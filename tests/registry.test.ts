import { test, expect } from 'claude-code/testing'
import {
  LEFT_DEFAULT, RIGHT_DEFAULT, TOOLS, defaultLayout, defaultSideOf, hide, isItemShown, moveDown,
  moveToOtherSide, moveUp, normalizeLayout, priorityOf, reservedHotkeys, resetLayout, show, userButtonTool,
} from '../hooks/tools/registry'
import { DONE_SOUND, idlePomodoro } from '../hooks/tools/pomodoro'
import { addButton, removeButton } from '../hooks/tools/user'
import { makeButtons, makeCtx, promptButton } from './pure-helpers'
import type { Layout } from '../types/index'

const buttons = makeButtons()
const ctxOf = { state: { buttons } }
const DEFAULT = defaultLayout(buttons)
const snapshot = (l: Layout): string => JSON.stringify(l)

test('default layout: clock, date, weather, pomodoro on the left; my buttons, then the tools on the right', () => {
  expect(DEFAULT).toEqual({
    left: ['clock', 'date', 'weather', 'pomodoro'],
    right: ['btn:ex-review', 'btn:ex-usage', 'attach', 'voice', 'theme', 'curtain', 'export', 'notes', 'edit'],
    hidden: [],
  })
  expect(resetLayout(buttons)).toEqual(DEFAULT)
  expect(defaultLayout({ ...buttons, sets: {}, activeSet: 'default' }).right).toEqual([...RIGHT_DEFAULT])
})

test('default sides in the lists match the registry', () => {
  for (const id of LEFT_DEFAULT) expect(TOOLS[id as keyof typeof TOOLS].side).toBe('left')
  for (const id of RIGHT_DEFAULT) expect(TOOLS[id as keyof typeof TOOLS].side).toBe('right')
  expect(defaultSideOf('btn:x')).toBe('right')
  expect(defaultSideOf('pomodoro')).toBe('left')
})

test('normalizeLayout: nothing stored means the default layout', () => {
  for (const raw of [undefined, null, 'x', 5, [], {}, { left: 'no' }]) {
    expect(normalizeLayout(raw, ctxOf)).toEqual(DEFAULT)
  }
})

test('normalizeLayout keeps a valid layout as it is', () => {
  const stored: Layout = { left: ['clock', 'date', 'weather'], right: ['edit', 'btn:ex-usage', 'notes'], hidden: ['pomodoro'] }
  const out = normalizeLayout(stored, ctxOf)
  expect(out.left).toEqual(['clock', 'date', 'weather'])
  expect(out.hidden).toEqual(['pomodoro'])
  expect(out.right.slice(0, 3)).toEqual(['edit', 'btn:ex-usage', 'notes'])
})

test('normalizeLayout drops unknown ids, more, user, non-strings and unknown buttons', () => {
  const raw = { left: ['clock', 'nope', 7, null, 'more', 'user'], right: ['btn:gone', 'edit'], hidden: ['bogus', 'notes'] }
  const out = normalizeLayout(raw, ctxOf)
  expect(out.left.slice(0, 1)).toEqual(['clock'])
  for (const id of ['nope', 'more', 'user', 'btn:gone', 'bogus']) {
    expect([...out.left, ...out.right, ...out.hidden]).not.toContain(id)
  }
  expect(out.hidden).toEqual(['notes'])
})

test('normalizeLayout puts a tool missing from the list after the one before it by default, or at the end of its side', () => {
  const stored: Layout = { left: ['weather', 'pomodoro'], right: ['btn:ex-review', 'btn:ex-usage', 'edit'], hidden: [] }
  const out = normalizeLayout(stored, ctxOf)
  // The clock has none before it, so it goes to the end; the date follows the clock.
  expect(out.left).toEqual(['weather', 'pomodoro', 'clock', 'date'])
  // A layout stored before the date was a tool gets it right after the clock.
  expect(normalizeLayout({ left: ['clock', 'weather', 'pomodoro'], right: [], hidden: [] }, ctxOf).left).toEqual(['clock', 'date', 'weather', 'pomodoro'])
  // The missing right-side tools follow `edit`, in default order.
  expect(out.right).toEqual(['btn:ex-review', 'btn:ex-usage', 'edit', 'attach', 'voice', 'theme', 'curtain', 'export', 'notes'])
})

