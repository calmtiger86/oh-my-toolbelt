// The transcript file made into the prompts tab's table: which rows are a person's prompts, the turn each started,
// which prompt each reply answers, and the file read as untrusted input, whole or piece by piece.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect, test } from 'claude-code/testing'
import { LINE_CHARS_MAX, feedLines, historyOf, lastRows, parseRow, rowsOf, startFeed, streamRequest } from '../hooks/tools/transcript'
import type { Row } from '../hooks/tools/transcript'

const ESC = String.fromCharCode(27)
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
type Fields = Record<string, unknown>

// Rows as the engine stores them (2.1.308): a typed prompt's origin is `human`; files from before origins have none.
const user = (n: number, parent: number | null, content: unknown, more: Fields = {}): string =>
  JSON.stringify({ type: 'user', uuid: id(n), parentUuid: parent === null ? null : id(parent), origin: { kind: 'human' }, message: { role: 'user', content }, ...more })
const reply = (n: number, parent: number, uses: { id: string; name: string; path?: string }[] = [], more: Fields = {}): string =>
  JSON.stringify({
    type: 'assistant', uuid: id(n), parentUuid: id(parent),
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, ...uses.map(use => ({ type: 'tool_use', id: use.id, name: use.name, input: use.path === undefined ? {} : { file_path: use.path } }))] },
    ...more,
  })
const result = (n: number, parent: number, toolId: string): string => user(n, parent, [{ type: 'tool_result', tool_use_id: toolId, content: 'done' }], { origin: undefined })
const duration = (n: number, parent: number, ms: number): string => JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: id(n), parentUuid: id(parent), durationMs: ms })

const kinds = (lines: string[]): string[] => lines.map(line => parseRow(line)?.kind ?? 'none')
// This mod's name, as `$.plugin.name` gives it.
const OWN = 'oh-my-toolbelt'
const prompts = (lines: string[]): string[] => historyOf(rowsOf(lines.join('\n')), OWN).prompts.map(prompt => prompt.text)

test('a person\'s prompt is a prompt; the engine\'s own user rows are not', () => {
  expect(kinds([
    user(1, null, 'Fix the bug'),
    user(2, 1, [{ type: 'text', text: 'Blocks too' }]),
    user(3, 2, 'From before origins were stored', { origin: undefined }),
    user(4, 3, '<command-name>/toolbelt</command-name>'),
    user(5, 4, '/compact'),
    user(6, 5, '<bash-input>ls</bash-input>'),
    user(7, 6, '<task-notification>done</task-notification>', { origin: { kind: 'task-notification' } }),
    user(8, 7, 'A peer says hi', { origin: { kind: 'peer' } }),
    user(9, 8, 'Caveat: meta', { isMeta: true }),
    user(10, 9, 'Summary of the conversation', { isCompactSummary: true }),
    user(11, 10, [{ type: 'text', text: '[Request interrupted by user for tool use]' }], { origin: undefined }),
    result(12, 11, 't1'),
    user(13, 12, '   '),
    user(14, 13, 'A scheduled prompt', { origin: { kind: 'scheduled-trigger' } }),
    // A kind this build does not name is taken as a person's, so a misjudged prompt is listed rather than hidden.
    user(15, 14, 'From a client not known yet', { origin: { kind: 'some-new-client' } }),
  ])).toEqual(['prompt', 'prompt', 'prompt', 'other', 'other', 'other', 'start', 'start', 'other', 'other', 'interrupt', 'other', 'other', 'start', 'prompt'])
})

// Regression: the engine wraps a teammate's message in `<teammate-message>` (2.1.309); its origin is unstamped.
// The desktop app puts a note ahead of the first prompt of a session started without a project folder (that prompt used
// to be missing): the prompt is what follows it; a row that is only the engine's reminder is none.
test('a prompt behind the desktop app\'s reminder is the text after it', () => {
  const note = '<system-reminder>\nThe user started this session without choosing a project folder.\n</system-reminder>\n\n'
  expect(prompts([
    user(1, null, [{ type: 'text', text: note }, { type: 'text', text: 'Test the toolbelt, please.' }], { promptSource: 'sdk' }),
    user(2, 1, [{ type: 'text', text: note }]),
    user(3, 2, 'second'),
  ])).toEqual(['Test the toolbelt, please.', 'second'])
})

