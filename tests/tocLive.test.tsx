// The prompts tab's live part: where the person reads, the card a pointer reveals with its turn, the moves of /toolbelt
// toc, and an agent's transcript beside the panel.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptOrigin, RenderSurface } from 'claude-code'
import { PLUGIN, SLOW_MS, SURFACES, TEST_OPTIONS, boot, keysOf, mountBand, mountPane, runCommand, seedButtons, test } from './helpers'

type Place = { first: number; last: number; of: number } | null
// On screen from row `first` of the message: 0 is whole at the top, more is cut at the viewport's top.
const at = (first: number): Place => ({ first, last: first + 3, of: first + 5 })

const prompt = (text: string, onScreen?: Place) => ({ text, origin: { kind: 'composer' as const }, isExpanded: false, ...(onScreen === undefined ? {} : { onScreen }) })
const mountPrompt = ($: Engine, id: string, text: string, onScreen?: Place) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: id, props: prompt(text, onScreen) })
const mountReply = ($: Engine, id: string, onScreen: Place) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text: 'reply', isFirstOfReply: true, onScreen } })
const mountTool = ($: Engine, id: string, onScreen: Place) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool: 'Edit', input: {}, isRunning: false, isErrored: false, isInterrupted: false, onScreen } })

// The engine's own answers beneath the mod for the turns these tests raise; the kit keeps appended rows itself.
function stubTurns(on: On): void {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

type Use = { id: string; name: string; path?: string }
const sent = ($: Engine, uuid: string, text: string) =>
  $.session.append({ door: 'prompt', uuid, origin: { kind: 'composer' }, message: { type: 'user', role: 'user', content: [{ type: 'text', text }] } })
const replied = ($: Engine, uuid: string, uses: readonly Use[] = []) =>
  $.session.append({
    door: 'response',
    uuid,
    origin: { kind: 'model', model: 'claude' },
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...uses.map(use => ({ type: 'tool_use', id: use.id, name: use.name, input: use.path === undefined ? {} : { file_path: use.path } }))] },
  })
const turn = ($: Engine, id: string, durationMs: number, reason: 'answer' | 'aborted' = 'answer', agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs, isAborted: reason === 'aborted', turnId: id, reason, ...(agentId === undefined ? {} : { agentId }) })

// The panel on any surface: its buttons, a key's element and the whole drawing are read.
type Found = { key?: string; text: string; props: Record<string, unknown> }
type Pane = {
  findAll: (query: { type: 'Button' }) => Promise<Found[]>
  find: (query: { type?: 'Text'; text?: string; key?: string }) => Promise<Found | undefined>
  drawn: () => Promise<unknown>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<void>
}
const tocRows = async (pane: Pane) =>
  (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => ({ label: b.text, dim: b.props.dimColor === true }))
const labels = async (pane: Pane) => (await tocRows(pane)).map(row => row.label)

async function openToc($: Engine, surface: RenderSurface = 'terminal', agentId?: string): Promise<Pane> {
  const props = { title: 'Toolbelt', isFocused: true, bodyColumns: 80, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 12 }, view: agentId === undefined ? {} : { agentId } }
  const pane = agentId === undefined ? await mountPane($, surface) : await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props })
  await pane.press({ key: 'tab-toc' })
  return pane
}

// The drawn element under a key, and every string beneath an element, in order.
type Drawn = { props?: { key?: unknown; display?: unknown; position?: unknown; marginBottom?: unknown }; hover?: unknown; children?: unknown[] }
function drawnKey(node: unknown, key: string): Drawn | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const element = node as Drawn
  if (element.props?.key === key) return element
  return (element.children ?? []).map(child => drawnKey(child, key)).find(found => found !== undefined)
}
const textOf = (node: unknown): string =>
  typeof node === 'string' ? node : typeof node === 'object' && node !== null ? ((node as Drawn).children ?? []).map(textOf).join('\n') : ''

