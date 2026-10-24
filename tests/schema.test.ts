import { test, expect } from 'claude-code/testing'
import {
  CURRENT_SCHEMA,
  DEFAULT_REVIEW_TEXT,
  cleanButtonConfig,
  defaultButtons,
  defaultLayout,
  isNewerSchema,
  migrate,
  planLoad,
  stripControls,
} from '../hooks/lib/schema'

test('the current schema is 1', () => {
  expect(CURRENT_SCHEMA).toBe(1)
})

test('default buttons: two examples in the default set', () => {
  expect(defaultButtons()).toEqual({
    version: 1,
    sets: {
      default: [
        { id: 'ex-review', kind: 'prompt', label: 'Review', text: DEFAULT_REVIEW_TEXT, mode: 'fill' },
        { id: 'ex-usage', kind: 'command', label: '/usage', command: 'usage', mode: 'run' },
      ],
    },
    activeSet: 'default',
  })
})

test('default buttons take a localized prompt text', () => {
  const text = defaultButtons('방금 바꾼 내용을 검토하고 위험을 알려 줘.').sets['default']?.[0]?.text
  expect(text).toBe('방금 바꾼 내용을 검토하고 위험을 알려 줘.')
})

test('default buttons are a fresh object every call', () => {
  const first = defaultButtons()
  first.sets['default']?.pop()
  expect(defaultButtons().sets['default']).toHaveLength(2)
})

test('default layout: clock, date, weather, pomodoro on the left, my buttons then the tools on the right', () => {
  expect(defaultLayout()).toEqual({
    left: ['clock', 'date', 'weather', 'pomodoro'],
    right: [
      'btn:ex-review',
      'btn:ex-usage',
      'attach',
      'voice',
      'theme',
      'curtain',
      'export',
      'notes',
      'edit',
    ],
    hidden: [],
  })
})

test('default layout never lists more', () => {
  const layout = defaultLayout()
  expect([...layout.left, ...layout.right, ...layout.hidden]).not.toContain('more')
})

test('default layout follows the active set of the given buttons', () => {
  const buttons = {
    version: 1 as const,
    sets: {
      default: [{ id: 'a', kind: 'prompt' as const, label: 'A', text: 'x', mode: 'fill' as const }],
      work: [
        { id: 'b', kind: 'prompt' as const, label: 'B', text: 'y', mode: 'fill' as const },
        { id: 'c', kind: 'skill' as const, label: 'C', command: 'c', mode: 'run' as const },
      ],
    },
    activeSet: 'work',
  }
  expect(defaultLayout(buttons).right.slice(0, 3)).toEqual(['btn:b', 'btn:c', 'attach'])
})

test('default layout is a fresh object every call', () => {
  const first = defaultLayout()
  first.left.push('x')
  expect(defaultLayout().left).toHaveLength(4)
})

test('migrate v0 with nothing stored gives the v1 defaults', () => {
  const expected = {
    schemaVersion: 1,
    buttons: defaultButtons(),
    layout: defaultLayout(),
  }
  expect(migrate(undefined, 0)).toEqual(expected)
  expect(migrate(null, 0)).toEqual(expected)
  expect(migrate({}, 0)).toEqual(expected)
})

test('migrate v0 keeps stored buttons and layout that already have the v1 shape', () => {
  const buttons = {
    version: 1,
    sets: { default: [{ id: 'mine', kind: 'prompt', label: 'Mine', text: 'hi', mode: 'send' }] },
    activeSet: 'default',
  }
  const layout = { left: ['clock'], right: ['btn:mine', 'edit'], hidden: ['weather'] }
  expect(migrate({ buttons, layout }, 0)).toEqual({ schemaVersion: 1, buttons, layout })
})

test('migrate v0 replaces malformed stored values with defaults', () => {
  const broken = {
    buttons: { version: 1, sets: {}, activeSet: 'gone' },
    layout: { left: 'clock', right: [], hidden: [] },
  }
  expect(migrate(broken, 0)).toEqual(migrate(undefined, 0))
  expect(migrate({ buttons: { version: 1, sets: { toString: [] }, activeSet: 'valueOf' } }, 0)).toEqual(
    migrate(undefined, 0),
  )
})

test('migrate v0 builds the default layout from the kept buttons', () => {
  const buttons = {
    version: 1,
    sets: { default: [{ id: 'mine', kind: 'command', label: '/x', command: 'x', mode: 'run' }] },
    activeSet: 'default',
  }
  expect(migrate({ buttons }, 0).layout.right.slice(0, 2)).toEqual(['btn:mine', 'attach'])
})

test('migrate refuses versions it has no step for', () => {
  expect(() => migrate({}, 1)).toThrow(RangeError)
  expect(() => migrate({}, 2)).toThrow('schema version 2')
  expect(() => migrate({}, -1)).toThrow(RangeError)
})

test('isNewerSchema detects a store written by a newer version', () => {
  expect(isNewerSchema(2)).toBe(true)
  expect(isNewerSchema(99)).toBe(true)
  expect(isNewerSchema(1)).toBe(false)
  expect(isNewerSchema(0)).toBe(false)
  expect(isNewerSchema(undefined)).toBe(false)
  expect(isNewerSchema('2')).toBe(false)
})

const withButtons = (list: unknown[]) => ({ version: 1, activeSet: 'default', sets: { default: list } })
const LINE_SEPARATOR = String.fromCodePoint(0x2028)

test('stripControls removes control characters and line separators only', () => {
  expect(stripControls(`Line1\nLine2\tx\r${LINE_SEPARATOR}y`)).toBe('Line1Line2xy')
  expect(stripControls('리뷰 ✓ ok')).toBe('리뷰 ✓ ok')
})

