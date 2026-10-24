// The table of contents' pure parts: the line kept for a prompt, the rows, the setting.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect, test } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'
import { translator } from '../hooks/lib/i18n'
import { TOC_ROWS_MAX, bandCardText, fileNames, firstLine, isTocOrigin, isTocRow, isTocTabOn, promptOf, promptText, rowKey, tocRows, withPrompt } from '../hooks/tools/toc'
import type { Toc } from '../hooks/tools/toc'

// This mod's name, as `$.plugin.name` gives it.
const OWN = 'oh-my-toolbelt'

test('firstLine is the first line with text, trimmed and on one line', () => {
  expect(firstLine('Hello\nworld')).toBe('Hello')
  expect(firstLine('\r\n\n   Hi there \r\nnext')).toBe('Hi there')
  expect(firstLine('a\tb')).toBe('a b')
  expect(firstLine('bell' + String.fromCharCode(7) + 'ring')).toBe('bellring')
  expect(firstLine('')).toBe('')
  expect(firstLine(' \n\t\n ')).toBe('')
})

test('firstLine is bounded and never splits an emoji', () => {
  const kept = Array.from(firstLine('x'.repeat(5000)))
  expect(kept).toHaveLength(200)
  const emoji = firstLine(String.fromCodePoint(0x1f600).repeat(300))
  expect(Array.from(emoji)).toHaveLength(200)
  expect(emoji.includes(String.fromCharCode(0xfffd))).toBe(false)
})

test('withPrompt returns a new table, keeps the order and the prompt\'s lines', () => {
  const empty: Toc = new Map()
  const one = withPrompt(empty, 'a', 'First\n\n  more\t line ')
  const two = withPrompt(one, 'b', 'Second')
  expect(empty.size).toBe(0)
  expect([...one]).toEqual([['a', { requestId: 'a', text: 'First\nmore  line' }]])
  expect([...two].map(([key]) => key)).toEqual(['a', 'b'])
  // A row of a prompt already listed adds nothing, and the same table comes back.
  expect(withPrompt(two, 'a', 'again')).toBe(two)
})

test('a prompt drawn under ids made from its uuid is one row', () => {
  const uuid = 'dae2bfb1-3f75-4882-a3e4-6f43dc45b51c'
  const split = 'dae2bfb1-3f75-4882-a3e4-000000000001'
  expect(rowKey(uuid)).toBe(rowKey(split))
  expect(rowKey('toolu_01')).toBe('toolu_01')
  const toc = withPrompt(withPrompt(new Map(), split, 'first'), uuid, 'first')
  expect(toc.size).toBe(1)
  expect(toc.get(rowKey(uuid))?.requestId).toBe(split)
})

test('tocRows numbers every row and lists only the newest ones', () => {
  const small = tocRows(withPrompt(withPrompt(new Map(), 'a', 'A\nmore'), 'b', 'B'))
  expect(small).toEqual({
    rows: [{ requestId: 'a', key: 'a', number: 1, line: 'A', text: 'A\nmore' }, { requestId: 'b', key: 'b', number: 2, line: 'B', text: 'B' }],
    hidden: 0,
  })
  const many: Toc = new Map(Array.from({ length: TOC_ROWS_MAX + 3 }, (_, i) => [`m${i + 1}`, { requestId: `m${i + 1}`, text: `P${i + 1}` }] as const))
  const { rows, hidden } = tocRows(many)
  expect(hidden).toBe(3)
  expect(rows).toHaveLength(TOC_ROWS_MAX)
  expect(rows[0]).toEqual({ requestId: 'm4', key: 'm4', number: 4, line: 'P4', text: 'P4' })
  expect(rows.at(-1)?.number).toBe(TOC_ROWS_MAX + 3)
})

test('the tab is on unless the setting is false', () => {
  expect(isTocTabOn({})).toBe(true)
  expect(isTocTabOn({ tocTab: true })).toBe(true)
  expect(isTocTabOn({ tocTab: false })).toBe(false)
})

