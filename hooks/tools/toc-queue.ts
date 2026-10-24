// Prompts sent while a turn runs. Such a prompt (queued behind the running turn, delivered into it, or sent from Remote
// Control) is drawn under ids the engine never stores before its stored row comes, so the table would list it twice.
// Its entry is pending meanwhile: rows drawn with its text are other names of it, and its stored row takes its place.
// Pure: hooks/toc-live.ts keeps the queue beside the table.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { PROVISIONAL_ID, promptText, rowKey, withPrompt, withRequestId } from './toc'
import type { Toc } from './toc'

// A row added at most this long before a prompt's notification may be that prompt's own: the engine may draw a
// queued prompt's first row before it notifies. And a row of a waiting prompt drawn longer than this after its
// notification, while a turn runs, is the one the turn read (prompt-rail's measure).
export const LATELY_MS = 250

export type Queue = {
  // The texts sent while a turn ran and not stored yet, each with when it was sent (prompt.submit, session.receive).
  waiting: ReadonlyMap<string, number>
  // The entries listed under an id the engine never stores, until their stored row is drawn.
  pending: ReadonlySet<string>
  // Row key -> the key of the entry the row is another name of.
  aliases: ReadonlyMap<string, string>
  // The text of the prompt last drawn under the provisional id, until its stored row is drawn.
  provisional: string | undefined
  // The entries added since the last notification, provisional row or turn edge, and when.
  lately: readonly { key: string; at: number }[]
  // The pending entries delivered into the running turn: no provisional row follows them.
  delivered: ReadonlySet<string>
}
export type Listed = { toc: Toc; queue: Queue }

export const emptyQueue = (): Queue => ({ waiting: new Map(), pending: new Set(), aliases: new Map(), provisional: undefined, lately: [], delivered: new Set() })

const without = (keys: ReadonlySet<string>, key: string): ReadonlySet<string> => new Set([...keys].filter(other => other !== key))
const unwaited = (waiting: ReadonlyMap<string, number>, text: string): ReadonlyMap<string, number> => new Map([...waiting].filter(([other]) => other !== text))
const pendingWith = ({ toc, queue }: Listed, text: string): string | undefined => [...toc].find(([key, entry]) => queue.pending.has(key) && entry.text === text)?.[0]
const replaced = (toc: Toc, from: string, to: string, requestId: string): Toc =>
  new Map([...toc].map(([key, entry]) => (key === from ? [to, { ...entry, requestId }] : [key, entry])))

// The table's key of a drawn row: its own, or that of the entry it is another name of.
export const entryKey = ({ toc, queue }: Listed, key: string): string => (toc.has(key) ? key : (queue.aliases.get(key) ?? key))

// A prompt with this text was sent while a turn ran: its rows are pending until the stored one is drawn. Rows with its
// text added just before the notification are its own, one entry with the others as its names. One sent while no turn
// runs waits for nothing: its stored row is listed as any other, so the same text sent again is a row of its own.
export function noteSent(listed: Listed, text: string, now: number, isRunning: boolean): Listed {
  const { toc, queue } = listed
  const kept = promptText(text)
  if (kept === '' || !isRunning) return listed
  const base: Queue = { ...queue, waiting: new Map([...queue.waiting, [kept, now]]), lately: [] }
  const fresh = new Set(queue.lately.filter(item => now - item.at <= LATELY_MS).map(item => item.key))
  const own = [...toc].filter(([key, entry]) => fresh.has(key) && entry.text === kept && !queue.pending.has(key)).map(([key]) => key)
  const held = pendingWith(listed, kept) ?? own[0]
  if (held === undefined || own.length === 0) return { toc, queue: base }
  const others = own.filter(key => key !== held)
  return {
    toc: new Map([...toc].filter(([key]) => !others.includes(key))),
    queue: { ...base, pending: new Set([...queue.pending, held]), aliases: new Map([...queue.aliases, ...others.map((key): [string, string] => [key, held])]) },
  }
}

// A prompt row as it is drawn. The provisional row is not listed but marks the next stored row of its text; that row
// takes the place of the pending entry with its text. A row of a waiting prompt is pending itself, or another name of
// the one pending, where a jump then goes.
export function noteDrawn(listed: Listed, requestId: string, text: string, now: number, isRunning: boolean): Listed {
  const { toc, queue } = listed
  const kept = promptText(text)
  if (requestId === PROVISIONAL_ID) return { toc, queue: { ...queue, provisional: kept, lately: [] } }
  const key = rowKey(requestId)
  const isStored = queue.provisional === kept
  const settled: Queue = isStored ? { ...queue, provisional: undefined, waiting: unwaited(queue.waiting, kept) } : queue
  // A stored row listed first (by the transcript file) still ends its prompt.
  if (toc.has(key)) return { toc, queue: settled }
  const alias = queue.aliases.get(key)
  if (alias !== undefined) return { toc: withRequestId(toc, alias, requestId), queue }
  const held = pendingWith(listed, kept)
  if (isStored && held !== undefined) {
    const aliases = new Map([...[...queue.aliases].map(([name, target]): [string, string] => [name, target === held ? key : target]), [held, key]])
    return { toc: replaced(toc, held, key, requestId), queue: { ...settled, pending: without(queue.pending, held), aliases } }
  }
  if (isStored) return { toc: withPrompt(toc, requestId, text), queue: settled }
  const sentAt = queue.waiting.get(kept)
  if (sentAt !== undefined && held !== undefined) {
    const delivered = isRunning && now - sentAt > LATELY_MS ? new Set([...queue.delivered, held]) : queue.delivered
    return { toc: withRequestId(toc, held, requestId), queue: { ...queue, aliases: new Map([...queue.aliases, [key, held]]), delivered } }
  }
  if (sentAt !== undefined) return { toc: withPrompt(toc, requestId, text), queue: { ...queue, pending: new Set([...queue.pending, key]) } }
  const added = withPrompt(toc, requestId, text)
  return { toc: added, queue: added === toc ? queue : { ...queue, lately: [...queue.lately, { key, at: now }] } }
}

// The main loop came to rest: a prompt still waiting is queued behind the turn (its rows to come follow a provisional
// row), and one delivered into the turn waits for nothing more.
export const restQueue = (queue: Queue): Queue => ({
  ...queue,
  waiting: new Map(),
  pending: new Set([...queue.pending].filter(key => !queue.delivered.has(key))),
  lately: [],
  delivered: new Set(),
})
