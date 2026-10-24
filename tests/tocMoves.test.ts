// The prompts tab's pure parts: the toc words of /toolbelt, moving through the prompts, where the person reads, what a
// jump's answer means, a turn's line and a card's lines.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect, test } from 'claude-code/testing'
import { translator } from '../hooks/lib/i18n'
import { cellsOf } from '../hooks/lib/width'
import { parseCommand } from '../hooks/tools/command'
import { TURN_FILES_MAX, bandCardText, cardLines, emptyTurn, jumpNote, pickIndex, readIndex, stepFrom, tick, topIndex, turnLine, withUses } from '../hooks/tools/toc'

const en = translator('en')
const ko = translator('ko')

test('toc opens the tab, and its words name a move', () => {
  expect(parseCommand('toc')).toEqual({ op: 'open', tab: 'toc' })
  for (const kind of ['next', 'prev', 'first', 'last'] as const) expect(parseCommand(`toc ${kind}`)).toEqual({ op: 'toc', move: { kind } })
  expect(parseCommand('toc 12')).toEqual({ op: 'toc', move: { kind: 'number', n: 12 } })
  expect(parseCommand('TOC #3')).toEqual({ op: 'toc', move: { kind: 'number', n: 3 } })
  expect(parseCommand('toc find  Login   Form')).toEqual({ op: 'toc', move: { kind: 'find', words: 'login form' } })
  expect(parseCommand('toc find')).toEqual({ op: 'usage' })
  // Control characters are dropped before anything is echoed, and the words are bounded.
  const esc = String.fromCharCode(27)
  expect(parseCommand(`toc find ${esc}[2Jx`)).toEqual({ op: 'toc', move: { kind: 'find', words: '[2jx' } })
  expect((parseCommand(`toc find ${'a'.repeat(200)}`) as { move: { words: string } }).move.words).toHaveLength(80)
  expect(parseCommand('toc next now')).toEqual({ op: 'usage', unknown: 'now' })
  expect(parseCommand('toc sideways')).toEqual({ op: 'usage', unknown: 'sideways' })
})

test('a step passes over prompts it cannot reach, and from nowhere starts at an end', () => {
  const none = () => false
  expect(stepFrom(1, 4, 1, none)).toBe(2)
  expect(stepFrom(1, 4, -1, none)).toBe(0)
  expect(stepFrom(3, 4, 1, none)).toBe(-1)
  expect(stepFrom(0, 4, -1, none)).toBe(-1)
  expect(stepFrom(-1, 4, 1, none)).toBe(0)
  expect(stepFrom(-1, 4, -1, none)).toBe(3)
  expect(stepFrom(0, 4, 1, i => i === 1 || i === 2)).toBe(3)
  expect(stepFrom(-1, 0, 1, none)).toBe(-1)
})

test('a move names its prompt by place, number or words', () => {
  const texts = ['Fix the login', 'add tests', 'LOGIN form again']
  const none = () => false
  expect(pickIndex({ kind: 'next' }, texts, 0, none)).toBe(1)
  expect(pickIndex({ kind: 'prev' }, texts, -1, none)).toBe(2)
  expect(pickIndex({ kind: 'first' }, texts, 2, none)).toBe(0)
  expect(pickIndex({ kind: 'last' }, texts, 0, none)).toBe(2)
  expect(pickIndex({ kind: 'number', n: 2 }, texts, -1, none)).toBe(1)
  expect(pickIndex({ kind: 'number', n: 4 }, texts, -1, none)).toBe(-1)
  expect(pickIndex({ kind: 'number', n: 0 }, texts, -1, none)).toBe(-1)
  // The newest that holds the words, case aside.
  expect(pickIndex({ kind: 'find', words: 'login' }, texts, -1, none)).toBe(2)
  expect(pickIndex({ kind: 'find', words: 'deploy' }, texts, -1, none)).toBe(-1)
  expect(pickIndex({ kind: 'first' }, [], -1, none)).toBe(-1)
  expect(pickIndex({ kind: 'last' }, [], -1, none)).toBe(-1)
})

test('the reader is under the earliest prompt on screen, past the rows above a cut top row', () => {
  // Nothing cut: the earliest prompt shown.
  expect(readIndex([{ i: 2, first: 0, order: 1 }, { i: 1, first: 0, order: 2 }])).toBe(1)
  // A row cut at the top is the top one; a row of an earlier prompt that said so before it left without a word.
  const rows = [{ i: 0, first: 0, order: 1 }, { i: 1, first: 4, order: 2 }, { i: 2, first: 0, order: 3 }]
  expect(topIndex(rows)).toBe(1)
  expect(readIndex(rows)).toBe(1)
  // An earlier prompt's row reported after the cut one: the viewport moved above it.
  const back = [...rows, { i: 0, first: 0, order: 4 }]
  expect(topIndex(back)).toBeUndefined()
  expect(readIndex(back)).toBe(0)
  expect(readIndex([])).toBe(-1)
})

