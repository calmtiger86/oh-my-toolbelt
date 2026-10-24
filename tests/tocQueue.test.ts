// A prompt sent while a turn runs is one row: the rows the engine draws for it under ids it never stores and its stored
// row are one entry, whose jump goes to the row drawn last.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect, test } from 'claude-code/testing'
import { PROVISIONAL_ID } from '../hooks/tools/toc'
import { LATELY_MS, emptyQueue, entryKey, noteDrawn, noteSent, restQueue } from '../hooks/tools/toc-queue'
import type { Listed } from '../hooks/tools/toc-queue'

const id = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
const start = (): Listed => ({ toc: new Map(), queue: emptyQueue() })
const rows = (listed: Listed): [string, string][] => [...listed.toc].map(([key, entry]) => [key, entry.requestId])
// A prompt that starts a turn: its provisional row, then its stored one.
const typed = (listed: Listed, n: number, text: string, now = 0): Listed => noteDrawn(noteDrawn(listed, PROVISIONAL_ID, text, now, false), id(n), text, now, false)

test('a prompt delivered into the running turn is one row, which jumps to the row the turn read', () => {
  const first = typed(start(), 1, 'first')
  const sent = noteSent(first, 'second', 1000, true)
  // The engine draws the queued prompt under an id it never stores, then the row the turn read, later.
  const queued = noteDrawn(sent, 'queued-preview', 'second', 1010, true)
  const read = noteDrawn(queued, id(2), 'second', 1000 + LATELY_MS + 1, true)
  expect(rows(read)).toEqual([[id(1).slice(0, 24), id(1)], ['queued-preview', id(2)]])
  expect(entryKey(read, id(2).slice(0, 24))).toBe('queued-preview')
  // Drawn again, neither adds a row; the turn's end leaves the entry pending no more.
  expect(rows(noteDrawn(noteDrawn(read, 'queued-preview', 'second', 3000, true), id(2), 'second', 3000, true))).toEqual(rows(read))
  expect([...restQueue(read.queue).pending]).toEqual([])
})

test('a queued prompt\'s first row drawn just before it is sent is its own; one drawn long before is not', () => {
  const first = typed(start(), 1, 'first')
  const early = noteDrawn(noteDrawn(first, 'preview-a', 'second', 1000, true), 'preview-b', 'second', 1100, true)
  const sent = noteSent(early, 'second', 1000 + LATELY_MS, true)
  expect(rows(sent).map(([key]) => key)).toEqual([id(1).slice(0, 24), 'preview-a'])
  expect(entryKey(sent, 'preview-b')).toBe('preview-a')
  const stale = noteSent(noteDrawn(first, 'old', 'second', 0, true), 'second', LATELY_MS + 1, true)
  expect([...stale.queue.pending]).toEqual([])
  expect(rows(stale)).toHaveLength(2)
})

test('a prompt queued behind the turn keeps its place, and its stored row takes it when its own turn starts', () => {
  const sent = noteSent(typed(start(), 1, 'first'), 'second', 1000, true)
  const queued = noteDrawn(sent, 'queued-preview', 'second', 1010, true)
  // The turn ends before the prompt is read; the next turn draws it under the provisional id, then stored.
  const rested = { ...queued, queue: restQueue(queued.queue) }
  expect([...rested.queue.pending]).toEqual(['queued-preview'])
  const stored = typed(rested, 2, 'second', 5000)
  expect(rows(stored)).toEqual([[id(1).slice(0, 24), id(1)], [id(2).slice(0, 24), id(2)]])
  expect(entryKey(stored, 'queued-preview')).toBe(id(2).slice(0, 24))
  expect([...stored.queue.pending]).toEqual([])
})

test('the same text sent in two turns is two rows, and a drawn row with no notification is listed as before', () => {
  const twice = typed(typed(start(), 1, 'continue'), 2, 'continue', 10_000)
  expect(rows(twice).map(([, requestId]) => requestId)).toEqual([id(1), id(2)])
  const plain = noteDrawn(start(), id(3), 'scrolled up to', 0, false)
  expect(rows(plain)).toEqual([[id(3).slice(0, 24), id(3)]])
  expect(noteSent(plain, '   ', 0, true)).toBe(plain)
})

// Regression: drawn with no provisional row first, a prompt sent while no turn ran was held pending, and the same text
// sent next joined it as another name, so the list lost the second.
test('a prompt sent while no turn runs waits for nothing: the same text sent twice is two rows, with a provisional row or without', () => {
  for (const isProvisional of [true, false]) {
    const turn = (listed: Listed, n: number, at: number): Listed => {
      const sent = noteSent(listed, 'continue', at, false)
      const drawn = isProvisional ? noteDrawn(sent, PROVISIONAL_ID, 'continue', at + 50, true) : sent
      const stored = noteDrawn(drawn, id(n), 'continue', at + 100, true)
      return { ...stored, queue: restQueue(stored.queue) }
    }
    const twice = turn(turn(start(), 1, 0), 2, 60_000)
    expect(rows(twice)).toEqual([[id(1).slice(0, 24), id(1)], [id(2).slice(0, 24), id(2)]])
    expect([...twice.queue.pending]).toEqual([])
  }
})
