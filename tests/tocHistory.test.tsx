// The prompts tab's earlier prompts: after a reload, a launch or /resume the session's transcript file lists the
// prompts sent before, in order and with their turns; a drawn row joins its listed prompt; a file past 4 MiB streams
// through tail; a failure leaves the drawn rows. The disk and the commands are stubs.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { EngineInterface, On, RenderSurface } from 'claude-code'
import { engineOf } from '../hooks/register'
import { readRows } from '../hooks/toc-history'
import { READ_CAP, TAIL_PATH } from '../hooks/tools/transcript'
import { NOW, PLUGIN, SURFACES, TEST_OPTIONS, boot, hostless, isManifestPath, mountBand, mountPane, runCommand, test } from './helpers'

const SESSION_ID = '0d6c2f1e-5b7a-4c38-9e21-3f4a5b6c7d8e'
const FOLDER = '/home/me/.claude/projects/-work'
const PATH = `${FOLDER}/${SESSION_ID}.jsonl`
const REMEMBERED = { [`transcript:${SESSION_ID}`]: { path: PATH, at: 1 } }
const id = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
// A message the engine splits is drawn under ids whose last group is the row's index (2.1.283).
const part = (n: number, k: number): string => `${id(n).slice(0, 24)}${String(100 + k).padStart(12, '0')}`

const promptRow = (n: number, parent: number | null, text: string): string =>
  JSON.stringify({ type: 'user', uuid: id(n), parentUuid: parent === null ? null : id(parent), origin: { kind: 'human' }, message: { role: 'user', content: text } })
const replyRow = (n: number, parent: number, uses: { id: string; name: string; path: string }[] = []): string =>
  JSON.stringify({ type: 'assistant', uuid: id(n), parentUuid: id(parent), message: { role: 'assistant', content: uses.map(use => ({ type: 'tool_use', id: use.id, name: use.name, input: { file_path: use.path } })) } })
const durationRow = (n: number, parent: number, ms: number): string => JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: id(n), parentUuid: id(parent), durationMs: ms })

const FILE = `${[
  promptRow(1, null, 'first'),
  replyRow(2, 1, [{ id: 't1', name: 'Edit', path: '/work/app.ts' }]),
  durationRow(3, 2, 5000),
  promptRow(4, 3, 'second'),
  replyRow(5, 4),
  'a torn line {"uuid":',
  promptRow(6, 5, 'third'),
  replyRow(7, 6),
].join('\n')}\n`

// The disk and the commands beneath the mod: `$.session.id()`, the files by path, `tail` printing a file in pieces
// that cut its lines. Registered before boot, as every stub must be.
// `paused`: the stream of that path waits after its first piece `until` it is let go; `onEnd` says, as the stream ends
// or is ended, whether it was read whole.
type Disk = { reads: string[]; spawned: string[][] }
type Paused = { path: string; until: Promise<void>; onEnd: (isWhole: boolean) => void }
// `manifest`: the mod's own plugin.json, served from wherever the engine says the mod is.
function stubDisk(on: On, files: Record<string, string>, o: { size?: number; refuseRead?: boolean; paused?: Paused; manifest?: string } = {}): Disk {
  const disk: Disk = { reads: [], spawned: [] }
  // Kept and looked up without the host's drive (helpers.ts `hostless`).
  const held = new Map(Object.entries(files).map(([path, text]) => [hostless(path), text]))
  on('session.id', () => ({ value: SESSION_ID }))
  on('fs.exists', (_, e) => ({ value: held.has(hostless(e.path)) }))
  on('fs.stat', (_, e) => {
    const text = held.get(hostless(e.path))
    return text === undefined ? { deny: 'ENOENT: no such file' } : { value: { kind: 'file' as const, size: o.size ?? text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_, e) => {
    // The mod's own plugin.json (its rows, its version) is no transcript read.
    if (isManifestPath(e.path)) return o.manifest === undefined ? { deny: 'ENOENT: no such file' } : { value: o.manifest }
    disk.reads.push(hostless(e.path))
    const text = held.get(hostless(e.path))
    return o.refuseRead === true || text === undefined ? { deny: 'EACCES: permission denied' } : { value: text }
  })
  on('process.spawn', async function* (_, e) {
    disk.spawned.push([...e.argv])
    const text = held.get(hostless(e.argv.at(-1) ?? ''))
    if (e.argv[0] !== 'tail' || text === undefined) return { deny: 'not found' }
    const pause = o.paused?.path === e.argv.at(-1) ? o.paused : undefined
    let isWhole = false
    try {
      for (let at = 0; at < text.length; at += 70) {
        yield { stream: 'stdout' as const, text: text.slice(at, at + 70) }
        if (at === 0) await pause?.until
      }
      isWhole = true
      return { value: { code: 0, signal: null } }
    } finally {
      pause?.onEnd(isWhole)
    }
  })
  return disk
}

type Place = { first: number; last: number; of: number } | null
const at = (first: number): Place => ({ first, last: first + 3, of: first + 5 })
const mountPrompt = ($: Engine, requestId: string, text: string, onScreen: Place = null) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId, props: { text, origin: { kind: 'composer' as const }, isExpanded: false, onScreen } })
const mountReply = ($: Engine, requestId: string, onScreen: Place) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', requestId, props: { text: 'reply', isFirstOfReply: true, onScreen } })

