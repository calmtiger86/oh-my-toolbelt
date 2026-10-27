// The prompts tab's live part: the prompts drawn, which one the person reads, each prompt's turn and the rows a jump
// could not reach. Module state, as register.tsx's `runtime`; a function that calls the engine takes `engine`
// (register.tsx's `engineOf`) as its argument and stores none of it in module state.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import type { Timer } from 'claude-code'
import { TOC_REDRAW_MS, errorText } from './runtime'
import type { Engine } from './runtime'
import type { TFn } from './lib/i18n'
import { PROVISIONAL_ID, answerFor, bandCardText, commandOf, emptyTurn, isTocOrigin, jumpNote, pickIndex, promptIndexOf, promptOf, readIndex, rowKey, toolUse, tocRows, tocScope, withRequestId, withUses } from './tools/toc'
import type { Answered, BandCard, Opened, PlacedRow, Toc, TocEntry, TocMove, TocView, TocViewOp, Turn } from './tools/toc'
import { emptyQueue, entryKey, noteDrawn, noteSent, restQueue } from './tools/toc-queue'
import type { Queue } from './tools/toc-queue'
import type { History } from './tools/transcript'

// Where the person reads is drawn again this long after the last onScreen report, and no later than SETTLE_MAX_MS
// after the first, so reports that never pause still redraw it. prompt-rail measured on the terminal: a replayed row
// is corrected within 13 ms, a layout settles within 18 ms.
const SETTLE_MS = 40
const SETTLE_MAX_MS = 120
// The rows besides a prompt's own whose place on screen places the person: a reply block, a tool row, a folded group.
const PLACING: ReadonlySet<string> = new Set(['AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup'])

// Where a row is on screen, as its `onScreen` says; null once it left the viewport.
type Place = { first: number } | null
// A transcript row on screen, by component and id: the key it places by, where it starts, and when it said so.
type Shown = { name: string; key: string; first: number; order: number }
// The prompt a jump landed on, read while the rows that came into view as it landed are all that show; `shown` holds
// those rows' prompts, `isSettled` once they had SETTLE_MAX_MS to report.
type Landed = { id: number; key: string; shown: ReadonlySet<number>; isSettled: boolean }

type Live = {
  toc: Toc
  // The prompts sent while a turn runs, drawn under ids the engine never stores (hooks/tools/toc-queue.ts).
  queue: Queue
  // The row keys the transcript file holds (hooks/toc-history.ts), and those of its prompts no row was drawn for yet,
  // whose jump id is the file's until one is.
  known: ReadonlySet<string>
  filed: ReadonlySet<string>
  // Reply row key or tool_use id -> the key of the prompt it answers, and each prompt's turn, from session.append.
  owners: ReadonlyMap<string, string>
  turns: ReadonlyMap<string, Turn>
  // The prompt the main loop's replies now belong to, and whether its turn runs.
  turnKey: string | undefined
  isRunning: boolean
  // The slash command prompt.submit last ran for the person, by name, until its own row is appended (noteCommandRow).
  commandSent: string | undefined
  onScreen: ReadonlyMap<string, Shown>
  reports: number
  // The key of the prompt being read, kept while no row that places anyone shows.
  reading: string | undefined
  landed: Landed | undefined
  // The index the panel last drew as being read.
  drawnCurrent: number
  unreachable: ReadonlySet<string>
  isUnscrollableSaid: boolean
  // The agent whose transcript is beside the panel; undefined for the main conversation, whose prompts alone are listed.
  viewAgent: string | undefined
  // The desktop app's opened row (tools/toc.ts answerFor).
  opened: Opened | null
}

const initialLive = (): Live => ({
  toc: new Map(), queue: emptyQueue(), known: new Set(), filed: new Set(), owners: new Map(), turns: new Map(), turnKey: undefined, isRunning: false, commandSent: undefined, onScreen: new Map(), reports: 0,
  reading: undefined, landed: undefined, drawnCurrent: -1, unreachable: new Set(), isUnscrollableSaid: false, viewAgent: undefined, opened: null,
})

let live = initialLive()
// The new-prompt redraw, and the two of the redraw that waits for onScreen reports to settle.
let timers: { redraw: Timer | null; quiet: Timer | null; latest: Timer | null } = { redraw: null, quiet: null, latest: null }

// ---- Redraws ----
export function watchToc(engine: Engine): Promise<number> {
  return engine.cells.tocMoved.read()
}