// Regression: the toolbelt's send button submits as the person; its prompts were missing after a reload and their turns
// went to the prompt before. 2.1.310 stores the row's `asUser`; a file of an earlier build may name the plugin alone.
test('the file\'s prompts from this mod\'s send button are listed with their turns; another plugin\'s and a command\'s rows are not', () => {
  const own = { origin: { kind: 'plugin', name: OWN } }
  const history = historyOf(rowsOf([
    user(1, null, 'Typed'),
    duration(2, 1, 1_000),
    user(3, 2, 'Write the commit message.', { origin: { kind: 'plugin', name: OWN, asUser: true } }),
    reply(4, 3, [{ id: 't1', name: 'Bash' }]),
    duration(5, 4, 83_000),
    user(6, 5, 'From another plugin', { origin: { kind: 'plugin', name: 'other' } }),
    // A command this mod ran (/voice): the engine's wrapper, its caveat row and its output.
    user(7, 6, '<command-name>/voice</command-name>\n<command-message>voice</command-message>\n<command-args>tap</command-args>', own),
    user(8, 7, '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>', { ...own, isMeta: true }),
    user(9, 8, '<local-command-stdout>Voice mode enabled</local-command-stdout>', own),
    user(10, 9, 'Run the tests.', own),
  ].join('\n')), OWN)
  expect(history.prompts).toEqual([{ uuid: id(1), text: 'Typed' }, { uuid: id(3), text: 'Write the commit message.' }, { uuid: id(10), text: 'Run the tests.' }])
  expect(history.turns).toEqual([{ tools: 0, files: [], fileCount: 0, durationMs: 1_000 }, { tools: 1, files: [], fileCount: 0, durationMs: 83_000 }, { tools: 0, files: [], fileCount: 0 }])
})

// Regression: the turn another plugin's prompt, a skill another plugin ran or a notification started went to the prompt
// before it. A turn ends at its turn_duration row.
test('a turn no listed prompt started adds to none, and its replies place no one', () => {
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Edit', path: '/p/app.ts' }]),
    duration(3, 2, 5_000),
    user(4, 3, 'From another plugin', { origin: { kind: 'plugin', name: 'other', asUser: true } }),
    reply(5, 4, [{ id: 't2', name: 'Bash' }, { id: 't3', name: 'Bash' }]),
    duration(6, 5, 60_000),
    // A skill another plugin ran: the engine's wrapper under its name, and the skill's text.
    user(7, 6, '<command-message>co</command-message>\n<command-name>/co</command-name>', { origin: { kind: 'plugin', name: 'other' }, turnPosition: { promptIndex: 3, turnIndex: 3 } }),
    user(8, 7, 'Base directory for this skill: /skills/co', { origin: { kind: 'plugin', name: 'other' }, isMeta: true }),
    reply(9, 8, [{ id: 't4', name: 'Write', path: '/p/MEMORY.md' }]),
    duration(10, 9, 30_000),
    user(11, 10, '<task-notification>\n<task-id>a1</task-id>\n</task-notification>', { origin: { kind: 'task-notification' } }),
    reply(12, 11),
    duration(13, 12, 2_000),
  ].join('\n')), OWN)
  expect(history.prompts).toEqual([{ uuid: id(1), text: 'first' }])
  expect(history.turns).toEqual([{ tools: 1, files: ['/p/app.ts'], fileCount: 1, durationMs: 5_000 }])
  expect(history.owners).toEqual([[id(2), 0], ['t1', 0]])
  expect(history.started).toBe(-1)
})