type Found = { key?: string; text: string }
type Pane = { findAll: (query: { type: 'Button' }) => Promise<Found[]>; drawn: () => Promise<unknown>; press: (target: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
async function openToc($: Engine, surface: RenderSurface = 'terminal'): Promise<Pane> {
  const pane = await mountPane($, surface)
  await pane.press({ key: 'tab-toc' })
  return pane
}
const labels = async (pane: Pane): Promise<string[]> => (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => b.text)
const keys = async (pane: Pane): Promise<string[]> => (await pane.findAll({ type: 'Button' })).flatMap(b => (b.key?.startsWith('toc-') ? [b.key] : []))

// The drawn element under a key, and every string beneath it.
type Drawn = { props?: { key?: unknown }; children?: unknown[] }
function drawnKey(node: unknown, key: string): Drawn | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const element = node as Drawn
  if (element.props?.key === key) return element
  return (element.children ?? []).map(child => drawnKey(child, key)).find(found => found !== undefined)
}
const textOf = (node: unknown): string =>
  typeof node === 'string' ? node : typeof node === 'object' && node !== null ? ((node as Drawn).children ?? []).map(textOf).join('\n') : ''

test('after a reload the transcript lists the prompts sent before, in order and with their turns, on both surfaces', { options: TEST_OPTIONS }, async ($, on) => {
  const disk = stubDisk(on, { [PATH]: FILE })
  await boot($, on, { store: REMEMBERED })
  expect(disk).toEqual({ reads: [PATH], spawned: [] })
  for (const surface of SURFACES) {
    const pane = await openToc($, surface)
    expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third'])
    const band = await mountBand($, surface, 160)
    expect(textOf(drawnKey(await band.drawn(), 'band-card-toc-1'))).toContain('5s · Tools: 1 · app.ts')
    await band.unmount()
    await pane.unmount()
  }
})

test('a drawn row joins its listed prompt, a split one lends the jump its id, a reply places the reader, a new prompt follows', { options: TEST_OPTIONS }, async ($, on) => {
  stubDisk(on, { [PATH]: FILE })
  const { clock } = await boot($, on, { store: REMEMBERED })
  await mountPrompt($, id(4), 'second')
  await mountPrompt($, part(6, 0), 'third')
  await mountPrompt($, id(8), 'fourth')
  // The second prompt's reply, as the file says, is at the top of the conversation.
  await mountReply($, id(5), at(0))
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. first', '━ 2. second', '─ 3. third', '─ 4. fourth'])
  // A row's key names the id its press scrolls to (the test host answers no scroll of the conversation).
  expect(await keys(pane)).toEqual([`toc-${id(1)}`, `toc-${id(4)}`, `toc-${part(6, 0)}`, `toc-${id(8)}`])
  await pane.unmount()
})

// Regression: a row opened in the desktop app closed once its prompt was drawn under another id.
test('a row opened in the desktop app stays open when its prompt is drawn under another id', { options: TEST_OPTIONS }, async ($, on) => {
  stubDisk(on, { [PATH]: FILE })
  on('session.messages', () => ({ value: [{ role: 'user', text: 'third', toolUses: [] }, { role: 'assistant', text: 'Third answer.', toolUses: [] }] as never }))
  const { clock } = await boot($, on, { store: REMEMBERED })
  const pane = await openToc($, 'desktop')
  await pane.press({ key: `toc-${id(6)}` })
  expect(textOf(await pane.drawn())).toContain('Third answer.')
  await mountPrompt($, part(6, 0), 'third')
  await clock.advance(300)
  expect(await keys(pane)).toContain(`toc-${part(6, 0)}`)
  expect(textOf(await pane.drawn())).toContain('Third answer.')
  await pane.unmount()
})

test('a prompt delivered into a turn, a queued_command row in the file, is listed once with its words; its drawn row adds none', { options: TEST_OPTIONS }, async ($, on) => {
  const queued = JSON.stringify({ type: 'attachment', uuid: id(3), parentUuid: id(2), attachment: { type: 'queued_command', prompt: 'second', origin: { kind: 'human' }, source_uuid: 'queued', humanTurn: true } })
  const file = `${[
    promptRow(1, null, 'first'),
    replyRow(2, 1),
    queued,
    replyRow(4, 3, [{ id: 't9', name: 'Edit', path: '/work/b.ts' }]),
    durationRow(5, 4, 2000),
  ].join('\n')}\n`
  stubDisk(on, { [PATH]: file })
  const { clock } = await boot($, on, { store: REMEMBERED })
  await mountPrompt($, id(3), 'second')
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await openToc($, surface)
    expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second'])
    // The turn stays with the prompt that started it.
    const band = await mountBand($, surface, 160)
    expect(textOf(drawnKey(await band.drawn(), 'band-card-toc-1'))).toContain('2s · Tools: 1 · b.ts')
    await band.unmount()
    await pane.unmount()
  }
})

