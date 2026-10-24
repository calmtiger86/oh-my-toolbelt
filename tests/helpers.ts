// Shared set-up for the hook tests. Not a test file: the runner only loads *.test.ts(x).
// `boot` registers every stub before the first call on `$`, then fires session.start.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { CommandInfo, ConfigRow, On, PaneOpenArgs, RenderSurface, RenderViewport, UiNotifyResult } from 'claude-code'
import type { ButtonConfig, ToolButton } from '../types/index'

export const PLUGIN = 'oh-my-toolbelt'
export const SURFACES = ['terminal', 'desktop'] as const
// 2026-10-22 05:32:00 UTC: with `TEST_OPTIONS` the clock reads 05:32.
export const NOW = Date.UTC(2026, 9, 22, 5, 32, 0)
// Attach and the date are off here, as most band tests measure widths without them; tests/attach.test.tsx and the
// date's own tests turn them on.
export const TEST_OPTIONS = { clockFormat: '24', timeZone: 'UTC', attachEnabled: false, dateFormat: 'off' } as const
// The limit for the tests that run the clock through a whole round, or draw hundreds of rows: a CI runner on Linux or
// Windows runs them four to five times slower than a Mac (measured on the first run), past the kit's 5000 ms.
export const SLOW_MS = 120_000

// A fs hook gets its path made absolute on the host (test.md: compare with endsWith): on a Windows runner `/work/a.md`
// arrives as `D:\work\a.md`, and on a Mac `C:\a.md` as `<repo>/C:\a.md`. Stubs keep and compare paths in one form:
// no leading drive, forward slashes.
export const hostless = (path: string): string => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
export const isSamePath = (got: string, wrote: string): boolean => hostless(got).endsWith(hostless(wrote))
// The mod's own plugin.json, whatever separators the host's path uses (Windows hands hooks backslashes).
export const isManifestPath = (path: string): boolean => hostless(path).endsWith('/.claude-plugin/plugin.json')

export const COMMANDS: CommandInfo[] = [
  { name: 'usage', description: '', source: 'builtin' },
  { name: 'deslop', description: '', source: 'plugin', plugin: 'other' },
]

export type Calls = {
  registered: string[]
  // The names registered to run at once while a turn is in flight.
  immediate: string[]
  ran: { command: string; args: string }[]
  filled: string[]
  // The `mode` of each fill: replace, append or insert.
  fillModes: string[]
  submitted: string[]
  toasts: string[]
  notified: string[]
  played: string[]
  opened: PaneOpenArgs[]
  // How many times a hook asked for the screen to be drawn again.
  invalidated: number
  closed: number
  // What the engine stand-in for the band below ours was asked to draw with.
  belowMaxRows: number[]
  // Lines sent to `$.ui.log`.
  logged: string[]
}

// A failure the test turns on and off while it runs.
export type Switch = { on: boolean }

export type BootOptions = {
  surface?: RenderSurface
  // false: a session an SDK host starts (the desktop app), with no surface until one attaches.
  isInteractive?: boolean
  env?: Record<string, string>
  store?: Record<string, unknown>
  commands?: CommandInfo[]
  // The /config rows `$.config.list()` answers.
  settings?: ConfigRow[]
  notify?: UiNotifyResult
  // Command names whose registration the engine refuses.
  refuse?: string[]
  // Command names whose run the engine refuses.
  failRun?: string[]
  // The band beneath ours fails instead of drawing.
  belowThrows?: boolean
  // Store keys whose reads fail.
  failGet?: string[]
  failSet?: Switch
  // While on, `$.state.get` and `$.state.set` throw.
  failStateGet?: Switch
  failStateSet?: Switch
  // While on, the host refuses the clock tick's `clock.every` periods, which ends that interval.
  refuseTick?: Switch
  // Runs after the stubs and before session.start (a band drawn early).
  beforeStart?: () => Promise<void>
  // Awaited before the first `$.session.surfaces()` answer, so a surface can attach while the start waits for it.
  firstSurfaces?: () => Promise<void>
}

export type Booted = { clock: MockClock; store: Map<string, unknown>; calls: Calls }

