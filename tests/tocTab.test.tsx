// The contents tab: prompts the person sent are noted as their rows are drawn, listed in the panel, and a press asks
// the engine to bring one into view.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'
import { cellsOf } from '../hooks/lib/width'
import { PLUGIN, SLOW_MS, SURFACES, TEST_OPTIONS, boot, hostless, mountPane, runCommand } from './helpers'

const EMPTY = 'No prompts yet. The prompts you send are listed here.'
const SCROLL_FAILED = 'Could not jump to that prompt.'
const TABS = ['tab-toc', 'tab-notes', 'tab-status', 'tab-tools', 'tab-guide']

// `more`: who else sent the message, or the task a notification reports on.
type More = { from?: { name: string }; task?: { id?: string; status?: string } }
const mountPrompt = ($: Engine, requestId: string, text: string, origin: PromptOrigin = { kind: 'composer' }, more: More = {}) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId, props: { text, origin, isExpanded: false, ...more } })

// The panel on any surface: only its buttons are read.
type Pane = { findAll: (query: { type: 'Button' }) => Promise<{ key?: string; text: string }[]> }
const rowsOf = async (pane: Pane) =>
  (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => ({ key: b.key, label: b.text }))
const tabsOf = async (pane: Pane) => (await pane.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(key => key.startsWith('tab-'))

test('the tab lists the prompts a person sent, in the order drawn, one line each', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  // A start draws everything once (the options it applies, register.tsx applySettings); the rows draw after it.
  const started = calls.invalidated
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    expect(await tabsOf(pane)).toEqual(TABS)
    await pane.press({ key: 'tab-toc' })
    expect(await pane.find({ type: 'Text', text: EMPTY })).toBeDefined()
    await pane.unmount()
  }
  const first = await mountPrompt($, 'm1', '\n  First prompt  \nsecond line')
  await mountPrompt($, 'm2', 'A task finished', { kind: 'task-notification' })
  await mountPrompt($, 'm3', 'Third', { kind: 'bridge' })
  await mountPrompt($, 'm4', 'From another session', { kind: 'peer' })
  await mountPrompt($, 'm5', 'From a plugin', { kind: 'plugin', name: 'other', asUser: true })
  await mountPrompt($, 'm6', 'From a routine', { kind: 'scheduled-trigger' })
  // The same row drawn again is not noted twice.
  await first.unmount()
  await mountPrompt($, 'm1', 'First prompt, drawn again')
  expect(calls.invalidated - started).toBe(0)
  await clock.advance(300)
  expect(calls.invalidated - started).toBe(1)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    await pane.press({ key: 'tab-toc' })
    expect(await rowsOf(pane)).toEqual([
      { key: 'toc-m1', label: '─ 1. First prompt' },
      { key: 'toc-m3', label: '─ 2. Third' },
    ])
    await pane.unmount()
  }
})

// Regression: a drawn row is judged as the transcript file judges it, so a reload keeps the numbers; and a message
// someone else sent (a teammate's row is `unclassified`) is not the person's prompt.
test('a slash command, the engine\'s wrapper, a blank row and a message someone else sent are not listed', { options: TEST_OPTIONS }, async ($, on) => {
  const { clock } = await boot($, on)
  await mountPrompt($, 'm1', '/usage')
  await mountPrompt($, 'm2', '<command-name>/model</command-name>')
  await mountPrompt($, 'm3', '  \n  ')
  await mountPrompt($, 'm4', '\n  /Users/me/notes.md explain this')
  await mountPrompt($, 'm5', 'Mine')
  await mountPrompt($, 'm6', 'The tests pass now', { kind: 'unclassified' }, { from: { name: 'researcher' } })
  await mountPrompt($, 'm7', 'A shell finished', { kind: 'unclassified' }, { task: { id: 'b1', status: 'completed' } })
  await mountPrompt($, 'm8', 'From before origins were stamped', { kind: 'unclassified' })
  await clock.advance(300)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    await pane.press({ key: 'tab-toc' })
    expect(await rowsOf(pane)).toEqual([
      { key: 'toc-m5', label: '─ 1. Mine' },
      { key: 'toc-m8', label: '─ 2. From before origins were stamped' },
    ])
    await pane.unmount()
  }
})

