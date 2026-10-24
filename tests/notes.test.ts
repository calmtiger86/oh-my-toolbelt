// Quick notes and do not disturb, the pure parts.
import { expect, test } from 'claude-code/testing'
import type { Note } from '../types/index'
import { formatStamp } from '../hooks/lib/format'
import { NOTES_MAX, addNote, asNotes, notesLabel, removeNote } from '../hooks/tools/notes'
import { t } from './pure-helpers'

const note = (id: string, text = id, createdAt = 1): Note => ({ id, text, createdAt })
const saved = (result: ReturnType<typeof addNote>) => {
  if (result.kind !== 'saved') throw new Error(`not saved: ${result.kind}`)
  return result
}

test('asNotes keeps well-formed notes in order, drops the rest and repeated ids', () => {
  const stored = [note('a'), { id: 'b', text: 5, createdAt: 1 }, null, 'x', note('a', 'again'), { id: '', text: 't', createdAt: 1 }, { id: 'c', text: 't', createdAt: Number.NaN }, { ...note('d'), extra: true }]
  expect(asNotes(stored)).toEqual([note('a'), note('d')])
  for (const junk of [undefined, null, 'notes', 7, { a: 1 }]) expect(asNotes(junk)).toEqual([])
})

test('addNote puts the trimmed text last, with an id no other note has', () => {
  const first = saved(addNote([], '  buy milk\nand eggs \n', 1000))
  expect(first.notes).toEqual([{ id: 'nrs', text: 'buy milk\nand eggs', createdAt: 1000 }])
  expect(first.dropped).toBe(0)
  const second = saved(addNote(first.notes, 'same millisecond', 1000))
  expect(second.notes.map(n => n.id)).toEqual(['nrs', 'nrs-2'])
  expect(addNote(first.notes, ' \n\t ', 1000)).toEqual({ kind: 'empty' })
})

test('over 500 notes the oldest go first', () => {
  const stored = Array.from({ length: NOTES_MAX }, (_, i) => note(`s${i}`))
  const result = saved(addNote(stored, 'new', 5))
  expect(result.notes).toHaveLength(NOTES_MAX)
  expect(result.notes[0]?.id).toBe('s1')
  expect(result.notes.at(-1)?.text).toBe('new')
  expect(result.dropped).toBe(1)
  // A store that already holds too many (older version, another writer) is cut to the limit in one go.
  const crowded = saved(addNote([...stored, ...stored.map(n => ({ ...n, id: `t${n.id}` }))], 'new', 5))
  expect(crowded.notes).toHaveLength(NOTES_MAX)
  expect(crowded.dropped).toBe(NOTES_MAX + 1)
})

test('over 256 KiB the oldest go first, counted in UTF-8 bytes, and one note alone over it is refused', () => {
  const big = (id: string) => note(id, '가'.repeat(30_000))
  // Each is 90,000 bytes of text: two fit in 256 KiB, three do not.
  const result = saved(addNote([big('a'), big('b')], '가'.repeat(30_000), 5))
  expect(result.notes.map(n => n.id)).toEqual(['b', 'n5'])
  expect(result.dropped).toBe(1)
  expect(addNote([note('a')], 'x'.repeat(256 * 1024), 5)).toEqual({ kind: 'tooLong' })
  const edge = saved(addNote([], 'x'.repeat(256 * 1024 - 2 - JSON.stringify(note('n5', '', 5)).length), 5))
  expect(edge.notes).toHaveLength(1)
})

test('removeNote drops one id and leaves the rest', () => {
  expect(removeNote([note('a'), note('b'), note('c')], 'b').map(n => n.id)).toEqual(['a', 'c'])
  expect(removeNote([note('a')], 'zzz')).toEqual([note('a')])
})

test('the notes label is the icon and the word, the icon alone when tight, the word alone as a label', () => {
  expect([notesLabel('long', 'icon+label', undefined, t), notesLabel('short', 'icon+label', undefined, t), notesLabel('long', 'label', undefined, t), notesLabel('short', 'label', undefined, t)]).toEqual(['📝 Notes', '📝', 'Notes', 'Notes'])
  expect([notesLabel('long', 'icon', undefined, t), notesLabel('long', 'icon+label', '🎯', t), notesLabel('short', 'icon+label', '', t)]).toEqual(['📝', '🎯 Notes', 'Notes'])
})

test('formatStamp writes month, day and time in the zone, cycle and locale asked for', () => {
  const at = Date.UTC(2026, 9, 22, 5, 32, 0)
  expect(formatStamp(at, { locale: 'en-US', timeZone: 'UTC', hour12: false, seconds: false })).toBe('10/22, 05:32')
  expect(formatStamp(at, { locale: 'en-US', timeZone: 'Asia/Seoul', hour12: true, seconds: false })).toBe('10/22, 2:32 PM')
  expect(formatStamp(at, { locale: 'ko-KR', timeZone: 'UTC', hour12: false, seconds: false })).toContain('05:32')
  // A time zone Intl does not know falls back to the local clock rather than failing.
  expect(formatStamp(at, { locale: 'en-US', timeZone: 'Nowhere/Land', seconds: false })).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/)
})
