// The curtain: nine kinds of row draw an empty box while it is up (the first block of a reply too), the band button,
// /toolbelt curtain and curtainRestoreOnSubmit change it, and the contents tab keeps filling.
import { expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { PromptOrigin, RenderSurface } from 'claude-code'
import { PLUGIN, SLOW_MS, SURFACES, TEST_OPTIONS, boot, mountBand, mountPane, runCommand, seedButtons, test } from './helpers'

const TOAST = 'Most of the conversation is hidden; command, attachment and notice lines and the logo stay. Press Show, or type /toolbelt curtain off, to bring it back.'
const HUMAN_ONLY = 'This can only be changed by typing the command yourself.'

// What a mounted row needs to be looked at.
type Row = { drawn: () => Promise<unknown>; unmount: () => Promise<void> }
type Site = { name: string; surfaces: readonly RenderSurface[]; mount: ($: Engine, surface: RenderSurface) => Promise<Row> }

const mountAssistant = ($: Engine, surface: RenderSurface, isFirstOfReply: boolean) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AssistantMessage', props: { text: 'answer', isFirstOfReply } })
const mountPrompt = ($: Engine, requestId: string, text: string, surface: RenderSurface = 'terminal') =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'UserMessage', requestId, props: { text, origin: { kind: 'composer' }, isExpanded: false } })
const mountToolUse = ($: Engine, surface: RenderSurface) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'ToolUse', props: { tool_use_id: 't1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false } })

// The nine rows the curtain covers. Three of them are drawn on the terminal only.
const SITES: Site[] = [
  { name: 'AssistantMessage', surfaces: SURFACES, mount: ($, s) => mountAssistant($, s, false) },
  { name: 'UserMessage', surfaces: SURFACES, mount: ($, s) => mountPrompt($, 'u1', 'question', s) },
  { name: 'ToolUse', surfaces: SURFACES, mount: mountToolUse },
  { name: 'ToolResult', surfaces: SURFACES, mount: ($, s) => $.ui.mount({ plugin: PLUGIN, surface: s, component: 'ToolResult', props: { tool_use_id: 't1', tool: 'Bash', output: 'ok', isErrored: false } }) },
  { name: 'ToolGroup', surfaces: SURFACES, mount: ($, s) => $.ui.mount({ plugin: PLUGIN, surface: s, component: 'ToolGroup', props: { calls: [], isActive: false, isExpanded: false } }) },
  { name: 'CommandOutput', surfaces: SURFACES, mount: ($, s) => $.ui.mount({ plugin: PLUGIN, surface: s, component: 'CommandOutput', props: { command: 'usage', args: '', text: 'out', isErrored: false } }) },
  { name: 'TurnDuration', surfaces: ['terminal'], mount: ($, s) => $.ui.mount({ plugin: PLUGIN, surface: s, component: 'TurnDuration', props: { word: 'Baked', durationMs: 3000 } }) },
  { name: 'InfoNotice', surfaces: ['terminal'], mount: ($, s) => $.ui.mount({ plugin: PLUGIN, surface: s, component: 'InfoNotice', props: { text: 'notice', command: null } }) },
  { name: 'ToolProgress', surfaces: ['terminal'], mount: ($, s) => $.ui.mount({ plugin: PLUGIN, surface: s, component: 'ToolProgress', props: { tool_use_id: 't1', kind: 'background_hint', text: '(ctrl+b to run in background)' } }) },
]

type Shape = { type: string; props?: { height?: number }; children?: unknown[] }

// What the row draws now: 'blank' for an empty box of no height, else the text of the one line it draws
// ('engine' is the stand-in for the engine's own drawing).
async function looksLike(row: Row): Promise<string> {
  const shape = JSON.parse(JSON.stringify(await row.drawn())) as Shape
  if (shape.type === 'Box' && shape.props?.height === 0 && shape.children === undefined) return 'blank'
  return shape.type === 'Text' ? (shape.children ?? []).join('') : `<${shape.type}>`
}

const raisedToasts = (toasts: readonly string[]): number => toasts.filter(text => text === TOAST).length
const submitAs = ($: Engine, kind: PromptOrigin['kind']) => $.prompt.submit({ text: 'next', wait: false, origin: { kind } as PromptOrigin })

test('under the curtain each of the nine rows draws an empty box, and itself again once it is down', { timeoutMs: SLOW_MS }, async ($, on) => {
  await boot($, on)
  for (const site of SITES) {
    for (const surface of site.surfaces) {
      const row = await site.mount($, surface)
      expect(await looksLike(row), `${site.name} ${surface} before`).toBe('engine')
      await runCommand($, 'toolbelt', 'curtain on')
      expect(await looksLike(row), `${site.name} ${surface} covered`).toBe('blank')
      await runCommand($, 'toolbelt', 'curtain off')
      expect(await looksLike(row), `${site.name} ${surface} after`).toBe('engine')
      await row.unmount()
    }
  }
})

test('every block of a reply is blank under the curtain, the first one too', async ($, on) => {
  await boot($, on)
  for (const surface of SURFACES) {
    const [first, later, tool] = [await mountAssistant($, surface, true), await mountAssistant($, surface, false), await mountToolUse($, surface)]
    expect(await looksLike(first)).toBe('engine')
    await runCommand($, 'toolbelt', 'curtain on')
    expect(await looksLike(first)).toBe('blank')
    expect(await looksLike(later)).toBe('blank')
    expect(await looksLike(tool)).toBe('blank')
    await runCommand($, 'toolbelt', 'curtain off')
    for (const row of [first, later, tool]) await row.unmount()
  }
})

test('the button follows the language and the icon style', { options: { iconStyle: 'label' } }, async ($, on) => {
  await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'curtain' }))?.props.label).toBe('가리기')
  const first = await mountAssistant($, 'terminal', true)
  await band.press({ key: 'curtain' })
  expect((await band.find({ key: 'curtain' }))?.props.label).toBe('보기')
  expect(await looksLike(first)).toBe('blank')
})