async function bumpToc(engine: Engine): Promise<void> {
  try {
    await engine.cells.tocMoved.update(n => n + 1)
  } catch (err) {
    engine.ui.log(`oh-my-toolbelt: toc redraw failed: ${errorText(err)}`, { to: 'debug' })
  }
}

// A drawing may not write `$.state`, so a new prompt draws the panel again once the burst of rows is over. Each new
// prompt moves the timer back, so a refused timer cannot block the next.
function queueTocRedraw(engine: Engine): void {
  timers.redraw?.cancel()
  timers = { ...timers, redraw: engine.clock.after(TOC_REDRAW_MS, () => engine.ui.invalidate('ui.render')) }
}

// Draws the panel again once onScreen reports settle, if its drawing no longer shows the prompt being read.
function redrawSettled(engine: Engine): void {
  const fire = () => {
    timers.quiet?.cancel()
    timers.latest?.cancel()
    timers = { ...timers, quiet: null, latest: null }
    if (currentIndex() !== live.drawnCurrent) void bumpToc(engine)
  }
  timers.quiet?.cancel()
  timers = { ...timers, quiet: engine.clock.after(SETTLE_MS, fire), latest: timers.latest ?? engine.clock.after(SETTLE_MAX_MS, fire) }
}

// ---- Where the person reads ----
// A row's key in the table: its own, or that of the queued prompt it is another name of.
const keyOf = (key: string): string => entryKey({ toc: live.toc, queue: live.queue }, key)
const promptIndexes = (): ReadonlyMap<string, number> => new Map([...live.toc.keys()].map((key, i) => [key, i]))
const indexOfRow = (key: string, promptIndex: ReadonlyMap<string, number>): number | undefined => promptIndexOf(keyOf(key), promptIndex, live.owners)

const placedRows = (promptIndex: ReadonlyMap<string, number>): PlacedRow[] =>
  [...live.onScreen.values()].flatMap(row => {
    const i = indexOfRow(row.key, promptIndex)
    return i === undefined ? [] : [{ i, first: row.first, order: row.order }]
  })

// The prompt the topmost row on screen belongs to, or the one a jump landed on; kept while no known row shows.
function currentIndex(): number {
  const promptIndex = promptIndexes()
  const jumped = landedIndex(promptIndex)
  if (jumped >= 0) {
    live = { ...live, reading: live.landed?.key }
    return jumped
  }
  const best = readIndex(placedRows(promptIndex))
  live = { ...live, landed: undefined, reading: best >= 0 ? [...live.toc.keys()][best] : live.reading }
  // By key, and through another name, so a stored row that takes a queued prompt's place keeps it.
  return live.reading === undefined ? -1 : (promptIndex.get(keyOf(live.reading)) ?? -1)
}

function landedIndex(promptIndex: ReadonlyMap<string, number>): number {
  return live.landed === undefined ? -1 : (promptIndex.get(keyOf(live.landed.key)) ?? -1)
}

// A row of a prompt that was not in view as the jump landed: the person scrolled, so the top row says who is read again.
function noteLandedRow(key: string): void {
  const landed = live.landed
  const i = landed === undefined ? undefined : indexOfRow(key, promptIndexes())
  if (landed === undefined || i === undefined) return
  if (!landed.isSettled) live = { ...live, landed: { ...landed, shown: new Set([...landed.shown, i]) } }
  else if (!landed.shown.has(i)) live = { ...live, landed: undefined }
}

// A row still cut at the viewport's top a while after it said so is the top one: the rows of earlier prompts left for
// good. Not sooner: a remounted row replays where it was last seen. Not when a row of an earlier prompt said it is on
// screen since, as the viewport then moved above it.
function dropAbove(cut: Shown): void {
  const row = live.onScreen.get(cut.name)
  if (row === undefined || row.first <= 0) return
  const promptIndex = promptIndexes()
  const top = indexOfRow(row.key, promptIndex)
  if (top === undefined) return
  const isAbove = (other: Shown) => (indexOfRow(other.key, promptIndex) ?? top) < top
  if ([...live.onScreen.values()].some(other => other.order > row.order && isAbove(other))) return
  live = { ...live, onScreen: new Map([...live.onScreen].filter(([, other]) => !isAbove(other))) }
}

