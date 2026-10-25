// The clipboard tab: what the person copied by dragging over the screen, newest first, to put back in the prompt box or
// delete. Claude Code copies a mouse selection as it is let go (Copy on select, on unless turned off) where it draws
// the whole screen itself (`"tui": "fullscreen"`, checked in 2.1.309), and there `$.ui.selection()` reads it; the
// desktop app answers it too. On the main screen the terminal app selects and nothing reaches the mod. Kept for this
// session only (`$.state`, and a copy here for /clear), never written to a file.
// ponytail: Copy on select turned off still collects selections, as a mod cannot read that global setting
import type { ClipBoard } from '../types/index'
import type { Effect } from './lib/effects'
import type { Engine } from './runtime'

export const CLIPS_MAX = 30
// A longer selection is skipped rather than kept in part: an insert must put back what was copied.
export const CLIP_CHARS_MAX = 20_000

// /clear, /resume and /branch empty `$.state`, a reload empties this; each puts the other back.
let kept: ClipBoard | undefined
// A failing read is logged once, not each second, until a read works again.
let hasFailed = false

export const isClipsTabOn = (options: Readonly<Record<string, unknown>>): boolean => options.clipboardTab === true

// One reading of the selection, once a second. The selection is read while a drag still grows or shrinks it, and stays
// once let go until the next one or a prompt. A drag keeps one end where it began, so a reading that shares a start or
// an end with the newest clip while that clip still changes (`changing`) is the same drag; the clip stays once the same
// text is read twice or the selection goes. A reading that extends it at one end while the selection is still that clip
// is the same drag after a pause (any later copy that began with it used to take its place). A blank selection is
// skipped, as Copy on select skips it; the same text elsewhere moves up; past CLIPS_MAX the oldest go.
export function withReading(board: ClipBoard, text: string | undefined, id: string): ClipBoard {
  const seen = text ?? null
  if (seen === board.seen) return board.changing === null ? board : { ...board, changing: null }
  if (text === undefined || text.trim() === '' || text.length > CLIP_CHARS_MAX) return { ...board, seen, changing: null }
  const newest = board.clips[0]
  const holdsAtEnd = (longer: string, shorter: string) => longer.startsWith(shorter) || longer.endsWith(shorter)
  const isSameDrag = newest !== undefined && (
    (newest.id === board.changing && (holdsAtEnd(text, newest.text) || holdsAtEnd(newest.text, text))) ||
    (board.seen === newest.text && holdsAtEnd(text, newest.text)))
  const rest = board.clips.filter((clip, i) => clip.text !== text && !(isSameDrag && i === 0))
  const clip = { id: isSameDrag ? newest.id : id, text }
  return { clips: [clip, ...rest].slice(0, CLIPS_MAX), seen, changing: clip.id }
}

async function change(engine: Engine, next: (board: ClipBoard) => ClipBoard): Promise<void> {
  await engine.cells.clipBoard.update(board => (kept = next(board)))
}

export function readClipBoard(engine: Engine): Promise<ClipBoard> {
  return engine.cells.clipBoard.read()
}

// Each second while the tab is on. A board the reading leaves as it was is not written, so the tab is not redrawn.
export async function noteSelection(engine: Engine, now: number): Promise<void> {
  let text: string | undefined
  try {
    text = (await engine.ui.selection())?.text
    hasFailed = false
  } catch (err) {
    if (hasFailed) return
    hasFailed = true
    throw err
  }
  const id = `c${now}`
  const board = await engine.cells.clipBoard.read()
  if (withReading(board, text, id) !== board) await change(engine, current => withReading(current, text, id))
}

// At each load of the store. After /clear, /resume or /branch emptied the state: the list as it was, the selection
// forgotten. After a reload: the state's list, kept here for the next /clear.
export async function restoreClips(engine: Engine): Promise<void> {
  const board = await engine.cells.clipBoard.read()
  const list = kept
  if (board.clips.length > 0) kept = board
  else if (list !== undefined && list.clips.length > 0) await change(engine, () => ({ clips: list.clips, seen: null, changing: null }))
}

// Insert puts the clip at the prompt's cursor, whole; one gone since the tab was drawn (deleted, or moved up under a
// new id) says so.
export async function clipEffects(engine: Engine, id: string, goneText: string): Promise<Effect[]> {
  const clip = (await engine.cells.clipBoard.read()).clips.find(c => c.id === id)
  return clip === undefined ? [{ kind: 'ui.toast', text: goneText }] : [{ kind: 'prompt.fill', text: clip.text, mode: 'insert' }]
}

// The selection that made it stays `seen`, so it does not come back.
export async function deleteClip(engine: Engine, id: string): Promise<void> {
  await change(engine, board => ({ ...board, clips: board.clips.filter(c => c.id !== id), changing: board.changing === id ? null : board.changing }))
}
