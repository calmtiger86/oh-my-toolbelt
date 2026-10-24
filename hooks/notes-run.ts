// Quick notes: the store holds them for every session, `$.state` mirrors what was read or written last. Out of
// register.tsx for its 800-line cap; the store calls are register.tsx's (`StoreIo`), which note a failure.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { Note } from '../types/index'
import type { Effect } from './lib/effects'
import type { TFn } from './lib/i18n'
import type { StoreIo } from './runtime'
import { NOTES_KIB_MAX, NOTES_MAX, addNote, asNotes, removeNote } from './tools/notes'

const notesState = atom({ plugin: 'oh-my-toolbelt', key: 'notes' } as const, [])

export function readNotes($: EngineInterface): Promise<Note[]> {
  return read($, notesState)
}

// What the store holds now: another session may have saved a note since this one read them.
export async function syncNotes($: EngineInterface, io: StoreIo): Promise<void> {
  const stored = await io.get('notes')
  if (stored.isRead) await update($, notesState, () => asNotes(stored.value))
}

// True once saved. ponytail: a re-read and a write are two calls, so two sessions saving in the same instant can
// lose one note; the store has no compare-and-set.
async function saveNotes($: EngineInterface, io: StoreIo, notes: readonly Note[]): Promise<boolean> {
  if (!(await io.save('notes', notes))) return false
  await update($, notesState, () => [...notes])
  return true
}

// Adds to the notes as the store holds them just now, so a note another session saved stays.
export async function addQuickNote($: EngineInterface, io: StoreIo, text: string, t: TFn): Promise<void> {
  const stored = await io.fresh('notes')
  if (!stored.isRead) return
  const added = addNote(asNotes(stored.value), text, await $.clock.now())
  if (added.kind === 'tooLong') return $.ui.toast(t('toast.noteTooLong', { kib: NOTES_KIB_MAX }))
  if (added.kind === 'empty' || !(await saveNotes($, io, added.notes))) return
  if (added.dropped > 0) $.ui.toast(t('toast.notesTrimmed', { max: NOTES_MAX, kib: NOTES_KIB_MAX, n: added.dropped }))
}

export async function deleteQuickNote($: EngineInterface, io: StoreIo, id: string): Promise<void> {
  const stored = await io.fresh('notes')
  if (stored.isRead) await saveNotes($, io, removeNote(asNotes(stored.value), id))
}

// At the cursor of the prompt box, whole (not just the first line the row shows).
export async function noteFillEffects($: EngineInterface, id: string): Promise<Effect[]> {
  const note = (await read($, notesState)).find(n => n.id === id)
  return note === undefined ? [] : [{ kind: 'prompt.fill', text: note.text, mode: 'insert' }]
}