// Regression: a prompt that was a slash command alone (`/ci`, a skill) was missing after a reload, and its turn went to
// the prompt before it. 2.1.310 stores such a row with its place among the turns (`turnPosition`), typed or run by this
// mod's button, and a command that only acts here (`/login`, `/reload-plugins`) with none, behind its caveat row.
test('a slash command Claude answers is a prompt with its turn, as `/name args`; one that only acts here is not', () => {
  const at = (n: number) => ({ turnPosition: { promptIndex: n, turnIndex: n } })
  const caveat = '<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>'
  const history = historyOf(rowsOf([
    user(1, null, '<command-message>ci</command-message>\n<command-name>/ci</command-name>', at(1)),
    user(2, 1, 'Base directory for this skill: /skills/ci', { isMeta: true }),
    reply(3, 2, [{ id: 't1', name: 'Read' }]),
    duration(4, 3, 9_000),
    user(5, 4, caveat, { origin: undefined, isMeta: true }),
    user(6, 5, '<command-name>/login</command-name>\n            <command-message>login</command-message>\n            <command-args></command-args>', { origin: undefined }),
    user(7, 6, '<local-command-stdout>Login successful</local-command-stdout>', { origin: undefined }),
    user(8, 7, '<command-message>hs</command-message>\n<command-name>/hs</command-name>\n<command-args>keep the files\nas they are</command-args>', at(2)),
    reply(9, 8),
    user(10, 9, '<command-message>co</command-message>\n<command-name>/co</command-name>', { origin: { kind: 'plugin', name: OWN }, ...at(3) }),
    user(11, 10, caveat, { origin: { kind: 'plugin', name: OWN }, isMeta: true }),
    user(12, 11, '<command-name>/reload-plugins</command-name>\n            <command-message>reload-plugins</command-message>\n            <command-args></command-args>', { origin: { kind: 'plugin', name: OWN } }),
  ].join('\n')), OWN)
  expect(history.prompts).toEqual([{ uuid: id(1), text: '/ci' }, { uuid: id(8), text: '/hs keep the files\nas they are' }, { uuid: id(10), text: '/co' }])
  expect(history.turns[0]).toEqual({ tools: 1, files: [], fileCount: 0, durationMs: 9_000 })
  expect(history.owners).toEqual([[id(3), 0], ['t1', 0], [id(9), 1]])
})

// Regression: a turn an interruption or an API error ended may write no turn_duration row (seen in 2.1.295 to
// 2.1.308), and the turn after it, a notification's, went to the prompt before. Such a turn ends there, and a
// turn_duration row right after it is still its own.
test('an interruption or an API error ends its turn, a turn_duration row after it is that turn\'s, and the next turn adds to none', () => {
  const notice = (n: number): string => user(n, n - 1, '<task-notification>\n<task-id>a1</task-id>\n</task-notification>', { origin: { kind: 'task-notification' } })
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Bash' }]),
    user(3, 2, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined }),
    notice(4),
    reply(5, 4, [{ id: 't2', name: 'Bash' }]),
    duration(6, 5, 2_000),
    user(7, 6, 'second'),
    reply(8, 7, [{ id: 't3', name: 'Read' }]),
    user(9, 8, [{ type: 'text', text: '[Request interrupted by user for tool use]' }], { origin: undefined }),
    duration(10, 9, 7_000),
    notice(11),
    reply(12, 11),
    duration(13, 12, 1_000),
    user(14, 13, 'third'),
    reply(15, 14, [], { isApiErrorMessage: true }),
    notice(16),
    reply(17, 16, [{ id: 't4', name: 'Bash' }]),
    duration(18, 17, 3_000),
    user(19, 18, 'fourth'),
    reply(20, 19, [], { isApiErrorMessage: true }),
    duration(21, 20, 4_000),
  ].join('\n')), OWN)
  expect(history.prompts.map(prompt => prompt.text)).toEqual(['first', 'second', 'third', 'fourth'])
  expect(history.turns).toEqual([
    { tools: 1, files: [], fileCount: 0, outcome: 'interrupted' },
    { tools: 1, files: [], fileCount: 0, durationMs: 7_000, outcome: 'interrupted' },
    { tools: 0, files: [], fileCount: 0, outcome: 'error' },
    { tools: 0, files: [], fileCount: 0, durationMs: 4_000, outcome: 'error' },
  ])
  expect(history.owners).toEqual([[id(2), 0], ['t1', 0], [id(8), 1], ['t3', 1], [id(15), 2], [id(20), 3]])
  expect(history.started).toBe(-1)
})