// One onScreen report: where a row is, or that it left. Rows drawn while an agent's transcript is in view are not the
// main conversation's.
function seeRow(engine: Engine, component: string, id: string, place: Place): void {
  if (live.viewAgent !== undefined) return
  const name = `${component}\u0000${id}`
  if (place === null) {
    live = { ...live, onScreen: new Map([...live.onScreen].filter(([other]) => other !== name)) }
    const promptIndex = promptIndexes()
    const i = landedIndex(promptIndex)
    if (live.landed !== undefined && !(i >= 0 && placedRows(promptIndex).some(row => row.i === i))) live = { ...live, landed: undefined }
  } else {
    const row = { name, key: rowKey(id), first: place.first, order: live.reports + 1 }
    live = { ...live, reports: row.order, onScreen: new Map([...live.onScreen, [name, row]]) }
    noteLandedRow(row.key)
    if (row.first > 0) engine.clock.after(SETTLE_MS, () => dropAbove(row))
  }
  redrawSettled(engine)
}

// ---- What the transcript hooks note (register.tsx) ----
// A prompt's row as it is drawn (`now` by `$.clock.now()`), or as session.append hands the send button's, whose row is
// never drawn to this mod (no `place`): listed once by its key, the provisional row not at all, a queued prompt's rows
// as one (hooks/tools/toc-queue.ts), and where it is on screen. A prompt read from the transcript
// file jumps to the first id its row is drawn under; a row the file holds as no prompt (bash mode, a command that only
// acts here) stays out, as the read left it, and so does one the file would hold as none (`promptOf`), before any read.
export function notePromptRow(engine: Engine, requestId: string, text: string, place: Place | undefined, now: number): void {
  if (promptOf(text) !== undefined) listRow(engine, requestId, text, place, now)
}

// prompt.submit ran a slash command for the person or this mod's button. It runs one Claude answers (a skill, a command
// file, a built-in that asks the model) and none that only acts here (`/model`, `/reload-plugins`), right before that
// command's own row is appended, a command typed while a turn runs too, as it runs (2.1.310).
export function noteCommandSent(name: string): void {
  live = { ...live, commandSent: name }
}

// A slash command's own row as session.append hands it (door `command`), as `/name args`: listed when it is the command
// prompt.submit ran, and the turn its replies belong to starts. Only the composer's placeholder of it is drawn to this
// mod, so it is listed under its stored id, where a jump lands (2.1.310).
export function noteCommandRow(engine: Engine, uuid: string, text: string, now: number): void {
  const command = commandOf(text)
  if (command === undefined || live.commandSent === undefined || command.split(/\s/, 1)[0] !== `/${live.commandSent}`) return
  const key = rowKey(uuid)
  live = { ...live, commandSent: undefined, turnKey: key, turns: new Map([...live.turns, [key, emptyTurn()]]) }
  listRow(engine, uuid, command, undefined, now)
}

function listRow(engine: Engine, requestId: string, text: string, place: Place | undefined, now: number): void {
  const key = rowKey(requestId)
  if (live.known.has(key) && !live.toc.has(key)) return
  const listed = noteDrawn({ toc: live.toc, queue: live.queue }, requestId, text, now, live.isRunning)
  const isFiled = live.filed.has(key)
  const toc = isFiled ? withRequestId(listed.toc, key, requestId) : listed.toc
  const isChanged = toc !== live.toc
  live = { ...live, toc, queue: listed.queue, filed: isFiled ? new Set([...live.filed].filter(other => other !== key)) : live.filed }
  if (isChanged) queueTocRedraw(engine)
  if (place !== undefined && requestId !== PROVISIONAL_ID) seeRow(engine, 'UserMessage', requestId, place)
}

// A person's prompt was sent (prompt.submit, or session.receive from Remote Control): while a turn runs, its rows drawn
// before the stored one are one entry. Not a drawing, so the panel is drawn again here when two rows became one.
export async function notePromptSent(engine: Engine, text: string, now: number): Promise<void> {
  const listed = noteSent({ toc: live.toc, queue: live.queue }, text, now, live.isRunning)
  const isChanged = listed.toc !== live.toc
  live = { ...live, ...listed }
  if (isChanged) await bumpToc(engine)
}

