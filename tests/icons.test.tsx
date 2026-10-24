// Icons on the toolbelt buttons: the three icon styles in the band, the icon lists of the layout rows and of the form,
// the shared store key `icons`, and the checks on what is stored.
import { expect, test } from 'claude-code/testing'
import type { ButtonConfig } from '../types/index'
import { cellsOf } from '../hooks/lib/width'
import { TOC_MARGIN } from '../hooks/toc-tab'
import { SLOW_MS, SURFACES, TEST_OPTIONS, boot, listOf, mountBand, mountPane, pick, runCommand, seedButtons } from './helpers'

type Node = { type?: string; props?: { key?: string; width?: number; label?: string; columnGap?: number; options?: { value: string; label?: string }[]; value?: string }; children?: unknown[] }

const iconsOf = (store: Map<string, unknown>) => store.get('icons') as Record<string, string> | undefined
const buttonsOf = (store: Map<string, unknown>) => (store.get('buttons') as ButtonConfig).sets.default ?? []
const labelOf = async (band: Awaited<ReturnType<typeof mountBand>>, key: string) => (await band.find({ key }))?.props.label
const withIcon = (): ButtonConfig => {
  const config = seedButtons()
  return { ...config, sets: { default: (config.sets.default ?? []).map(b => (b.id === 'ex-review' ? { ...b, icon: '🎯' } : b)) } }
}

const KEYS = ['pomodoro', 'curtain', 'export', 'notes', 'edit', 'btn:ex-review', 'btn:ex-usage'] as const

for (const style of ['icon+label', 'icon', 'label'] as const) {
  test(`the ${style} style draws the band buttons`, { options: { ...TEST_OPTIONS, iconStyle: style } }, async ($, on) => {
    await boot($, on, { store: { schemaVersion: 1, buttons: withIcon() } })
    const expected = {
      'icon+label': ['🍅 Start', '▢ Hide', '⇩ Export', '📝 Notes', 'Edit', '🎯 Review', '/usage'],
      icon: ['🍅', '▢', '⇩', '📝', '⚙', '🎯', '/usage'],
      label: ['Pomo Start', 'Hide', 'Export', 'Notes', 'Edit', 'Review', '/usage'],
    }[style]
    for (const surface of SURFACES) {
      const band = await mountBand($, surface, 258)
      expect(await Promise.all(KEYS.map(key => labelOf(band, key)))).toEqual(expected)
      await band.unmount()
    }
  })
}

test('with the icon style a running timer still shows the time left, and the all-tools list keeps the words', { options: { ...TEST_OPTIONS, iconStyle: 'icon' } }, async ($, on) => {
  await boot($, on)
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, 258)
    await runCommand($, 'toolbelt', 'pomodoro start')
    expect(await labelOf(band, 'pomodoro')).toBe('🍅 25:00')
    await runCommand($, 'toolbelt', 'pomodoro stop')
    expect(await labelOf(band, 'pomodoro')).toBe('🍅')
    await band.unmount()
    const pane = await mountPane($, surface)
    await pane.press({ key: 'tab-status' })
    expect((await pane.find({ key: 'more-notes' }))?.props.label).toBe('📝 Notes')
    expect((await pane.find({ key: 'more-pomodoro' }))?.props.label).toBe('🍅 Start')
    await pane.unmount()
  }
})