test('normalizeLayout puts a new button at the right end, after missing tools', () => {
  const next = addButton(buttons, promptButton('fresh'))
  const stored: Layout = { left: [...LEFT_DEFAULT], right: ['edit'], hidden: [] }
  const out = normalizeLayout(stored, { state: { buttons: next } })
  expect(out.right[out.right.length - 1]).toBe('btn:fresh')
  expect(out.right.indexOf('edit')).toBe(0)
})

test('normalizeLayout drops a deleted button and keeps buttons of other sets', () => {
  const stored: Layout = { left: [...LEFT_DEFAULT], right: ['btn:ex-review', 'btn:ex-usage', ...RIGHT_DEFAULT], hidden: [] }
  const removed = removeButton(buttons, 'ex-review')
  expect(normalizeLayout(stored, { state: { buttons: removed } }).right).not.toContain('btn:ex-review')
  const twoSets = { ...buttons, sets: { ...buttons.sets, work: [promptButton('w1')] } }
  const out = normalizeLayout(stored, { state: { buttons: twoSets } })
  expect(out.right).toContain('btn:w1')
  expect(out.right).toContain('btn:ex-review')
})

test('normalizeLayout removes duplicates; left wins over right wins over hidden', () => {
  const raw = { left: ['clock', 'clock', 'edit'], right: ['edit', 'export'], hidden: ['export', 'clock', 'notes'] }
  const out = normalizeLayout(raw, ctxOf)
  const all = [...out.left, ...out.right, ...out.hidden]
  expect(new Set(all).size).toBe(all.length)
  // The missing left tools land after the ones before them by default, so `edit` stays on the left after them.
  expect(out.left).toEqual(['clock', 'date', 'weather', 'pomodoro', 'edit'])
  expect(out.right[0]).toBe('export')
  expect(out.hidden).toEqual(['notes'])
})

test('normalizeLayout returns a new object and leaves the input alone', () => {
  const raw = { left: ['clock', 'x'], right: ['edit'], hidden: ['notes'] }
  const before = JSON.stringify(raw)
  const out = normalizeLayout(raw, ctxOf)
  expect(JSON.stringify(raw)).toBe(before)
  expect(out).not.toBe(raw)
  expect(out.left).not.toBe(raw.left)
})

test('moveUp and moveDown swap neighbours on one side and return new objects', () => {
  const up = moveUp(DEFAULT, 'weather')
  expect(up.left).toEqual(['clock', 'weather', 'date', 'pomodoro'])
  expect(moveDown(DEFAULT, 'clock').left).toEqual(['date', 'clock', 'weather', 'pomodoro'])
  expect(moveDown(DEFAULT, 'btn:ex-review').right.slice(0, 2)).toEqual(['btn:ex-usage', 'btn:ex-review'])
  expect(up).not.toBe(DEFAULT)
  expect(up.right).not.toBe(DEFAULT.right)
  expect(up.hidden).not.toBe(DEFAULT.hidden)
})

test('moveUp at the top and moveDown at the bottom change nothing but still return a new object', () => {
  const first = moveUp(DEFAULT, 'clock')
  const last = moveDown(DEFAULT, 'edit')
  expect(first).toEqual(DEFAULT)
  expect(last).toEqual(DEFAULT)
  expect(first).not.toBe(DEFAULT)
  expect(moveUp(DEFAULT, 'unknown')).toEqual(DEFAULT)
})

test('moveUp and moveDown skip neighbours the person cannot see', () => {
  const shown = (id: string) => !['voice', 'theme', 'curtain', 'export', 'notes'].includes(id)
  // edit sits after hidden-from-view tools; moving up must jump over them.
  const up = moveUp(DEFAULT, 'edit', shown)
  expect(up.right.indexOf('edit')).toBeLessThan(up.right.indexOf('attach'))
  const down = moveDown(DEFAULT, 'attach', shown)
  expect(down.right.indexOf('attach')).toBeGreaterThan(down.right.indexOf('edit'))
  expect(moveUp(DEFAULT, 'btn:ex-review', shown)).toEqual(DEFAULT)
})

test('moveToOtherSide sends the item to the end of the other side', () => {
  const toRight = moveToOtherSide(DEFAULT, 'clock')
  expect(toRight.left).toEqual(['date', 'weather', 'pomodoro'])
  expect(toRight.right[toRight.right.length - 1]).toBe('clock')
  const toLeft = moveToOtherSide(DEFAULT, 'btn:ex-usage')
  expect(toLeft.left[toLeft.left.length - 1]).toBe('btn:ex-usage')
  expect(toLeft.right).not.toContain('btn:ex-usage')
  expect(moveToOtherSide(DEFAULT, 'nothing')).toEqual(DEFAULT)
  expect(moveToOtherSide(DEFAULT, 'nothing')).not.toBe(DEFAULT)
})

