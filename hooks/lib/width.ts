// Display width in terminal cells. Never use String.length for layout.
// ponytail: Intl.Segmenter is assumed present (verified in the Claude Code 2.1.308 mod runtime);
// add a code-point fallback only if a runtime without it ever shows up.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.

type Range = readonly [number, number]

// Marks that take no room of their own.
const ZERO_WIDTH: readonly Range[] = [
  [0x0300, 0x036f], // combining diacritics
  [0x1160, 0x11ff], // Hangul medial vowels and final consonants
  [0x1ab0, 0x1aff], // combining diacritics extended
  [0x200b, 0x200f], // zero-width space, joiners, direction marks
  [0x20d0, 0x20ff], // combining marks for symbols
  [0x2060, 0x2064], // word joiner and invisible operators
  [0xfe00, 0xfe0f], // variation selectors
  [0x1f3fb, 0x1f3ff], // skin tone modifiers
]

// East Asian Wide/Fullwidth plus characters that default to emoji presentation.
const WIDE: readonly Range[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f1e6, 0x1f1ff], // regional indicators (flags)
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
  // Symbols that default to emoji presentation (Unicode Emoji_Presentation=Yes).
  // Text-default symbols such as U+2600 (sun) stay 1 cell unless followed by U+FE0F.
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
]

const ZWJ = 0x200d
const VS16 = 0xfe0f
const ELLIPSIS = '…'

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

function inRanges(codePoint: number, ranges: readonly Range[]): boolean {
  return ranges.some(([low, high]) => codePoint >= low && codePoint <= high)
}

// Width of one grapheme cluster, decided by its first code point.
function clusterCells(cluster: string): number {
  const codePoints = Array.from(cluster, ch => ch.codePointAt(0) ?? 0)
  const first = codePoints[0] ?? 0
  if (inRanges(first, ZERO_WIDTH)) return 0
  if (inRanges(first, WIDE)) return 2
  if (codePoints.includes(VS16)) return 2
  // Emoji ZWJ sequence that starts with a text-default symbol (e.g. a heart + ZWJ + fire).
  if (codePoints.includes(ZWJ) && codePoints.some(cp => inRanges(cp, WIDE))) return 2
  return 1
}

export function cellsOf(text: string): number {
  let cells = 0
  for (const { segment } of segmenter.segment(text)) cells += clusterCells(segment)
  return cells
}

// Splits text into lines of at most `max` cells, never inside a grapheme. ponytail: breaks mid-word; break at
// spaces if cards read badly.
export function wrapCells(text: string, max: number): string[] {
  if (max <= 0) return []
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const { segment } of segmenter.segment(text)) {
    const cells = clusterCells(segment)
    if (used + cells > max && line !== '') {
      lines.push(line)
      line = ''
      used = 0
    }
    line += segment
    used += cells
  }
  return line === '' ? lines : [...lines, line]
}

// Text followed by spaces up to `width` cells, so a card painted over rows hides them whole.
export const padCells = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - cellsOf(text)))

// Cuts text to at most `max` cells; when something is cut the result ends with an ellipsis.
export function truncateCells(text: string, max: number): string {
  if (max <= 0) return ''
  if (cellsOf(text) <= max) return text
  const budget = max - cellsOf(ELLIPSIS)
  let used = 0
  let kept = ''
  for (const { segment } of segmenter.segment(text)) {
    const cells = clusterCells(segment)
    if (used + cells > budget) break
    kept += segment
    used += cells
  }
  return kept + ELLIPSIS
}
