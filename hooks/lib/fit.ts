// Band width fitting. Pure: callers pass label widths measured with cellsOf().

export type FitSide = 'left' | 'right'
export type FitSize = 'long' | 'short'

export type FitItem = {
  id: string
  side: FitSide
  order: number
  priority: number
  longCells: number
  shortCells: number
  // Right side: user buttons and tools are told apart by a dim mark where one group meets the other.
  group?: 'user' | 'tool'
}

export type FitGaps = { left: number; right: number; between: number }

export type FitInput = {
  bodyColumns: number
  // Visible items only: hidden and unavailable tools are already left out.
  items: readonly FitItem[]
  moreCells: number
  gaps?: FitGaps
}

export type FitResult = {
  size: FitSize
  left: string[]
  right: string[]
  hasMore: boolean
}

export const DEFAULT_GAPS: FitGaps = { left: 2, right: 1, between: 1 }
// The mark between two groups on the right and the gap after it.
export const GROUP_MARK_CELLS = 2

// Where the group changes between neighbours; `…` takes the group before it, so it adds no mark.
export const groupBreaks = (groups: readonly (string | undefined)[]): number => groups.slice(1).filter((group, i) => group !== groups[i]).length
export const MIN_BODY_COLUMNS = 12

// Items of one side in display order; equal orders keep their input order.
function sideItems(items: readonly FitItem[], side: FitSide): FitItem[] {
  return items.filter(item => item.side === side).sort((a, b) => a.order - b.order)
}

// Hide order: biggest priority number first; on a tie, the one nearest the right end of the band
// first. Display order runs left side then right side, so reversing it puts the right end first
// and the stable sort keeps that order among equal priorities.
function hideOrder(left: readonly FitItem[], right: readonly FitItem[]): FitItem[] {
  return [...left, ...right].reverse().sort((a, b) => b.priority - a.priority)
}

function rowWidth(cells: readonly number[], gap: number): number {
  return cells.reduce((sum, c) => sum + c, 0) + gap * Math.max(0, cells.length - 1)
}

function tryFit(
  input: FitInput,
  left: readonly FitItem[],
  right: readonly FitItem[],
  size: FitSize,
  hasMore: boolean,
): FitResult | null {
  const gaps = input.gaps ?? DEFAULT_GAPS
  const cells = (item: FitItem) => (size === 'long' ? item.longCells : item.shortCells)
  const rightCells = [...right.map(cells), ...(hasMore ? [input.moreCells] : [])]
  const leftCells = left.map(cells)
  const between = leftCells.length > 0 && rightCells.length > 0 ? gaps.between : 0
  const marks = groupBreaks(right.map(item => item.group)) * GROUP_MARK_CELLS
  const total = rowWidth(leftCells, gaps.left) + between + rowWidth(rightCells, gaps.right) + marks
  if (total > input.bodyColumns) return null
  return { size, left: left.map(i => i.id), right: right.map(i => i.id), hasMore }
}

// Returns what to draw, or null when the band should yield and draw nothing.
export function fitBand(input: FitInput): FitResult | null {
  if (input.bodyColumns < MIN_BODY_COLUMNS) return null
  const left = sideItems(input.items, 'left')
  const right = sideItems(input.items, 'right')
  for (const size of ['long', 'short'] as const) {
    const fitted = tryFit(input, left, right, size, false)
    if (fitted) return fitted
  }
  const order = hideOrder(left, right)
  for (let count = 1; count <= order.length; count++) {
    const hidden = new Set(order.slice(0, count))
    const fitted = tryFit(
      input,
      left.filter(i => !hidden.has(i)),
      right.filter(i => !hidden.has(i)),
      'short',
      true,
    )
    if (fitted) return fitted
  }
  return null
}
