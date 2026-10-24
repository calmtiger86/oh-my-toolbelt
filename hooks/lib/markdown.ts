// Markdown to HTML for the html export. Pure, and written here because a module may import only the plugin's own files
// and `claude-code`. The text is untrusted: it is parsed as it was written and every character of it is escaped as it
// goes out, so the only tags are the ones this file writes, raw HTML in the text shows as text, and a link keeps its
// href only for http, https and mailto.
import { stripControls } from './schema'

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// Safe in text and in a quoted attribute value alike.
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, ch => ESCAPES[ch] ?? ch)

// The schemes a link may open. Anything else (javascript:, data:, vbscript:, a relative path) stays text.
const SAFE_SCHEME = /^(?:https?|mailto):/i

export const safeHref = (url: string): string | null => (SAFE_SCHEME.test(url) && stripControls(url) === url ? url : null)

// Nesting this deep (quotes, lists, emphasis) is drawn as text, so no input can exhaust the stack.
const DEPTH_MAX = 8
// A longer line is escaped without inline marks: the lazy patterns below would take quadratic time on it.
const INLINE_CHARS_MAX = 5000

// One alternation, leftmost match first: code span, escaped punctuation, autolink, link (an image becomes a link,
// never an <img>), strong emphasis, strong, strikethrough, emphasis.
const INLINE = /(`+)([^`]|[^`].*?[^`])\1(?!`)|\\([!-\/:-@[-`{-~])|<((?:https?|mailto):[^\s<>]+)>|!?\[([^[\]]*)\]\(([^\s()]*)\)|\*\*\*(?=\S)(.*?\S)\*\*\*|\*\*(?=\S)(.*?\S)\*\*|~~(?=\S)(.*?\S)~~|\*(?=\S)(.*?\S)\*/gi

const anchor = (href: string, label: string): string => `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`

function token(m: RegExpMatchArray, depth: number): string {
  const [whole, , code, punct, auto, label, url, strongEm, strong, del, em] = m
  if (code !== undefined) return `<code>${escapeHtml(code)}</code>`
  if (punct !== undefined) return escapeHtml(punct)
  if (auto !== undefined || url !== undefined) {
    const href = safeHref(auto ?? url ?? '')
    return href === null ? escapeHtml(whole) : anchor(href, auto === undefined ? inline(label ?? '', depth + 1) : escapeHtml(auto))
  }
  if (strongEm !== undefined) return `<strong><em>${inline(strongEm, depth + 1)}</em></strong>`
  if (strong !== undefined) return `<strong>${inline(strong, depth + 1)}</strong>`
  if (del !== undefined) return `<del>${inline(del, depth + 1)}</del>`
  return `<em>${inline(em ?? '', depth + 1)}</em>`
}

// One line of text with its inline marks.
export function inline(text: string, depth = 0): string {
  if (depth > DEPTH_MAX || text.length > INLINE_CHARS_MAX) return escapeHtml(text)
  let out = ''
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, m.index)) + token(m, depth)
    last = (m.index ?? 0) + m[0].length
  }
  return out + escapeHtml(text.slice(last))
}

// ---- Blocks ----
type Block = { html: string; next: number }
type Lines = readonly string[]

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
// Greedy text and no lazy group before trailing whitespace: the old pattern went quadratic on a heading that ended in
// tens of thousands of spaces. The closing #s are cut in headingText.
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
const TASK = /^\[([ xX])\][ \t]+/
const DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*(?:\|[ \t]*)?$/
const ALIGN = { left: ' class="a-l"', center: ' class="a-c"', right: ' class="a-r"', none: '' } as const

const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === ''
const indentOf = (line: string): number => line.length - line.trimStart().length
const textBlock = (lines: Lines): string => `<p>${lines.map(line => escapeHtml(line)).join('<br>\n')}</p>`

function fence(lines: Lines, i: number): Block | null {
  const m = FENCE.exec(lines[i] ?? '')
  const mark = m?.[1] ?? ''
  const info = (m?.[2] ?? '').trim()
  if (m === null || (mark.startsWith('`') && info.includes('`'))) return null
  const closes = (line: string): boolean => {
    const c = FENCE.exec(line)
    return c !== null && (c[2] ?? '').trim() === '' && c[1]?.[0] === mark[0] && (c[1]?.length ?? 0) >= mark.length
  }
  let j = i + 1
  while (j < lines.length && !closes(lines[j] ?? '')) j += 1
  const lang = (info.split(/\s+/)[0] ?? '').slice(0, 32)
  const label = lang === '' ? '' : `<div class="lang">${escapeHtml(lang)}</div>`
  return { html: `<div class="code">${label}<pre><code>${escapeHtml(lines.slice(i + 1, j).join('\n'))}</code></pre></div>`, next: Math.min(j + 1, lines.length) }
}

// A heading's text without trailing blanks and without a closing run of #s, which counts only after a blank
// (`# C#` keeps its #) or when it is the whole text.
function headingText(raw: string): string {
  const text = raw.trimEnd()
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end--
  if (end === text.length || end === 0) return end === 0 ? '' : text
  const before = text[end - 1]
  return before === ' ' || before === '\t' ? text.slice(0, end).trimEnd() : text
}

function heading(lines: Lines, i: number): Block | null {
  const m = HEADING.exec(lines[i] ?? '')
  if (m === null) return null
  const level = m[1]?.length ?? 1
  return { html: `<h${level}>${inline(headingText(m[2] ?? ''))}</h${level}>`, next: i + 1 }
}

const rule = (lines: Lines, i: number): Block | null => (RULE.test(lines[i] ?? '') ? { html: '<hr>', next: i + 1 } : null)