test('a launch\'s SessionStart before session.start is kept and read once the session starts; the path is remembered', { options: TEST_OPTIONS }, async ($, on) => {
  const disk = stubDisk(on, { [PATH]: FILE })
  const beforeStart = async () => {
    await $.classic.SessionStart({ source: 'startup', session_id: SESSION_ID, transcript_path: PATH })
    expect(disk.reads).toEqual([])
  }
  const { store, clock } = await boot($, on, { beforeStart })
  expect(disk.reads).toEqual([PATH])
  expect(store.get(`transcript:${SESSION_ID}`)).toEqual({ path: PATH, at: NOW })
  // A compact SessionStart on the same file reads nothing again.
  await $.classic.SessionStart({ source: 'compact', session_id: SESSION_ID, transcript_path: PATH })
  expect(disk.reads).toEqual([PATH])
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third'])
  await pane.unmount()
})

test('/resume to another conversation lists that file\'s prompts alone; /clear starts empty and remembers its new file', { options: TEST_OPTIONS }, async ($, on) => {
  const [otherId, clearedId] = ['1a2b3c4d-0000-4000-8000-00000000000a', '1a2b3c4d-0000-4000-8000-00000000000b']
  const other = `${FOLDER}/${otherId}.jsonl`
  const disk = stubDisk(on, { [PATH]: FILE, [other]: `${promptRow(11, null, 'elsewhere')}\n` })
  const { store, clock } = await boot($, on, { store: REMEMBERED })
  const drawn = await mountPrompt($, id(9), 'drawn here, not stored yet')
  // The conversation resumed draws its own rows; the old ones are gone.
  await drawn.unmount()
  await $.classic.SessionStart({ source: 'resume', session_id: otherId, transcript_path: other })
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. elsewhere'])
  expect(store.get(`transcript:${otherId}`)).toEqual({ path: other, at: NOW })
  await $.classic.SessionStart({ source: 'clear', session_id: clearedId, transcript_path: `${FOLDER}/${clearedId}.jsonl` })
  await clock.advance(300)
  expect(await labels(pane)).toEqual([])
  expect(store.get(`transcript:${clearedId}`)).toEqual({ path: `${FOLDER}/${clearedId}.jsonl`, at: NOW + 300 })
  expect(disk.reads).toEqual([PATH, other])
  // Back to the conversation read last before /clear: its file is read again, as it is on screen again.
  await $.classic.SessionStart({ source: 'resume', session_id: otherId, transcript_path: other })
  await clock.advance(300)
  expect(await labels(pane)).toEqual(['─ 1. elsewhere'])
  expect(disk.reads).toEqual([PATH, other, other])
  await pane.unmount()
})

test('a file past 4 MiB streams through tail without holding the start, and fills the tab once read', { options: TEST_OPTIONS }, async ($, on) => {
  const disk = stubDisk(on, { [PATH]: FILE }, { size: READ_CAP + 1 })
  const { clock } = await boot($, on, { store: REMEMBERED })
  await clock.advance(300)
  const pane = await openToc($)
  expect(disk).toEqual({ reads: [], spawned: [['tail', '-c', '+1', '--', PATH]] })
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third'])
  await pane.unmount()
})

// Security: /resume while a long file streams stops that read at its next piece and ends its command, even when the
// person comes back to that conversation before it ends: the read started then is the one that fills.
test('a stream of a conversation left meanwhile stops and its command ends; the conversation on screen fills', { options: TEST_OPTIONS }, async ($, on) => {
  const otherId = '1a2b3c4d-0000-4000-8000-00000000000c'
  const other = `${FOLDER}/${otherId}.jsonl`
  let letGo = (): void => undefined
  const until = new Promise<void>(resolve => (letGo = resolve))
  const ends: boolean[] = []
  const disk = stubDisk(on, { [PATH]: FILE, [other]: `${promptRow(11, null, 'elsewhere')}\n` }, { size: READ_CAP + 1, paused: { path: PATH, until, onEnd: isWhole => ends.push(isWhole) } })
  const { calls, clock } = await boot($, on, { store: REMEMBERED })
  await $.classic.SessionStart({ source: 'resume', session_id: otherId, transcript_path: other })
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. elsewhere'])
  await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID, transcript_path: PATH })
  letGo()
  await clock.advance(300)
  expect(disk.spawned.map(argv => argv.at(-1))).toEqual([PATH, other, PATH])
  expect([...ends].sort()).toEqual([false, true])
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third'])
  expect(calls.logged.filter(line => line.includes('transcript'))).toEqual([])
  await pane.unmount()
})