// Rows the engine writes between an interruption and its turn_duration row (2.1.308 wrote dozens of informational
// ones) belong to no turn, so the time still goes to the interrupted one.
test('a turn_duration row after an interruption and informational rows is the interrupted turn\'s', () => {
  const info = (n: number): string => JSON.stringify({ type: 'system', subtype: 'informational', uuid: id(n), parentUuid: id(n - 1), content: 'note', level: 'info' })
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Bash' }]),
    user(3, 2, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined }),
    info(4),
    info(5),
    duration(6, 5, 2_000),
  ].join('\n')), OWN)
  expect(history.turns).toEqual([{ tools: 1, files: [], fileCount: 0, durationMs: 2_000, outcome: 'interrupted' }])
  expect(history.started).toBe(-1)
})

test('a turn_duration row after an interruption and a /compact boundary is the interrupted turn\'s', () => {
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Bash' }]),
    user(3, 2, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: id(4), parentUuid: null, logicalParentUuid: id(3) }),
    duration(5, 4, 3_000),
  ].join('\n')), OWN)
  expect(history.turns).toEqual([{ tools: 1, files: [], fileCount: 0, durationMs: 3_000, outcome: 'interrupted' }])
  expect(history.started).toBe(-1)
})

// Regression: the notice was read by its first words, so a person's message that began with them left the list after a
// reload and ended its turn, while the live list and the export keep it. Only the whole row is the notice; while a tool
// runs it rides with the call's result, and the text blocks alone are read.
test('an interruption notice is a whole row: a message that only starts with its words is a prompt and ends no turn', () => {
  const stopped = '[Request interrupted by user for tool use]'
  expect(kinds([
    user(1, null, '[Request interrupted by user]\n', { origin: undefined }),
    user(2, 1, [{ type: 'tool_result', tool_use_id: 't1', content: 'done' }, { type: 'text', text: stopped }], { origin: undefined }),
    user(3, 2, '[Request interrupted by user] please go on'),
    user(4, 3, `${stopped}\nplease go on`),
  ])).toEqual(['interrupt', 'interrupt', 'prompt', 'prompt'])
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Bash' }]),
    user(3, 2, '[Request interrupted by user] please go on'),
    reply(4, 3),
    duration(5, 4, 2_000),
  ].join('\n')), OWN)
  expect(history.prompts.map(prompt => prompt.text)).toEqual(['first', '[Request interrupted by user] please go on'])
  expect(history.turns).toEqual([
    { tools: 1, files: [], fileCount: 0 },
    { tools: 0, files: [], fileCount: 0, durationMs: 2_000 },
  ])
})

// Regression: 2.1.310 writes no turn_duration row for a turn the person stops, so after a reload its card said
// "interrupted" with no time where the live one said 13 s. The time runs from the prompt's row to the row that ended
// the turn (measured: 19:08:28.708 to 19:08:42.769, where the engine counted 13.919 s).
test('a turn an interruption or an API error ended with no turn_duration row takes its time from the rows\' timestamps', () => {
  const at = (time: string): Fields => ({ timestamp: `2026-10-27T${time}Z` })
  const history = historyOf(rowsOf([
    user(1, null, 'first', at('19:08:28.708')),
    reply(2, 1, [{ id: 't1', name: 'Bash' }], at('19:08:31.000')),
    user(3, 2, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined, ...at('19:08:42.769') }),
    user(4, 3, 'second', at('19:09:00.000')),
    reply(5, 4, [{ id: 't2', name: 'Read' }], at('19:09:01.000')),
    user(6, 5, [{ type: 'text', text: '[Request interrupted by user for tool use]' }], { origin: undefined, ...at('19:09:05.500') }),
    user(7, 6, 'third', at('19:10:00.000')),
    reply(8, 7, [], { isApiErrorMessage: true, ...at('19:10:02.250') }),
    // A turn_duration row after the interruption (2.1.308): the engine's time stands, not added to the timestamps'.
    user(9, 8, 'fourth', at('19:11:00.000')),
    user(10, 9, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined, ...at('19:11:30.000') }),
    duration(11, 10, 29_500),
    // Still running: no row ended it.
    user(12, 11, 'fifth', at('19:12:00.000')),
    reply(13, 12, [], at('19:12:09.000')),
  ].join('\n')), OWN)
  expect(history.turns.map(turn => turn.durationMs)).toEqual([14_061, 5_500, 2_250, 29_500, undefined])
  expect(history.turns.map(turn => turn.outcome)).toEqual(['interrupted', 'interrupted', 'error', 'interrupted', undefined])
})