function quote(lines: Lines, i: number, depth: number): Block | null {
  const inner: string[] = []
  let j = i
  for (let m = QUOTE.exec(lines[j] ?? ''); m !== null && j < lines.length; m = QUOTE.exec(lines[j] ?? '')) {
    inner.push(m[1] ?? '')
    j += 1
  }
  return j === i ? null : { html: `<blockquote>\n${blocks(inner, depth + 1)}\n</blockquote>`, next: j }
}

// Cells split on `|`, except an escaped `\|`, which stays in the cell as `|`.
function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1')
  const out = ['']
  for (let k = 0; k < trimmed.length; k += 1) {
    const ch = trimmed[k] ?? ''
    if (ch === '\\' && trimmed[k + 1] === '|') {
      out[out.length - 1] += '|'
      k += 1
    } else if (ch === '|') out.push('')
    else out[out.length - 1] += ch
  }
  return out.map(cell => cell.trim())
}

const isTableStart = (lines: Lines, i: number): boolean =>
  (lines[i] ?? '').includes('|') && DELIMITER.test(lines[i + 1] ?? '') && cells(lines[i] ?? '').length === cells(lines[i + 1] ?? '').length

function alignOf(cell: string): keyof typeof ALIGN {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  return left && right ? 'center' : right ? 'right' : left ? 'left' : 'none'
}

function table(lines: Lines, i: number): Block | null {
  if (!isTableStart(lines, i)) return null
  const head = cells(lines[i] ?? '')
  const aligns = cells(lines[i + 1] ?? '').map(alignOf)
  const row = (line: string, tag: 'th' | 'td'): string => {
    const own = cells(line)
    return `<tr>${head.map((_, k) => `<${tag}${ALIGN[aligns[k] ?? 'none']}>${inline(own[k] ?? '')}</${tag}>`).join('')}</tr>`
  }
  let j = i + 2
  const body: string[] = []
  while (j < lines.length && !isBlank(lines[j]) && (lines[j] ?? '').includes('|')) body.push(row(lines[j++] ?? '', 'td'))
  const tbody = body.length === 0 ? '' : `<tbody>${body.join('')}</tbody>`
  return { html: `<div class="table"><table><thead>${row(lines[i] ?? '', 'th')}</thead>${tbody}</table></div>`, next: j }
}

// A line that ends a paragraph because another block starts there.
const startsBlock = (lines: Lines, j: number): boolean => {
  const line = lines[j] ?? ''
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || (ITEM.exec(line)?.[3] ?? '') !== '' || isTableStart(lines, j)
}

function paragraph(lines: Lines, i: number): Block {
  let j = i + 1
  while (j < lines.length && !isBlank(lines[j]) && !startsBlock(lines, j)) j += 1
  return { html: `<p>${lines.slice(i, j).map(line => inline(line.trim())).join('<br>\n')}</p>`, next: j }
}

// ---- Lists: an item holds its own blocks, so a nested list or a fenced code block under an item renders too ----
type Item = { lines: string[] }

const isOrdered = (marker: string): boolean => /\d/.test(marker)

function itemOf(m: RegExpExecArray): { item: Item; width: number } {
  const text = m[3] ?? ''
  const task = TASK.exec(text)
  const width = (m[1]?.length ?? 0) + (m[2]?.length ?? 0) + 1
  const box = task === null ? '' : task[1] === ' ' ? '☐ ' : '☑ '
  return { item: { lines: [box + (task === null ? text : text.slice(task[0].length))] }, width }
}

function list(lines: Lines, i: number, depth: number): Block | null {
  const first = ITEM.exec(lines[i] ?? '')
  if (first === null || (first[1]?.length ?? 0) > 3 || (first[3] ?? '') === '') return null
  const base = first[1]?.length ?? 0
  const ordered = isOrdered(first[2] ?? '')
  const items: Item[] = []
  let width = 0
  let j = i
  while (j < lines.length) {
    const line = lines[j] ?? ''
    const m = ITEM.exec(line)
    const indent = indentOf(line)
    const current = items[items.length - 1]
    if (m !== null && indent <= base + 1 && isOrdered(m[2] ?? '') === ordered && (m[3] ?? '') !== '') {
      const next = itemOf(m)
      items.push(next.item)
      width = next.width
    } else if (current === undefined) break
    else if (isBlank(line)) {
      const after = lines[j + 1]
      if (isBlank(after) || (after !== undefined && indentOf(after) <= base && ITEM.exec(after) === null)) break
      current.lines.push('')
    } else if (indent > base || (!isBlank(lines[j - 1]) && !startsBlock(lines, j))) {
      current.lines.push(line.slice(Math.min(indent, width)))
    } else break
    j += 1
  }
  const start = Number.parseInt(first[2] ?? '1', 10)
  const open = ordered ? (start === 1 ? '<ol>' : `<ol start="${start}">`) : '<ul>'
  const body = items.map(item => `<li>${blocks(item.lines, depth + 1)}</li>`)
  return { html: `${open}\n${body.join('\n')}\n${ordered ? '</ol>' : '</ul>'}`, next: j }
}

function blocks(lines: Lines, depth: number): string {
  if (depth > DEPTH_MAX) return textBlock(lines.filter(line => !isBlank(line)))
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i += 1
      continue
    }
    const block = fence(lines, i) ?? heading(lines, i) ?? rule(lines, i) ?? quote(lines, i, depth) ?? table(lines, i) ?? list(lines, i, depth) ?? paragraph(lines, i)
    out.push(block.html)
    i = block.next
  }
  return out.join('\n')
}

// The whole text as HTML blocks: headings, paragraphs (each line break kept), emphasis, strikethrough, code spans and
// fenced code blocks (the language shown as a label), lists with nesting, quotes, tables, links and rules.
export const markdownToHtml = (source: string): string => blocks(source.replace(/\r\n?/g, '\n').split('\n'), 0)