test('a file that cannot be read leaves the drawn rows and logs one line; a file not there yet logs nothing', { options: TEST_OPTIONS }, async ($, on) => {
  stubDisk(on, { [PATH]: FILE }, { refuseRead: true })
  const { calls, clock } = await boot($, on, { store: REMEMBERED })
  await $.classic.SessionStart({ source: 'resume', session_id: 'abcdef12-0000-4000-8000-000000000000', transcript_path: `${FOLDER}/missing.jsonl` })
  await mountPrompt($, id(8), 'drawn')
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. drawn'])
  expect(calls.logged.filter(line => line.includes('transcript'))).toEqual(['oh-my-toolbelt: transcript read failed: oh-my-toolbelt: $.fs.read: EACCES: permission denied'])
  await pane.unmount()
})

test('the store keeps the newest 20 sessions\' files, and a remembered path not named after the session is not read', { options: TEST_OPTIONS }, async ($, on) => {
  const older = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`transcript:s${i}`, { path: `${FOLDER}/s${i}.jsonl`, at: i }]))
  const disk = stubDisk(on, { [PATH]: FILE, '/etc/hosts': 'x' })
  const { store } = await boot($, on, { store: { ...older, [`transcript:${SESSION_ID}`]: { path: '/etc/hosts', at: 99 } } })
  expect(disk.reads).toEqual([])
  await $.classic.SessionStart({ source: 'startup', session_id: SESSION_ID, transcript_path: PATH })
  expect(disk.reads).toEqual([PATH])
  const kept = [...store.keys()].filter(key => key.startsWith('transcript:'))
  expect(kept).toHaveLength(20)
  expect(kept).not.toContain('transcript:s0')
  expect(store.get(`transcript:${SESSION_ID}`)).toEqual({ path: PATH, at: NOW })
})

// The desktop app's status tab applies a change without a reload (hooks/own-settings.ts), and nothing noted the prompts
// while the tab was off, so turning it on reads the file at once.
test('the prompts tab turned on in the desktop app reads the conversation file at once', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { tocTab: { type: 'boolean', title: 'Prompts tab', default: true } } })
  const disk = stubDisk(on, { [PATH]: FILE }, { manifest })
  await boot($, on, { isInteractive: false, store: REMEMBERED })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(disk.reads).toEqual([])
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const status = await mountPane($, 'desktop')
  await status.press({ key: 'setting-oh-my-toolbelt.tocTab' })
  await status.unmount()
  expect(disk.reads).toEqual([PATH])
  const pane = await openToc($, 'desktop')
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third'])
  await pane.unmount()
})

// Regression: a reload in the middle of a turn (new options, a changed file) started the module over as if no turn ran,
// so a prompt sent before the turn ended was listed once for each of the three ids the engine draws it under (seen in
// 2.1.310). The desktop app's tab turned on during a turn, with no reload, forgot the same way.
test('a prompt sent into a turn that ran before the prompts tab came on is listed once', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const manifest = JSON.stringify({ userConfig: { tocTab: { type: 'boolean', title: 'Prompts tab', default: true } } })
  stubDisk(on, { [PATH]: FILE }, { manifest })
  const { clock } = await boot($, on, { isInteractive: false, store: REMEMBERED })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'third', turnId: 't3' })
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const status = await mountPane($, 'desktop')
  await status.press({ key: 'setting-oh-my-toolbelt.tocTab' })
  await status.unmount()
  await $.prompt.submit({ text: 'fourth', wait: false, origin: { kind: 'composer' } })
  for (const n of [11, 12, 13]) {
    await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'UserMessage', requestId: id(n), props: { text: 'fourth', origin: { kind: 'composer' as const }, isExpanded: false } })
    await clock.advance(1000)
  }
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't3', reason: 'answer' })
  const pane = await openToc($, 'desktop')
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third', '─ 4. fourth'])
  await pane.unmount()
})

// Regression (review M1): reading whether a turn runs after `live` was spread wrote back the copy taken before the read,
// so a row drawn while the read waited was lost.
test('a row drawn while the tab reads whether a turn runs is kept', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  let release = (): void => undefined
  const gate = new Promise<void>(resolve => (release = resolve))
  let entered = (): void => undefined
  const inRead = new Promise<void>(resolve => (entered = resolve))
  let isArmed = false
  // Above boot's own state stubs, by its matcher.
  on('state.get', { plugin: 'oh-my-toolbelt', key: 'turnRunning' }, async (_, e, next) => {
    if (isArmed) {
      isArmed = false
      entered()
      await gate
    }
    return next(e)
  })
  const manifest = JSON.stringify({ userConfig: { tocTab: { type: 'boolean', title: 'Prompts tab', default: true } } })
  stubDisk(on, { [PATH]: FILE }, { manifest })
  await boot($, on, { isInteractive: false, store: REMEMBERED })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.turn.start({ text: 'third', turnId: 't3' })
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const status = await mountPane($, 'desktop')
  isArmed = true
  const pressing = status.press({ key: 'setting-oh-my-toolbelt.tocTab' })
  await inRead
  await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'UserMessage', requestId: id(11), props: { text: 'fourth', origin: { kind: 'composer' as const }, isExpanded: false } })
  release()
  await pressing
  await status.unmount()
  const pane = await openToc($, 'desktop')
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third', '─ 4. fourth'])
  await pane.unmount()
})