test('hide moves an item to hidden; show brings it back to the end of its default side', () => {
  const hidden = hide(DEFAULT, 'pomodoro')
  expect(hidden.left).toEqual(['clock', 'date', 'weather'])
  expect(hidden.hidden).toEqual(['pomodoro'])
  expect(hide(hidden, 'pomodoro')).toEqual(hidden)
  // Moved to the right first, hidden there, shown again: it returns to the LEFT end (default side).
  const moved = hide(moveToOtherSide(DEFAULT, 'pomodoro'), 'pomodoro')
  expect(show(moved, 'pomodoro').left).toEqual(['clock', 'date', 'weather', 'pomodoro'])
  expect(show(moved, 'pomodoro').hidden).toEqual([])
  const button = show(hide(DEFAULT, 'btn:ex-review'), 'btn:ex-review')
  expect(button.right[button.right.length - 1]).toBe('btn:ex-review')
  expect(show(DEFAULT, 'clock')).toEqual(DEFAULT)
})

test('hide, show and reset return new objects and never touch the input', () => {
  const before = snapshot(DEFAULT)
  const results = [hide(DEFAULT, 'notes'), show(DEFAULT, 'notes'), moveToOtherSide(DEFAULT, 'notes'), resetLayout(buttons)]
  for (const out of results) {
    expect(out).not.toBe(DEFAULT)
    expect(out.left).not.toBe(DEFAULT.left)
    expect(out.right).not.toBe(DEFAULT.right)
    expect(out.hidden).not.toBe(DEFAULT.hidden)
  }
  expect(snapshot(DEFAULT)).toBe(before)
})

test('the tools that depend on something show when it holds; the rest are always available', () => {
  const ctx = makeCtx()
  // No /voice, no theme row: no voice or theme button. Attach is on by default, in a terminal only.
  for (const id of ['weather', 'voice', 'theme'] as const) expect(TOOLS[id].isAvailable(ctx)).toBe(false)
  expect([TOOLS.attach.isAvailable(makeCtx({ surface: 'terminal' })), TOOLS.attach.isAvailable(makeCtx({ surface: 'desktop' }))]).toEqual([true, false])
  expect(TOOLS.attach.isAvailable(makeCtx({ surface: 'terminal', options: { attachEnabled: false } }))).toBe(false)
  expect(TOOLS.voice.isAvailable(makeCtx({ state: { voice: { isAvailable: true, requested: null } } }))).toBe(true)
  expect(TOOLS.theme.isAvailable(makeCtx({ state: { themeRow: { value: 'dark', options: ['dark', 'light'] } } }))).toBe(true)
  // The weather tool is there once a city of the coordinate table is chosen.
  expect(TOOLS.weather.isAvailable(makeCtx({ options: { weatherPlace: 'Seoul' } }))).toBe(true)
  expect(TOOLS.weather.isAvailable(makeCtx({ options: { weatherPlace: 'off' } }))).toBe(false)
  // The curtain is always there.
  expect(TOOLS.curtain.isAvailable(ctx)).toBe(true)
  // So are the notes and export buttons, and the clock, the pomodoro, edit, more and the person's buttons.
  for (const id of ['notes', 'export', 'clock', 'pomodoro', 'edit', 'more', 'user'] as const) expect(TOOLS[id].isAvailable(ctx)).toBe(true)
  expect(TOOLS.user.isAvailable(makeCtx({ state: { buttons: { ...buttons, sets: { default: [] } } } }))).toBe(false)
})

test('the registry gives each tool its side, priority and kind', () => {
  const table = {
    more: ['right', 1, 'button'], clock: ['left', 2, 'text'], pomodoro: ['left', 2, 'button'], edit: ['right', 3, 'button'],
    attach: ['right', 4, 'button'], user: ['right', 5, 'button'], curtain: ['right', 6, 'button'],
    export: ['right', 7, 'button'], theme: ['right', 7, 'button'], voice: ['right', 7, 'button'], notes: ['right', 7, 'button'],
    weather: ['left', 8, 'text'],
  } as const
  for (const [id, [side, priority, kind]] of Object.entries(table)) {
    const tool = TOOLS[id as keyof typeof TOOLS]
    expect([tool.id, tool.side, tool.priority, tool.kind]).toEqual([id, side, priority, kind])
  }
})