// A reply or tool row on screen places the person under the prompt it answers. A tool row is drawn under its tool_use
// id; a folded group counts as its first call.
export function noteReplyRow(engine: Engine, component: string, requestId: string, place: Place | undefined, calls?: ReadonlyArray<{ tool_use_id?: string }>): void {
  if (!PLACING.has(component) || place === undefined) return
  const id = component === 'ToolGroup' ? calls?.find(call => call.tool_use_id !== undefined)?.tool_use_id : requestId
  if (id !== undefined) seeRow(engine, component, id, place)
}

// The panel and the band say whose transcript is in view; the rows a switch leaves were another transcript's.
export function noteTocView(agentId: string | undefined): void {
  if (agentId !== live.viewAgent) live = { ...live, viewAgent: agentId, onScreen: new Map(), landed: undefined }
}

// ---- Turns (session.append, turn.start, turn.complete on the main loop) ----
type Append = { door: string; uuid: string; agentId?: string; origin: { kind: string; name?: unknown; asUser?: unknown }; message: { type: string; isMeta?: true; content: readonly unknown[] } }

// A row the main conversation keeps, with the id its rows are drawn under: a person's prompt (`own` names this mod, whose
// send button's prompts are the person's) starts the turn the replies after it belong to; a reply and each tool call in
// it are that prompt's. A prompt delivered into a running turn comes as an attachment row, so the turn stays with the
// prompt that started it. A turn no listed prompt started belongs to none (noteTurnEnd).
// ponytail: each reply copies the whole owners Map, O(n²) over a session's tool calls; cap it or keep an append-only
// table if long sessions draw slowly
export function noteAppend(e: Append, own: string): void {
  if (e.agentId !== undefined) return
  const key = rowKey(e.uuid)
  if (e.door === 'prompt') {
    if (e.message.type === 'user' && e.message.isMeta !== true && isTocOrigin(e.origin, own)) live = { ...live, turnKey: key, turns: new Map([...live.turns, [key, emptyTurn()]]) }
    return
  }
  const owner = live.turnKey
  if (e.door !== 'response' || e.message.type !== 'assistant' || owner === undefined) return
  const uses = e.message.content.flatMap(toolUse)
  const owned: [string, string][] = [[key, owner], ...uses.map((use): [string, string] => [use.id, owner])]
  live = { ...live, owners: new Map([...live.owners, ...owned]), turns: new Map([...live.turns, [owner, withUses(live.turns.get(owner) ?? emptyTurn(), uses)]]) }
}

// ---- The prompts sent before this load, from the transcript file (hooks/toc-history.ts) ----
// The file's prompts come first, in its order; one drawn already keeps the id it was drawn under, where a jump
// scrolls. A prompt drawn but not stored yet stays after them; a drawn row the file holds as no prompt (a rewound
// one) leaves, and so does a queued prompt one of whose rows the file holds. The file's turns and owners win over what
// session.append noted since the load, which saw only part.
// ponytail: the file wins for a turn running while a long file streams; a later read would settle it if that matters.
export async function noteHistory(engine: Engine, history: History): Promise<void> {
  const prompts = history.prompts.map(prompt => ({ ...prompt, key: rowKey(prompt.uuid) }))
  const held = new Set([...history.known].map(rowKey))
  const known = new Set([...held, ...[...live.queue.aliases].flatMap(([name, key]) => (held.has(name) ? [key] : []))])
  const listed = prompts.map(({ key, uuid, text }): [string, TocEntry] => [key, live.toc.get(key) ?? { requestId: uuid, text }])
  const later = [...live.toc].filter(([key]) => !known.has(key))
  const toc = new Map([...listed, ...later])
  const queue = { ...live.queue, pending: new Set([...live.queue.pending].filter(key => !known.has(key))), aliases: new Map([...live.queue.aliases].filter(([name, key]) => !toc.has(name) && toc.has(key))) }
  const owners = history.owners.flatMap(([id, i]): [string, string][] => {
    const owner = prompts[i]?.key
    return owner === undefined ? [] : [[rowKey(id), owner]]
  })
  live = {
    ...live,
    toc,
    queue,
    known,
    filed: new Set(prompts.filter(({ key }) => !live.toc.has(key)).map(({ key }) => key)),
    owners: new Map([...live.owners, ...owners]),
    turns: new Map([...live.turns, ...prompts.map(({ key }, i): [string, Turn] => [key, history.turns[i] ?? emptyTurn()])]),
    turnKey: live.turnKey ?? prompts[history.started]?.key,
  }
  await bumpToc(engine)
}