test('a person typed it, sent it through the bridge, saved it before origins were stamped, or sent it with this mod\'s button', () => {
  expect(isTocOrigin({ kind: 'composer' } as PromptOrigin, OWN)).toBe(true)
  expect(isTocOrigin({ kind: 'unclassified' } as PromptOrigin, OWN)).toBe(true)
  expect(isTocOrigin({ kind: 'task-notification' } as PromptOrigin, OWN)).toBe(false)
  // The send button submits as the person; another plugin's prompt, and a command this mod ran, are not the person's.
  expect(isTocOrigin({ kind: 'plugin', name: OWN, asUser: true }, OWN)).toBe(true)
  expect(isTocOrigin({ kind: 'plugin', name: 'other', asUser: true }, OWN)).toBe(false)
  expect(isTocOrigin({ kind: 'plugin', name: OWN }, OWN)).toBe(false)
})

test('file names in a card lose control characters and stay bounded', () => {
  const esc = String.fromCharCode(27)
  expect(fileNames([`/a/${esc}]8;;x${String.fromCharCode(7)}app.ts`, '/b/README.md'])).toEqual([']8;;xapp.ts', 'README.md'])
  expect(Array.from(fileNames([`/x/${'f'.repeat(500)}`])[0] ?? '').length).toBeLessThanOrEqual(200)
})

// Security: a prompt pasted or resumed with characters that reorder or hide text is drawn without them.
test('a row line, a card and a file name lose the characters that reorder or hide text', () => {
  const at = (...codes: number[]): string => String.fromCodePoint(...codes)
  const raw = `invoice${at(0x202e)}fdp.exe and ${at(0x2066)}more${at(0x2069)}${at(0xe0041, 0xe007f)}`
  expect(firstLine(raw)).toBe('invoicefdp.exe and more')
  expect(bandCardText({ number: 3, text: promptText(raw) }, undefined, 40, translator('en'))).toBe('#3 invoicefdp.exe and more')
  expect(fileNames([`/p/${at(0x202e)}txt.exe`])).toEqual(['txt.exe'])
})

// Regression: the drawn rows and the transcript file judge a prompt by one rule, so a reload keeps the numbers.
test('a prompt is text that is not blank, not the engine\'s wrapper and not a slash command', () => {
  expect(promptOf('\n  Fix the bug  \nthen test')).toBe('Fix the bug\nthen test')
  for (const none of ['', '  \n ', '/usage', '  /Users/me/a.md explain', '<command-name>/model</command-name>', '<bash-input>ls</bash-input>', '<teammate-message teammate_id="r">done</teammate-message>']) {
    expect(promptOf(none)).toBeUndefined()
  }
})

// Regression: a teammate's row is `unclassified`, as an old one is; its `from` tells them apart (d.ts 2.1.309).
test('a drawn row is a person\'s prompt unless someone else sent it or it reports on a task', () => {
  const unclassified = { kind: 'unclassified' } as PromptOrigin
  expect(isTocRow({ origin: unclassified }, OWN)).toBe(true)
  expect(isTocRow({ origin: unclassified, from: { name: 'researcher' } }, OWN)).toBe(false)
  expect(isTocRow({ origin: unclassified, task: { id: 'b1' } }, OWN)).toBe(false)
  expect(isTocRow({ origin: { kind: 'peer' } as PromptOrigin }, OWN)).toBe(false)
  // This mod's own row is judged by name alone, as the transcript file judges it: 2.1.310 stores `asUser`, but files of
  // earlier builds keep the name alone. Another plugin's is not the person's.
  expect(isTocRow({ origin: { kind: 'plugin', name: OWN, asUser: true } }, OWN)).toBe(true)
  expect(isTocRow({ origin: { kind: 'plugin', name: OWN } }, OWN)).toBe(true)
  expect(isTocRow({ origin: { kind: 'plugin', name: 'other', asUser: true } }, OWN)).toBe(false)
})