test('a timestamp that is missing, unreadable or later than the turn\'s end gives the turn no time', () => {
  expect(parseRow(user(1, null, 'x', { timestamp: '2026-10-27T19:08:28.708Z' }))?.at).toBe(Date.UTC(2026, 9, 27, 19, 8, 28, 708))
  expect(parseRow(user(1, null, 'x', { timestamp: 'not a time' }))).not.toHaveProperty('at')
  expect(parseRow(user(1, null, 'x', { timestamp: 1_793_000_000_000 }))).not.toHaveProperty('at')
  const stop = (n: number, more: Fields = {}): string => user(n, n - 1, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined, ...more })
  const history = historyOf(rowsOf([
    user(1, null, 'first', { timestamp: '2026-10-27T19:00:00.000Z' }),
    stop(2),
    user(3, 2, 'second', { timestamp: 'not a time' }),
    stop(4, { timestamp: '2026-10-27T19:01:00.000Z' }),
    user(5, 4, 'third', { timestamp: '2026-10-27T19:03:00.000Z' }),
    stop(6, { timestamp: '2026-10-27T19:02:00.000Z' }),
  ].join('\n')), OWN)
  const interrupted = { tools: 0, files: [], fileCount: 0, outcome: 'interrupted' }
  expect(history.turns).toEqual([interrupted, interrupted, interrupted])
})

// Regression: two rows that end a turn in a row (an interruption, or an API error reply and then an interruption) left
// the turn_duration row after them to no turn, and the turn without its time. A machine's row between them starts the
// next turn, so an API error reply after a notification is not the interrupted prompt's.
test('a second row that ends a turn is still that turn\'s, and so is its turn_duration row; a machine\'s row between starts another turn', () => {
  const stop = (n: number): string => user(n, n - 1, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined })
  const notice = (n: number): string => user(n, n - 1, '<task-notification>\n<task-id>a1</task-id>\n</task-notification>', { origin: { kind: 'task-notification' } })
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Bash' }]),
    stop(3),
    stop(4),
    duration(5, 4, 6_000),
    user(6, 5, 'second'),
    reply(7, 6, [], { isApiErrorMessage: true }),
    stop(8),
    duration(9, 8, 8_000),
    user(10, 9, 'third'),
    reply(11, 10, [{ id: 't2', name: 'Read' }]),
    stop(12),
    notice(13),
    reply(14, 13, [], { isApiErrorMessage: true }),
    duration(15, 14, 1_000),
  ].join('\n')), OWN)
  expect(history.turns).toEqual([
    { tools: 1, files: [], fileCount: 0, durationMs: 6_000, outcome: 'interrupted' },
    { tools: 0, files: [], fileCount: 0, durationMs: 8_000, outcome: 'interrupted' },
    { tools: 1, files: [], fileCount: 0, outcome: 'interrupted' },
  ])
  // The API error reply after the notification answers no listed prompt.
  expect(history.owners).toEqual([[id(2), 0], ['t1', 0], [id(7), 1], [id(11), 2], ['t2', 2]])
  expect(history.started).toBe(-1)
})

