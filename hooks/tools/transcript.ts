// The session's transcript file made into the prompts tab's table: one JSON row a line, as the engine stores the
// conversation. Pure: hooks/toc-history.ts reads the file. The file is untrusted input: a line that is not JSON, too
// long, or of a shape not expected here is passed over, and a prompt's text is cleaned and bounded as a drawn one's is
// (`promptText`).
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { powershellPath } from '../lib/platform'
import { commandOf, emptyTurn, promptOf, toolUse, withUses } from './toc'
import type { Turn, Use } from './toc'

// What one `$.fs.read` takes (4 MiB); a larger file is streamed through a command.
export const READ_CAP = 4 * 1024 * 1024
// A longer line is not parsed, nor held while it streams in: the engine's own rows stay far below it (a long
// session's longest was 135 KB).
export const LINE_CHARS_MAX = 8 * 1024 * 1024

// The viewer's state the engine puts ahead of a prompt sent while an artifact is open; the typed text follows it.
const VIEW_CONTEXT = /^\s*<artifact-view-context artifact="[^"]*">\n\{"context":[\s\S]*?\n<\/artifact-view-context>/
// The notice the engine stores as a user row when the person interrupts a turn (`for tool use` while a tool runs), as
// 2.1.310 words it. Only the whole row is it: the person can start a message with the same words (lib/export.ts reads
// the notice so too).
const INTERRUPTED = /^\[Request interrupted by user(?: for tool use)?\]$/

// A row by what the table makes of it, with its link to the row before it on its branch and when it was written (`at`,
// epoch ms, none for a missing or unreadable timestamp). A prompt a plugin sent names the plugin (`plugin`), which
// historyOf weighs; a user row a machine sent (`start`: a notification, a scheduled task, a peer's message) lists no
// prompt but starts a turn.
type Kind =
  | { kind: 'prompt' | 'queued'; text: string; plugin?: string }
  | { kind: 'reply'; uses: readonly Use[]; isError: boolean }
  | { kind: 'duration'; ms: number }
  | { kind: 'interrupt' | 'boundary' | 'start' | 'other' }
export type Row = { uuid: string; parent: string | undefined; isSidechain: boolean; at?: number } & Kind

// The prompts in order, by row uuid; the turn each started; the prompt (an index) each reply row and tool call
// answers; every row uuid the file holds; and the prompt whose turn the last replies belong to (-1 for none).
export type History = {
  prompts: readonly { uuid: string; text: string }[]
  turns: readonly Turn[]
  owners: readonly (readonly [string, number])[]
  known: ReadonlySet<string>
  started: number
}

