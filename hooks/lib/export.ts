// The conversation as a txt, md or html file. Pure: register.tsx reads the messages and writes the files.
import type { SessionMessage, ToolUseSummary } from 'claude-code'
import type { ExportFormat } from '../../types/index'
import type { TFn } from './i18n'
import { escapeHtml, markdownToHtml } from './markdown'
import { stripControls } from './schema'
import { utf8Bytes } from '../tools/notes'
import { withoutReminders } from '../tools/toc'

export type { ExportFormat }
// The order the status tab lists them; md is the first choice. pdf is the html page printed by a browser (pdf-run.ts).
export const EXPORT_FORMATS: readonly ExportFormat[] = ['md', 'txt', 'html', 'pdf']
// `$.fs.write` refuses more than 4 MiB a file, so a longer export goes into parts.
export const PART_BYTES_MAX = 4 * 1024 * 1024
// `$.session.messages()` returns the newest this many; a list this long may have lost older ones.
export const MESSAGES_MAX = 4096
// A tool use is its name and the first this many characters of its input.
const TOOL_CHARS_MAX = 80
// The input fields that say most about a call, tried in order before the whole input.
const TOOL_INPUT_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

export const asExportFormat = (value: unknown): ExportFormat | null =>
  EXPORT_FORMATS.find(format => format === value) ?? null

// The store's `exportLast` is `{ format }`; anything else means md, the first choice.
export const storedExportFormat = (value: unknown): ExportFormat =>
  asExportFormat(typeof value === 'object' && value !== null ? (value as Record<string, unknown>).format : undefined) ?? 'md'

// The header's words: `t` in the person's language, the session id as the file name shows it, the date written out.
export type ExportMeta = { t: TFn; lang: string; sessionId: string; date: string; isCapped: boolean }

type Part = { text: string; tools: string[] }
export type Turn = { role: 'user' | 'assistant'; parts: Part[] }

// `Bash(ls -la)`: the tool and the most telling field of its input on one line, cut to 80 characters.
export function toolLine(use: ToolUseSummary): string {
  const input: Record<string, unknown> = use.input ?? {}
  const named = TOOL_INPUT_KEYS.map(key => input[key]).find((v): v is string => typeof v === 'string')
  const raw = named ?? (Object.keys(input).length === 0 ? '' : JSON.stringify(input))
  const chars = Array.from(stripControls(cleanText(raw).replace(/\s+/g, ' ')).trim())
  const shown = chars.length > TOOL_CHARS_MAX ? `${chars.slice(0, TOOL_CHARS_MAX).join('')}…` : chars.join('')
  return `${stripControls(cleanText(use.tool))}(${shown})`
}

// Rows with no text and no tool use (a user row that only carries tool results) are left out, and rows of one role in
// a row join one turn, so a reply the transcript cut at each tool use reads as one.
// Message text ends up in files opened in terminals and browsers: terminal escape sequences, control characters other
// than newline and tab, and invisible bidirectional overrides go.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g
const UNSAFE_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g
export const cleanText = (text: string): string => text.replace(ESCAPES, '').replace(UNSAFE_CHARS, '')

// The tags the engine writes a user row of: a slash command's (its name and arguments, in either order, with its
// message), bash mode's input, and the engine's output: bash mode's and a local command's output and caveat, a task's
// notification, a hook's output.
const OUTPUT_TAGS: ReadonlySet<string> = new Set([
  'bash-stdout', 'bash-stderr', 'local-command-stdout', 'local-command-stderr', 'local-command-caveat', 'task-notification',
  'user-prompt-submit-hook',
])
const ROW_TAGS: ReadonlySet<string> = new Set(['command-name', 'command-message', 'command-args', 'bash-input', ...OUTPUT_TAGS])
const OPENING_TAG = /^<([a-z-]+)>/
// The name of the tag a row starts with, attributes and all (`<bash-stdout exit="1">`), and whether it is one of the
// engine's: a listed one, or one of a local command's or bash mode's not listed yet, a name with digits or `_` too.
const LEADING_TAG = /^<([a-z][a-z0-9_-]*)(?:\s[^>]*)?\/?>/
const isEngineTag = (tag: string): boolean => ROW_TAGS.has(tag) || /^(?:local[-_]command|bash)[-_]/.test(tag)
// A teammate's message, its sender named on the tag.
const TEAMMATE_ROW = /^<teammate-message\b[^>]*>([\s\S]*)<\/teammate-message>$/

