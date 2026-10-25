// Quick notes: the store holds them for every session, `$.state` mirrors what was read or written last (the `notes`
// cell). The store calls are register.tsx's (`StoreIo`), which note a failure.
import type { Note } from '../types/index'
import type { Effect } from './lib/effects'
import type { TFn } from './lib/i18n'
import type { Engine, StoreIo } from './runtime'
import { NOTES_KIB_MAX, NOTES_MAX, addNote, asNotes, removeNote } from './tools/notes'

export function readNotes(engine: Engine): Promise<Note[]> {
  return engine.cells.notes.read()
}

// What the store holds now: another session may have saved a note since this one read them.
export async function syncNotes(engine: Engine, io: StoreIo): Promise<void> {
  const stored = await io.get('notes')
  if (stored.isRead) await engine.cells.notes.update(() => asNotes(stored.value))
}

// True once saved. ponytail: a re-read and a write are two calls, so two sessions saving in the same instant can
// lose one note; the store has no compare-and-set.
async function saveNotes(engine: Engine, io: StoreIo, notes: readonly Note[]): Promise<boolean> {
  if (!(await io.save('notes', notes))) return false
  await engine.cells.notes.update(() => [...notes])
  return true
}

// Adds to the notes as the store holds them just now, so a note another session saved stays.
export async function addQuickNote(engine: Engine, io: StoreIo, text: string, t: TFn): Promise<void> {
  const stored = await io.fresh('notes')
  if (!stored.isRead) return
  const added = addNote(asNotes(stored.value), text, await engine.clock.now())
  if (added.kind === 'tooLong') return engine.ui.toast(t('toast.noteTooLong', { kib: NOTES_KIB_MAX }))
  if (added.kind === 'empty' || !(await saveNotes(engine, io, added.notes))) return
  if (added.dropped > 0) engine.ui.toast(t('toast.notesTrimmed', { max: NOTES_MAX, kib: NOTES_KIB_MAX, n: added.dropped }))
}

export async function deleteQuickNote(engine: Engine, io: StoreIo, id: string): Promise<void> {
  const stored = await io.fresh('notes')
  if (stored.isRead) await saveNotes(engine, io, removeNote(asNotes(stored.value), id))
}

// At the cursor of the prompt box, whole (not just the first line the row shows).
export async function noteFillEffects(engine: Engine, id: string): Promise<Effect[]> {
  const note = (await engine.cells.notes.read()).find(n => n.id === id)
  return note === undefined ? [] : [{ kind: 'prompt.fill', text: note.text, mode: 'insert' }]
}