const OTHER: Kind = { kind: 'other' }
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.flatMap(b => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n') : ''
// A row's text blocks joined, the artifact view state ahead of the typed text gone (hooks/toc-hooks.ts reads a
// session.append row's content so too).
export const cleanText = (content: unknown): string => textOf(content).replace(VIEW_CONTEXT, '').trim()

// The senders that are not a person, by PromptOrigin's kinds (2.1.308). The file stores a person's row as `human`, and
// no origin in files written before origins were. Any kind this list does not name counts as a person's: a prompt
// the list misjudged would otherwise stay out of the tab even when drawn (see toc-live's `known`). `sdk` is a machine's
// here though tools/toc.ts isTocKind takes a drawn `sdk` row as the person's: the file stores a prompt typed in the
// desktop app as `human` (with `promptSource: sdk`), so a row stored as `sdk` is no person's. A `plugin` row is a
// prompt for historyOf to judge by its plugin.
const MACHINE_KINDS: ReadonlySet<string> = new Set([
  'auto-continuation', 'channel', 'coordinator', 'observer', 'observer-activity', 'peer', 'peer-send-message',
  'projects-relay', 'scheduled-trigger', 'sdk', 'slack-ping', 'task-notification',
])
const isPersonOrigin = (origin: unknown): boolean => !(isRecord(origin) && typeof origin.kind === 'string' && MACHINE_KINDS.has(origin.kind))
// The plugin that sent a prompt, by name alone, as drawn rows are (tools/toc.ts isTocRow). 2.1.310 stores the send
// button's `asUser`, but files of earlier builds keep none; a command this mod's button ran is listed as one typed is
// (userKind).
const pluginOf = (origin: unknown): { plugin?: string } =>
  isRecord(origin) && origin.kind === 'plugin' ? { plugin: typeof origin.name === 'string' ? origin.name : '' } : {}

function userKind(row: Record<string, unknown>, message: Record<string, unknown>): Kind {
  if (row.isMeta === true || row.isCompactSummary === true || message.role !== 'user') return OTHER
  const text = cleanText(message.content)
  // An interruption ends its turn; one mid tool call rides with the call's result, so it is read first.
  if (INTERRUPTED.test(text)) return { kind: 'interrupt' }
  if (Array.isArray(message.content) && message.content.some(b => isRecord(b) && b.type === 'tool_result')) return OTHER
  if (!isPersonOrigin(row.origin)) return { kind: 'start' }
  // A slash command's own row is a prompt when Claude answers it: the engine stamps where it stands among the turns
  // (`turnPosition`) on that row, and on none of a command that only acts here (`/model`, `/reload-plugins`), in the
  // transcript files sampled (2.1.284 to 2.1.310).
  // ponytail: files of builds that stamp no turnPosition keep their commands out; list a command a reply follows if
  // those matter
  const prompt = promptOf(text) ?? (isRecord(row.turnPosition) ? commandOf(text) : undefined)
  return prompt === undefined ? OTHER : { kind: 'prompt', text: prompt, ...pluginOf(row.origin) }
}

// A prompt typed while a turn ran and delivered into it is stored as a queued_command attachment, never as a user row.
function queuedKind(attachment: unknown): Kind {
  if (!isRecord(attachment) || attachment.type !== 'queued_command' || !isPersonOrigin(attachment.origin)) return OTHER
  const prompt = promptOf(cleanText(attachment.prompt))
  return prompt === undefined ? OTHER : { kind: 'queued', text: prompt, ...pluginOf(attachment.origin) }
}

function kindOf(row: Record<string, unknown>): Kind {
  const message = isRecord(row.message) ? row.message : {}
  if (row.type === 'user') return userKind(row, message)
  if (row.type === 'attachment') return queuedKind(row.attachment)
  if (row.type === 'assistant') {
    const uses = Array.isArray(message.content) ? message.content.flatMap(toolUse) : []
    return { kind: 'reply', uses, isError: row.isApiErrorMessage === true }
  }
  if (row.type !== 'system') return OTHER
  if (row.subtype === 'compact_boundary') return { kind: 'boundary' }
  const ms = row.durationMs
  return row.subtype === 'turn_duration' && typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? { kind: 'duration', ms } : OTHER
}

// What the table reads of one line, and nothing else: a long session's rows are held until the read ends, and most
// of their bytes are tool results it never shows. Undefined for a line that is not a row.
export function parseRow(line: string): Row | undefined {
  if (line.length > LINE_CHARS_MAX || line.trim() === '') return undefined
  let row: unknown
  try {
    row = JSON.parse(line)
  } catch {
    // A torn or foreign line: passed over, as the read's contract says.
    return undefined
  }
  if (!isRecord(row) || typeof row.uuid !== 'string') return undefined
  const parent = typeof row.parentUuid === 'string' ? row.parentUuid : undefined
  const at = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : NaN
  return { uuid: row.uuid, parent, isSidechain: row.isSidechain === true, ...(Number.isFinite(at) ? { at } : {}), ...kindOf(row) }
}

// ---- Lines as they come: the whole file at once, or a command's output piece by piece ----
// The line not ended yet, and whether it is one too long to keep, dropped up to its end.
export type Feed = { rest: string; isSkipping: boolean }
export const startFeed = (): Feed => ({ rest: '', isSkipping: false })

// The rows of the lines `text` ends, and what is left to wait for.
export function feedLines(feed: Feed, text: string): { feed: Feed; rows: Row[] } {
  const parts = text.split('\n')
  const tail = parts.pop() ?? ''
  const [first, ...whole] = parts
  const ended = first === undefined ? [] : feed.isSkipping ? whole : [feed.rest + first, ...whole]
  const rest = first === undefined && !feed.isSkipping ? feed.rest + tail : tail
  const isSkipping = (first === undefined && feed.isSkipping) || rest.length > LINE_CHARS_MAX
  return { feed: { rest: isSkipping ? '' : rest, isSkipping }, rows: ended.flatMap(line => parseRow(line) ?? []) }
}

// The last line, which has no newline after it when the file ends without one.
export function lastRows(feed: Feed): Row[] {
  const row = feed.isSkipping ? undefined : parseRow(feed.rest)
  return row === undefined ? [] : [row]
}

export function rowsOf(text: string): Row[] {
  const fed = feedLines(startFeed(), text)
  return [...fed.rows, ...lastRows(fed.feed)]
}

// ---- The table ----
// The rows on the live branch: the chain of parents from the last row; a /rewind leaves the abandoned branch in the
// file. A /compact boundary starts a new chain (its logicalParentUuid points past it in 2.1.308), so the chain goes on
// from the row written last above it, where the conversation stood. Where a parent is not in the file (a line that
// could not be read, a row of an earlier file), every row above counts, so a torn line hides no prompt.
function liveBranch(rows: readonly Row[]): ReadonlySet<string> {
  const index = new Map(rows.map((row, i) => [row.uuid, i]))
  const live = new Set<string>()
  let i = rows.findLastIndex(row => !row.isSidechain)
  let row = rows[i]
  while (row !== undefined && !live.has(row.uuid)) {
    live.add(row.uuid)
    const parent = row.kind === 'boundary' ? rows.slice(0, i).findLastIndex(above => !above.isSidechain) : row.parent === undefined ? -1 : index.get(row.parent)
    if (parent === undefined) return new Set([...rows.slice(0, i).map(above => above.uuid), ...live])
    i = parent
    row = rows[i]
  }
  return live
}

// The prompts on the live branch in order, each one's turn (its time, tool calls, edited files and how it ended), and
// which prompt each reply and tool call answers: a reply places the reader under the latest prompt, but a prompt
// queued into a turn leaves the turn's details with the one that started it. A subagent's rows are passed over, and so
// is a prompt another plugin sent; one this mod (`own`) sent came from its send button, as the person's. A turn ends
// at its turn_duration row, which nearly every turn writes, or at its interruption or API error reply: such a turn
// may write none (seen in 2.1.295 to 2.1.308; 2.1.310 writes none for a turn the person stops), and one it writes
// right after is still that turn's, as is a second interruption or API error reply there. The engine's rows between
// (informational ones, a /compact boundary) leave the turn open; a machine's row, which starts the next turn, does
// not. A turn so ended with no turn_duration row takes its time from the rows' timestamps, from its prompt to the
// first row that ended it (14.06 s where the engine counted 13.92 s, 2.1.310). So the next turn adds to no listed
// prompt unless one starts it: another plugin's prompt or command, bash mode's answer, a scheduled task or a
// notification lists none.
export function historyOf(rows: readonly Row[], own: string): History {
  const live = liveBranch(rows)
  const seen = new Set<string>()
  const prompts: { uuid: string; text: string }[] = []
  const turns: Turn[] = []
  const owners: [string, number][] = []
  // By turn: when its prompt was written, and when the first interruption or API error that ended it was.
  const startsAt: (number | undefined)[] = []
  const endsAt: (number | undefined)[] = []
  let started = -1
  // The turn an interruption or an API error just ended, until its turn_duration row or a row of the next turn.
  let ending = -1
  for (const row of rows) {
    if (row.isSidechain || !live.has(row.uuid) || seen.has(row.uuid)) continue
    seen.add(row.uuid)
    if ((row.kind === 'duration' || row.kind === 'interrupt' || (row.kind === 'reply' && row.isError)) && ending !== -1) started = ending
    if (row.kind !== 'other' && row.kind !== 'boundary') ending = -1
    const turn = turns[started]
    if ((row.kind === 'prompt' || row.kind === 'queued') && (row.plugin === undefined || row.plugin === own)) {
      prompts.push({ uuid: row.uuid, text: row.text })
      turns.push(emptyTurn())
      startsAt.push(row.kind === 'prompt' ? row.at : undefined)
      if (row.kind === 'prompt') started = prompts.length - 1
    } else if (turn !== undefined && row.kind === 'reply') {
      const owner = prompts.length - 1
      owners.push([row.uuid, owner], ...row.uses.map((use): [string, number] => [use.id, owner]))
      turns[started] = { ...withUses(turn, row.uses), ...(row.isError ? { outcome: 'error' as const } : {}) }
      if (row.isError) {
        endsAt[started] = endsAt[started] ?? row.at
        ending = started
        started = -1
      }
    } else if (turn !== undefined && row.kind === 'duration') {
      turns[started] = { ...turn, durationMs: (turn.durationMs ?? 0) + row.ms }
      started = -1
    } else if (turn !== undefined && row.kind === 'interrupt') {
      turns[started] = { ...turn, outcome: 'interrupted' }
      endsAt[started] = endsAt[started] ?? row.at
      ending = started
      started = -1
    }
  }
  // Only once every row is read: a turn_duration row may still follow the row that ended its turn (2.1.308), and its
  // time is the engine's own.
  const timed = turns.map((turn, i) => {
    const [from, to] = [startsAt[i], endsAt[i]]
    return turn.durationMs === undefined && from !== undefined && to !== undefined && to >= from ? { ...turn, durationMs: to - from } : turn
  })
  return { prompts, turns: timed, owners, known: new Set(rows.map(row => row.uuid)), started }
}

// ---- Streaming a file over READ_CAP ----
export type StreamRequest = { argv: readonly string[]; env?: Record<string, string> }

// A Windows path, of a drive (`C:\...`).
export const isWindowsPath = (path: string): boolean => /^[a-zA-Z]:[\\/]/.test(path)
// A network location (`\\host\...`, `//host/...`): never read, whatever checked the path before (PowerShell opening a
// share would hand the host the Windows login's hash).
const isNetworkPath = (path: string): boolean => /^[\\/]{2}/.test(path)

// PowerShell copying the file to its standard output. The path reaches the script through its environment, never its
// text; the file stays shared for the engine to write; a failed read ends the script with a non-zero code.
const POWERSHELL_COPY = [
  "$ErrorActionPreference = 'Stop'",
  "$f = [IO.File]::Open($env:TOOLBELT_TRANSCRIPT, 'Open', 'Read', 'ReadWrite, Delete')",
  'try { $f.CopyTo([Console]::OpenStandardOutput()) } finally { $f.Dispose() }',
].join('; ')

// Where macOS and most Linux systems keep tail; one elsewhere is run by its name.
export const TAIL_PATH = '/usr/bin/tail'

// The command that writes the whole file to its standard output, an argument vector (no shell): `tail -c +1` (`tail`,
// TAIL_PATH where it is there), and on a Windows path, where tail is not a given, PowerShell by its full path
// (`systemRoot`, the `SystemRoot` variable). A network path throws.
export function streamRequest(path: string, systemRoot: string | undefined, tail = 'tail'): StreamRequest {
  if (isNetworkPath(path)) throw new Error('a network path is not read')
  if (!isWindowsPath(path)) return { argv: [tail, '-c', '+1', '--', path] }
  return { argv: [powershellPath(systemRoot), '-NoProfile', '-NonInteractive', '-Command', POWERSHELL_COPY], env: { TOOLBELT_TRANSCRIPT: path } }
}