function stubEngine(on: On, o: BootOptions, store: Map<string, unknown>, calls: Calls): void {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The surfaces drawn on: the start's, then each one attached.
  let surfaces: readonly RenderSurface[] = o.isInteractive === false ? [] : [o.surface ?? 'terminal']
  on('session.attach', (_, e) => {
    surfaces = [...new Set([...surfaces, e.surface])]
    return { clientId: e.clientId }
  })
  let waitFirst = o.firstSurfaces
  on('session.surfaces', async () => {
    const wait = waitFirst
    waitFirst = undefined
    if (wait !== undefined) await wait()
    return { value: surfaces }
  })
  on('classic.SessionStart', () => ({}))
  on('command.list', () => ({ value: o.commands ?? COMMANDS }))
  on('config.list', () => ({ value: o.settings ?? [] }))
  on('command.register', (_, e) => {
    calls.registered.push(e.name)
    if (e.immediate === true) calls.immediate.push(e.name)
    return o.refuse?.includes(e.name) ? { deny: `/${e.name} is taken` } : { value: { command: e.name } }
  })
  on('command.run', (_, e) => {
    calls.ran.push({ command: e.command, args: e.args })
    if (o.failRun?.includes(e.command)) throw new Error(`/${e.command} refused`)
    return { text: '' }
  })
  on('store.get', (_, e) => {
    if (o.failGet?.includes(e.key)) throw new Error('read failed')
    return { value: store.get(e.key) }
  })
  on('store.set', (_, e) => {
    if (o.failSet?.on) throw new Error('disk full')
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
}

function stubSurface(on: On, o: BootOptions, calls: Calls): void {
  let isOpen = false
  on('ui.open', (_, e) => (calls.opened.push(e), (isOpen = true), { value: { isPlaced: true } }))
  on('ui.invalidate', (_, e, next) => ((calls.invalidated += 1), next(e)))
  on('ui.close', () => ((calls.closed += 1), (isOpen = false), { value: undefined }))
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'oh-my-toolbelt', title: 'Toolbelt', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('ui.toast', (_, e) => (calls.toasts.push(e.text), { value: undefined }))
  // An autoFocus field (the new set's name) moves the ring; the ring stays where the chain left it.
  on('ui.focus', () => ({}))
  on('ui.log', (_, e) => (calls.logged.push(e.text), { value: undefined }))
  on('ui.notify', (_, e) => (calls.notified.push(e.text), { value: o.notify ?? { isSent: true, channel: 'kitty' } }))
  on('audio.play', (_, e) => (calls.played.push(e.clip.asset ?? ''), { value: undefined }))
  on('prompt.fill', (_, e) => (calls.filled.push(e.text), calls.fillModes.push(e.mode), { isFilled: true }))
  on('prompt.submit', (_, e) => (calls.submitted.push(e.text), { text: e.text }))
  // Stands for another mod's band (and anything else drawn beneath ours).
  on('ui.render', ($, e) => {
    if (o.belowThrows) throw new Error('the band below failed')
    if (e.component === 'AbovePrompt') calls.belowMaxRows.push(e.props.maxRows)
    return $.ui.resolve(e).Text({ children: 'engine' })
  })
}

// Failures switched on by the test. The tick hook has a matcher and comes before mock.clock, so it
// sits above the mock's own hook for the 1-second period.
function stubFailures(on: On, o: BootOptions): void {
  // A throwing test hook is skipped, so these refuse instead.
  on('state.get', (_, e, next) => (o.failStateGet?.on ? { deny: 'state unreadable' } : next(e)))
  on('state.set', (_, e, next) => (o.failStateSet?.on ? { deny: 'state refused' } : next(e)))
  on('clock.every', { ms: 1000 }, (_, e, next) => (o.refuseTick?.on ? { deny: 'period refused' } : next(e)))
}

export async function boot($: Engine, on: On, o: BootOptions = {}): Promise<Booted> {
  const store = new Map(Object.entries(o.store ?? {}))
  const calls: Calls = { registered: [], immediate: [], ran: [], filled: [], fillModes: [], submitted: [], toasts: [], notified: [], played: [], opened: [], invalidated: 0, closed: 0, belowMaxRows: [], logged: [] }
  stubEngine(on, o, store, calls)
  stubSurface(on, o, calls)
  stubFailures(on, o)
  mock.env(on, o.env ?? { LANG: 'en_US.UTF-8' })
  const clock = mock.clock(on, { now: NOW })
  if (o.beforeStart) await o.beforeStart()
  const isInteractive = o.isInteractive ?? true
  await $.session.start({ cwd: '/work', surface: isInteractive ? (o.surface ?? 'terminal') : null, isInteractive })
  return { clock, store, calls }
}

// A command typed by the person (or, with `origin`, sent by someone else).
export function runCommand($: Engine, command: 'toolbelt' | 'tb', args: string, origin: 'composer' | 'sdk' | 'plugin' = 'composer') {
  return $.command.run({ command, args, origin: origin === 'plugin' ? { kind: origin, name: 'other-mod' } : { kind: origin }, presentation: { isFullscreen: false, columns: 120 } })
}

export const bandProps = (bodyColumns: number, over: { hasSurvey?: boolean; agentId?: string } = {}) => ({
  hasSurvey: over.hasSurvey ?? false,
  isWorking: false,
  maxRows: 6,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 5 },
  view: over.agentId === undefined ? {} : { agentId: over.agentId },
})

export const mountBand = <P extends RenderSurface>($: Engine, surface: P, bodyColumns: number, over: { hasSurvey?: boolean; agentId?: string } = {}) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: bandProps(bodyColumns, over) })

