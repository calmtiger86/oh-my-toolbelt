// The icon groups and the pure icon helpers: sizes the Select can take, the widths the band counts, the three icon
// styles, and the checks on stored values.
import { expect, test } from 'claude-code/testing'
import {
  OWN_ICONS, DEFAULT_ICON_GROUP, ICON_DEFAULT, ICON_GROUPS, ICON_GROUP_MAX, ICON_NONE, ICON_TOOLS, asIconGroup, asIcons, faceOf, groupChoices, iconChoices,
  iconStyleOf, isListedIcon, pickedIcon, withToolIcon,
} from '../hooks/lib/icons'
import { LANGS, translator } from '../hooks/lib/i18n'
import { cleanButtonConfig } from '../hooks/lib/schema'
import { cellsOf } from '../hooks/lib/width'
import { setButtonIcon } from '../hooks/tools/user'
import { makeButtons, t } from './pure-helpers'

// A Select takes 1 to 64 choices (2.1.308).
const SELECT_MAX = 64
const EMOJI_GROUPS = ICON_GROUPS.filter(group => group.id !== 'symbols')
const SYMBOLS = ICON_GROUPS.find(group => group.id === 'symbols')?.icons ?? []

test('there are five emoji groups and one symbols group, each a name of the language files', () => {
  expect(ICON_GROUPS.map(group => group.id)).toEqual(['work', 'time', 'objects', 'nature', 'faces', 'symbols'])
  expect(ICON_GROUPS[0]?.id).toBe(DEFAULT_ICON_GROUP)
  for (const lang of LANGS) {
    for (const choice of groupChoices(translator(lang))) expect(choice.label, `${lang} ${choice.value}`).not.toBe(`icon.group.${choice.value}`)
  }
})

test('a group holds at most 60 icons, so its Select with default, none and a pick from elsewhere stays within 64', () => {
  for (const group of ICON_GROUPS) {
    expect(group.icons.length, group.id).toBeGreaterThan(0)
    expect(group.icons.length, group.id).toBeLessThanOrEqual(ICON_GROUP_MAX)
    for (const current of [ICON_DEFAULT, ICON_NONE, ...ICON_GROUPS.flatMap(g => g.icons.slice(0, 1))]) {
      expect(iconChoices(t, group.id, current, '🍅').length).toBeLessThanOrEqual(SELECT_MAX)
    }
  }
})

test('emoji are one code point of Emoji_Presentation and two cells wide', () => {
  for (const group of EMOJI_GROUPS) {
    for (const icon of group.icons) {
      expect([...icon].length, `${group.id} ${icon}`).toBe(1)
      expect(/^\p{Emoji_Presentation}$/u.test(icon), `${group.id} ${icon} U+${icon.codePointAt(0)?.toString(16)}`).toBe(true)
      expect(cellsOf(icon), `${group.id} ${icon}`).toBe(2)
    }
  }
})

test('symbols are one code point, drawn as text, and one cell wide; the Ambiguous ones are left out', () => {
  expect(SYMBOLS.length).toBeGreaterThan(40)
  for (const icon of SYMBOLS) {
    expect([...icon].length, icon).toBe(1)
    expect(/^\p{Emoji_Presentation}$/u.test(icon), `${icon} is drawn as an emoji`).toBe(false)
    expect(/^\p{Emoji}$/u.test(icon), `${icon} is an emoji that may be drawn wide`).toBe(false)
    expect(cellsOf(icon), icon).toBe(1)
  }
  // East Asian Width Ambiguous (two cells in Korean and Japanese terminals), or Wide; checked against Unicode 16.
  const ambiguous = [...'★☆♪●○■□◆◇▲△▶◀♠♥♣♡→←↑↓↔⇧▣∞≈±☰☱☲☷⚓']
  for (const icon of ambiguous) expect(SYMBOLS, icon).not.toContain(icon)
})

test('no icon is in two groups, and the stored sentinels are not icons', () => {
  const all = ICON_GROUPS.flatMap(group => group.icons)
  expect(new Set(all).size).toBe(all.length)
  expect([isListedIcon(ICON_NONE), isListedIcon(ICON_DEFAULT), isListedIcon(''), isListedIcon(undefined), isListedIcon('🦖')]).toEqual([false, false, false, false, false])
  expect(all.every(isListedIcon)).toBe(true)
})

test('the icon style reads the three values and takes anything else, the older emoji and text included, as icon and label', () => {
  expect(['icon+label', 'icon', 'label'].map(iconStyleOf)).toEqual(['icon+label', 'icon', 'label'])
  expect(['emoji', 'text', undefined, 3, ''].map(iconStyleOf)).toEqual(['icon+label', 'icon+label', 'icon+label', 'icon+label', 'icon+label'])
})

test('a face: icon and label, the icon alone when tight, the icon alone, the label alone, and the label for a button with no icon', () => {
  expect([faceOf('icon+label', 'long', '📝', 'Notes'), faceOf('icon+label', 'short', '📝', 'Notes')]).toEqual(['📝 Notes', '📝'])
  expect([faceOf('icon', 'long', '📝', 'Notes'), faceOf('icon', 'short', '📝', 'Notes')]).toEqual(['📝', '📝'])
  expect([faceOf('label', 'long', '📝', 'Notes'), faceOf('label', 'short', '📝', 'Notes', 'Note')]).toEqual(['Notes', 'Note'])
  for (const style of ['icon+label', 'icon'] as const) expect([faceOf(style, 'long', '', 'Notes'), faceOf(style, 'short', '', 'Notes', 'Note')]).toEqual(['Notes', 'Note'])
})

