// The prompt table of contents. Pure: hooks/toc-live.ts keeps the table, each prompt's turn and where the person reads;
// hooks/toc-tab.tsx draws the rows.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import type { PromptOrigin, SessionMessage } from 'claude-code'
import type { TFn } from '../lib/i18n'
import { stripControls } from '../lib/schema'
import { cellsOf, truncateCells, wrapCells } from '../lib/width'

// The panel's tree is bounded (20,000 nodes, 100,000 characters), so the newest rows are listed.
export const TOC_ROWS_MAX = 200
// What a row keeps of a first line; the panel cuts it again to its own width.
const LINE_CHARS_MAX = 200
// What the table keeps of a prompt for its card, which shows a few lines of it.
const TEXT_CHARS_MAX = 2000
// The id the engine draws a new prompt's row under before the message is stored; the stored row follows.
export const PROVISIONAL_ID = 'placeholder'
// A message uuid. A message the engine splits into rows is drawn under ids made from its uuid: the first four groups
// kept and the last replaced by the row's index (2.1.283).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEP = ' · '

// A prompt as the table keeps it: the id its row was first drawn under (where a jump scrolls) and its text.
export type TocEntry = { requestId: string; text: string }
// The prompts by row key, in the order first drawn.
export type Toc = ReadonlyMap<string, TocEntry>
// A row of the tab: `line` is the first line, `text` the prompt as kept for its card.
export type TocRow = { requestId: string; key: string; number: number; line: string; text: string }

// A turn a prompt started: how long it ran, how many tools it called, the files it edited (the first TURN_FILES_MAX
// of them) and how many, and how it went unless it simply answered.
export type Outcome = 'running' | 'interrupted' | 'error'
export type Turn = { durationMs?: number; tools: number; files: readonly string[]; fileCount: number; outcome?: Outcome }
export const emptyTurn = (): Turn => ({ tools: 0, files: [], fileCount: 0 })

// What the tab draws: the rows with the one being read, the ones a jump could not reach and their turns; `isElsewhere`
// while an agent's transcript is beside the panel.
export type TocRowView = TocRow & { isCurrent: boolean; isUnreachable: boolean; turn: Turn | undefined }
// The desktop app's opened row (see answerFor): its whole answer shown or not, and what was found, once read
// (undefined while reading, null when none was).
// By the table's key, which stays when a row's id changes (a prompt read from the file, then drawn).
export type Opened = { key: string; isFull: boolean; found?: Answered | null }
// What a press on it asks (hooks/toc-live.ts viewTocRow).
export type TocViewOp = 'open' | 'full' | 'back' | 'fill'
export type TocView = { rows: readonly TocRowView[]; hidden: number; isElsewhere: boolean; opened?: Opened | null }

// A person's prompt: typed here or through the bridge, typed in the desktop app (`sdk`, see isHumanOrigin; the
// transcript file judges `sdk` the other way, see tools/transcript.ts MACHINE_KINDS), or saved before origins were
// stamped (`unclassified`), which a resumed old conversation is full of.
export const isTocKind = (kind: string): boolean => kind === 'composer' || kind === 'bridge' || kind === 'sdk' || kind === 'unclassified'
// Or one the toolbelt's own send button sent as the person's words: a plugin's prompt under this mod's name (`own`,
// `$.plugin.name`); another plugin's stays out.
type Origin = { kind: string; name?: unknown; asUser?: unknown }
export const isOwn = (origin: Origin, own: string): boolean => origin.kind === 'plugin' && origin.name === own
// The send button's prompt as session.append hands its row: `asUser`, which a command this mod runs is not. 2.1.310
// hands this mod its own submit through session.append alone, never its ui.render or prompt.submit hooks.
export const isOwnPrompt = (origin: Origin, own: string): boolean => isOwn(origin, own) && origin.asUser === true
// A row session.append hands that starts a turn of a listed prompt: one a person sent, or the send button's.
export const isTocOrigin = (origin: Origin, own: string): boolean => isTocKind(origin.kind) || isOwnPrompt(origin, own)
// A drawn UserMessage row of a person's prompt: not a message someone else sent (`from`: another agent, a teammate,
// whose row is `unclassified`, another session, a channel) nor a task's notification (`task`). This mod's own rows are
// judged by name alone, as the transcript file judges them (tools/transcript.ts pluginOf): a command it ran draws the
// engine's wrapper, which promptOf leaves out (session.append lists one Claude answers, toc-live.ts noteCommandRow).
// 2.1.310 draws none of them through this mod's own hook as they are sent (session.append lists the send button's); a
// row drawn again after a resume is not known to differ.
export const isTocRow = (props: { origin: PromptOrigin; from?: unknown; task?: unknown }, own: string): boolean =>
  (isTocKind(props.origin.kind) || isOwn(props.origin, own)) && props.from === undefined && props.task === undefined

