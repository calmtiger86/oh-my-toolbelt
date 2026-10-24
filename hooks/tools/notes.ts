// Quick notes. Pure: register.tsx re-reads and writes the store, this decides what to write.
import type { Note } from '../../types/index'
import { faceOf } from '../lib/icons'
import type { IconStyle } from '../lib/icons'
import type { TFn } from '../lib/i18n'

// The store keeps at most this many notes and this many bytes of them; the oldest go first.
export const NOTES_MAX = 500
export const NOTES_KIB_MAX = 256
const NOTES_BYTES_MAX = NOTES_KIB_MAX * 1024
// A row shows the first line up to this wide; the panel cuts it again to its own width.
export const NOTE_CELLS_MAX = 60

const ICON = '📝'

// `📝 Notes`, the icon alone when the band is tight, by the icon style. `picked` is the icon the person chose (`''` for none).
export const notesLabel = (size: 'long' | 'short', style: IconStyle, picked: string | undefined, t: TFn): string =>
  faceOf(style, size, picked ?? ICON, t('tool.notes'))

const isNote = (v: unknown): v is Note => {
  if (typeof v !== 'object' || v === null) return false
  const n = v as Record<string, unknown>
  return typeof n.id === 'string' && n.id !== '' && typeof n.text === 'string' && typeof n.createdAt === 'number' && Number.isFinite(n.createdAt)
}

// The stored notes, oldest first. Another session or version may have written anything under the key:
// what is not a note is dropped, and a repeated id keeps its first place.
export function asNotes(value: unknown): Note[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const kept: Note[] = []
  for (const item of value) {
    if (!isNote(item) || seen.has(item.id)) continue
    seen.add(item.id)
    kept.push({ id: item.id, text: item.text, createdAt: item.createdAt })
  }
  return kept
}

// UTF-8 length, as the store counts the file.
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

const EMPTY_LIST_BYTES = 2
const noteBytes = (note: Note): number => utf8Bytes(JSON.stringify(note))

// The newest notes that fit both limits, in the same order. An array of n notes is the brackets, the notes and n - 1 commas.
function newest(notes: readonly Note[]): Note[] {
  let start = Math.max(0, notes.length - NOTES_MAX)
  const sizes = notes.map(noteBytes)
  let total = EMPTY_LIST_BYTES + sizes.slice(start).reduce((sum, size) => sum + size + 1, -1)
  while (total > NOTES_BYTES_MAX && start < notes.length - 1) {
    total -= (sizes[start] ?? 0) + 1
    start += 1
  }
  return notes.slice(start)
}

export type NoteAdd =
  | { kind: 'saved'; notes: Note[]; dropped: number }
  | { kind: 'empty' }
  // One note alone is over the byte limit.
  | { kind: 'tooLong' }

// `stored` is what was just read from the store, so a note another session saved stays.
export function addNote(stored: readonly Note[], text: string, now: number): NoteAdd {
  const body = text.trim()
  if (body === '') return { kind: 'empty' }
  const taken = new Set(stored.map(n => n.id))
  const base = `n${now.toString(36)}`
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  const note: Note = { id, text: body, createdAt: now }
  if (EMPTY_LIST_BYTES + noteBytes(note) > NOTES_BYTES_MAX) return { kind: 'tooLong' }
  const all = [...stored, note]
  const notes = newest(all)
  return { kind: 'saved', notes, dropped: all.length - notes.length }
}

export const removeNote = (stored: readonly Note[], id: string): Note[] => stored.filter(n => n.id !== id)
