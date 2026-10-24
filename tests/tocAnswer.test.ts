// The desktop app's opened prompt row finds its answer among `$.session.messages()`, which carry no ids (tools/toc.ts):
// the message whose prompt, as the table keeps prompts, is the row's text, counted from the latest.
import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { ANSWER_CHARS_MAX, ANSWER_LINES_MAX, answerFor, answerLines, promptText } from '../hooks/tools/toc'

const said = (role: 'user' | 'assistant', text: string, more: Partial<SessionMessage> = {}): SessionMessage => ({ role, text, toolUses: [], ...more })
const TALK: SessionMessage[] = [
  said('user', 'run the tests'),
  said('assistant', 'First run.'),
  said('user', '', { toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] }),
  said('assistant', 'All green.'),
  said('user', '/cost'),
  said('assistant', 'Still green.'),
  said('user', 'run the tests'),
  said('assistant', 'Second run.'),
]

test('the answer is what Claude wrote after the prompt up to the next prompt the table lists; a tool result or a slash command is none', () => {
  expect(answerFor(TALK, 'run the tests', 1)).toEqual({ prompt: 'run the tests', answer: 'First run.\n\nAll green.\n\nStill green.' })
})

test('the same prompt sent twice is counted from the latest, as the messages hold the latest ones only', () => {
  expect(answerFor(TALK, 'run the tests', 0)?.answer).toBe('Second run.')
  expect(answerFor(TALK.slice(4), 'run the tests', 0)?.answer).toBe('Second run.')
  expect(answerFor(TALK, 'run the tests', 2)).toBeNull()
})

// Regression: "ok" opened the answer to "fix it, then say ok".
test('a short prompt is not found inside a longer one, before or after', () => {
  const talk = [said('user', 'fix it, then say ok'), said('assistant', 'A'), said('user', 'ok'), said('assistant', 'B'), said('user', 'ok then fix'), said('assistant', 'C')]
  expect(answerFor(talk, 'ok', 0)?.answer).toBe('B')
  expect(answerFor(talk, 'fix', 0)).toBeNull()
})

test('a prompt behind a reminder or an artifact\'s view state is found, and comes back without it', () => {
  const view = '<artifact-view-context artifact="a">\n{"context":{}}\n</artifact-view-context>\nlook at this'
  expect(answerFor([said('user', view), said('assistant', 'Looked.')], 'look at this', 0)).toEqual({ prompt: 'look at this', answer: 'Looked.' })
  const note = '<system-reminder>\nno project folder\n</system-reminder>\n\n'
  expect(answerFor([said('user', `${note}Test the toolbelt`), said('assistant', 'Testing.')], 'Test the toolbelt', 0)).toEqual({ prompt: 'Test the toolbelt', answer: 'Testing.' })
})

// Regression: a first prompt over the table's cut, behind the desktop app's reminder, found nothing.
test('a prompt longer than the table keeps is found by the text the table kept, and comes back whole', () => {
  const long = 'x'.repeat(3000)
  const note = '<system-reminder>\nno project folder\n</system-reminder>\n\n'
  expect(answerFor([said('user', `${note}${long}`), said('assistant', 'Read.')], promptText(long), 0)).toEqual({ prompt: long, answer: 'Read.' })
})

test('a message that is only a reminder is no one\'s prompt: it neither ends an answer nor counts', () => {
  const note = '<system-reminder>\nthe date changed\n</system-reminder>'
  expect(answerFor([said('user', 'go'), said('assistant', 'One.'), said('user', note), said('assistant', 'Two.')], 'go', 0)?.answer).toBe('One.\n\nTwo.')
})

test('no such prompt finds nothing', () => {
  expect(answerFor(TALK, 'never sent', 0)).toBeNull()
})

test('a long answer is drawn up to its caps, never inside a surrogate pair, and says the rest is only in an export', () => {
  expect(answerLines('a\nb')).toEqual({ lines: ['a', 'b'], isCut: false })
  const long = answerLines('x'.repeat(ANSWER_CHARS_MAX + 1))
  expect([long.isCut, long.lines.join('').length]).toEqual([true, ANSWER_CHARS_MAX])
  const split = answerLines(`${'x'.repeat(ANSWER_CHARS_MAX - 1)}😀`)
  expect([split.isCut, split.lines.join('').length]).toEqual([true, ANSWER_CHARS_MAX - 1])
  const many = answerLines('a\n'.repeat(ANSWER_LINES_MAX + 5))
  expect([many.isCut, many.lines.length]).toEqual([true, ANSWER_LINES_MAX])
})