test('a layout row picks the icon of a fixed tool: the group list, default, none, and the store key icons', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { store } = await boot($, on)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    const band = await mountBand($, surface, 258)
    const options = async (key: string) => (await listOf(pane, key)).values
    // The first group is work; default and none come first; the clock, the weather and `…` have no list.
    expect((await options('icon-pomodoro')).slice(0, 3)).toEqual(['default', 'none', '💼'])
    expect(await pane.find({ key: 'icon-clock' })).toBeUndefined()
    expect(await pane.find({ key: 'icon-more' })).toBeUndefined()
    expect((await listOf(pane, 'icon-group')).current).toBe('work')
    await pick(pane, 'icon-group', 'time')
    expect((await options('icon-pomodoro')).slice(0, 3)).toEqual(['default', 'none', '⏰'])
    await pick(pane, 'icon-pomodoro', '⏰')
    expect(iconsOf(store)).toEqual({ pomodoro: '⏰' })
    expect(await labelOf(band, 'pomodoro')).toBe('⏰ Start')
    // The pick is kept in the list while another group shows.
    await pick(pane, 'icon-group', 'symbols')
    expect((await options('icon-pomodoro')).slice(0, 4)).toEqual(['default', 'none', '⏰', '✓'])
    await pick(pane, 'icon-curtain', '⌘')
    await pick(pane, 'icon-notes', 'none')
    await pick(pane, 'icon-export', '✎')
    await pick(pane, 'icon-edit', '❖')
    expect(iconsOf(store)).toEqual({ pomodoro: '⏰', curtain: '⌘', notes: 'none', export: '✎', edit: '❖' })
    expect(await Promise.all(['pomodoro', 'curtain', 'export', 'notes', 'edit'].map(key => labelOf(band, key)))).toEqual(['⏰ Start', '⌘ Hide', '✎ Export', 'Notes', '❖ Edit'])
    // The curtain's pick stands for both states.
    await band.press({ key: 'curtain' })
    expect(await labelOf(band, 'curtain')).toBe('⌘ Show')
    await band.press({ key: 'curtain' })
    for (const key of ['pomodoro', 'curtain', 'export', 'notes', 'edit']) await pick(pane, `icon-${key}`, 'default')
    expect(iconsOf(store)).toEqual({})
    expect(await Promise.all(['pomodoro', 'curtain', 'export', 'notes', 'edit'].map(key => labelOf(band, key)))).toEqual(['🍅 Start', '▢ Hide', '⇩ Export', '📝 Notes', 'Edit'])
    await pick(pane, 'icon-group', 'work')
    await band.unmount()
    await pane.unmount()
  }
})

test('a pomodoro with no icon shows its words, and the break and the pause keep their marks', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { schemaVersion: 1, icons: { pomodoro: 'none' } } })
  const band = await mountBand($, 'terminal', 258)
  expect(await labelOf(band, 'pomodoro')).toBe('Pomo Start')
  await band.press({ key: 'pomodoro' })
  expect(await labelOf(band, 'pomodoro')).toBe('Focus 25:00')
  const pane = await mountPane($, 'terminal')
  await pick(pane, 'icon-pomodoro', '🎯')
  expect(iconsOf(store)).toEqual({ pomodoro: '🎯' })
  expect(await labelOf(band, 'pomodoro')).toBe('🎯 25:00')
  await band.press({ key: 'pomodoro' })
  expect(await labelOf(band, 'pomodoro')).toBe('⏸ 25:00')
  await pane.unmount()
  await band.unmount()
})

test('a layout row picks the icon of a button, which has no default, and the button keeps it', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { store } = await boot($, on, { store: { schemaVersion: 1, buttons: seedButtons() } })
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    const band = await mountBand($, surface, 258)
    const list = (await listOf(pane, 'icon-btn:ex-review')).values
    expect(list.slice(0, 2)).toEqual(['none', '💼'])
    expect((await listOf(pane, 'icon-btn:ex-review')).current).toBe('none')
    await pick(pane, 'icon-btn:ex-review', '🎯')
    expect(buttonsOf(store).find(b => b.id === 'ex-review')?.icon).toBe('🎯')
    expect(await labelOf(band, 'btn:ex-review')).toBe('🎯 Review')
    expect((await listOf(pane, 'icon-btn:ex-review')).current).toBe('🎯')
    // Short labels of the narrow band: the icon alone.
    const narrow = await mountBand($, surface, 49)
    expect(await labelOf(narrow, 'btn:ex-review')).toBe('🎯')
    await narrow.unmount()
    await pick(pane, 'icon-btn:ex-review', 'none')
    expect(buttonsOf(store).find(b => b.id === 'ex-review')).not.toHaveProperty('icon')
    expect(await labelOf(band, 'btn:ex-review')).toBe('Review')
    await band.unmount()
    await pane.unmount()
  }
})