test('pomodoro priority is 2 while a timer exists and 7 when idle', () => {
  const idle = makeCtx()
  const running = makeCtx({ state: { pomodoro: { ...idlePomodoro(1), phase: 'focus', endsAt: 5, remainingSec: 4 } } })
  expect(priorityOf(TOOLS.pomodoro, idle)).toBe(7)
  expect(priorityOf(TOOLS.pomodoro, running)).toBe(2)
  expect(priorityOf(TOOLS.edit, idle)).toBe(3)
})

test('fixed hotkeys are single distinct letters; hotkeysEnabled false removes them', () => {
  const letters = reservedHotkeys()
  expect(letters).toHaveLength(8)
  expect(new Set(letters).size).toBe(8)
  for (const letter of letters) expect(letter).toMatch(/^[a-z]$/)
  // The pomodoro chip has no letter (hooks/chip.tsx), so a button of the person's may take `o`.
  expect(letters).not.toContain('o')
  expect(TOOLS.pomodoro.hotkey).toBeUndefined()
  const on = makeCtx()
  const off = makeCtx({ options: { hotkeysEnabled: false } })
  expect(TOOLS.edit.hotkey?.(on)).toBe('b')
  expect(TOOLS.edit.hotkey?.(off)).toBeUndefined()
  expect(TOOLS.more.hotkey?.(on)).toBe('m')
})

test('clock tool shows the label the tick stored', () => {
  expect(TOOLS.clock.label(makeCtx({ state: { clockLabel: '14:32' } }), 'long')).toBe('14:32')
  expect(TOOLS.clock.label(makeCtx({ state: { clockLabel: '14:32' } }), 'short')).toBe('14:32')
})

test('edit and more labels, icon style and presses', () => {
  const emoji = makeCtx()
  const text = makeCtx({ options: { iconStyle: 'label' } })
  expect(TOOLS.edit.label(emoji, 'long')).toBe('Edit')
  expect(TOOLS.edit.label(emoji, 'short')).toBe('⚙')
  expect(TOOLS.edit.label(text, 'short')).toBe('Edit')
  expect(TOOLS.more.label(emoji, 'short')).toBe('…')
  expect(TOOLS.edit.onPress?.(emoji, { surface: 'terminal' })).toEqual([{ kind: 'ui.toggle', tab: 'tools' }])
  expect(TOOLS.more.onPress?.(emoji, { surface: 'terminal' })).toEqual([{ kind: 'ui.open', tab: 'status' }])
})

test('pomodoro tool: label by phase and a press that draws and stores the new timer', () => {
  const ctx = makeCtx()
  expect(TOOLS.pomodoro.label(ctx, 'long')).toBe('🍅 Start')
  expect(TOOLS.pomodoro.label(ctx, 'short')).toBe('🍅')
  const effects = TOOLS.pomodoro.onPress?.(ctx, { surface: 'terminal' }) ?? []
  expect(effects.map(e => e.kind)).toEqual(['state.update', 'store.set'])
  const stored = effects[1]
  expect(stored && stored.kind === 'store.set' ? (stored.value as { phase: string }).phase : '').toBe('focus')
  expect(DONE_SOUND).toBe('assets/sounds/done.wav')
})

test('user buttons: group label, per-button tool, short labels clip by cells, hotkey follows the setting', () => {
  const wide = promptButton('w', { label: '한글라벨입니다', hotkey: 's' })
  const ctx = makeCtx()
  const tool = userButtonTool(wide)
  expect(tool.label(ctx, 'long')).toBe('한글라벨입니다')
  expect(tool.label(ctx, 'short')).toBe('한글')
  expect(tool.hotkey?.(ctx)).toBe('s')
  expect(tool.hotkey?.(makeCtx({ options: { hotkeysEnabled: false } }))).toBeUndefined()
  expect(tool.onPress?.(ctx, { surface: 'terminal' })).toEqual([{ kind: 'prompt.fill', text: 'text w', mode: 'insert' }])
  expect(TOOLS.user.label(ctx, 'long')).toBe('Review /usage')
})

test('isItemShown: available tools and buttons of the active set', () => {
  const ctx = makeCtx()
  expect(isItemShown('clock', ctx)).toBe(true)
  expect(isItemShown('attach', makeCtx({ surface: 'desktop' }))).toBe(false)
  expect(isItemShown('btn:ex-review', ctx)).toBe(true)
  expect(isItemShown('btn:other', ctx)).toBe(false)
  expect(isItemShown('mystery', ctx)).toBe(false)
})