// The date off, as the widths here were measured without it.
test('the band button flips the curtain and toasts once, when it goes up', { options: { dateFormat: 'off' } }, async ($, on) => {
  const { calls } = await boot($, on)
  for (const [turn, surface] of SURFACES.entries()) {
    const band = await mountBand($, surface, 119)
    const row = await mountAssistant($, surface, false)
    const label = async () => (await band.find({ key: 'curtain' }))?.props.label
    expect(await label()).toBe('▢ Hide')
    await band.press({ key: 'curtain' })
    expect([await label(), await looksLike(row), raisedToasts(calls.toasts)]).toEqual(['▣ Show', 'blank', turn + 1])
    await band.press({ key: 'curtain' })
    expect([await label(), await looksLike(row), raisedToasts(calls.toasts)]).toEqual(['▢ Hide', 'engine', turn + 1])
    await band.unmount()
    await row.unmount()
  }
})

test('/toolbelt curtain on and off change the curtain; asking for the state it is in changes nothing', async ($, on) => {
  const { calls } = await boot($, on)
  const row = await mountAssistant($, 'terminal', false)
  expect(await runCommand($, 'toolbelt', 'curtain on')).toEqual({})
  expect(await runCommand($, 'tb', 'curtain on')).toEqual({})
  expect([await looksLike(row), raisedToasts(calls.toasts)]).toEqual(['blank', 1])
  expect((await runCommand($, 'tb', 'curtain off')).text).toBe('Conversation shown.')
  expect(await looksLike(row)).toBe('engine')
  expect((await runCommand($, 'toolbelt', 'curtain off')).text).toBe('Conversation shown.')
  expect(raisedToasts(calls.toasts)).toBe(1)
})

test('only a person can raise or lower it by command; a bad word answers the usage line', async ($, on) => {
  const { calls } = await boot($, on)
  const row = await mountAssistant($, 'terminal', false)
  expect((await runCommand($, 'toolbelt', 'curtain on', 'plugin')).text).toContain(HUMAN_ONLY)
  expect(await looksLike(row)).toBe('engine')
  await runCommand($, 'toolbelt', 'curtain on')
  expect((await runCommand($, 'toolbelt', 'curtain off', 'plugin')).text).toContain(HUMAN_ONLY)
  expect(await looksLike(row)).toBe('blank')
  expect((await runCommand($, 'toolbelt', 'curtain maybe')).text).toContain('Unknown argument: maybe Usage: /toolbelt')
  expect((await runCommand($, 'toolbelt', 'curtain')).text).toContain('curtain on|off')
  expect(raisedToasts(calls.toasts)).toBe(1)
})