// Regression (review L1): another conversation's file empties the table, which forgot that a turn runs, so a prompt sent
// into it was listed again for each id the engine draws it under.
test('after /resume, a prompt sent into a turn that ran before the tab came back on is listed once', { options: TEST_OPTIONS }, async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const other = '1a2b3c4d-0000-4000-8000-00000000000d'
  const otherPath = `${FOLDER}/${other}.jsonl`
  const manifest = JSON.stringify({ userConfig: { tocTab: { type: 'boolean', title: 'Prompts tab', default: true } } })
  stubDisk(on, { [PATH]: FILE, [otherPath]: FILE }, { manifest })
  const { clock } = await boot($, on, { isInteractive: false, store: REMEMBERED })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const off = await mountPane($, 'desktop')
  await off.press({ key: 'setting-oh-my-toolbelt.tocTab' })
  await off.unmount()
  await $.classic.SessionStart({ source: 'resume', session_id: other, transcript_path: otherPath })
  await $.turn.start({ text: 'third', turnId: 't3' })
  const on2 = await mountPane($, 'desktop')
  await on2.press({ key: 'setting-oh-my-toolbelt.tocTab' })
  await on2.unmount()
  await $.prompt.submit({ text: 'fourth', wait: false, origin: { kind: 'composer' } })
  for (const n of [11, 12, 13]) {
    await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'UserMessage', requestId: id(n), props: { text: 'fourth', origin: { kind: 'composer' as const }, isExpanded: false } })
    await clock.advance(1000)
  }
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't3', reason: 'answer' })
  const pane = await openToc($, 'desktop')
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '─ 3. third', '─ 4. fourth'])
  await pane.unmount()
})

// Security: another hook may change the event; a path not named after the session is neither read nor remembered.
test('a SessionStart naming a file not named after its session reads and remembers nothing', { options: TEST_OPTIONS }, async ($, on) => {
  const disk = stubDisk(on, { [PATH]: FILE, '/Users/me/.ssh/config': 'x', [`${FOLDER}/x${SESSION_ID}.jsonl`]: FILE })
  const { store } = await boot($, on)
  await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID, transcript_path: '/Users/me/.ssh/config' })
  await $.classic.SessionStart({ source: 'resume', session_id: '', transcript_path: `${FOLDER}/.jsonl` })
  // The session's name must be the file's whole name, not the end of another one.
  await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID, transcript_path: `${FOLDER}/x${SESSION_ID}.jsonl` })
  expect(disk).toEqual({ reads: [], spawned: [] })
  expect([...store.keys()].filter(key => key.startsWith('transcript:'))).toEqual([])
})

test('with the prompts tab off no transcript is read or remembered', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  const disk = stubDisk(on, { [PATH]: FILE })
  const { store } = await boot($, on, { store: REMEMBERED })
  await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID, transcript_path: PATH })
  expect(disk).toEqual({ reads: [], spawned: [] })
  expect([...store.keys()].filter(key => key.startsWith('transcript:'))).toEqual([`transcript:${SESSION_ID}`])
})

// Regression: a SessionStart for another conversation whose path another hook changed left the earlier conversation's
// file named, so the prompts tab turned on later read that one.
test('a SessionStart whose file is not named after its session forgets the file named before', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { tocTab: { type: 'boolean', title: 'Prompts tab', default: true } } })
  const disk = stubDisk(on, { [PATH]: FILE }, { manifest })
  await boot($, on, { isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.classic.SessionStart({ source: 'startup', session_id: SESSION_ID, transcript_path: PATH })
  await $.classic.SessionStart({ source: 'resume', session_id: '1a2b3c4d-0000-4000-8000-00000000000c', transcript_path: '/Users/me/.ssh/config' })
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const status = await mountPane($, 'desktop')
  await status.press({ key: 'setting-oh-my-toolbelt.tocTab' })
  await status.unmount()
  expect(disk.reads).toEqual([])
})