// On unless the person turned it off; an options object that lacks the field counts as on.
export const isTocTabOn = (options: Readonly<Record<string, unknown>>): boolean => options.tocTab !== false

// The key rows are matched by: a uuid by its first four groups, any other id (a tool_use id) as it is.
export const rowKey = (id: string): string => (UUID.test(id) ? id.slice(0, 24) : id)

const cleanLines = (text: string): string[] => text.split('\n').map(line => stripControls(line.replace(/\t/g, ' ')).trim())
const bounded = (text: string, max: number): string => Array.from(text).slice(0, max).join('')

// The first line with text, on one line and bounded; '' for a prompt that is all blank.
export const firstLine = (text: string): string => bounded(cleanLines(text).find(line => line !== '') ?? '', LINE_CHARS_MAX)

// The prompt as the table keeps it: its lines with text, bounded.
// What a host puts ahead of the typed text: a reminder (the desktop app's note on the first prompt of a session started
// without a project folder, which once kept that prompt out of the tab) or an open artifact's view state. The text
// after it is the prompt.
const PREAMBLE = /^\s*(?:(?:<system-reminder>[\s\S]*?<\/system-reminder>|<artifact-view-context\b[^>]*>[\s\S]*?<\/artifact-view-context>)\s*)+/
export const withoutReminders = (text: string): string => text.replace(PREAMBLE, '')

export const promptText = (text: string): string => bounded(cleanLines(withoutReminders(text)).filter(line => line !== '').join('\n'), TEXT_CHARS_MAX)

// User rows the engine writes around its own output (slash commands, bash mode, reminders) or another party's words
// (a teammate's), which are not prompts. An export reads them closer, as they hold what the person typed
// (lib/export.ts).
export const WRAPPER = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook|teammate-message)/

// A prompt as the table keeps it, or undefined for a row that is none: blank, the engine's wrapper, or a slash
// command (any text starting with `/`). The transcript file and the drawn rows judge alike, so a reload numbers the
// prompts as they were.
export function promptOf(text: string): string | undefined {
  const trimmed = withoutReminders(text).trim()
  const kept = WRAPPER.test(trimmed) || trimmed.startsWith('/') ? '' : promptText(trimmed)
  return kept === '' ? undefined : kept
}

// A slash command's own row as the engine stores it and session.append hands it: its name, message and arguments tags
// alone, in either order (`<command-message>co</command-message>\n<command-name>/co</command-name>`). Read from the
// front, three tags at most, so any text costs one pass.
const COMMAND_TAG = /^\s*<(command-name|command-message|command-args)>/
const COMMAND_TAGS_MAX = 3

function commandTags(text: string): ReadonlyMap<string, string> | undefined {
  const bodies = new Map<string, string>()
  let rest = text
  for (let i = 0; i < COMMAND_TAGS_MAX && rest !== ''; i++) {
    const open = COMMAND_TAG.exec(rest)
    const tag = open?.[1]
    if (open === null || tag === undefined) return undefined
    const end = rest.indexOf(`</${tag}>`, open[0].length)
    if (end === -1) return undefined
    bodies.set(tag, rest.slice(open[0].length, end).trim())
    rest = rest.slice(end + tag.length + 3)
  }
  return rest === '' ? bodies : undefined
}

// That row as typed, `/name args`, whole; undefined for any other text.
function commandLine(text: string): string | undefined {
  const tags = commandTags(withoutReminders(text).trim())
  const name = tags?.get('command-name') ?? ''
  return name.startsWith('/') ? `${name} ${tags?.get('command-args') ?? ''}`.trim() : undefined
}

// That row as the table keeps it, or undefined for any other text. Which command rows are prompts is the caller's to
// judge: one Claude answers, not one that only acts here (`/model`; tools/transcript.ts userKind, toc-live.ts
// noteCommandRow).
export function commandOf(text: string): string | undefined {
  const line = commandLine(text)
  const kept = line === undefined ? '' : promptText(line)
  return kept === '' ? undefined : kept
}

// A new table with the prompt added at the end, unless a row of it is listed already.
export const withPrompt = (toc: Toc, requestId: string, text: string): Toc =>
  toc.has(rowKey(requestId)) ? toc : new Map([...toc, [rowKey(requestId), { requestId, text: promptText(text) }]])