test('rows drawn in a burst draw the panel once, and the open panel shows them', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  // A start draws everything once (the options it applies, register.tsx applySettings); the rows draw after it.
  const started = calls.invalidated
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-toc' })
  for (const id of ['a', 'b', 'c']) await mountPrompt($, id, `Prompt ${id}`)
  await clock.advance(299)
  expect(calls.invalidated - started).toBe(0)
  expect(await rowsOf(pane)).toEqual([])
  await clock.advance(1)
  expect(calls.invalidated - started).toBe(1)
  expect((await rowsOf(pane)).map(row => row.label)).toEqual(['─ 1. Prompt a', '─ 2. Prompt b', '─ 3. Prompt c'])
  await pane.unmount()
})

test('a long first line is cut to the panel width, wide letters counted as two cells', { options: TEST_OPTIONS }, async ($, on) => {
  const { clock } = await boot($, on)
  await mountPrompt($, 'm1', 'x'.repeat(200))
  await mountPrompt($, 'm2', '가'.repeat(100))
  await mountPrompt($, 'm3', 'short')
  await clock.advance(300)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-toc' })
  const labels = (await rowsOf(pane)).map(row => row.label)
  // The mounted panel is 80 cells wide.
  for (const label of labels.slice(0, 2)) {
    expect(cellsOf(label)).toBeLessThanOrEqual(78)
    expect(label.endsWith('…')).toBe(true)
  }
  expect(labels[2]).toBe('─ 3. short')
  await pane.unmount()
})

test('only the newest 200 prompts are listed, numbered by their place among all', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { clock } = await boot($, on)
  for (let i = 1; i <= 205; i++) await mountPrompt($, `m${i}`, `P${i}`)
  await clock.advance(300)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-toc' })
  const rows = await rowsOf(pane)
  expect(rows).toHaveLength(200)
  expect(rows[0]?.label).toBe('─ 6. P6')
  expect(rows.at(-1)?.label).toBe('─ 205. P205')
  expect(await pane.find({ type: 'Text', text: 'Showing the latest 200 prompts.' })).toBeDefined()
  await pane.unmount()
})

test('a press on a prompt asks the engine to scroll there, and a scroll that fails says so', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  await mountPrompt($, 'm1', 'First')
  await clock.advance(300)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-toc' })
  await pane.press({ key: 'toc-m1' })
  // The test host has no transcript to scroll, so the engine call fails and the person is told.
  expect(calls.logged.some(line => line.includes('ui.scroll failed'))).toBe(true)
  expect(calls.toasts).toEqual([SCROLL_FAILED])
  await pane.unmount()
})

test('with the tab off there is no tab and nothing is noted or redrawn', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  // A start draws everything once (the options it applies, register.tsx applySettings); the rows draw after it.
  const started = calls.invalidated
  await mountPrompt($, 'm1', 'First')
  await mountPrompt($, 'm2', 'Second')
  await clock.advance(300)
  expect(calls.invalidated - started).toBe(0)
  const pane = await mountPane($, 'terminal')
  expect(await tabsOf(pane)).toEqual(['tab-notes', 'tab-status', 'tab-tools', 'tab-guide'])
  await pane.unmount()
})

test('/clear empties the table, and prompts after it are noted again', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  const old = await mountPrompt($, 'm1', 'Before')
  await clock.advance(300)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-toc' })
  expect((await rowsOf(pane)).map(row => row.key)).toEqual(['toc-m1'])
  const before = calls.invalidated
  // The cleared conversation has no rows left to draw.
  await old.unmount()
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(300)
  expect(calls.invalidated).toBeGreaterThan(before)
  expect(await rowsOf(pane)).toEqual([])
  expect(await pane.find({ type: 'Text', text: EMPTY })).toBeDefined()
  await mountPrompt($, 'm2', 'After')
  await clock.advance(300)
  expect(await rowsOf(pane)).toEqual([{ key: 'toc-m2', label: '─ 1. After' }])
  await pane.unmount()
})

test('the panel is not opened at the start by default', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on)
  expect(calls.opened).toEqual([])
})

test('paneOpenOnStart opens the panel with no focus request', { options: { ...TEST_OPTIONS, paneOpenOnStart: true } }, async ($, on) => {
  const { calls } = await boot($, on)
  expect(calls.opened).toHaveLength(1)
  expect(calls.opened[0]).toMatchObject({ id: 'oh-my-toolbelt', title: 'Toolbelt' })
  expect('focus' in (calls.opened[0] ?? {})).toBe(false)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: EMPTY })).toBeDefined()
  await pane.unmount()
})