// The bodies of a row made of the engine's tags alone, by tag, or null when anything else is in it or a tag is left
// open. A body runs to its tag's last closing tag, so output that prints the tag (a file cat'ed) stays inside it. In a
// command's row of several tags, a closing tag in the person's words can misplace a bound; that row holds no output,
// and one that no longer reads to its end goes whole.
function engineTags(text: string): ReadonlyMap<string, string> | null {
  const bodies = new Map<string, string>()
  let rest = text
  while (rest !== '') {
    const tag = OPENING_TAG.exec(rest)?.[1]
    const end = tag === undefined || !ROW_TAGS.has(tag) ? -1 : rest.lastIndexOf(`</${tag}>`)
    if (tag === undefined || end === -1) return null
    bodies.set(tag, rest.slice(tag.length + 2, end).trim())
    rest = rest.slice(end + tag.length + 3).trim()
  }
  return bodies
}

// A person's row as they typed it, without what the engine put ahead of the typed text (a reminder carrying CLAUDE.md,
// memory or a hook's context, an open artifact's view state): a slash command is its name and arguments (`/co the
// words`), bash mode's input `! ls`, a teammate's message its words. A row of the engine's own (a command's or bash
// mode's output, a notification) is no one's words: null, and any row with an output tag in it is one, as output that
// prints the tags can read as a command. So is a row that starts with one of its tags but does not read as them: it may
// be output, and the export keeps out what it cannot tell apart.
function userText(text: string): string | null {
  const typed = cleanText(withoutReminders(text)).trim()
  const tags = typed === '' ? null : engineTags(typed)
  if (tags === null && isEngineTag(LEADING_TAG.exec(typed)?.[1] ?? '')) return null
  if (tags === null) return TEAMMATE_ROW.exec(typed)?.[1]?.trim() ?? typed
  if ([...tags.keys()].some(tag => OUTPUT_TAGS.has(tag))) return null
  const name = tags.get('command-name')
  if (name !== undefined) return `${name} ${tags.get('command-args') ?? ''}`.trim()
  const input = tags.get('bash-input')
  return input === undefined ? null : `! ${input}`
}

// A row the engine wrote alone is left out, and the rows around it stay apart: the reply to a notification is not
// joined to the one before it.
export function turnsOf(messages: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  let isApart = false
  for (const message of messages) {
    const text = message.role === 'user' ? userText(message.text) : cleanText(message.text).trim()
    if (text === null) {
      isApart = true
      continue
    }
    const part = { text, tools: message.toolUses.map(toolLine) }
    if (part.text === '' && part.tools.length === 0) continue
    const role = message.role === 'user' ? 'user' : 'assistant'
    const last = turns[turns.length - 1]
    if (last?.role === role && !isApart) turns[turns.length - 1] = { role, parts: [...last.parts, part] }
    else turns.push({ role, parts: [part] })
    isApart = false
  }
  return turns
}

type Renderer = {
  head: (meta: ExportMeta) => string
  turn: (turn: Turn, meta: ExportMeta) => string
  // One file from its blocks; a part after the first says which part it is.
  wrap: (body: string, meta: ExportMeta, part: number) => string
  separator: string
}

const roleName = (turn: Turn, t: TFn): string => t(turn.role === 'user' ? 'export.user' : 'export.assistant')
const title = (meta: ExportMeta): string => meta.t('export.title', { id: meta.sessionId })
const headLines = (meta: ExportMeta): string[] => [
  meta.t('export.date', { date: meta.date }),
  ...(meta.isCapped ? [meta.t('export.capped', { n: MESSAGES_MAX.toLocaleString('en-US') })] : []),
]
const plainWrap = (body: string, meta: ExportMeta, part: number): string => `${part > 1 ? `${meta.t('export.part', { n: part })}\n\n` : ''}${body}\n`