test('stored tool icons keep only the tools that take one, with none or an icon of a group', () => {
  expect(asIcons({ pomodoro: '⏰', curtain: ICON_NONE, export: '🦖', clock: '⏰', more: '⏰', notes: 3, edit: ICON_DEFAULT, constructor: '⏰' })).toEqual({ pomodoro: '⏰', curtain: ICON_NONE })
  for (const bad of [null, undefined, 'x', 4, ['⏰'], []]) expect(asIcons(bad)).toEqual({})
  expect(ICON_TOOLS).toEqual(['pomodoro', 'curtain', 'export', 'notes', 'edit', 'theme', 'voice', 'attach'])
})

test('a pick: undefined is the tool\'s own icon, an empty string is none', () => {
  const icons = { pomodoro: '⏰', curtain: ICON_NONE }
  expect([pickedIcon(icons, 'pomodoro'), pickedIcon(icons, 'curtain'), pickedIcon(icons, 'notes'), pickedIcon(icons, 'constructor')]).toEqual(['⏰', '', undefined, undefined])
})

test('withToolIcon sets, clears and refuses', () => {
  const start = { pomodoro: '⏰' }
  expect(withToolIcon(start, 'notes', '🎯')).toEqual({ pomodoro: '⏰', notes: '🎯' })
  expect(withToolIcon(start, 'pomodoro', ICON_NONE)).toEqual({ pomodoro: ICON_NONE })
  expect(withToolIcon(start, 'pomodoro', ICON_DEFAULT)).toEqual({})
  expect(start).toEqual({ pomodoro: '⏰' })
  for (const [id, value] of [['clock', '🎯'], ['more', ICON_NONE], ['notes', '🦖'], ['notes', ''], ['notes', 'x']] as const) expect(withToolIcon(start, id, value), `${id} ${value}`).toBeNull()
})

test('the choices of an icon list: default only for a tool, a pick from another group kept, no repeats', () => {
  const values = (current: string, hasDefault: boolean, group = 'work') => iconChoices(t, group, current, hasDefault ? '🍅' : null).map(choice => choice.value)
  expect(values(ICON_NONE, true).slice(0, 3)).toEqual([ICON_DEFAULT, ICON_NONE, ICON_GROUPS[0]?.icons[0]])
  expect(values(ICON_NONE, false).slice(0, 2)).toEqual([ICON_NONE, ICON_GROUPS[0]?.icons[0]])
  // '⏰' belongs to the time group: it is listed after none while another group shows, and once while its own does.
  expect(values('⏰', true).slice(0, 4)).toEqual([ICON_DEFAULT, ICON_NONE, '⏰', ICON_GROUPS[0]?.icons[0]])
  expect(values('⏰', true, 'time').filter(value => value === '⏰')).toHaveLength(1)
  for (const group of ICON_GROUPS) {
    const list = values('⏰', true, group.id)
    expect(new Set(list).size, group.id).toBe(list.length)
  }
  // A tool's default is drawn as its own icon, so a closed list shows what the band shows.
  expect(iconChoices(t, 'work', ICON_NONE, '🍅').map(choice => choice.label).slice(0, 2)).toEqual(['🍅', 'None'])
  expect(asIconGroup('symbols')).toBe('symbols')
  expect([asIconGroup('nope'), asIconGroup(undefined)]).toEqual([DEFAULT_ICON_GROUP, DEFAULT_ICON_GROUP])
})

test('a stored button keeps an icon of a group and drops any other', () => {
  const buttons = makeButtons()
  const raw = { ...buttons, sets: { default: (buttons.sets.default ?? []).map((b, i) => ({ ...b, icon: i === 0 ? '🎯' : '🦖' })) } }
  const clean = cleanButtonConfig(raw)
  expect(clean?.sets.default?.map(b => b.icon)).toEqual(['🎯', undefined])
  expect(cleanButtonConfig({ ...raw, sets: { default: [{ ...(buttons.sets.default?.[0] ?? {}), icon: 5 }] } })?.sets.default?.[0]).not.toHaveProperty('icon')
})

test('setButtonIcon sets, clears and refuses, and leaves the other buttons alone', () => {
  const buttons = makeButtons()
  const first = setButtonIcon(buttons, 'ex-review', '🎯')
  expect(first?.sets.default?.map(b => b.icon)).toEqual(['🎯', undefined])
  expect(setButtonIcon(first ?? buttons, 'ex-review', ICON_NONE)?.sets.default?.[0]).not.toHaveProperty('icon')
  expect(setButtonIcon(first ?? buttons, 'ex-review', ICON_DEFAULT)?.sets.default?.[0]).not.toHaveProperty('icon')
  expect([setButtonIcon(buttons, 'nope', '🎯'), setButtonIcon(buttons, 'ex-review', '🦖'), setButtonIcon(buttons, 'ex-review', '')]).toEqual([null, null, null])
})

test('every fixed tool that takes an icon has its own icon for the default choice', () => {
  expect(Object.keys(OWN_ICONS).sort()).toEqual([...ICON_TOOLS].sort())
})

test('a tool\'s own icon is listed once, as Default, and not again in its group', () => {
  const values = iconChoices(t, 'symbols', ICON_DEFAULT, OWN_ICONS.curtain ?? null).map(choice => choice.label)
  expect(values.filter(label => label === '▢')).toHaveLength(1)
  expect(iconChoices(t, 'symbols', ICON_DEFAULT, null).some(choice => choice.value === '▢')).toBe(true)
})