test('a turn two rows ended, with no turn_duration row, takes its time up to the first of them', () => {
  const at = (time: string): Fields => ({ timestamp: `2026-10-27T${time}Z` })
  const stop = (n: number, time: string): string => user(n, n - 1, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined, ...at(time) })
  const history = historyOf(rowsOf([
    user(1, null, 'first', at('19:00:00.000')),
    stop(2, '19:00:10.000'),
    stop(3, '19:00:12.000'),
    user(4, 3, 'second', at('19:01:00.000')),
    reply(5, 4, [], { isApiErrorMessage: true, ...at('19:01:03.000') }),
    stop(6, '19:01:04.000'),
  ].join('\n')), OWN)
  expect(history.turns.map(turn => [turn.durationMs, turn.outcome])).toEqual([[10_000, 'interrupted'], [3_000, 'interrupted']])
})

test('a teammate\'s message is not a prompt', () => {
  expect(parseRow(user(1, null, '<teammate-message teammate_id="researcher">done</teammate-message>', { origin: undefined }))?.kind).toBe('other')
})

test('a line that is not a row is passed over: broken JSON, no uuid, odd types, a giant line', () => {
  expect(parseRow('{"type":"user","uuid":')).toBeUndefined()
  expect(parseRow('not json at all')).toBeUndefined()
  expect(parseRow(JSON.stringify({ type: 'last-prompt', lastPrompt: 'hi' }))).toBeUndefined()
  expect(parseRow(JSON.stringify({ type: 'user', uuid: 42 }))).toBeUndefined()
  expect(parseRow('[1,2,3]')).toBeUndefined()
  expect(parseRow('null')).toBeUndefined()
  // Fields of the wrong type count as nothing.
  expect(parseRow(JSON.stringify({ type: 'user', uuid: id(1), parentUuid: 7, message: 'text', origin: 'human' }))).toEqual({ uuid: id(1), parent: undefined, isSidechain: false, kind: 'other' })
  expect(parseRow(JSON.stringify({ type: 'assistant', uuid: id(2), message: { content: [null, 3, { type: 'tool_use', id: 9 }, { type: 'tool_use', id: 't1', name: 5, input: [] }] } })))
    .toEqual({ uuid: id(2), parent: undefined, isSidechain: false, kind: 'reply', uses: [{ id: 't1', name: '' }], isError: false })
  expect(parseRow(JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: id(3), durationMs: -5 }))?.kind).toBe('other')
  expect(parseRow(JSON.stringify({ type: 'system', subtype: 'turn_duration', uuid: id(3), durationMs: 'long' }))?.kind).toBe('other')
  expect(parseRow(user(4, null, 'x'.repeat(LINE_CHARS_MAX)))).toBeUndefined()
})

test('a prompt is kept as a drawn one is: control characters gone, blank lines dropped, bounded', () => {
  const row = parseRow(user(1, null, `Red ${ESC}[31mtext${ESC}[0m\n\n\tsecond line`))
  expect(row?.kind === 'prompt' ? row.text : '').toBe('Red [31mtext[0m\nsecond line')
  const long = parseRow(user(2, null, 'y'.repeat(50_000)))
  expect(long?.kind === 'prompt' ? Array.from(long.text).length : 0).toBe(2000)
  const viewed = parseRow(user(3, null, '<artifact-view-context artifact="a1">\n{"context":{"page":2}}\n</artifact-view-context>\nWhat is on page 2?'))
  expect(viewed?.kind === 'prompt' ? viewed.text : '').toBe('What is on page 2?')
})