// Security: the invisible characters that reorder or hide text go; the joiner inside an emoji stays.
test('stripControls removes bidi marks, overrides and isolates, the BOM and tag characters, and keeps a joined emoji', () => {
  const at = (...codes: number[]): string => String.fromCodePoint(...codes)
  expect(stripControls(`invoice${at(0x202e)}fdp.exe`)).toBe('invoicefdp.exe')
  expect(stripControls(`a${at(0x2066)}b${at(0x2069)}c`)).toBe('abc')
  for (const code of [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x2067, 0x2068, 0xfeff, 0xe0000, 0xe0041, 0xe007f]) {
    expect(stripControls(`x${at(code)}y`)).toBe('xy')
  }
  const family = at(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)
  expect(stripControls(family)).toBe(family)
  // A subdivision flag is spelled with tag characters: it is left a black flag.
  expect(stripControls(at(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f))).toBe(at(0x1f3f4))
})

test('cleanButtonConfig drops bad optional fields and cleans labels, keeping good ones', () => {
  const cleaned = cleanButtonConfig(withButtons([
    { id: 'a', kind: 'prompt', label: 'A\nB', text: 5, mode: 'fill', hotkey: 'AB', extra: true },
    { id: 'b', kind: 'command', label: 'B', command: 'usage', args: ['x'], mode: 'run', hotkey: '1' },
    { id: 'c', kind: 'skill', label: 'C', command: 7, mode: 'run', hotkey: '' },
    { id: 'd', kind: 'prompt', label: 'D', text: 'Hi', mode: 'send', hotkey: 'k' },
  ]))
  expect(cleaned?.sets.default).toEqual([
    { id: 'a', kind: 'prompt', label: 'AB', mode: 'fill' },
    { id: 'b', kind: 'command', label: 'B', command: 'usage', mode: 'run' },
    { id: 'c', kind: 'skill', label: 'C', mode: 'run' },
    { id: 'd', kind: 'prompt', label: 'D', text: 'Hi', mode: 'send', hotkey: 'k' },
  ])
  expect(cleanButtonConfig({ version: 1, activeSet: 'x', sets: {} })).toBeNull()
  expect(migrate({ buttons: withButtons([{ id: 'a', kind: 'prompt', label: 'A', mode: 'fill', hotkey: 'Z' }]) }, 0).buttons.sets.default)
    .toEqual([{ id: 'a', kind: 'prompt', label: 'A', mode: 'fill' }])
})

test('planLoad writes only when every read worked and the store is older', () => {
  const read = (value: unknown) => ({ isRead: true, value })
  const failed = { isRead: false, value: undefined }
  const mine = withButtons([{ id: 'mine', kind: 'prompt', label: 'Mine', text: 'x', mode: 'fill' }])
  const fresh = defaultButtons()
  expect(planLoad(read(undefined), read(undefined), read(undefined), fresh, false)).toMatchObject({ shouldWrite: true, isReadOnly: false })
  expect(planLoad(read(1), read(mine), read(undefined), fresh, false).shouldWrite).toBe(false)
  for (const reads of [[failed, read(mine), read(undefined)], [read(undefined), failed, read(undefined)], [read(undefined), read(mine), failed]] as const) {
    expect(planLoad(reads[0], reads[1], reads[2], fresh, false).shouldWrite).toBe(false)
  }
  // What was read is still used; what failed falls back to defaults in memory only.
  expect(planLoad(failed, read(mine), failed, fresh, false).snapshot.buttons.sets.default?.[0]?.id).toBe('mine')
  expect(planLoad(read(2), read(mine), read(undefined), fresh, false)).toMatchObject({ isReadOnly: true, shouldWrite: false })
  expect(planLoad(failed, read(mine), read(undefined), fresh, true).isReadOnly).toBe(true)
})

// Regression: stored buttons too broken to read came back as the English examples, not the person's language.
test('planLoad puts the new-install buttons in the person\'s language where the stored ones are too broken to read', () => {
  const read = (value: unknown) => ({ isRead: true, value })
  const fresh = defaultButtons('Bitte prüfe das.', 'Prüfen')
  for (const broken of [{ version: 1, sets: 'none' }, 'buttons', 42]) {
    expect(planLoad(read(1), read(broken), read(undefined), fresh, false).snapshot.buttons).toEqual(fresh)
  }
})

test('cleanButtonConfig cleans set names as a new set\'s are, and two that become one keep both sets\' buttons', () => {
  const a = { id: 'a', kind: 'prompt', label: 'A', mode: 'fill' }
  const b = { id: 'b', kind: 'prompt', label: 'B', mode: 'fill' }
  const cleaned = cleanButtonConfig({ version: 1, activeSet: 'Work\u001b[31m', sets: { default: [], 'Work\u001b[31m': [a], ' Work ': [b], '\u0007': [] } })
  expect(cleaned?.sets).toEqual({ default: [], 'Work[31m': [a], Work: [b] })
  expect(cleaned?.activeSet).toBe('Work[31m')
  const lost = cleanButtonConfig({ version: 1, activeSet: '\u0007', sets: { '\u0007': [a] } })
  expect(lost).toEqual({ version: 1, sets: { default: [] }, activeSet: 'default' })
})

test('a stored command, its prompt and a prompt text lose control characters; the text keeps its lines and tabs', () => {
  const button = { id: 'x', kind: 'command', label: 'X', mode: 'run', command: 'dep\u001b]8;;http://a\u0007loy', args: 'now‮', text: 'one\n\ttwo\u001b[2J' }
  const cleaned = cleanButtonConfig({ version: 1, activeSet: 'default', sets: { default: [button] } })
  expect(cleaned?.sets.default?.[0]).toMatchObject({ command: 'dep]8;;http://aloy', args: 'now', text: 'one\n\ttwo[2J' })
})