test('the prompt at the top of the conversation is heavy and the others dim, drawn again once reports settle', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  await mountPrompt($, 'u1', 'first', null)
  const second = await mountPrompt($, 'u2', 'second', at(0))
  await mountPrompt($, 'u3', 'third', at(0))
  await clock.advance(300)
  const pane = await openToc($)
  expect(await tocRows(pane)).toEqual([
    { label: '─ 1. first', dim: true },
    { label: '━ 2. second', dim: false },
    { label: '─ 3. third', dim: true },
  ])
  const invalidated = calls.invalidated
  // The conversation scrolls down: the second prompt's row is cut at the top, then leaves.
  await second.redraw(prompt('second', at(2)))
  await clock.advance(40)
  expect((await labels(pane))[1]).toBe('━ 2. second')
  await second.redraw(prompt('second', null))
  await clock.advance(40)
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second', '━ 3. third'])
  // Only the panel was drawn again, never the transcript's rows.
  expect(calls.invalidated).toBe(invalidated)
  await pane.unmount()
})

test('a reply or tool row places the reader under the prompt it answers', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  await sent($, 'u1', 'first')
  await mountPrompt($, 'u1', 'first', null)
  await replied($, 'a1', [{ id: 't1', name: 'Edit', path: '/p/app.ts' }])
  await sent($, 'u2', 'second')
  await mountPrompt($, 'u2', 'second', null)
  await replied($, 'a2')
  // The first prompt's reply is cut at the top, its tool row and the second reply below it.
  await mountReply($, 'a1', at(4))
  await mountTool($, 't1', at(0))
  await mountReply($, 'a2', at(0))
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['━ 1. first', '─ 2. second'])
  await pane.unmount()
})

test('a row from before this load places no one, and with no place known no row is dim', { options: TEST_OPTIONS }, async ($, on) => {
  const { clock } = await boot($, on)
  await mountPrompt($, 'u1', 'first')
  await mountPrompt($, 'u2', 'second')
  await mountReply($, 'old', at(0))
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await openToc($, surface)
    expect(await tocRows(pane)).toEqual([{ label: '─ 1. first', dim: false }, { label: '─ 2. second', dim: false }])
    await pane.unmount()
  }
})

test('a pointer on a row reveals its card on the band, not over the list: the prompt and what its turn did', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  const text = 'Fix the login bug\nThen run the tests'
  await sent($, 'u1', text)
  await mountPrompt($, 'u1', text)
  await $.turn.start({ text, turnId: 't1' })
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await openToc($, surface)
    const drawn = await pane.drawn()
    expect(drawnKey(drawn, 'toc-u1')?.hover).toEqual({ scope: 'toc-1', inverse: true, dimColor: false })
    // A card over the rows held the pointer; it lies on the band, under the same scope.
    expect(drawnKey(drawn, 'toc-card-u1')).toBeUndefined()
    const band = await mountBand($, surface, 160)
    const card = drawnKey(await band.drawn(), 'band-card-toc-1')
    expect(card?.hover).toEqual({ scope: 'toc-1', display: 'flex' })
    // Over the row on the terminal; a desktop lets the row show through, so there it is a row above, one row apart.
    expect([card?.props?.display, card?.props?.position, card?.props?.marginBottom]).toEqual(surface === 'terminal' ? ['none', 'absolute', undefined] : ['none', undefined, 1])
    if (surface !== 'terminal') expect(keysOf(await band.drawn()).indexOf('band-card-toc-1')).toBeLessThan(keysOf(await band.drawn()).indexOf('band-row'))
    expect(textOf(card)).toContain('#1 Fix the login bug Then run the tests · Running')
    await band.unmount()
    await pane.unmount()
  }
  await replied($, 'a1', [{ id: 't1', name: 'Edit', path: '/p/app.ts' }, { id: 't2', name: 'Bash' }, { id: 't3', name: 'Write', path: '/p/README.md' }])
  await turn($, 't1', 83_000)
  const band = await mountBand($, 'terminal', 160)
  expect(textOf(drawnKey(await band.drawn(), 'band-card-toc-1'))).toContain('1m 23s · Tools: 3 · app.ts, README.md')
  await band.unmount()
})