test('paneOpenOnStart opens the panel once a run: a reload keeps the tab the person moved to', { options: { ...TEST_OPTIONS, paneOpenOnStart: true } }, async ($, on) => {
  const { calls } = await boot($, on)
  await runCommand($, 'toolbelt', 'status')
  const opened = calls.opened.length
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(calls.opened).toHaveLength(opened)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ key: 'settings' })).toBeDefined()
  await pane.unmount()
})

test('paneOpenOnStart shows the tools tab when the contents tab is off', { options: { ...TEST_OPTIONS, paneOpenOnStart: true, tocTab: false } }, async ($, on) => {
  const { calls } = await boot($, on)
  expect(calls.opened).toHaveLength(1)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ key: 'layout' })).toBeDefined()
  await pane.unmount()
})

test('after /clear, /resume or /branch a reload does not open the panel by itself', { options: { ...TEST_OPTIONS, paneOpenOnStart: true } }, async ($, on) => {
  const { calls } = await boot($, on)
  const opened = calls.opened.length
  for (const source of ['clear', 'resume', 'fork'] as const) {
    await $.classic.SessionStart({ source })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  }
  expect(calls.opened).toHaveLength(opened)
})

// The desktop app moves no transcript for a mod ("transcript not scrollable here"), so there a pressed row opens in
// place: the prompt whole, its turn and its answer's start; the whole answer in the panel; the prompt back in the
// prompt box; the answer saved alone. The terminal still jumps.
const ANSWERED = [
  { role: 'user', text: 'Fix the login bug', toolUses: [] },
  { role: 'assistant', text: 'Looking at it.', toolUses: [] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] },
  { role: 'assistant', text: 'Fixed in auth.ts.\nThe token check was inverted.', toolUses: [] },
  { role: 'user', text: 'Thanks', toolUses: [] },
  { role: 'assistant', text: 'You are welcome.', toolUses: [] },
]

test('in the desktop app a pressed row opens with its answer, read whole, put in the prompt box or saved alone', { options: { ...TEST_OPTIONS, exportDirectory: 'session' } }, async ($, on) => {
  on('session.messages', () => ({ value: ANSWERED as never }))
  on('session.id', () => ({ value: 'abc12345-0000-4000-8000-000000000000' }))
  on('session.cwd', () => ({ value: '/work' }))
  const written = new Map<string, string>()
  on('fs.exists', (_, e) => ({ value: written.has(hostless(e.path)) }))
  on('fs.write', (_, e) => (written.set(hostless(e.path), e.text), { value: undefined }))
  const { calls } = await boot($, on)
  await mountPrompt($, 'u1', 'Fix the login bug')
  await mountPrompt($, 'u2', 'Thanks')
  await runCommand($, 'toolbelt', 'toc')
  const pane = await mountPane($, 'desktop')
  const text = async (shown: string) => (await pane.find({ type: 'Text', text: shown })) !== undefined
  await pane.press({ key: 'toc-u1' })
  expect(calls.toasts).not.toContain(SCROLL_FAILED)
  expect([await text('Fix the login bug'), await text('Looking at it.'), await text('You are welcome.')]).toEqual([true, true, false])
  await pane.press({ key: 'toc-full' })
  expect([await text('The token check was inverted.'), await text('You are welcome.'), (await pane.find({ key: 'toc-u2' })) !== undefined]).toEqual([true, false, false])
  await pane.press({ key: 'toc-fill' })
  expect(calls.filled).toEqual(['Fix the login bug'])
  await pane.press({ key: 'toc-export' })
  const [[path, saved] = ['', '']] = [...written]
  expect(path).toMatch(/^\/work\/claude-session-.*-answer-1\.md$/)
  expect([saved.includes('The token check was inverted.'), saved.includes('Thanks')]).toEqual([true, false])
  await pane.press({ key: 'toc-back' })
  expect((await pane.find({ key: 'toc-u2' })) !== undefined).toBe(true)
  // A second press closes the row.
  await pane.press({ key: 'toc-u1' })
  expect(await text('Looking at it.')).toBe(false)
  await pane.unmount()
  // The terminal jumps, as before (the test host has no transcript to move, so the jump is refused).
  const terminal = await mountPane($, 'terminal')
  await terminal.press({ key: 'toc-u2' })
  expect(calls.toasts).toContain(SCROLL_FAILED)
  await terminal.unmount()
})