test('the form has an icon group list and an icon list; a saved button keeps the pick and an edit shows it', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { store } = await boot($, on)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    await pane.press({ key: 'button-new' })
    const field = await listOf(pane, 'field-icon')
    expect([field.current, field.values.slice(0, 2)]).toEqual(['none', ['none', '💼']])
    expect(await pane.find({ type: 'Text', text: 'Shown before the label on the toolbelt. The group above decides which icons are listed.' })).toBeDefined()
    // One group for the layout rows and the form.
    await pick(pane, 'field-icon-group', 'objects')
    expect((await listOf(pane, 'icon-group')).current).toBe('objects')
    expect((await listOf(pane, 'field-icon')).values[0]).toBe('none')
    await pick(pane, 'field-icon', '🎁')
    await pane.input({ key: 'field-label', text: `Gift ${surface}` })
    await pane.input({ key: 'field-text', text: 'wrap it' })
    await pane.press({ key: 'save' })
    const added = buttonsOf(store).at(-1)
    expect(added).toMatchObject({ label: `Gift ${surface}`, icon: '🎁' })
    await pane.press({ key: `edit-${added?.id}` })
    expect((await listOf(pane, 'field-icon')).current).toBe('🎁')
    // Back to none, and the saved button has no icon.
    await pick(pane, 'field-icon', 'none')
    await pane.press({ key: 'save' })
    expect(buttonsOf(store).find(b => b.id === added?.id)).not.toHaveProperty('icon')
    await pick(pane, 'icon-group', 'work')
    await pane.unmount()
  }
})

test('stored icons that are in no group are ignored, and one that is stays', { options: TEST_OPTIONS }, async ($, on) => {
  const buttons = withIcon()
  const bad = { ...buttons, sets: { default: (buttons.sets.default ?? []).map(b => (b.id === 'ex-usage' ? { ...b, icon: '🦖' } : b)) } }
  await boot($, on, { store: { schemaVersion: 1, buttons: bad, icons: { pomodoro: '🦖', curtain: '⏰', clock: '⏰', notes: 7 } } })
  const band = await mountBand($, 'terminal', 258)
  expect(await Promise.all(['pomodoro', 'curtain', 'btn:ex-review', 'btn:ex-usage'].map(key => labelOf(band, key)))).toEqual(['🍅 Start', '⏰ Hide', '🎯 Review', '/usage'])
  await band.unmount()
})

test('a panel pick that is no icon of a group changes nothing', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { schemaVersion: 1, icons: { notes: '🎯' } } })
  const pane = await mountPane($, 'terminal')
  await pick(pane, 'icon-pomodoro', '🦖').catch(() => undefined)
  await pick(pane, 'icon-group', 'no-such-group').catch(() => undefined)
  expect(iconsOf(store)).toEqual({ notes: '🎯' })
  expect((await listOf(pane, 'icon-group')).current).toBe('work')
  await pane.unmount()
})

test('a failed read of the saved icons stops the pick, with a toast, and writes nothing over them', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { store: { schemaVersion: 1, icons: { notes: '🎯' } }, failGet: ['icons'] })
  const pane = await mountPane($, 'terminal')
  await pick(pane, 'icon-pomodoro', '💼')
  expect(calls.toasts.at(-1)).toBe('Could not save your settings.')
  expect(iconsOf(store)).toEqual({ notes: '🎯' })
  const band = await mountBand($, 'terminal', 258)
  expect(await labelOf(band, 'pomodoro')).toBe('🍅 Start')
  await band.unmount()
  await pane.unmount()
})