// A new table whose prompt under `key` jumps to `requestId`, the id its row is drawn under, in its place.
export function withRequestId(toc: Toc, key: string, requestId: string): Toc {
  const entry = toc.get(key)
  return entry === undefined || entry.requestId === requestId ? toc : new Map(toc).set(key, { ...entry, requestId })
}

// ---- A turn's tool calls, from session.append and from the transcript file alike ----
// The tools whose `file_path` a turn's line names.
const EDITING_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])
// A tool call: its id (a tool row is drawn under it), its tool and the file it names.
export type Use = { id: string; name: string; path?: string }

// A message block's tool call, if it is one; any other value is none.
export function toolUse(block: unknown): Use[] {
  if (typeof block !== 'object' || block === null) return []
  const { type, id, name, input } = block as Record<string, unknown>
  if (type !== 'tool_use' || typeof id !== 'string') return []
  const path = typeof input === 'object' && input !== null ? (input as Record<string, unknown>).file_path : undefined
  return [{ id, name: typeof name === 'string' ? name : '', ...(typeof path === 'string' ? { path } : {}) }]
}

// A turn keeps this many of the files it edited: its card names three and counts the rest (a turn of thousands of edits
// made every band drawing slow).
// ponytail: past the cap a file edited again counts again; keep every path in a Set if the count must be exact
export const TURN_FILES_MAX = 50

// The turn with the calls counted and the files they edit named once each.
export function withUses(turn: Turn, uses: readonly Use[]): Turn {
  const named = new Set(turn.files)
  const edited = new Set(uses.flatMap(use => (EDITING_TOOLS.has(use.name) && use.path !== undefined ? [use.path] : [])))
  const added = [...edited].filter(path => !named.has(path))
  return { ...turn, tools: turn.tools + uses.length, files: [...turn.files, ...added].slice(0, TURN_FILES_MAX), fileCount: turn.fileCount + added.length }
}

// The newest rows, numbered by their place among all prompts; `hidden` counts the older ones left out.
export function tocRows(toc: Toc): { rows: TocRow[]; hidden: number } {
  const hidden = Math.max(0, toc.size - TOC_ROWS_MAX)
  const rows = [...toc].slice(hidden).map(([key, entry], i) => ({ requestId: entry.requestId, key, number: hidden + i + 1, line: firstLine(entry.text), text: entry.text }))
  return { rows, hidden }
}

// The mark before a row: heavy where the person reads, dotted where the transcript draws no row to jump to.
// A panel row and its card on the band light together: both join this hover scope (an engine scope spans sites).
export const tocScope = (number: number): string => `toc-${number}`

// A card the band reveals while the pointer is on a prompt's row: one line, as wide as the band.
export type BandCard = { scope: string; text: string }

// The band's card: a card over the list held the pointer, so rows below it could not be reached; it moved to the band
// row, as the earlier contents panel drew it. `#3 the prompt · 1m 23s · Tools: 2 · app.ts`: the prompt is cut first,
// never below a few words, then the turn names fewer files.
const CARD_TEXT_MIN = 12
export function bandCardText(row: { number: number; text: string }, turn: Turn | undefined, width: number, t: TFn): string {
  const head = `#${row.number} `
  const room = Math.max(0, width - cellsOf(head))
  const text = row.text.split('\n').filter(line => line !== '').join(' ')
  const details = turnLine(turn, t, room - CARD_TEXT_MIN - cellsOf(SEP))
  if (details === '') return truncateCells(`${head}${text}`, width)
  const textRoom = Math.max(CARD_TEXT_MIN, room - cellsOf(details) - cellsOf(SEP))
  return truncateCells(`${head}${truncateCells(text, textRoom)}${SEP}${details}`, width)
}

export const tick = (isCurrent: boolean, isUnreachable: boolean): string => (isCurrent ? '━' : isUnreachable ? '┄' : '─')

// A card's lines: the prompt wrapped to `width`, at most `max` lines, the last ending in … when more is left.
export function cardLines(text: string, width: number, max: number): string[] {
  const all = text.split('\n').flatMap(line => wrapCells(line, width))
  if (all.length <= max) return all
  return all.slice(0, max).map((line, i) => (i === max - 1 ? truncateCells(`${line}…`, width) : line))
}

// ---- A turn on one line: `1m 23s · Tools: 4 · app.ts, README.md`, each part left out when unknown ----
const NAMED_FILES = 3

function durationText(ms: number, t: TFn): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return t('toc.turn.seconds', { s })
  if (s < 3600) return t('toc.turn.minutes', { m: Math.floor(s / 60), s: s % 60 })
  return t('toc.turn.hours', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) })
}