// A reply came before the interruption, so the engine keeps the prompt, and so does the list (an Esc before any reply
// takes it back, below).
test('an interrupted turn says so, and an agent\'s turn adds nothing to the prompt\'s', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  await sent($, 'u1', 'first')
  await mountPrompt($, 'u1', 'first')
  await $.turn.start({ text: 'first', turnId: 'main' })
  await turn($, 'sub', 99_000, 'answer', 'ag1')
  await replied($, 'a1')
  await turn($, 'main', 12_500, 'aborted')
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await openToc($, surface)
    expect(await labels(pane)).toEqual(['─ 1. first'])
    await pane.unmount()
    const band = await mountBand($, surface, 160)
    expect(textOf(drawnKey(await band.drawn(), 'band-card-toc-1'))).toContain('12초 · 중단됨')
    await band.unmount()
  }
})

// Regression: a prompt interrupted before any reply stayed listed, its press refused (┄), and a reload, which reads the
// file that skips it, moved every later number up by one. 2.1.310 takes such a prompt back into the prompt box; the
// engine's own row then comes by the `note` door and the turn ends `aborted`. A turn no listed prompt started, and an
// agent's, take nothing back.
test('a prompt interrupted before any reply leaves the list as the engine takes it back; the later ones keep the numbers a reload gives', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  await sent($, 'u1', 'first')
  await mountPrompt($, 'u1', 'first')
  await $.turn.start({ text: 'first', turnId: 't1' })
  await replied($, 'a1')
  await turn($, 't1', 5_000)
  await sent($, 'u2', 'second')
  const taken = await mountPrompt($, 'u2', 'second')
  await $.turn.start({ text: 'second', turnId: 't2' })
  await clock.advance(300)
  const panes: Pane[] = []
  for (const surface of SURFACES) panes.push(await openToc($, surface))
  for (const pane of panes) expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second'])
  await $.session.append({ door: 'note', uuid: 'n2', origin: { kind: 'engine' }, message: { type: 'user', role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
  await turn($, 't2', 5_302, 'aborted')
  // Drawn again at once, the panels open.
  for (const pane of panes) expect(await labels(pane)).toEqual(['─ 1. first'])
  // A late drawing of its row lists it no more.
  await taken.redraw(prompt('second'))
  await taken.unmount()
  // Another plugin's prompt interrupted before any reply: no listed prompt's turn, so nothing leaves.
  const other = { kind: 'plugin' as const, name: 'other', asUser: true as const }
  await $.session.append({ door: 'prompt', uuid: 'u3', origin: other, message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'From another plugin' }] } })
  await $.turn.start({ text: 'From another plugin', turnId: 't3' })
  await turn($, 't3', 1_000, 'aborted')
  // The words sent again, and an agent interrupted inside that turn before the turn's first reply.
  await sent($, 'u4', 'second, again')
  await mountPrompt($, 'u4', 'second, again')
  await $.turn.start({ text: 'second, again', turnId: 't4' })
  await turn($, 'sub', 2_000, 'aborted', 'ag1')
  await replied($, 'a4')
  await turn($, 't4', 4_000)
  await clock.advance(300)
  for (const pane of panes) {
    expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. second, again'])
    await pane.unmount()
  }
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, 160)
    const drawn = await band.drawn()
    expect(textOf(drawnKey(drawn, 'band-card-toc-1'))).toContain('#1 first · 5s')
    expect(textOf(drawnKey(drawn, 'band-card-toc-2'))).toContain('#2 second, again · 4s')
    expect(drawnKey(drawn, 'band-card-toc-3')).toBeUndefined()
    await band.unmount()
  }
})