// `viewport` as the surface measured it; a terminal says whether Claude Code draws it in full.
export const mountPane = <P extends RenderSurface>($: Engine, surface: P, bodyColumns = 80, viewport?: RenderViewport) =>
  $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PLUGIN,
    ...(viewport === undefined ? {} : { viewport }),
    props: { title: 'Toolbelt', isFocused: true, bodyColumns, placement: 'inline', scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })

const button = (b: ToolButton): ToolButton => b

// The two example buttons plus a skill with a hotkey and a prompt with a long label.
export function seedButtons(): ButtonConfig {
  return {
    version: 1,
    activeSet: 'default',
    sets: {
      default: [
        button({ id: 'ex-review', kind: 'prompt', label: 'Review', text: 'Review it.', mode: 'fill' }),
        button({ id: 'ex-usage', kind: 'command', label: '/usage', command: 'usage', mode: 'run' }),
        button({ id: 'b-deslop', kind: 'skill', label: 'Deslop', command: 'deslop', hotkey: 's', mode: 'run' }),
        button({ id: 'b-commit', kind: 'prompt', label: 'Commit message', text: 'Write the commit message.', mode: 'send' }),
      ],
    },
  }
}

// Every key drawn in a mounted tree, in document order.
export function keysOf(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return []
  const element = node as { props?: { key?: unknown }; children?: unknown[] }
  const own = typeof element.props?.key === 'string' ? [element.props.key] : []
  return [...own, ...(element.children ?? []).flatMap(keysOf)]
}

// The panel's lists (hooks/picker.tsx): a button opens its choices, each a Button keyed `<key>/<value>`, the one in
// use drawn without dimColor.
type PaneMount = { press: (target: { key: string }) => Promise<unknown>; drawn: () => Promise<unknown> }
type DrawnNode = { props?: Record<string, unknown>; children?: unknown[] }

function nodesOf(node: unknown): DrawnNode[] {
  if (typeof node !== 'object' || node === null) return []
  const element = node as DrawnNode
  return [element, ...(element.children ?? []).flatMap(nodesOf)]
}

const choicesIn = async (pane: PaneMount, key: string): Promise<DrawnNode[]> =>
  nodesOf(await pane.drawn()).filter(node => typeof node.props?.key === 'string' && node.props.key.startsWith(`${key}/`))

// Open the list unless it is open, then press the choice.
export async function pick(pane: PaneMount, key: string, value: string): Promise<void> {
  if ((await choicesIn(pane, key)).length === 0) await pane.press({ key })
  await pane.press({ key: `${key}/${value}` })
}

// A list's values in order and the one in use; the list is left as it was found.
export async function listOf(pane: PaneMount, key: string): Promise<{ values: string[]; current: string | undefined }> {
  const wasOpen = (await choicesIn(pane, key)).length > 0
  if (!wasOpen) await pane.press({ key })
  const choices = await choicesIn(pane, key)
  if (!wasOpen) await pane.press({ key })
  const valueOf = (node: DrawnNode) => String(node.props?.key).slice(key.length + 1)
  return { values: choices.map(valueOf), current: choices.filter(node => node.props?.dimColor !== true).map(valueOf)[0] }
}