test('a jump\'s answer: a landing reaches, nothing drawn does not, a screen that cannot scroll is said once', () => {
  expect(jumpNote(undefined, false)).toEqual({ reach: 'yes', isUnscrollable: false })
  expect(jumpNote('nothing drawn under that requestId', false)).toEqual({ reach: 'no', say: 'toast.tocNotDrawn', isUnscrollable: false })
  expect(jumpNote('transcript not scrollable here', false)).toEqual({ reach: 'unknown', say: 'toast.tocUnscrollable', isUnscrollable: true })
  expect(jumpNote('transcript not scrollable here', true)).toEqual({ reach: 'unknown', isUnscrollable: true })
  expect(jumpNote('the window moved meanwhile', true)).toEqual({ reach: 'unknown', say: 'toast.scrollRejected', isUnscrollable: false })
})

test('a row\'s mark: heavy where the person reads, dotted where no row can be reached', () => {
  expect([tick(true, false), tick(false, false), tick(false, true), tick(true, true)]).toEqual(['━', '─', '┄', '━'])
})

test('a turn on one line, in the person\'s language', () => {
  expect(turnLine(undefined, en)).toBe('')
  expect(turnLine({ tools: 0, files: [], fileCount: 0 }, en)).toBe('')
  expect(turnLine({ durationMs: 83_000, tools: 4, files: ['/p/app.ts', '/p/README.md'], fileCount: 2 }, en)).toBe('1m 23s · Tools: 4 · app.ts, README.md')
  expect(turnLine({ durationMs: 7_000, tools: 1, files: [], fileCount: 0, outcome: 'interrupted' }, en)).toBe('7s · Interrupted · Tools: 1')
  expect(turnLine({ durationMs: 3_720_000, tools: 0, files: [], fileCount: 0 }, ko)).toBe('1시간 2분')
  expect(turnLine({ tools: 2, files: [], fileCount: 0, outcome: 'running' }, ko)).toBe('진행 중 · 도구 2개')
  expect(turnLine({ tools: 0, files: [], fileCount: 0, outcome: 'error' }, en)).toBe('API error')
  // Files that share a name are told apart by their folder; more than three are counted.
  expect(turnLine({ tools: 2, files: ['/p/web/index.ts', '/p/api/index.ts'], fileCount: 2 }, en)).toBe('Tools: 2 · web/index.ts, api/index.ts')
  expect(turnLine({ durationMs: 500, tools: 5, files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'], fileCount: 5 }, en)).toBe('0s · Tools: 5 · a.ts, b.ts, c.ts +2')
})

test('a narrow turn line names fewer files, then counts them', () => {
  const turn = { durationMs: 9_000, tools: 3, files: ['alpha.ts', 'beta.ts', 'gamma.ts'], fileCount: 3 }
  expect(turnLine(turn, en)).toBe('9s · Tools: 3 · alpha.ts, beta.ts, gamma.ts')
  expect(turnLine(turn, en, 28)).toBe('9s · Tools: 3 · alpha.ts +2')
  expect(turnLine(turn, en, 20)).toBe('9s · Tools: 3 · Files: 3')
})

// Regression: a turn kept every file it edited and named each against every other, so a card of 3,000 files took
// seconds, on every band drawing. The turn keeps TURN_FILES_MAX of them and the count; names are counted once.
test('a turn of 3,000 edited files keeps 50 and their count, and its card is made within 300 ms', () => {
  // Names no two share: each was compared with every other.
  const paths = Array.from({ length: 3000 }, (_, i) => `/repo/src/file${i}.ts`)
  const turn = paths.reduce((built, path, i) => withUses(built, [{ id: `t${i}`, name: 'Edit', path }]), emptyTurn())
  expect(turn.files).toEqual(paths.slice(0, TURN_FILES_MAX))
  expect([turn.fileCount, turn.tools]).toEqual([3000, 3000])
  const row = { number: 7, text: 'rename it everywhere' }
  const started = Date.now()
  const card = bandCardText(row, turn, 200, en)
  // Comparing every name with every other took seconds; 300 ms leaves room for a busy machine.
  expect(Date.now() - started).toBeLessThan(300)
  expect(card).toBe('#7 rename it everywhere · Tools: 3000 · file0.ts, file1.ts, file2.ts +2997')
  // Every path at once, as a turn built some other way could hold them: still one count of the names.
  const before = Date.now()
  bandCardText(row, { ...turn, files: paths }, 200, en)
  expect(Date.now() - before).toBeLessThan(300)
  // A file edited again is named once.
  const again = withUses(withUses(emptyTurn(), [{ id: 'a', name: 'Edit', path: '/p/a.ts' }]), [{ id: 'b', name: 'Write', path: '/p/a.ts' }, { id: 'c', name: 'Edit', path: '/p/a.ts' }])
  expect([again.files, again.fileCount, again.tools]).toEqual([['/p/a.ts'], 1, 3])
})

test('a card wraps the prompt to its width and ends a long one with an ellipsis', () => {
  expect(cardLines('short\nsecond', 10, 4)).toEqual(['short', 'second'])
  expect(cardLines('x'.repeat(25), 10, 4)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  const cut = cardLines('가'.repeat(40), 10, 2)
  expect(cut).toHaveLength(2)
  expect(cut.every(line => cellsOf(line) <= 10)).toBe(true)
  expect(cut[1]?.endsWith('…')).toBe(true)
  expect(cardLines('', 10, 4)).toEqual([])
})