// Regression: the turn another plugin's prompt or a skill the command button ran started went to the prompt before it,
// live and from the file alike; and 2.1.310 hands this mod the send button's prompt through session.append alone.
test('a turn no listed prompt started adds to no card, live and from the file alike; the send button\'s prompt is listed once', { options: TEST_OPTIONS }, async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const own = { kind: 'plugin', name: PLUGIN, asUser: true }
  const other = { kind: 'plugin', name: 'other', asUser: true }
  const command = { kind: 'plugin', name: PLUGIN }
  const wrapper = '<command-message>co</command-message>\n<command-name>/co</command-name>'
  const userRow = (n: number, text: string, origin: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    JSON.stringify({ type: 'user', uuid: id(n), parentUuid: id(n - 1), origin, message: { role: 'user', content: [{ type: 'text', text }] }, ...more })
  const file = `${[
    promptRow(1, null, 'first'), replyRow(2, 1, [{ id: 't1', name: 'Edit', path: '/work/app.ts' }]), durationRow(3, 2, 5000),
    userRow(4, 'From another plugin', other), replyRow(5, 4, [{ id: 't2', name: 'Bash', path: '-' }, { id: 't3', name: 'Bash', path: '-' }]), durationRow(6, 5, 60_000),
    userRow(7, 'Write the commit message.', own), replyRow(8, 7, [{ id: 't4', name: 'Bash', path: '-' }]), durationRow(9, 8, 83_000),
    userRow(10, wrapper, command), userRow(11, 'Base directory for this skill: /skills/co', command, { isMeta: true }), replyRow(12, 11, [{ id: 't5', name: 'Write', path: '/work/MEMORY.md' }]), durationRow(13, 12, 30_000),
  ].join('\n')}\n`
  const disk = stubDisk(on, { [PATH]: file })
  const { clock } = await boot($, on)
  expect(disk.reads).toEqual([])
  // The same rows as they come: each prompt's row appended, a person's and another plugin's drawn, a turn around each.
  type Sent = { n: number; text: string; origin: Record<string, unknown>; isMeta?: true; uses: { id: string; name: string; path?: string }[]; ms: number }
  const sent: Sent[] = [
    { n: 1, text: 'first', origin: { kind: 'composer' }, uses: [{ id: 't1', name: 'Edit', path: '/work/app.ts' }], ms: 5000 },
    { n: 4, text: 'From another plugin', origin: other, uses: [{ id: 't2', name: 'Bash' }, { id: 't3', name: 'Bash' }], ms: 60_000 },
    { n: 7, text: 'Write the commit message.', origin: own, uses: [{ id: 't4', name: 'Bash' }], ms: 83_000 },
    { n: 10, text: wrapper, origin: command, uses: [{ id: 't5', name: 'Write', path: '/work/MEMORY.md' }], ms: 30_000 },
  ]
  for (const { n, text, origin, uses, ms } of sent) {
    await $.session.append({ door: 'prompt', uuid: id(n), origin: origin as never, message: { type: 'user', role: 'user', content: [{ type: 'text', text }] } })
    if (n === 1 || n === 4) await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: id(n), props: { text, origin: origin as never, isExpanded: false } })
    if (n === 10) await $.session.append({ door: 'prompt', uuid: id(11), origin: command as never, message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: 'Base directory for this skill: /skills/co' }] } })
    await $.turn.start({ text, turnId: `t${n}` })
    const content = uses.map(use => ({ type: 'tool_use', id: use.id, name: use.name, input: use.path === undefined ? {} : { file_path: use.path } }))
    await $.session.append({ door: 'response', uuid: id(n + 1), origin: { kind: 'model', model: 'claude' }, message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...content] } })
    await $.turn.complete({ answer: 'done', durationMs: ms, isAborted: false, turnId: `t${n}`, reason: 'answer' })
  }
  await clock.advance(300)
  const cards = async () => {
    const band = await mountBand($, 'terminal', 160)
    const drawn = await band.drawn()
    await band.unmount()
    return [textOf(drawnKey(drawn, 'band-card-toc-1')), textOf(drawnKey(drawn, 'band-card-toc-2'))]
  }
  const live = await cards()
  expect(live[0]).toContain('#1 first · 5s · Tools: 1 · app.ts')
  expect(live[1]).toContain('#2 Write the commit message. · 1m 23s · Tools: 1')
  // The file read since lists the same two prompts, no row twice, with the same turns.
  await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID, transcript_path: PATH })
  expect(disk.reads).toEqual([PATH])
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. Write the commit message.'])
  await pane.unmount()
  expect(await cards()).toEqual(live)
})