// Regression: a prompt the toolbelt's own send button sent was missing from the tab, and its turn's tools and time went
// to the prompt before it. 2.1.310 hands this mod that prompt through session.append alone, never its UserMessage hook,
// so its row is not drawn here. Another plugin's prompt, and a command this mod runs (no `asUser`), stay out, and the
// turn another plugin's prompt starts adds to no card.
test('a prompt the send button sent is listed from session.append alone, with its own turn; another plugin\'s is not', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { calls, clock } = await boot($, on, { store: { buttons: seedButtons() } })
  await sent($, 'u1', 'first')
  await mountPrompt($, 'u1', 'first')
  await $.turn.start({ text: 'first', turnId: 't1' })
  await turn($, 't1', 5_000)
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'btn:b-commit' })
  await band.unmount()
  const text = 'Write the commit message.'
  expect(calls.submitted).toEqual([text])
  // The origin session.append hands this mod for its own `asUser` submit (2.1.310), as the engine stores the row.
  const own = { kind: 'plugin' as const, name: PLUGIN, asUser: true as const }
  // u4: a command this mod ran (/voice), the engine's wrapper under the mod's name with no `asUser`.
  const rows = [['u2', own], ['u3', { kind: 'plugin' as const, name: 'other', asUser: true as const }], ['u4', { kind: 'plugin' as const, name: PLUGIN }]] as const
  for (const [uuid, origin] of rows) {
    const said = uuid === 'u2' ? text : uuid === 'u3' ? 'From another plugin' : '<command-name>/voice</command-name>\n<command-args>tap</command-args>'
    await $.session.append({ door: 'prompt', uuid, origin, message: { type: 'user', role: 'user', content: [{ type: 'text', text: said }] } })
    if (uuid !== 'u2') await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: uuid, props: { text: said, origin, isExpanded: false } })
    if (uuid === 'u4') continue
    await $.turn.start({ text: said, turnId: `t-${uuid}` })
    await replied($, `a-${uuid}`, uuid === 'u2' ? [{ id: 'k1', name: 'Bash' }] : [{ id: 'k2', name: 'Bash' }, { id: 'k3', name: 'Read' }])
    await turn($, `t-${uuid}`, uuid === 'u2' ? 83_000 : 40_000)
  }
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. Write the commit message.'])
  await pane.unmount()
  const shown = await mountBand($, 'terminal', 160)
  const drawn = await shown.drawn()
  expect(textOf(drawnKey(drawn, 'band-card-toc-1'))).toContain('#1 first · 5s')
  expect(textOf(drawnKey(drawn, 'band-card-toc-1'))).not.toContain('Tools')
  expect(textOf(drawnKey(drawn, 'band-card-toc-2'))).toContain('#2 Write the commit message. · 1m 23s · Tools: 1')
  expect(textOf(drawnKey(drawn, 'band-card-toc-2'))).not.toContain('2m')
  await shown.unmount()
})

// Regression: a prompt that was a slash command alone (`/co`, a skill) was missing from the tab, and its turn's tools
// and time went to the prompt before it. 2.1.310 draws only the composer's placeholder of it, raises prompt.submit with
// the command, then appends its row by the `command` door; a command that only acts here (`/model`) raises no
// prompt.submit. One this mod's button ran is listed as one typed is; another plugin's is not.
test('a slash command Claude answers is listed from its appended row, with its own turn; one that only acts here and another plugin\'s are not', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  const ran = (name: string, args: string, origin: PromptOrigin) => $.prompt.submit({ text: `/${name} ${args}`.trim(), wait: false, origin, command: { name, args } })
  const commandRow = (uuid: string, text: string, origin: PromptOrigin) =>
    $.session.append({ door: 'command', uuid, origin, message: { type: 'user', role: 'user', content: [{ type: 'text', text }] } })
  await sent($, 'u1', 'first')
  await mountPrompt($, 'u1', 'first')
  await mountPrompt($, 'placeholder', '/co today')
  await ran('co', 'today', { kind: 'composer' })
  await commandRow('u2', '<command-message>co</command-message>\n<command-name>/co</command-name>\n<command-args>today</command-args>', { kind: 'composer' })
  await $.turn.start({ text: '/co today', turnId: 't2' })
  await replied($, 'a2', [{ id: 'k1', name: 'Write', path: '/p/MEMORY.md' }])
  await turn($, 't2', 30_000)
  await commandRow('u3', '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>', { kind: 'unclassified' })
  const own = { kind: 'plugin', name: PLUGIN } as PromptOrigin
  await ran('ci', '', own)
  await commandRow('u4', '<command-message>ci</command-message>\n<command-name>/ci</command-name>', own)
  const other = { kind: 'plugin', name: 'other' } as PromptOrigin
  await ran('review', '', other)
  await commandRow('u5', '<command-message>review</command-message>\n<command-name>/review</command-name>', other)
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. first', '─ 2. /co today', '─ 3. /ci'])
  // A press jumps to the command's stored row, which 2.1.310 reveals.
  expect((await pane.findAll({ type: 'Button' })).some(b => b.key === 'toc-u2')).toBe(true)
  await pane.unmount()
  const band = await mountBand($, 'terminal', 160)
  const drawn = await band.drawn()
  expect(textOf(drawnKey(drawn, 'band-card-toc-1'))).not.toContain('Tools')
  expect(textOf(drawnKey(drawn, 'band-card-toc-2'))).toContain('#2 /co today · 30s · Tools: 1')
  await band.unmount()
})