// A code span that holds any text: one backtick more than the longest run inside.
function codeSpan(text: string): string {
  const fence = '`'.repeat(Math.max(0, ...Array.from(text.matchAll(/`+/g), m => m[0].length)) + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

const txt: Renderer = {
  head: meta => [title(meta), ...headLines(meta)].join('\n'),
  turn: (turn, meta) =>
    [`[${roleName(turn, meta.t)}]`, ...turn.parts.flatMap(p => [...(p.text === '' ? [] : [p.text]), ...p.tools.map(line => `  · ${line}`)])].join('\n'),
  wrap: plainWrap,
  separator: '\n\n',
}

const mdTools = (tools: readonly string[], t: TFn): string[] =>
  tools.length === 0 ? [] : [`<details>\n<summary>${t('export.tools', { n: tools.length })}</summary>\n\n${tools.map(line => `- ${codeSpan(line)}`).join('\n')}\n\n</details>`]

const md: Renderer = {
  head: meta => [`# ${title(meta)}`, ...headLines(meta)].join('\n\n'),
  turn: (turn, meta) =>
    [`## ${roleName(turn, meta.t)}`, ...turn.parts.flatMap(p => [...(p.text === '' ? [] : [p.text]), ...mdTools(p.tools, meta.t)])].join('\n\n'),
  wrap: plainWrap,
  separator: '\n\n',
}

// Every text the conversation brings is escaped or goes through markdownToHtml, which escapes it as well.
const htmlTools = (tools: readonly string[], t: TFn): string =>
  tools.length === 0
    ? ''
    : `<details class="tools"><summary>${escapeHtml(t('export.tools', { n: tools.length }))}</summary><ul>${tools.map(line => `<li><code>${escapeHtml(line)}</code></li>`).join('')}</ul></details>`

const html: Renderer = {
  head: meta => `<header><h1>${escapeHtml(title(meta))}</h1>${headLines(meta).map(line => `<p class="meta">${escapeHtml(line)}</p>`).join('')}</header>`,
  turn: (turn, meta) => {
    const parts = turn.parts.map(p => `${p.text === '' ? '' : `<div class="body">\n${markdownToHtml(p.text)}\n</div>`}${htmlTools(p.tools, meta.t)}`)
    return `<section class="turn ${turn.role === 'user' ? 'user' : 'assistant'}"><h2>${escapeHtml(roleName(turn, meta.t))}</h2>\n${parts.join('\n')}\n</section>`
  },
  wrap: (body, meta, part) => htmlDocument(body, meta, part),
  separator: '\n',
}

// Light and dark from the system setting; nothing is loaded from outside, and the policy lets nothing run.
const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--code:#f6f8fa;--user:#ddf4ff;--user-edge:#54aeff;--ai:#fff4ec;--ai-edge:#d97757;--link:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--code:#161b22;--user:#0f2541;--user-edge:#4493f8;--ai:#2a1d16;--ai-edge:#d97757;--link:#4493f8}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:24px 16px 64px}
header h1{font-size:1.5em;margin:0 0 4px}
.meta{color:var(--muted);margin:0 0 4px}
.turn{border-left:4px solid var(--line);border-radius:6px;padding:4px 16px 8px;margin:16px 0}
.turn.user{background:var(--user);border-left-color:var(--user-edge)}
.turn.assistant{background:var(--ai);border-left-color:var(--ai-edge)}
.turn>h2{font-size:.8em;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:8px 0 4px}
.body h1{font-size:1.4em}.body h2{font-size:1.25em}.body h3{font-size:1.1em}.body h4,.body h5,.body h6{font-size:1em}
a{color:var(--link)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:var(--code);padding:.1em .3em;border-radius:4px}
.code{margin:8px 0;border:1px solid var(--line);border-radius:6px;background:var(--code);overflow:hidden}
.code .lang{font-size:.75em;color:var(--muted);padding:2px 12px;border-bottom:1px solid var(--line)}
pre{margin:0;padding:12px;overflow-x:auto}
pre code{background:none;padding:0;white-space:pre}
blockquote{margin:8px 0;padding:0 12px;border-left:4px solid var(--line);color:var(--muted)}
.table{overflow-x:auto}
table{border-collapse:collapse;margin:8px 0}
th,td{border:1px solid var(--line);padding:4px 10px}
.a-l{text-align:left}.a-c{text-align:center}.a-r{text-align:right}
hr{border:0;border-top:1px solid var(--line)}
li>p{margin:0}
.tools{color:var(--muted);font-size:.9em;margin:8px 0}
.tools ul{margin:4px 0;padding-left:20px}`

function htmlDocument(body: string, meta: ExportMeta, part: number): string {
  const partName = part > 1 ? meta.t('export.part', { n: part }) : ''
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(meta.lang)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    `<title>${escapeHtml(partName === '' ? title(meta) : `${title(meta)} (${partName})`)}</title>`,
    `<style>\n${CSS}\n</style>`,
    '</head>',
    '<body>',
    '<main>',
    ...(partName === '' ? [] : [`<p class="meta">${escapeHtml(partName)}</p>`]),
    body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

const RENDERERS: Readonly<Record<Exclude<ExportFormat, 'pdf'>, Renderer>> = { txt, md, html }

// Halves at a line break when one sits in the middle half, else at the middle (never inside a surrogate pair).
function halves(text: string): [string, string] {
  const middle = Math.floor(text.length / 2)
  const cut = text.lastIndexOf('\n', middle)
  let at = cut > text.length / 4 ? cut : middle
  const code = text.charCodeAt(at - 1)
  if (code >= 0xd800 && code <= 0xdbff) at += 1
  return [text.slice(0, at), text.slice(at).replace(/^\n/, '')]
}

// A turn too big for one file becomes smaller turns of the same role: its parts in two, or one part's text or tool
// list in two, until each fits. ponytail: a cut inside a fenced code block shows the rest of it as plain text in
// md and html; cut at fences if that matters.
function fit(turn: Turn, r: Renderer, meta: ExportMeta, room: number): string[] {
  const block = r.turn(turn, meta)
  if (utf8Bytes(block) <= room) return [block]
  const [first, ...rest] = turn.parts
  if (first === undefined) return [block]
  if (rest.length > 0) {
    const half = Math.ceil(turn.parts.length / 2)
    return [...fit({ ...turn, parts: turn.parts.slice(0, half) }, r, meta, room), ...fit({ ...turn, parts: turn.parts.slice(half) }, r, meta, room)]
  }
  if (first.tools.length > 0 && first.text !== '') {
    return [...fit({ ...turn, parts: [{ text: first.text, tools: [] }] }, r, meta, room), ...fit({ ...turn, parts: [{ text: '', tools: first.tools }] }, r, meta, room)]
  }
  if (first.tools.length > 1) {
    const half = Math.ceil(first.tools.length / 2)
    return [...fit({ ...turn, parts: [{ text: '', tools: first.tools.slice(0, half) }] }, r, meta, room), ...fit({ ...turn, parts: [{ text: '', tools: first.tools.slice(half) }] }, r, meta, room)]
  }
  if (first.text.length < 2) return [block]
  return halves(first.text).flatMap(text => fit({ ...turn, parts: [{ text, tools: [] }] }, r, meta, room))
}

// Blocks into files in order, each file as full as the room lets it be.
function pack(blocks: readonly string[], separator: string, room: number): string[] {
  const files: string[][] = []
  let size = 0
  for (const block of blocks) {
    const bytes = utf8Bytes(block) + utf8Bytes(separator)
    const current = files[files.length - 1]
    if (current === undefined || (current.length > 0 && size + bytes > room)) {
      files.push([block])
      size = bytes
    } else {
      current.push(block)
      size += bytes
    }
  }
  return files.map(file => file.join(separator))
}

// The files' texts, one per part, each a whole document under `limit` bytes; none when nothing was said yet.
export function exportParts(messages: readonly SessionMessage[], format: ExportFormat, meta: ExportMeta, limit = PART_BYTES_MAX): string[] {
  const r = RENDERERS[format === 'pdf' ? 'html' : format]
  const turns = turnsOf(messages)
  if (turns.length === 0) return []
  // The widest wrapper a part can get: the part number is never 6 digits.
  const room = limit - utf8Bytes(r.wrap('', meta, 99_999))
  const blocks = [r.head(meta), ...turns.flatMap(turn => fit(turn, r, meta, room))]
  return pack(blocks, r.separator, room).map((body, k) => r.wrap(body, meta, k + 1))
}

// `claude-session-<first 8 of the id>-<YYYYMMDD-HHmm>`. Only letters, digits, `_` and `-` of the id are kept, so the
// name can never leave the folder.
export function exportBaseName(sessionId: string, stamp: string): string {
  const id = sessionId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8)
  return `claude-session-${id === '' ? 'unknown' : id}-${stamp}`
}

// A copy after the first adds `-2`, `-3`, … so nothing is written over; a part after the first adds `-part2`, ….
export const exportFileName = (base: string, format: ExportFormat, copy: number, part: number): string =>
  `${base}${copy > 1 ? `-${copy}` : ''}${part > 1 ? `-part${part}` : ''}.${format}`