test('each prompt\'s turn: its tool calls, edited files, time and how it ended; replies and tool calls are its own', () => {
  const history = historyOf(rowsOf([
    user(1, null, 'first'),
    reply(2, 1, [{ id: 't1', name: 'Edit', path: '/p/app.ts' }, { id: 't2', name: 'Bash' }]),
    result(3, 2, 't1'),
    reply(4, 3, [{ id: 't3', name: 'Write', path: '/p/app.ts' }]),
    duration(5, 4, 83_000),
    user(6, 5, 'second'),
    reply(7, 6, [], { isApiErrorMessage: true }),
    user(8, 7, 'third'),
    reply(9, 8, [{ id: 't4', name: 'Read', path: '/p/README.md' }]),
    user(10, 9, [{ type: 'text', text: '[Request interrupted by user]' }], { origin: undefined }),
  ].join('\n')), OWN)
  expect(history.prompts).toEqual([{ uuid: id(1), text: 'first' }, { uuid: id(6), text: 'second' }, { uuid: id(8), text: 'third' }])
  expect(history.turns).toEqual([
    { tools: 3, files: ['/p/app.ts'], fileCount: 1, durationMs: 83_000 },
    { tools: 0, files: [], fileCount: 0, outcome: 'error' },
    { tools: 1, files: [], fileCount: 0, outcome: 'interrupted' },
  ])
  expect(history.owners).toEqual([[id(2), 0], ['t1', 0], ['t2', 0], [id(4), 0], ['t3', 0], [id(7), 1], [id(9), 2], ['t4', 2]])
  // The interruption ended the last turn: no reply after it is the third prompt's.
  expect(history.started).toBe(-1)
  expect(history.known.size).toBe(10)
})

test('a prompt queued into a running turn is listed, and the turn stays with the prompt that started it', () => {
  const queued = JSON.stringify({ type: 'attachment', uuid: id(3), parentUuid: id(2), attachment: { type: 'queued_command', prompt: 'and also this', origin: { kind: 'human' } } })
  const notified = JSON.stringify({ type: 'attachment', uuid: id(4), parentUuid: id(3), attachment: { type: 'queued_command', prompt: '<task-notification>x</task-notification>', origin: { kind: 'task-notification' } } })
  const history = historyOf(rowsOf([user(1, null, 'start'), reply(2, 1), queued, notified, reply(5, 4, [{ id: 't1', name: 'Bash' }])].join('\n')), OWN)
  expect(history.prompts.map(prompt => prompt.text)).toEqual(['start', 'and also this'])
  expect(history.turns).toEqual([{ tools: 1, files: [], fileCount: 0 }, { tools: 0, files: [], fileCount: 0 }])
  // A reply places the reader under the latest prompt, delivered or not.
  expect(history.owners).toEqual([[id(2), 0], [id(5), 1], ['t1', 1]])
  expect(history.started).toBe(0)
})

test('only the live branch counts: a rewound prompt drops, a /compact boundary goes on above it, a subagent\'s rows pass', () => {
  // As 2.1.308 writes it: no parent, and a logical parent past the boundary (the end of what the compaction kept).
  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: id(6), parentUuid: null, logicalParentUuid: id(8) })
  const side = user(9, 8, 'a subagent prompt', { isSidechain: true })
  expect(prompts([
    user(1, null, 'kept'),
    reply(2, 1),
    user(3, 2, 'rewound away'),
    reply(4, 3),
    // The person rewound to the reply after the first prompt and wrote again from there.
    user(5, 2, 'written again'),
    boundary,
    user(7, 6, 'after compact'),
    reply(8, 7),
    side,
  ])).toEqual(['kept', 'written again', 'after compact'])
})

// A prompt taken back with Esc before any reply (2.1.310, a test session): its row and the attachment row after it stay
// in the file, its interruption notice is not written, and the next prompt's parent skips it for the last row of the
// answered turn. The live list drops it too (tocLive.test.tsx), so both numberings agree.
test('a prompt Esc took back before any reply is an abandoned branch: the list and the numbers skip it', () => {
  const history = historyOf(rowsOf([
    user(1, null, 'answered'),
    reply(2, 1),
    duration(3, 2, 4_000),
    user(4, 3, 'taken back'),
    JSON.stringify({ type: 'attachment', uuid: id(5), parentUuid: id(4), attachment: { type: 'hook_success' } }),
    user(6, 3, 'asked again'),
    reply(7, 6),
    duration(8, 7, 2_000),
  ].join('\n')), OWN)
  expect(history.prompts).toEqual([{ uuid: id(1), text: 'answered' }, { uuid: id(6), text: 'asked again' }])
  expect(history.turns).toEqual([
    { tools: 0, files: [], fileCount: 0, durationMs: 4_000 },
    { tools: 0, files: [], fileCount: 0, durationMs: 2_000 },
  ])
  expect(history.owners).toEqual([[id(2), 0], [id(7), 1]])
})

