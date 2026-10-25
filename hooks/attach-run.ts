// The attach button: the system's file picker, and the paths it gives put in the prompt box. Windows has its own
// picker; macOS is known by /usr/bin/osascript being there and runs it by that path; elsewhere Linux's zenity, then
// kdialog.
import type { ProcessRunResult } from 'claude-code'
import type { TFn } from './lib/i18n'
import { isWindows, powershellPath } from './lib/platform'
import type { Engine } from './runtime'
import { ATTACH_TIMEOUT_MS, LINUX_PICKERS, MAC_PICKER, MAC_PICKER_PATH, WINDOWS_PICKER_ARGS, mentionText, pickedPaths } from './tools/attach'

// A run rejected this close to the timeout was a picker left open, not one that could not start.
const TIMEOUT_SLACK_MS = 5_000

// What a picker did: printed paths, was closed with none (or left open past the timeout), failed for another reason,
// or could not start at all.
type Picked = { kind: 'paths'; paths: string[] } | { kind: 'none' } | { kind: 'failed' } | { kind: 'absent' }

// The engine rejects a command that cannot start and one still running at the timeout alike; the time it took tells
// them apart. A non-zero exit is a cancel when it says so (osascript's -128) or the picker's plain no (exit 1).
async function runPicker(engine: Engine, argv: readonly string[]): Promise<Picked> {
  const started = await engine.clock.now()
  const result: ProcessRunResult | null = await engine.process.run(argv, { timeoutMs: ATTACH_TIMEOUT_MS }).catch(() => null)
  if (result === null) return (await engine.clock.now()) - started >= ATTACH_TIMEOUT_MS - TIMEOUT_SLACK_MS ? { kind: 'none' } : { kind: 'absent' }
  if (result.exitCode === 0) return { kind: 'paths', paths: pickedPaths(result.stdout) }
  return result.exitCode === 1 || result.stderr.includes('-128') ? { kind: 'none' } : { kind: 'failed' }
}

async function pickOnLinux(engine: Engine): Promise<Picked | 'no-display'> {
  if ((await engine.env.get('DISPLAY')) === undefined && (await engine.env.get('WAYLAND_DISPLAY')) === undefined) return 'no-display'
  for (const argv of LINUX_PICKERS) {
    const picked = await runPicker(engine, argv)
    if (picked.kind !== 'absent') return picked
  }
  return { kind: 'absent' }
}

// One picker at a time: a second press while one is open does nothing.
let isPicking = false

export async function runAttach(engine: Engine, t: TFn): Promise<void> {
  if (isPicking) return
  isPicking = true
  try {
    await pickAndFill(engine, t)
  } finally {
    isPicking = false
  }
}

async function pickAndFill(engine: Engine, t: TFn): Promise<void> {
  const windows = isWindows(await engine.env.get('OS'))
  // macOS has osascript where every Mac keeps it; a Mac never falls through to the Linux pickers.
  const isMac = !windows && (await engine.fs.exists(MAC_PICKER_PATH))
  const picked = windows
    ? await runPicker(engine, [powershellPath(await engine.env.get('SystemRoot')), ...WINDOWS_PICKER_ARGS])
    : isMac ? await runPicker(engine, MAC_PICKER) : await pickOnLinux(engine)
  if (picked === 'no-display') return engine.ui.toast(t('toast.attachNoDisplay'))
  if (picked.kind === 'absent') return engine.ui.toast(t(windows || isMac ? 'toast.attachFailed' : 'toast.attachInstall'))
  if (picked.kind === 'failed') return engine.ui.toast(t('toast.attachFailed'))
  if (picked.kind === 'none') return
  // Only files that are there: a name with a line break could leave a stray relative line.
  const there = (await Promise.all(picked.paths.map(async path => ((await engine.fs.exists(path)) ? [path] : [])))).flat()
  if (there.length === 0) return
  const filled = await engine.prompt.fill({ text: mentionText(there), mode: 'insert' })
  if (!filled.isFilled) engine.ui.toast(t('toast.attachFillRejected', { paths: there.join(' ') }))
}
