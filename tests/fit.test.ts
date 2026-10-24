import { test, expect } from 'claude-code/testing'
import { cellsOf, truncateCells } from '../hooks/lib/width'
import { fitBand, groupBreaks, type FitItem } from '../hooks/lib/fit'

const MORE = 5

function item(
  id: string,
  side: 'left' | 'right',
  order: number,
  priority: number,
  longCells: number,
  shortCells: number,
): FitItem {
  return { id, side, order, priority, longCells, shortCells }
}

// The default layout with hand-picked widths (cells): [long, short].
// left gaps 2, right gaps 1, at least 1 cell between the sides, `more` is 5 cells.
const defaults: FitItem[] = [
  item('clock', 'left', 0, 2, 8, 8),
  item('weather', 'left', 1, 8, 14, 6),
  item('pomodoro', 'left', 2, 2, 9, 8),
  item('btn:ex-review', 'right', 0, 5, 10, 6),
  item('btn:ex-usage', 'right', 1, 5, 10, 6),
  item('attach', 'right', 2, 4, 10, 4),
  item('voice', 'right', 3, 7, 10, 4),
  item('theme', 'right', 4, 7, 10, 4),
  item('curtain', 'right', 5, 6, 10, 4),
  item('export', 'right', 6, 7, 10, 4),
  item('notes', 'right', 7, 7, 10, 4),
  item('dnd', 'right', 8, 6, 10, 4),
  item('edit', 'right', 9, 3, 10, 4),
]

const fit = (bodyColumns: number, items: FitItem[] = defaults) =>
  fitBand({ bodyColumns, items, moreCells: MORE })

const allIds = (items: FitItem[], side: 'left' | 'right') =>
  items.filter(i => i.side === side).map(i => i.id)

test('258 columns: everything with long labels, no more button', () => {
  // left 8+14+9 + 2*2 = 35, right 10*10 + 9 = 109, between 1 -> 145
  expect(fit(258)).toEqual({
    size: 'long',
    left: allIds(defaults, 'left'),
    right: allIds(defaults, 'right'),
    hasMore: false,
  })
})

test('119 columns: short labels, everything still visible', () => {
  // short: left 8+6+8 + 4 = 26, right 2*6 + 8*4 + 9 = 53, between 1 -> 80
  expect(fit(119)).toEqual({
    size: 'short',
    left: allIds(defaults, 'left'),
    right: allIds(defaults, 'right'),
    hasMore: false,
  })
})

test('80 columns is the last width where the short form shows everything', () => {
  expect(fit(80)?.hasMore).toBe(false)
  expect(fit(79)?.hasMore).toBe(true)
})

test('79 columns: weather goes first (priority 8) and more appears', () => {
  // left 8+8+2 = 18, right 10 items + more = 44+5 + 10 gaps = 59, between 1 -> 78
  expect(fit(79)).toEqual({
    size: 'short',
    left: ['clock', 'pomodoro'],
    right: allIds(defaults, 'right'),
    hasMore: true,
  })
})

test('49 columns: priority 7, 6 and 5 buttons are hidden, in tie order', () => {
  // hidden: weather, then notes, export, theme, voice (7s, right end first), dnd, curtain (6s)
  // left 18, right review+usage+attach+edit+more = 6+6+4+4+5 + 4 gaps = 29, between 1 -> 48
  expect(fit(49)).toEqual({
    size: 'short',
    left: ['clock', 'pomodoro'],
    right: ['btn:ex-review', 'btn:ex-usage', 'attach', 'edit'],
    hasMore: true,
  })
})

test('13 columns: only more fits, 14 columns: the clock fits beside it', () => {
  expect(fit(13)).toEqual({ size: 'short', left: [], right: [], hasMore: true })
  // clock 8 + between 1 + more 5 = 14
  expect(fit(14)).toEqual({ size: 'short', left: ['clock'], right: [], hasMore: true })
})

test('12 columns still draws the more button, 11 columns yields', () => {
  expect(fit(12)).toEqual({ size: 'short', left: [], right: [], hasMore: true })
  expect(fit(11)).toBeNull()
  expect(fit(0)).toBeNull()
})

test('a band that cannot fit even the more button yields', () => {
  expect(fitBand({ bodyColumns: 12, items: defaults, moreCells: 13 })).toBeNull()
})

test('total width equal to bodyColumns fits, one more cell does not', () => {
  const items = [item('a', 'left', 0, 2, 10, 10), item('b', 'right', 0, 5, 10, 10)]
  expect(fit(21, items)).toEqual({ size: 'long', left: ['a'], right: ['b'], hasMore: false })
  expect(fit(20, items)).toEqual({ size: 'short', left: ['a'], right: [], hasMore: true })
})

test('one side empty needs no gap between the sides', () => {
  const items = [item('a', 'left', 0, 2, 12, 12)]
  expect(fit(12, items)).toEqual({ size: 'long', left: ['a'], right: [], hasMore: false })
})

test('no items: an empty band that fits', () => {
  expect(fit(80, [])).toEqual({ size: 'long', left: [], right: [], hasMore: false })
})

test('input order does not matter, display order follows `order`', () => {
  const shuffled = [...defaults].reverse()
  expect(fit(258, shuffled)).toEqual(fit(258))
})