const segments = (path: string): string[] => path.split(/[\\/]/).filter(Boolean)

// Each path by its file name, or by its folder and name where two share one; the names counted once, not each against
// every other.
// A path comes from the model's tool input and is drawn in the card: control characters go and it is bounded.
export function fileNames(raw: readonly string[]): string[] {
  const paths = raw.map(path => bounded(stripControls(path), LINE_CHARS_MAX))
  const bases = paths.map(path => segments(path).at(-1) ?? path)
  const counts = bases.reduce((seen, name) => seen.set(name, (seen.get(name) ?? 0) + 1), new Map<string, number>())
  return paths.map((path, i) => {
    const base = bases[i] ?? path
    return (counts.get(base) ?? 0) > 1 ? segments(path).slice(-2).join('/') : base
  })
}

// Given `maxCells`, it names fewer files (down to a count) to fit.
export function turnLine(turn: Turn | undefined, t: TFn, maxCells = Infinity): string {
  if (turn === undefined) return ''
  const parts = [
    ...(turn.durationMs === undefined ? [] : [durationText(turn.durationMs, t)]),
    ...(turn.outcome === undefined ? [] : [t(`toc.turn.${turn.outcome}`)]),
    ...(turn.tools > 0 ? [t('toc.turn.tools', { n: turn.tools })] : []),
  ]
  const names = fileNames(turn.files)
  const withFiles = (named: number): string => {
    if (names.length === 0) return parts.join(SEP)
    const rest = turn.fileCount - named
    const files = named > 0 ? `${names.slice(0, named).join(', ')}${rest > 0 ? ` +${rest}` : ''}` : t('toc.turn.files', { n: turn.fileCount })
    return [...parts, files].join(SEP)
  }
  const fits = [3, 2, 1].filter(named => named <= Math.min(NAMED_FILES, names.length)).map(withFiles).find(line => cellsOf(line) <= maxCells)
  return fits ?? withFiles(0)
}

// ---- Where the person reads: the prompt the topmost transcript row on screen belongs to ----
// A row's last onScreen report: the prompt it places (an index into the table), where it starts, and when it said so.
export type PlacedRow = { i: number; first: number; order: number }

// The index of the prompt a row belongs to: a prompt row its own, a reply or tool row its prompt's (`owners`);
// undefined for a row that places no one (one from before this load, the provisional one).
export function promptIndexOf(key: string, promptIndex: ReadonlyMap<string, number>, owners: ReadonlyMap<string, string>): number | undefined {
  if (key === PROVISIONAL_ID) return undefined
  const owner = owners.get(key)
  return promptIndex.get(key) ?? (owner === undefined ? undefined : promptIndex.get(owner))
}

// The prompt of the row that last said it is cut at the viewport's top: that row is the top one. Unless a row of an
// earlier prompt said it is on screen since: the viewport then moved above the cut row, which left without saying so.
export function topIndex(rows: readonly PlacedRow[]): number | undefined {
  const cut = rows.filter(row => row.first > 0 && !rows.some(other => other.i < row.i && other.order > row.order))
  return cut.reduce<PlacedRow | undefined>((top, row) => (top === undefined || row.order > top.order ? row : top), undefined)?.i
}

// The earliest prompt among the rows on screen, passing over those above the top row until it is confirmed; -1 for none.
export function readIndex(rows: readonly PlacedRow[]): number {
  const top = topIndex(rows)
  const shown = rows.filter(row => top === undefined || row.i >= top).map(row => row.i)
  return shown.length === 0 ? -1 : Math.min(...shown)
}

// ---- Moving through the prompts (`/toolbelt toc …`) ----
export type TocMove = { kind: 'next' | 'prev' | 'first' | 'last' } | { kind: 'number'; n: number } | { kind: 'find'; words: string }

// The prompt one step from `current` in direction `dir`, passing over those `isSkipped` names; from an unknown place
// (-1), the first or the last. -1 when there is none that way.
export function stepFrom(current: number, count: number, dir: 1 | -1, isSkipped: (i: number) => boolean): number {
  const start = current >= 0 ? current + dir : dir > 0 ? 0 : count - 1
  const order = Array.from({ length: count }, (_, k) => k).filter(i => (dir > 0 ? i >= start : i <= start))
  const found = (dir > 0 ? order : [...order].reverse()).find(i => !isSkipped(i))
  return found ?? -1
}