// A load that came in the middle of a turn (a reload, or the tab turned on) learns from the turnRunning cell that it
// runs: a prompt sent before it ends is drawn under ids the engine never stores (tools/toc-queue.ts).
// Read before `live` is spread, so a row noted while the read waits keeps its change.
// ponytail: a turn.start or turn.complete noted during the read can be undone by the value read; mark a load that heard
// a turn and leave it alone if that shows up.
export async function restoreTurn(engine: Engine): Promise<void> {
  const isRunning = await engine.cells.turnRunning.read()
  live = { ...live, isRunning }
}

export async function noteTurnStart(engine: Engine, agentId: string | undefined): Promise<void> {
  if (agentId !== undefined) return
  // The transcript follows the new turn down from a prompt jumped to. Rows added before it are not a queued prompt's.
  live = { ...live, isRunning: true, landed: undefined, queue: { ...live.queue, lately: [] } }
  await bumpToc(engine)
}

// A main-loop turn ended: its time adds to its prompt's, and an interruption or an API error says how it went. The
// next turn's replies belong to no prompt until one starts it, so a turn another plugin's prompt or command, a
// scheduled task or a notification started adds nothing to the card before it, as the transcript file reads it
// (tools/transcript.ts historyOf).
// A turn interrupted before any reply row of it was appended took its prompt back: 2.1.310 drops the prompt from the
// conversation and puts its words back in the prompt box, and the file's next row skips it, so a read of the file lists
// it no more (noteHistory). Its entry leaves the table now, so the prompts after keep the numbers a reload gives them,
// and its key counts as a row the file holds as no prompt, so a late drawing of its row lists it no more (listRow).
// The `[Request interrupted by user]` row the engine appends before the turn ends is no reply: it comes by the `note`
// door. What else names the key (where the person reads, a refused jump, the opened row) finds no entry and draws
// nothing, and the queue's other names of it keep a drawing of them from listing it again (tools/toc-queue.ts noteDrawn).
// ponytail: seen for a typed prompt only; a command row's turn (noteCommandRow), an Esc while Claude only thinks and the
// send button's prompt take the same rule unchecked. Probe each on a real screen and keep listed any the file keeps.
export async function noteTurnEnd(engine: Engine, e: { agentId?: string; durationMs: number; reason: string }): Promise<void> {
  if (e.agentId !== undefined) return
  const key = live.turnKey
  const rest = { isRunning: false, turnKey: undefined, queue: restQueue(live.queue) }
  if (key !== undefined && e.reason === 'aborted' && ![...live.owners.values()].includes(key)) {
    const listed = keyOf(key)
    live = { ...live, ...rest, toc: new Map([...live.toc].filter(([other]) => other !== listed)), turns: new Map([...live.turns].filter(([other]) => other !== key)), known: new Set([...live.known, key, listed]) }
    return bumpToc(engine)
  }
  const turn = key === undefined ? undefined : (live.turns.get(key) ?? emptyTurn())
  const outcome = e.reason === 'aborted' ? 'interrupted' : e.reason === 'error' ? 'error' : turn?.outcome
  const ended = turn === undefined ? undefined : { ...turn, durationMs: (turn.durationMs ?? 0) + e.durationMs, ...(outcome === undefined ? {} : { outcome }) }
  const turns = key === undefined || ended === undefined ? live.turns : new Map([...live.turns, [key, ended]])
  live = { ...live, ...rest, turns }
  await bumpToc(engine)
}

// ---- Jumps and moves ----
// After a jump lands, the rows before it left and the prompt jumped to is at the top, though rows may not say so.
function landOn(engine: Engine, key: string, requestId: string): void {
  const index = promptIndexes().get(key)
  const name = `UserMessage\u0000${requestId}`
  const jump: Landed = { id: live.reports + 1, key, shown: new Set(index === undefined ? [] : [index]), isSettled: false }
  live = { ...live, onScreen: new Map([[name, { name, key, first: 0, order: jump.id }]]), reports: jump.id, reading: key, landed: jump }
  engine.clock.after(SETTLE_MAX_MS, () => {
    if (live.landed?.id === jump.id) live = { ...live, landed: { ...live.landed, isSettled: true } }
  })
}