// Regression: an interrupted turn may write no turn_duration row (2.1.295, 2.1.308), and the file then gave the next
// turn, a notification's, to the interrupted prompt, while the live tab, which ends a turn at turn.complete, gave it to
// none: the card changed across a reload.
test('a turn after an interrupted one with no turn_duration row adds to no card, live and from the file alike', { options: TEST_OPTIONS }, async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const notice = '<task-notification>\n<task-id>a1</task-id>\n</task-notification>'
  const userRow = (n: number, text: string, more: Record<string, unknown>) =>
    JSON.stringify({ type: 'user', uuid: id(n), parentUuid: id(n - 1), message: { role: 'user', content: [{ type: 'text', text }] }, ...more })
  const file = `${[
    promptRow(1, null, 'first'), replyRow(2, 1, [{ id: 't1', name: 'Edit', path: '/work/app.ts' }]), userRow(3, '[Request interrupted by user]', {}),
    userRow(4, notice, { origin: { kind: 'task-notification' } }), replyRow(5, 4, [{ id: 't2', name: 'Bash', path: '-' }, { id: 't3', name: 'Bash', path: '-' }]), durationRow(6, 5, 60_000),
    promptRow(7, 6, 'second'), replyRow(8, 7, [{ id: 't4', name: 'Bash', path: '-' }]), durationRow(9, 8, 2_000),
  ].join('\n')}\n`
  const disk = stubDisk(on, { [PATH]: file })
  const { clock } = await boot($, on)
  // The same turns as they come: the first interrupted (turn.complete `aborted`), then a notification's, then a prompt's.
  const append = (n: number, text: string, origin: Record<string, unknown>) =>
    $.session.append({ door: 'prompt', uuid: id(n), origin: origin as never, message: { type: 'user', role: 'user', content: [{ type: 'text', text }] } })
  const reply = (n: number, uses: { id: string; name: string; path?: string }[]) =>
    $.session.append({
      door: 'response', uuid: id(n), origin: { kind: 'model', model: 'claude' },
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...uses.map(use => ({ type: 'tool_use', id: use.id, name: use.name, input: use.path === undefined ? {} : { file_path: use.path } }))] },
    })
  const turns = [
    { n: 1, text: 'first', origin: { kind: 'composer' }, uses: [{ id: 't1', name: 'Edit', path: '/work/app.ts' }], ms: 12_000, reason: 'aborted' as const },
    { n: 4, text: notice, origin: { kind: 'task-notification' }, uses: [{ id: 't2', name: 'Bash' }, { id: 't3', name: 'Bash' }], ms: 60_000, reason: 'answer' as const },
    { n: 7, text: 'second', origin: { kind: 'composer' }, uses: [{ id: 't4', name: 'Bash' }], ms: 2_000, reason: 'answer' as const },
  ]
  for (const { n, text, origin, uses, ms, reason } of turns) {
    await append(n, text, origin)
    if (origin.kind === 'composer') await mountPrompt($, id(n), text)
    await $.turn.start({ text, turnId: `t${n}` })
    await reply(n + 1, uses)
    await $.turn.complete({ answer: 'done', durationMs: ms, isAborted: reason === 'aborted', turnId: `t${n}`, reason })
  }
  await clock.advance(300)
  const cards = async () => {
    const band = await mountBand($, 'terminal', 160)
    const drawn = await band.drawn()
    await band.unmount()
    return [textOf(drawnKey(drawn, 'band-card-toc-1')), textOf(drawnKey(drawn, 'band-card-toc-2'))]
  }
  const live = await cards()
  expect(live[0]).toContain('#1 first · 12s · Interrupted · Tools: 1 · app.ts')
  expect(live[1]).toContain('#2 second · 2s · Tools: 1')
  await $.classic.SessionStart({ source: 'resume', session_id: SESSION_ID, transcript_path: PATH })
  expect(disk.reads).toEqual([PATH])
  // The same cards from the file (the padding to the card's width aside), but for the interrupted turn's time, which
  // the file holds nowhere.
  expect((await cards()).map(card => card.trimEnd())).toEqual(live.map(card => card.replace(' · 12s', '').trimEnd()))
})

// ---- The 4 MiB boundary, with a stand-in for `$` ----
const failureOf = (reading: Promise<unknown>): Promise<string> => reading.then(() => '', (err: unknown) => (err instanceof Error ? err.message : String(err)))

type Spawned = { argv: readonly string[]; env?: Record<string, string> }
// `refused`: `$.fs.read` rejects, and `$.fs.stat` then says the file is `refused.size` long. `ended` lists each child
// as it ends or is ended, with whether it was read whole. `env` answers `$.env.get`, each read noted. `tail`: whether
// /usr/bin/tail is there, or the look for it is refused; by default it is not there.
type StandIn = { $: EngineInterface; calls: string[]; ended: string[] }
function standIn(o: { starts: (argv: readonly string[]) => boolean; code?: number; refused?: { size: number }; env?: Record<string, string>; tail?: 'there' | 'refused' }): StandIn {
  const calls: string[] = []
  const ended: string[] = []
  const child = (argv: readonly string[]) => {
    const pieces = (async function* () {
      let isWhole = false
      try {
        if (!o.starts(argv)) throw new Error(`${argv[0]}: command not found`)
        for (let at = 0; at < FILE.length; at += 64) yield { stream: 'stdout' as const, text: FILE.slice(at, at + 64) }
        yield { stream: 'stderr' as const, text: 'a warning' }
        isWhole = true
        return { code: o.code ?? 0, signal: null }
      } finally {
        ended.push(`${argv[0]} ${isWhole ? 'whole' : 'cut'}`)
      }
    })()
    return Object.assign(pieces, { result: Promise.resolve({ code: o.code ?? 0, signal: null }) })
  }
  const read = async (path: string) => {
    calls.push(`read ${path}`)
    if (o.refused !== undefined) throw new Error('over 4 MiB')
    return FILE
  }
  const exists = async (path: string) => {
    if (o.tail === 'refused') throw new Error('refused')
    return o.tail === 'there' && path === TAIL_PATH
  }
  const $ = {
    // engineOf reads the plugin's name and root once.
    plugin: { name: PLUGIN, root: '/' },
    env: { get: async (name: string) => (calls.push(`env ${name}`), o.env?.[name]) },
    fs: { read, exists, stat: async (path: string) => (calls.push(`stat ${path}`), { kind: 'file', size: o.refused?.size ?? FILE.length, mtimeMs: 0, isLink: false }) },
    process: { spawn: (request: Spawned) => (calls.push(`spawn ${request.argv[0]}${request.env === undefined ? '' : ` ${JSON.stringify(request.env)}`}`), child(request.argv)) },
  } as unknown as EngineInterface
  return { $, calls, ended }
}