// Regression (review): the mark prompt.submit left went to whichever command row came next. A command row is listed
// only when it is the command prompt.submit ran, from the person or this mod: not after a command whose row never came
// (refused), not another plugin's, not a command this mod's button ran that only acts here (/voice). A row the person
// does not see (`isMeta`) takes nothing, even one that reads as the command.
test('a command row is listed only when it is the command prompt.submit ran, from the person or this mod', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  const ran = (name: string, origin: PromptOrigin) => $.prompt.submit({ text: `/${name}`, wait: false, origin, command: { name, args: '' } })
  const commandRow = (uuid: string, name: string, origin: PromptOrigin) =>
    $.session.append({ door: 'command', uuid, origin, message: { type: 'user', role: 'user', content: [{ type: 'text', text: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` }] } })
  const own = { kind: 'plugin', name: PLUGIN } as PromptOrigin
  // /co was refused, so no row of it comes; /model's row comes next.
  await ran('co', { kind: 'composer' })
  await commandRow('u1', 'model', { kind: 'unclassified' })
  // /ci ran; another plugin's /review row comes before /ci's own.
  await ran('ci', { kind: 'composer' })
  await commandRow('u2', 'review', { kind: 'plugin', name: 'other' } as PromptOrigin)
  await commandRow('u3', 'ci', { kind: 'composer' })
  // The button ran /voice, which only acts here: no prompt.submit, its row under this mod's name.
  await commandRow('u4', 'voice', own)
  // The button ran /co: a row of the engine's own by the same door first (a local command's caveat), then its row.
  await ran('co', own)
  await $.session.append({ door: 'command', uuid: 'u5', origin: own, message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: '<command-message>co</command-message>\n<command-name>/co</command-name>' }] } })
  await commandRow('u6', 'co', own)
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. /ci', '─ 2. /co'])
  await pane.unmount()
})

// The send button's prompt listed from session.append stays one entry when its row is drawn too, under the same id:
// the test host draws it, and so would a screen that hands this mod the row, or a row drawn again after a resume.
test('a send button\'s prompt appended, then drawn under the same id, is listed once', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  const own = { kind: 'plugin' as const, name: PLUGIN, asUser: true as const }
  const text = 'Write the commit message.'
  await $.session.append({ door: 'prompt', uuid: 'u1', origin: own, message: { type: 'user', role: 'user', content: [{ type: 'text', text }] } })
  await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: { text, origin: own, isExpanded: false } })
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. Write the commit message.'])
  await pane.unmount()
})

test('the provisional row of a new prompt is not listed, and a prompt sent twice is two rows', { options: TEST_OPTIONS }, async ($, on) => {
  const { clock } = await boot($, on)
  for (const id of ['placeholder', 'x1', 'placeholder', 'x2']) await (await mountPrompt($, id, 'continue')).unmount()
  await clock.advance(300)
  const pane = await openToc($)
  expect(await labels(pane)).toEqual(['─ 1. continue', '─ 2. continue'])
  await pane.unmount()
})

test('beside an agent\'s transcript the tab says it lists the main conversation, and a move asks to go back', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  await mountPrompt($, 'u1', 'first', at(0))
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await openToc($, surface, 'ag1')
    expect(await pane.find({ type: 'Text', text: 'Only the main conversation\'s prompts are listed here.' })).toBeDefined()
    expect(await labels(pane)).toEqual([])
    expect(await runCommand($, 'toolbelt', 'toc first')).toEqual({})
    expect(calls.toasts.at(-1)).toBe('Moving between prompts works in the main conversation only. Go back to it first.')
    await pane.unmount()
  }
})

test('/toolbelt toc opens the prompts tab, and a move with nowhere to go says so', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  expect(await runCommand($, 'toolbelt', 'toc')).toEqual({})
  expect(calls.opened).toHaveLength(1)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: 'No prompts yet. The prompts you send are listed here.' })).toBeDefined()
  await pane.unmount()
  for (const [args, toast] of [
    ['toc next', 'There is no next prompt.'],
    ['toc prev', 'There is no previous prompt.'],
    ['toc #3', 'No prompt matches: 3'],
    ['toc find login', 'No prompt matches: find login'],
  ] as const) {
    expect(await runCommand($, 'toolbelt', args)).toEqual({})
    expect(calls.toasts.at(-1)).toBe(toast)
  }
  // A move that finds its prompt asks the engine to scroll there; the test host has no transcript, so it says it could not.
  await mountPrompt($, 'u1', 'first')
  await mountPrompt($, 'u2', 'the login form')
  await clock.advance(300)
  expect(await runCommand($, 'tb', 'toc find LOGIN')).toEqual({})
  expect(calls.toasts.at(-1)).toBe('Could not jump to that prompt.')
  expect(calls.logged.some(line => line.includes('ui.scroll failed'))).toBe(true)
  // A move is harmless from anyone: it is not kept for the person alone.
  expect(await runCommand($, 'toolbelt', 'toc first', 'sdk')).toEqual({})
})

test('with the prompts tab off a move says the tab is off', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  await boot($, on)
  expect((await runCommand($, 'toolbelt', 'toc next')).text).toBe('The Prompts tab is off. Turn on Prompts tab in the Status tab or /config.')
})

// A uuid whose first group is `n`, so each is its own row.
const uuidOf = (n: number): string => `${n.toString(16).padStart(8, '0')}-3f75-4882-a3e4-6f43dc45b51c`

// The panel's tree with every row as long as it gets, on a narrow inline panel and a wide, tall dock.
async function drawnSizes($: Engine): Promise<{ size: number; rows: number }[]> {
  const sizes = []
  for (const surface of SURFACES) {
    for (const [bodyColumns, bodyRows] of [[80, 12], [240, 70]] as const) {
      const props = { title: 'Toolbelt', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} }
      const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props })
      await pane.press({ key: 'tab-toc' })
      sizes.push({ size: JSON.stringify(await pane.drawn()).length, rows: (await labels(pane)).length })
      await pane.unmount()
    }
  }
  return sizes
}

test('long prompts stay inside the panel tree\'s bounds, and the band carries a card for every listed row', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  // ASCII is one character a cell, the most characters a row or a card can hold.
  const long = `${'word '.repeat(120)}\n${'가'.repeat(150)}\n${'x'.repeat(400)}\n${'y'.repeat(400)}\n${'z'.repeat(400)}`
  const uses = Array.from({ length: 5 }, (_, k) => ({ id: `t${k}`, name: 'Edit', path: `/a/very/long/folder/name/for/the/test/file-${k}-${'n'.repeat(40)}.ts` }))
  for (let n = 1; n <= 205; n++) {
    await sent($, uuidOf(n), long)
    await mountPrompt($, uuidOf(n), long)
    await replied($, `${uuidOf(n)}-reply`, uses.map(use => ({ ...use, id: `${use.id}-${n}` })))
    await turn($, `turn-${n}`, 3_725_000)
  }
  await clock.advance(300)
  const sizes = await drawnSizes($)
  for (const drawn of sizes) expect(drawn.size).toBeLessThan(80_000)
  expect(sizes.map(drawn => drawn.rows)).toEqual([200, 200, 200, 200])
  // The list keeps the latest 200 (#6 to #205), and the band carries a card for each, whichever the panel shows.
  const band = await mountBand($, 'terminal', 240)
  const drawn = await band.drawn()
  const keys = Array.from({ length: 205 }, (_, k) => `band-card-toc-${k + 1}`).filter(key => drawnKey(drawn, key) !== undefined)
  expect([keys.length, keys[0], keys.at(-1)]).toEqual([200, 'band-card-toc-6', 'band-card-toc-205'])
  // A band of 200 cards this wide, about 105,000 characters, was drawn on a real screen (2.1.309).
  expect(JSON.stringify(drawn).length).toBeLessThan(120_000)
  await band.unmount()
})