test('with curtainRestoreOnSubmit the person\'s own prompt lowers the curtain, and nothing else does', { options: { curtainRestoreOnSubmit: true } }, async ($, on) => {
  await boot($, on)
  const row = await mountAssistant($, 'terminal', false)
  await runCommand($, 'toolbelt', 'curtain on')
  for (const kind of ['task-notification', 'scheduled-trigger'] as const) {
    await submitAs($, kind)
    expect(await looksLike(row), kind).toBe('blank')
  }
  await submitAs($, 'composer')
  expect(await looksLike(row)).toBe('engine')
  await runCommand($, 'toolbelt', 'curtain on')
  await submitAs($, 'bridge')
  expect(await looksLike(row)).toBe('engine')
})

// The toolbelt's send button sends as the person (`asUser`), as the prompts tab counts it; another plugin's prompt,
// `asUser` or not, and one this mod sends without `asUser` leave the curtain up.
test('with curtainRestoreOnSubmit the send button lowers the curtain, and another plugin\'s prompt does not', { options: { curtainRestoreOnSubmit: true } }, async ($, on) => {
  const { calls } = await boot($, on, { store: { buttons: seedButtons() } })
  const row = await mountAssistant($, 'terminal', false)
  await runCommand($, 'toolbelt', 'curtain on')
  for (const origin of [{ kind: 'plugin', name: 'other', asUser: true }, { kind: 'plugin', name: PLUGIN }] as const) {
    await $.prompt.submit({ text: 'next', wait: false, origin })
    expect(await looksLike(row), JSON.stringify(origin)).toBe('blank')
  }
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'btn:b-commit' })
  await band.unmount()
  expect(calls.submitted).toEqual(['next', 'next', 'Write the commit message.'])
  expect(await looksLike(row)).toBe('engine')
})

test('by default a prompt leaves the curtain up', async ($, on) => {
  const { calls } = await boot($, on)
  const row = await mountAssistant($, 'terminal', false)
  await runCommand($, 'toolbelt', 'curtain on')
  await submitAs($, 'composer')
  expect(await looksLike(row)).toBe('blank')
  expect(calls.submitted).toEqual(['next'])
})

test('the contents tab keeps filling while the curtain is up', { options: TEST_OPTIONS }, async ($, on) => {
  const { clock } = await boot($, on)
  await runCommand($, 'toolbelt', 'curtain on')
  const rows = [await mountPrompt($, 'a', 'Prompt a'), await mountPrompt($, 'b', 'Prompt b'), await mountPrompt($, 'c', 'Prompt c')]
  expect(await looksLike(rows[0] as Row)).toBe('blank')
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    await pane.press({ key: 'tab-toc' })
    const labels = (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => b.text)
    expect(labels).toEqual(['─ 1. Prompt a', '─ 2. Prompt b', '─ 3. Prompt c'])
    await pane.unmount()
  }
})

test('a hook that fails draws the row as it was, so a failure lifts the curtain', async ($, on) => {
  const failStateGet = { on: false }
  const { calls } = await boot($, on, { failStateGet })
  await runCommand($, 'toolbelt', 'curtain on')
  failStateGet.on = true
  const [tool, prompt] = [await mountToolUse($, 'terminal'), await mountPrompt($, 'f1', 'question')]
  failStateGet.on = false
  expect([await looksLike(tool), await looksLike(prompt)]).toEqual(['engine', 'engine'])
  expect(calls.logged.some(line => line.includes('ui.render curtain hook failed'))).toBe(true)
  expect(calls.logged.some(line => line.includes('ui.render UserMessage hook failed'))).toBe(true)
  expect(await looksLike(await mountToolUse($, 'terminal'))).toBe('blank')
})