test('a chain broken by a line that could not be read keeps every prompt above it; a row written twice counts once', () => {
  expect(prompts([user(1, null, 'one'), reply(2, 1), '{"type":"user","uuid":"torn', user(4, 3, 'two'), user(4, 3, 'two'), reply(5, 4)])).toEqual(['one', 'two'])
  expect(prompts([])).toEqual([])
  expect(prompts(['garbage', '', '{}'])).toEqual([])
})

test('lines come in pieces: one split across pieces is joined, a giant one dropped to its end, the last read without a newline', () => {
  const [a, b] = [user(1, null, 'alpha'), user(2, 1, 'beta')]
  const first = feedLines(startFeed(), a.slice(0, 10))
  expect(first.rows).toEqual([])
  const second = feedLines(first.feed, `${a.slice(10)}\n${b.slice(0, 5)}`)
  expect(second.rows.map(row => row.uuid)).toEqual([id(1)])
  expect(lastRows(feedLines(second.feed, b.slice(5)).feed).map(row => row.uuid)).toEqual([id(2)])
  // A line past LINE_CHARS_MAX is not held: it is dropped up to its newline, and the line after it is read.
  const giant = feedLines(startFeed(), 'z'.repeat(LINE_CHARS_MAX + 1))
  expect(giant.feed).toEqual({ rest: '', isSkipping: true })
  const still = feedLines(giant.feed, 'zzz')
  expect(still.feed).toEqual({ rest: '', isSkipping: true })
  const after = feedLines(still.feed, `zz\n${a}\n`)
  expect(after.rows.map(row => row.uuid)).toEqual([id(1)])
  expect(after.feed).toEqual({ rest: '', isSkipping: false })
  expect(lastRows(giant.feed)).toEqual([])
  const rows: Row[] = rowsOf(`${a}\n${b}`)
  expect(rows.map(row => row.uuid)).toEqual([id(1), id(2)])
})

// Security: on Windows a program named alone may be looked for in the session's folder first, so PowerShell runs by its
// full path, and tail, which Windows need not have, is not tried there.
test('a large file streams through tail by argv, and on a Windows path through PowerShell by its full path, the path in its environment', () => {
  expect(streamRequest('/Users/me/.claude/projects/p/s.jsonl', undefined)).toEqual({ argv: ['tail', '-c', '+1', '--', '/Users/me/.claude/projects/p/s.jsonl'] })
  expect(streamRequest('/Users/me/.claude/projects/p/s.jsonl', undefined, '/usr/bin/tail').argv[0]).toBe('/usr/bin/tail')
  const path = 'C:\\Users\\me\\.claude\\projects\\p\\s;rm -rf.jsonl'
  const powershell = streamRequest(path, 'C:\\WINDOWS')
  expect(powershell.argv.slice(0, 4)).toEqual(['C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoProfile', '-NonInteractive', '-Command'])
  expect(powershell.argv.join(' ')).not.toContain(path)
  expect(powershell.env).toEqual({ TOOLBELT_TRANSCRIPT: path })
  // With no SystemRoot, where Windows is installed by default.
  expect(streamRequest(path, undefined).argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  expect(streamRequest(path, '').argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  // A SystemRoot that does not start at a drive would be looked for in the session's folder again.
  for (const relative of ['Windows', '.\\Windows', '\\Windows', '%SystemRoot%']) {
    expect(streamRequest(path, relative).argv[0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  }
  // A network share is never read, however the path came.
  for (const share of ['\\\\host\\share\\s.jsonl', '//host/share/s.jsonl', '\\/host/share/s.jsonl']) {
    expect(() => streamRequest(share, undefined)).toThrow('a network path is not read')
  }
})