// Records what a jump to a prompt answered and returns the language key of what to say, if anything.
export async function noteJump(engine: Engine, requestId: string, deny: string | undefined): Promise<string | undefined> {
  // A queued prompt jumps to its row drawn last, which is another name of its entry.
  const key = keyOf(rowKey(requestId))
  const note = jumpNote(deny, live.isUnscrollableSaid)
  const was = live.unreachable.has(key)
  const unreachable = note.reach === 'yes' ? new Set([...live.unreachable].filter(other => other !== key)) : note.reach === 'no' ? new Set([...live.unreachable, key]) : live.unreachable
  live = { ...live, unreachable, isUnscrollableSaid: live.isUnscrollableSaid || note.isUnscrollable }
  if (note.reach === 'yes') landOn(engine, key, requestId)
  if (unreachable.has(key) !== was || currentIndex() !== live.drawnCurrent) await bumpToc(engine)
  return note.say
}

// The row id a move names, from where the person reads; undefined when there is none that way.
export function tocTarget(move: TocMove): string | undefined {
  const keys = [...live.toc.keys()]
  const entries = [...live.toc.values()]
  const i = pickIndex(move, entries.map(entry => entry.text), currentIndex(), k => live.unreachable.has(keys[k] ?? ''))
  return entries[i]?.requestId
}

export const isViewingAgent = (): boolean => live.viewAgent !== undefined

// The engine moves a transcript row only while the call answers the person's own input, so a press or a typed
// command reaches this with nothing awaited before it. A failure says so in a toast; a refusal as noteJump reads it.
export async function scrollToPrompt(engine: Engine, requestId: string, t: TFn): Promise<void> {
  const moved = await engine.ui.scroll({ to: { requestId }, block: 'start' }).catch((err: unknown) => {
    engine.ui.log(`oh-my-toolbelt: ui.scroll failed (${errorText(err)})`, { to: 'debug' })
    return null
  })
  if (moved === null) return engine.ui.toast(t('toast.scrollRejected'))
  if (moved.deny !== undefined) engine.ui.log(`oh-my-toolbelt: ui.scroll refused (${moved.deny})`, { to: 'debug' })
  const say = await noteJump(engine, requestId, moved.deny)
  if (say !== undefined) engine.ui.toast(t(say))
}

// `/toolbelt toc next|prev|first|last|<n>|find <words>` answers with a toast, as the person reads far above where a
// reply row lands. Anyone may ask: the engine moves the transcript only for the person's own input.
export async function moveToc(engine: Engine, move: TocMove, t: TFn, isLive: boolean): Promise<{ text?: string }> {
  if (!isLive) return { text: t('command.toc.off') }
  const requestId = isViewingAgent() ? undefined : tocTarget(move)
  if (requestId !== undefined) return scrollToPrompt(engine, requestId, t).then(() => ({}))
  const asked = move.kind === 'number' ? String(move.n) : move.kind === 'find' ? `find ${move.words}` : move.kind
  const missing = move.kind === 'next' ? t('toast.tocNoNext') : move.kind === 'prev' ? t('toast.tocNoPrev') : t('toast.tocNoMatch', { asked })
  engine.ui.toast(isViewingAgent() ? t('toast.tocMainOnly') : missing)
  return {}
}

// ---- The desktop app's opened row: the engine moves no transcript there ----
// A press opens a row (a second one closes it) and reads its answer; `full` shows the whole answer, read again as it
// may have grown since, `back` the list again; `fill` puts the prompt, whole, in the prompt box. A press from a row
// no longer open (drawn before the panel changed) acts on that row alone: `fill` puts its own prompt, the rest pass.
// A row is its key in the table (an opened row used to close when its id changed).
export async function viewTocRow(engine: Engine, op: TocViewOp, key: string, t: TFn): Promise<void> {
  const opened = live.opened?.key === key ? live.opened : null
  if (op === 'fill') {
    const text = opened?.found?.prompt ?? live.toc.get(key)?.text
    if (text !== undefined && !(await engine.prompt.fill({ text, mode: 'insert' })).isFilled) engine.ui.toast(t('toast.fillRejected'))
    return
  }
  if (op !== 'open') {
    if (opened === null) return
    live = { ...live, opened: { ...opened, isFull: op === 'full' } }
    if (op === 'full') await readOpened(engine)
    return bumpToc(engine)
  }
  live = { ...live, opened: opened === null ? { key, isFull: false } : null }
  await bumpToc(engine)
  await readOpened(engine)
  await bumpToc(engine)
}