test('a refused write leaves the list and the band as they were', { options: TEST_OPTIONS }, async ($, on) => {
  const failSet = { on: false }
  const { calls, store } = await boot($, on, { failSet })
  const pane = await mountPane($, 'terminal')
  failSet.on = true
  await pick(pane, 'icon-pomodoro', '💼')
  expect(calls.toasts.at(-1)).toBe('Could not save your settings.')
  expect(iconsOf(store)).toBeUndefined()
  expect((await listOf(pane, 'icon-pomodoro')).current).toBe('default')
  await pane.unmount()
})

test('every session shares the icons: read at start and after /clear, and read again before each write', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { schemaVersion: 1, icons: { notes: '🎯' } } })
  const band = await mountBand($, 'terminal', 258)
  expect(await labelOf(band, 'notes')).toBe('🎯 Notes')
  // Another session saves its own icons.
  store.set('icons', { export: '💾' })
  await $.classic.SessionStart({ source: 'clear' })
  expect([await labelOf(band, 'export'), await labelOf(band, 'notes')]).toEqual(['💾 Export', '📝 Notes'])
  // And one more saves between this session's last read and its pick: the pick joins it, as the store holds it now.
  store.set('icons', { export: '💾', edit: '❖' })
  const pane = await mountPane($, 'terminal')
  await pick(pane, 'icon-pomodoro', '💼')
  expect(iconsOf(store)).toEqual({ export: '💾', edit: '❖', pomodoro: '💼' })
  await pane.unmount()
  await band.unmount()
})

// The cells a layout row spends, as it declares them: the margin, the cells with a width, the labels of the controls, the gaps.
function rowCells(row: Node | undefined): number {
  const parts = (row?.children ?? []) as Node[]
  const widths = parts.map(part => (part.type === 'Button' ? cellsOf(part.props?.label ?? '') : (part.props?.width ?? 0)))
  return TOC_MARGIN + widths.reduce((sum, w) => sum + w, 0) + (row?.props?.columnGap ?? 0) * (parts.length - 1)
}

for (const [lang, curtainName] of [['en_US.UTF-8', 'Hide conversation'], ['ko_KR.UTF-8', '가리기'], ['ja_JP.UTF-8', '会話を隠す']] as const) {
  test(`a layout row with its icon list fits a panel 38 cells wide in ${lang.slice(0, 2)}, and a wide panel keeps the whole name`, { options: TEST_OPTIONS }, async ($, on) => {
    const { calls } = await boot($, on, { env: { LANG: lang }, store: { schemaVersion: 1, buttons: seedButtons() } })
    const narrow = await mountPane($, 'terminal', 38)
    for (const id of ['clock', 'pomodoro', 'curtain', 'notes', 'edit', 'btn:b-commit']) {
      expect(rowCells((await narrow.find({ key: `row-${id}` })) as Node | undefined), `${lang} ${id}`).toBeLessThanOrEqual(38)
    }
    await narrow.unmount()
    const wide = await mountPane($, 'terminal', 80)
    const nameBox = (await wide.find({ key: 'name-curtain' })) as Node | undefined
    expect(cellsOf(curtainName), curtainName).toBeLessThanOrEqual(nameBox?.props?.width ?? 0)
    expect(calls.toasts).toEqual([])
    await wide.unmount()
  })
}

test('the guide says how to pick an icon, and how the icon style setting shows the buttons', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-guide' })
  expect(await pane.find({ type: 'Text', text: '· Icon style: buttons show an icon and a label, an icon only, or a label only' })).toBeDefined()
  await pane.press({ key: 'guide-custom' })
  expect(await pane.find({ type: 'Text', text: '③ Icon: pick a group, then an icon from it (or None). The icon shows before the label.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '· The list before each name: the icon of that button (Default is the one it came with). The Icon group list at the top decides which icons these lists show.' })).toBeDefined()
  await pane.unmount()
})