// The prompt a move names among `texts` (the table's order), from `current`; -1 when none does. `find` takes the newest
// whose text holds the words, case aside.
export function pickIndex(move: TocMove, texts: readonly string[], current: number, isSkipped: (i: number) => boolean): number {
  switch (move.kind) {
    case 'next': return stepFrom(current, texts.length, 1, isSkipped)
    case 'prev': return stepFrom(current, texts.length, -1, isSkipped)
    case 'first': return texts.length > 0 ? 0 : -1
    case 'last': return texts.length - 1
    case 'number': return move.n >= 1 && move.n <= texts.length ? move.n - 1 : -1
    case 'find': return texts.findLastIndex(text => text.toLowerCase().includes(move.words.toLowerCase()))
  }
}

// ---- A jump's answer ----
// The engine's refusal when no row is drawn under the id, and where no transcript
// viewport takes a mod's scroll (the desktop app). Other refusals (a race with another move) leave the row be.
// Both are strings of the 2.1.309 engine ("nothing drawn under that requestId", "transcript not scrollable here").
const NOT_DRAWN = /nothing drawn/
const UNSCROLLABLE = /not scrollable/

// What a jump's answer means: a landing makes the row reachable, a refusal for want of a drawn row unreachable; and
// the toast to show, the screen that cannot scroll at all said once a session.
export type JumpNote = { reach: 'yes' | 'no' | 'unknown'; say?: string; isUnscrollable: boolean }

export function jumpNote(deny: string | undefined, isUnscrollableSaid: boolean): JumpNote {
  if (deny === undefined) return { reach: 'yes', isUnscrollable: false }
  if (NOT_DRAWN.test(deny)) return { reach: 'no', say: 'toast.tocNotDrawn', isUnscrollable: false }
  if (UNSCROLLABLE.test(deny)) return { reach: 'unknown', isUnscrollable: true, ...(isUnscrollableSaid ? {} : { say: 'toast.tocUnscrollable' }) }
  return { reach: 'unknown', say: 'toast.scrollRejected', isUnscrollable: false }
}

// ---- The desktop app's opened row: the engine moves no transcript there, so a pressed row
// opens in place with its prompt whole and its answer, from `$.session.messages()`, which carry no ids ----
// What the panel draws of an answer: one drawing holds 100,000 characters in all (d.ts, Text), and 20,000 nodes.
export const ANSWER_CHARS_MAX = 60_000
export const ANSWER_LINES_MAX = 2000
export type Answered = { prompt: string; answer: string }

// A message as the table would list it: its prompt (promptOf) or slash command (commandOf), or undefined for a tool
// result, the engine's own rows or a reminder alone. The messages carry no ids, so a row's prompt is the message whose
// prompt is the row's text, as the table kept it.
// ponytail: a command that only acts here (`/model`) counts too, so one typed while Claude answers cuts that answer
// short; the messages do not tell the two apart, the transcript file does (tools/transcript.ts userKind)
const listedPrompt = (message: SessionMessage): string | undefined =>
  message.role === 'user' && (message.toolResults ?? []).length === 0 ? (promptOf(message.text) ?? commandOf(message.text)) : undefined

// The prompt the table keeps as `text`, the `fromEnd`th of those (from 0) counted from the latest, as the messages hold
// the latest ones only; and the text Claude wrote after it up to the next prompt the table would list. Null when none.
export function answerFor(messages: readonly SessionMessage[], text: string, fromEnd: number): Answered | null {
  const matches = messages.flatMap((message, i) => (listedPrompt(message) === text ? [i] : []))
  const at = matches[matches.length - 1 - fromEnd]
  if (at === undefined) return null
  const after = messages.slice(at + 1)
  const end = after.findIndex(message => listedPrompt(message) !== undefined)
  const said = (end === -1 ? after : after.slice(0, end)).filter(message => message.role === 'assistant' && message.text.trim() !== '')
  const asked = messages[at]?.text ?? text
  return { prompt: commandLine(asked) ?? withoutReminders(asked).trim(), answer: said.map(message => message.text.trim()).join('\n\n') }
}

// The answer's lines as drawn, cut at ANSWER_CHARS_MAX and ANSWER_LINES_MAX, never inside a surrogate pair; `isCut`
// says the rest is only in an export.
export function answerLines(answer: string): { lines: string[]; isCut: boolean } {
  const end = answer.length > ANSWER_CHARS_MAX && /[\uD800-\uDBFF]/.test(answer[ANSWER_CHARS_MAX - 1] ?? '') ? ANSWER_CHARS_MAX - 1 : ANSWER_CHARS_MAX
  const lines = answer.slice(0, end).split('\n')
  return { lines: lines.slice(0, ANSWER_LINES_MAX), isCut: answer.length > end || lines.length > ANSWER_LINES_MAX }
}