const WINDOWS_PATH = 'C:\\Users\\me\\.claude\\projects\\w\\s.jsonl'
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

test('up to 4 MiB the file is one read; past it tail streams it, and on Windows PowerShell by its full path', async () => {
  const posix = standIn({ starts: () => true })
  const small = await readRows(engineOf(posix.$), PATH, READ_CAP)
  const large = await readRows(engineOf(posix.$), PATH, READ_CAP + 1)
  expect(posix.calls).toEqual([`read ${PATH}`, 'spawn tail'])
  expect(large).toEqual(small)
  expect(small.map(row => row.uuid)).toEqual([1, 2, 3, 4, 5, 6, 7].map(id))
  const windows = standIn({ starts: argv => argv[0] === POWERSHELL, env: { SystemRoot: 'C:\\Windows' } })
  expect(await readRows(engineOf(windows.$), WINDOWS_PATH, READ_CAP + 1)).toEqual(small)
  expect(windows.calls).toEqual(['env SystemRoot', `spawn ${POWERSHELL} ${JSON.stringify({ TOOLBELT_TRANSCRIPT: WINDOWS_PATH })}`])
  // Where /usr/bin/tail is there it runs by that path; a look for it that is refused names tail alone.
  const there = standIn({ starts: () => true, tail: 'there' })
  expect(await readRows(engineOf(there.$), PATH, READ_CAP + 1)).toEqual(small)
  expect(there.calls).toEqual(['spawn /usr/bin/tail'])
  const unlooked = standIn({ starts: () => true, tail: 'refused' })
  expect(await readRows(engineOf(unlooked.$), PATH, READ_CAP + 1)).toEqual(small)
  expect(unlooked.calls).toEqual(['spawn tail'])
  // A PowerShell that cannot start fails the read, which leaves the drawn rows.
  const missing = standIn({ starts: () => false })
  expect(await failureOf(readRows(engineOf(missing.$), WINDOWS_PATH, READ_CAP + 1))).toBe(`${POWERSHELL}: command not found`)
  const failing = standIn({ starts: () => true, code: 1 })
  let failure = ''
  await readRows(engineOf(failing.$), PATH, READ_CAP + 1).catch((err: unknown) => (failure = err instanceof Error ? err.message : String(err)))
  expect(failure).toBe('tail ended with 1')
})

// Regression: the engine appends to the file while it is read.
test('a read refused as the file grew past 4 MiB since its size was taken streams it after all; another refusal stays one', async () => {
  const grown = standIn({ starts: () => true, refused: { size: READ_CAP + 1 } })
  const rows = await readRows(engineOf(grown.$), PATH, READ_CAP)
  expect(grown.calls).toEqual([`read ${PATH}`, `stat ${PATH}`, 'spawn tail'])
  expect(rows.map(row => row.uuid)).toEqual([1, 2, 3, 4, 5, 6, 7].map(id))
  const refused = standIn({ starts: () => true, refused: { size: READ_CAP } })
  expect(await failureOf(readRows(engineOf(refused.$), PATH, READ_CAP))).toBe('over 4 MiB')
  expect(refused.calls).toEqual([`read ${PATH}`, `stat ${PATH}`])
})

// Security: however the read is left, its command is ended, not left running until the module unloads.
test('a stream no longer wanted stops at its next piece and ends its command; one read to its end ends as it did', async () => {
  const stopped = standIn({ starts: () => true })
  let wanted = 2
  expect(await failureOf(readRows(engineOf(stopped.$), PATH, READ_CAP + 1, () => wanted-- > 0))).toBe('tail stopped: another conversation is on screen')
  expect(stopped.ended).toEqual(['tail cut'])
  const windows = standIn({ starts: () => true })
  let wantedThere = 2
  expect(await failureOf(readRows(engineOf(windows.$), WINDOWS_PATH, READ_CAP + 1, () => wantedThere-- > 0))).toBe(`${POWERSHELL} stopped: another conversation is on screen`)
  expect(windows.ended).toEqual([`${POWERSHELL} cut`])
  const failing = standIn({ starts: () => true, code: 1 })
  expect(await failureOf(readRows(engineOf(failing.$), PATH, READ_CAP + 1))).toBe('tail ended with 1')
  expect(failing.ended).toEqual(['tail whole'])
})