// The open row's prompt and answer in the conversation's messages, kept unless another row opened meanwhile.
async function readOpened(engine: Engine): Promise<void> {
  const key = live.opened?.key
  if (key === undefined) return
  const found = await findAnswer(engine, key)
  if (live.opened?.key === key) live = { ...live, opened: { ...live.opened, found } }
}

// The row's prompt among the messages: the one with its text, as many from the latest as the listed rows after it with
// the same text, as the messages hold the latest ones only.
async function findAnswer(engine: Engine, key: string): Promise<Answered | null> {
  const entries = [...live.toc.values()]
  const at = [...live.toc.keys()].indexOf(key)
  const text = entries[at]?.text
  if (text === undefined) return null
  const fromEnd = entries.slice(at + 1).filter(entry => entry.text === text).length
  try {
    return answerFor(await engine.session.messages(), text, fromEnd)
  } catch (err) {
    engine.ui.log(`oh-my-toolbelt: session.messages failed: ${errorText(err)}`, { to: 'debug' })
    return null
  }
}

// The open row's answer, read again, and its number, for an export of it alone (register.tsx).
export async function openedAnswer(engine: Engine): Promise<{ answer: string; number: number } | null> {
  await readOpened(engine)
  const opened = live.opened
  const at = opened === null ? -1 : [...live.toc.keys()].indexOf(opened.key)
  return opened?.found == null || at === -1 ? null : { answer: opened.found.answer, number: at + 1 }
}

// ---- The tab's drawing and /clear ----
function turnOf(key: string): Turn | undefined {
  const turn = live.turns.get(key)
  return live.isRunning && key === live.turnKey ? { ...(turn ?? emptyTurn()), outcome: 'running' } : turn
}

// The band and the panel draw far more often than the table changes, so the listed rows and the cards are kept until
// what they are made from changes (by identity: every change makes a new table, turns map or translator).
let rowsMemo: { toc: Toc; listed: ReturnType<typeof tocRows> } | null = null
let cardsMemo: { toc: Toc; turns: Live['turns']; turnKey: string | undefined; isRunning: boolean; width: number; t: TFn; cards: BandCard[] } | null = null

function listedRows(): ReturnType<typeof tocRows> {
  if (rowsMemo?.toc !== live.toc) rowsMemo = { toc: live.toc, listed: tocRows(live.toc) }
  return rowsMemo.listed
}

// What the tab draws now; the prompt drawn as being read is remembered, so a settled report redraws only on a change.
export function tocView(): TocView {
  const current = currentIndex()
  live = { ...live, drawnCurrent: current }
  const { rows, hidden } = listedRows()
  const views = rows.map(row => ({ ...row, isCurrent: row.number - 1 === current, isUnreachable: live.unreachable.has(row.key), turn: turnOf(row.key) }))
  return { rows: views, hidden, isElsewhere: live.viewAgent !== undefined, opened: live.opened }
}

// One drawing draws 100,000 characters in all (d.ts, Text) and a card is as wide as the band, so past this only the
// latest prompts carry a card.
// ponytail: latest rows only past 300 columns; carry the panel's window instead if old prompts there need cards
const CARD_CHARS_MAX = 60_000

// The band's cards: one a pointer on a panel row reveals in the band row, for every listed row, so the card is there
// whichever row the panel shows. None beside an agent's transcript.
export function tocBandCards(width: number, t: TFn): BandCard[] {
  if (live.viewAgent !== undefined || width <= 0) return []
  const { toc, turns, turnKey, isRunning } = live
  const memo = cardsMemo
  if (memo !== null && memo.toc === toc && memo.turns === turns && memo.turnKey === turnKey && memo.isRunning === isRunning && memo.width === width && memo.t === t) return memo.cards
  const cards = listedRows().rows.slice(-Math.max(1, Math.floor(CARD_CHARS_MAX / width))).map(row => ({ scope: tocScope(row.number), text: bandCardText(row, turnOf(row.key), width, t) }))
  cardsMemo = { toc, turns, turnKey, isRunning, width, t, cards }
  return cards
}

// Nothing the table holds is in the new, empty conversation; the panel is drawn again once the old rows are gone.
// Whether a turn runs is the engine's, not the table's, so it stays.
export function resetToc(engine: Engine): void {
  timers.quiet?.cancel()
  timers.latest?.cancel()
  timers = { ...timers, quiet: null, latest: null }
  live = { ...initialLive(), isRunning: live.isRunning }
  queueTocRedraw(engine)
}