test('custom gaps are used', () => {
  const items = [item('a', 'left', 0, 2, 5, 5), item('b', 'left', 1, 2, 5, 5)]
  const base = { bodyColumns: 16, items, moreCells: MORE }
  expect(fitBand({ ...base, gaps: { left: 10, right: 1, between: 1 } })?.hasMore).toBe(true)
  expect(fitBand({ ...base, gaps: { left: 0, right: 0, between: 0 } })?.hasMore).toBe(false)
})

test('Korean labels count double and tip the band into the short form earlier', () => {
  const button = (id: string, label: string) =>
    item(
      id,
      'right',
      0,
      5,
      cellsOf(`[ ${label} ]`),
      cellsOf(`[ ${truncateCells(label, 4)} ]`),
    )
  const clock = item('clock', 'left', 0, 2, 8, 8)
  const ascii = [clock, button('btn:a', 'Review changes')] // long: 8 + 1 + 18 = 27
  const korean = [clock, button('btn:a', '변경사항 검토하기')] // long: 8 + 1 + 21 = 30
  expect(cellsOf('[ 변경사항 검토하기 ]')).toBe(21)
  expect(fit(28, ascii)?.size).toBe('long')
  expect(fit(28, korean)?.size).toBe('short')
  expect(fit(28, korean)?.hasMore).toBe(false)
})

// Four items with the same priority and width. Hide order must be right end first:
// right side from its last item, then the left side from its last item.
test('equal priorities hide from the right end of the band', () => {
  const tied = [
    item('L0', 'left', 0, 5, 10, 10),
    item('L1', 'left', 1, 5, 10, 10),
    item('R0', 'right', 0, 5, 10, 10),
    item('R1', 'right', 1, 5, 10, 10),
  ]
  // all: left 22 + 1 + right 21 = 44
  expect(fit(44, tied)).toEqual({ size: 'long', left: ['L0', 'L1'], right: ['R0', 'R1'], hasMore: false })
  // R1 hidden: left 22 + 1 + (R0 + more = 16) = 39
  expect(fit(39, tied)).toEqual({ size: 'short', left: ['L0', 'L1'], right: ['R0'], hasMore: true })
  // R0 hidden too: 22 + 1 + 5 = 28
  expect(fit(28, tied)).toEqual({ size: 'short', left: ['L0', 'L1'], right: [], hasMore: true })
  // L1 hidden: 10 + 1 + 5 = 16
  expect(fit(27, tied)).toEqual({ size: 'short', left: ['L0'], right: [], hasMore: true })
  expect(fit(16, tied)).toEqual({ size: 'short', left: ['L0'], right: [], hasMore: true })
  // L0 hidden: only more
  expect(fit(15, tied)).toEqual({ size: 'short', left: [], right: [], hasMore: true })
})

test('user layout with buttons on the left follows the same rules', () => {
  // The user moved Review to the left of the pomodoro and the clock to the right.
  const custom = [
    item('btn:ex-review', 'left', 0, 5, 10, 6),
    item('pomodoro', 'left', 1, 2, 9, 8),
    item('btn:ex-usage', 'right', 0, 5, 10, 6),
    item('clock', 'right', 1, 2, 8, 8),
    item('weather', 'right', 2, 8, 14, 6),
  ]
  // long: left 10+9+2 = 21, right 10+8+14+2 = 34, between 1 -> 56
  expect(fit(56, custom)?.size).toBe('long')
  // short: left 6+8+2 = 16, right 6+8+6+2 = 22, between 1 -> 39
  expect(fit(55, custom)).toEqual({
    size: 'short',
    left: ['btn:ex-review', 'pomodoro'],
    right: ['btn:ex-usage', 'clock', 'weather'],
    hasMore: false,
  })
  // weather (priority 8) is hidden first wherever it sits: left 16 + 1 + (6+8+5 + 2 = 21) = 38
  expect(fit(38, custom)).toEqual({
    size: 'short',
    left: ['btn:ex-review', 'pomodoro'],
    right: ['btn:ex-usage', 'clock'],
    hasMore: true,
  })
  // priority 5 tie: usage (right side) goes before review (left side), then the 2s are the last
  // left: 16, right: clock + more = 8+5+1 = 14 -> hidden usage gives 16 + 1 + 14 = 31
  expect(fit(31, custom)).toEqual({
    size: 'short',
    left: ['btn:ex-review', 'pomodoro'],
    right: ['clock'],
    hasMore: true,
  })
  // review hidden next: left pomodoro 8 + 1 + 14 = 23
  expect(fit(23, custom)).toEqual({
    size: 'short',
    left: ['pomodoro'],
    right: ['clock'],
    hasMore: true,
  })
  // equal priority 2: clock (right side) is hidden before pomodoro (left side)
  expect(fit(14, custom)).toEqual({ size: 'short', left: ['pomodoro'], right: [], hasMore: true })
})

test('a mark between my buttons and the tools takes two cells; … adds none', () => {
  const items = [
    { id: 'a', side: 'right', order: 0, priority: 5, longCells: 10, shortCells: 10, group: 'user' },
    { id: 'b', side: 'right', order: 1, priority: 5, longCells: 10, shortCells: 10, group: 'tool' },
  ] as const
  expect(fitBand({ bodyColumns: 23, items, moreCells: 3 })?.right).toEqual(['a', 'b'])
  expect(fitBand({ bodyColumns: 22, items, moreCells: 3 })?.right).toEqual(['a'])
  expect(groupBreaks(['user', 'tool', 'tool', 'user'])).toBe(2)
})
