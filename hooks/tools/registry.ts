// Tool registry and layout functions. Pure: no `$`.
import type { PluginOptions, PluginState, RenderSurface } from 'claude-code'
import type { ButtonConfig, Layout, ToolButton } from '../../types/index'
import type { Effect } from '../lib/effects'
import type { TFn } from '../lib/i18n'
import { DEFAULT_ICON_GROUP, faceOf, iconStyleOf, pickedIcon } from '../lib/icons'
import type { IconStyle } from '../lib/icons'
import { curtainEffects, curtainLabel } from './curtain'
import { exportLabel } from './export'
import { notesLabel } from './notes'
import { idlePomodoro, isLastMinute, pomodoroChipIcon, pomodoroConfig, pomodoroEffects, pomodoroLabel, pomodoroParts, pomodoroProgress, press } from './pomodoro'
import { activeButtons, allButtons, buttonEffects, buttonLabel } from './user'
import { offWeather, weatherCity, weatherParts } from './weather'
import { otherTheme, themeEffects, themeLabel } from './theme'
import { voiceEffects, voiceLabel, voiceModeOf } from './voice'
import { attachEffects, attachLabel } from './attach'
import { LEFT_DEFAULT, RIGHT_DEFAULT, defaultButtons, defaultLayout } from '../lib/schema'
import type { Chip } from '../chip'
import { configuredTimeZone, dateFormatOf, dateParts, dateText } from './clock'

export { LEFT_DEFAULT, RIGHT_DEFAULT, defaultLayout }

export type ToolId =
  | 'clock' | 'date' | 'weather' | 'pomodoro'
  | 'user'
  | 'attach' | 'voice' | 'theme' | 'curtain' | 'export'
  | 'notes' | 'more' | 'edit'

export type Options = PluginOptions
export type Snapshot = Readonly<PluginState['oh-my-toolbelt']>

export type Ctx = {
  surface: RenderSurface
  options: Options
  state: Snapshot
  t: TFn
  now: number
  // The locale for dates, times and weekdays (the date tool): i18n.ts `resolveLanguage`.
  locale: string
  // Lets a label be clipped by display cells (the short form of a user button).
  cells: (text: string) => number
}

export type Tool = {
  id: ToolId
  side: 'left' | 'right'
  priority: number
  isAvailable: (ctx: Ctx) => boolean
  label: (ctx: Ctx, size: 'long' | 'short') => string
  // The band draws it as a chip in place of its label (hooks/chip.tsx).
  chip?: (ctx: Ctx, size: 'long' | 'short') => Chip
  hotkey?: (ctx: Ctx) => string | undefined
  kind: 'text' | 'button'
  onPress?: (ctx: Ctx, press: { surface: RenderSurface }) => Effect[]
}

// Default letters of the fixed tools. A user button may not take any of them. The pomodoro has none: it is a chip, and
// a chip's letter would print before it (hooks/chip.tsx).
export const FIXED_HOTKEYS = {
  attach: 'a', voice: 'v', theme: 't', curtain: 'h', export: 'e', notes: 'n', more: 'm', edit: 'b',
} as const satisfies Partial<Record<ToolId, string>>

export const reservedHotkeys = (): string[] => Object.values(FIXED_HOTKEYS)

const always = (): boolean => true
// The iconStyle setting, and the icon the person picked for a tool (undefined: its own, '': none).
const styleOf = (ctx: Ctx): IconStyle => iconStyleOf(ctx.options.iconStyle)
const pickOf = (ctx: Ctx, id: ToolId): string | undefined => pickedIcon(ctx.state.icons, id)
// hotkeysEnabled turns every letter hotkey off.
const letter = (ctx: Ctx, key: string | undefined): string | undefined => (ctx.options.hotkeysEnabled === false ? undefined : key)
const fixedHotkey = (id: keyof typeof FIXED_HOTKEYS) => (ctx: Ctx): string | undefined => letter(ctx, FIXED_HOTKEYS[id])

// One cell wide, drawn in the chip's colour.
const CLOCK_ICON = '◷'

const clock: Tool = {
  id: 'clock', side: 'left', priority: 2, kind: 'text',
  isAvailable: always,
  label: ctx => ctx.state.clockLabel,
  chip: ctx => ({ hue: 'blue', icon: styleOf(ctx) === 'label' ? '' : CLOCK_ICON, value: ctx.state.clockLabel }),
}

// The date, a tool of its own beside the clock. The short form leaves the weekday out.
const DATE_ICON = '▦'
const datePartsOf = (ctx: Ctx) => dateParts(ctx.now, dateFormatOf(ctx.options.dateFormat), ctx.locale, configuredTimeZone(ctx.options))
const date: Tool = {
  id: 'date', side: 'left', priority: 9, kind: 'text',
  isAvailable: ctx => datePartsOf(ctx) !== null,
  label: ctx => dateText(ctx.now, dateFormatOf(ctx.options.dateFormat), ctx.locale, configuredTimeZone(ctx.options)),
  chip: (ctx, size) => {
    const parts = datePartsOf(ctx)
    return { hue: 'magenta', icon: styleOf(ctx) === 'label' ? '' : DATE_ICON, value: parts?.date ?? '', detail: size === 'long' ? (parts?.weekday ?? '') : '' }
  },
}

// Draws what the weather state holds; the label is written when the forecast arrives (hooks/tools/weather.ts).
const weather: Tool = {
  id: 'weather', side: 'left', priority: 8, kind: 'text',
  isAvailable: ctx => weatherCity(ctx.options) !== null,
  label: (ctx, size) => (size === 'long' ? ctx.state.weather.label : ctx.state.weather.shortLabel),
  chip: (ctx, size) => weatherParts(size === 'long' ? ctx.state.weather.label : ctx.state.weather.shortLabel),
}

const pomodoro: Tool = {
  id: 'pomodoro', side: 'left', priority: 2, kind: 'button',
  isAvailable: always,
  label: (ctx, size) =>
    pomodoroLabel(ctx.state.pomodoro, size, { style: styleOf(ctx), picked: pickOf(ctx, 'pomodoro'), t: ctx.t }),
  // The meter fills with the phase; a short band leaves it out.
  chip: (ctx, size) => {
    const p = ctx.state.pomodoro
    const picked = pickOf(ctx, 'pomodoro')
    const { head, rest } = pomodoroParts(p, size, { style: styleOf(ctx), picked, t: ctx.t })
    const progress = size === 'long' ? pomodoroProgress(p, ctx.now, pomodoroConfig(ctx.options)) : null
    return { hue: 'green', icon: pomodoroChipIcon(head, p, picked), value: rest, ...(progress === null ? {} : { meter: progress.ratio }), isWarning: isLastMinute(p) }
  },
  onPress: ctx => pomodoroEffects(press(ctx.state.pomodoro, ctx.now, pomodoroConfig(ctx.options))),
}

const edit: Tool = {
  id: 'edit', side: 'right', priority: 3, kind: 'button',
  isAvailable: always,
  label: (ctx, size) => {
    const [style, picked] = [styleOf(ctx), pickOf(ctx, 'edit')]
    // The gear has never stood beside the word: only an icon the person picked does.
    return picked === undefined && style === 'icon+label' && size === 'long' ? ctx.t('edit.label') : faceOf(style, size, picked ?? '⚙', ctx.t('edit.label'))
  },
  hotkey: fixedHotkey('edit'),
  onPress: () => [{ kind: 'ui.toggle', tab: 'tools' }],
}

// Hides most of the transcript; the state flips here and register.tsx's drawing hooks read it (hooks/tools/curtain.ts).
const curtain: Tool = {
  id: 'curtain', side: 'right', priority: 6, kind: 'button',
  isAvailable: always,
  label: (ctx, size) => curtainLabel(ctx.state.curtain, size, styleOf(ctx), pickOf(ctx, 'curtain'), ctx.t),
  hotkey: fixedHotkey('curtain'),
  onPress: ctx => curtainEffects(!ctx.state.curtain, ctx.t),
}

// Opens the notes tab, or closes the panel when that tab is the one showing.
const notes: Tool = {
  id: 'notes', side: 'right', priority: 7, kind: 'button',
  isAvailable: always,
  label: (ctx, size) => notesLabel(size, styleOf(ctx), pickOf(ctx, 'notes'), ctx.t),
  hotkey: fixedHotkey('notes'),
  onPress: () => [{ kind: 'ui.toggle', tab: 'notes' }],
}

// Saves the conversation in the last format chosen; register.tsx does the reading and writing.
const exportTool: Tool = {
  id: 'export', side: 'right', priority: 7, kind: 'button',
  isAvailable: always,
  label: (ctx, size) => exportLabel(size, styleOf(ctx), pickOf(ctx, 'export'), ctx.t),
  hotkey: fixedHotkey('export'),
  onPress: () => [{ kind: 'export' }],
}

// Whether the "more" button shows is decided by the width fit (it appears when anything was hidden),
// so the tool itself is always available.
const more: Tool = {
  id: 'more', side: 'right', priority: 1, kind: 'button',
  isAvailable: always,
  label: ctx => ctx.t('more.label'),
  hotkey: fixedHotkey('more'),
  onPress: () => [{ kind: 'ui.open', tab: 'status' }],
}

// The group of user buttons. The band draws each button on its own: see userButtonTool.
const user: Tool = {
  id: 'user', side: 'right', priority: 5, kind: 'button',
  isAvailable: ctx => activeButtons(ctx.state.buttons).length > 0,
  label: (ctx, size) => activeButtons(ctx.state.buttons).map(b => buttonLabel(b, size, ctx.cells, styleOf(ctx))).join(' '),
}

// Light while the theme is dark, Dark otherwise; only with a theme /config can swap (tools/theme.ts).
const theme: Tool = {
  id: 'theme', side: 'right', priority: 7, kind: 'button',
  isAvailable: ctx => ctx.state.themeRow !== null && otherTheme(ctx.state.themeRow) !== null,
  label: (ctx, size) => (ctx.state.themeRow === null ? '' : themeLabel(ctx.state.themeRow, size, styleOf(ctx), pickOf(ctx, 'theme'), ctx.t)),
  hotkey: fixedHotkey('theme'),
  onPress: ctx => (ctx.state.themeRow === null ? [] : themeEffects(ctx.state.themeRow)),
}

// The system's file picker. Commands run only where a terminal draws (`$.process` is CLI only), and the person can turn
// the button off (attachEnabled).
const attach: Tool = {
  id: 'attach', side: 'right', priority: 4, kind: 'button',
  isAvailable: ctx => ctx.surface === 'terminal' && ctx.options.attachEnabled !== false,
  label: (ctx, size) => attachLabel(size, styleOf(ctx), pickOf(ctx, 'attach'), ctx.t),
  hotkey: fixedHotkey('attach'),
  onPress: () => attachEffects(),
}

// Only while this session has /voice (tools/voice.ts).
const voice: Tool = {
  id: 'voice', side: 'right', priority: 7, kind: 'button',
  isAvailable: ctx => ctx.state.voice.isAvailable,
  label: (ctx, size) => voiceLabel(ctx.state.voice, size, styleOf(ctx), pickOf(ctx, 'voice'), ctx.t),
  hotkey: fixedHotkey('voice'),
  onPress: ctx => voiceEffects(ctx.state.voice, voiceModeOf(ctx.options.voiceMode)),
}

export const TOOLS: Record<ToolId, Tool> = {
  more, clock, date, weather, pomodoro, edit, curtain, notes,
  attach,
  user,
  export: exportTool,
  theme,
  voice,
}

// One user button as a tool of its own (layout id `btn:<id>`): priority 5, right side.
export const userButtonTool = (button: ToolButton): Tool => ({
  id: 'user', side: 'right', priority: 5, kind: 'button',
  isAvailable: always,
  label: (ctx, size) => buttonLabel(button, size, ctx.cells, styleOf(ctx)),
  hotkey: ctx => letter(ctx, button.hotkey),
  onPress: () => buttonEffects(button),
})

// Hide order number: a pomodoro that is running or paused is 2, an idle one is 7.
export const priorityOf = (tool: Tool, ctx: Ctx): number =>
  tool.id === 'pomodoro' && ctx.state.pomodoro.phase === 'idle' ? 7 : tool.priority

// ---- Layout. `more` is never part of a layout. ----

export const BUTTON_PREFIX = 'btn:'
export const buttonItemId = (id: string): string => `${BUTTON_PREFIX}${id}`

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isToolId = (id: string): id is ToolId => Object.hasOwn(TOOLS, id)
const copyLayout = (l: Layout): Layout => ({ left: [...l.left], right: [...l.right], hidden: [...l.hidden] })
const without = (list: readonly string[], id: string): string[] => list.filter(x => x !== id)

export const resetLayout = defaultLayout

export const defaultSideOf = (id: string): 'left' | 'right' => (LEFT_DEFAULT.includes(id) ? 'left' : 'right')

// Cleans a stored layout: unknown ids go, duplicates keep their first place (left, then right, then
// hidden), tools missing from the list join their default side after the tool before them in its default order (a new
// tool stands where a new install has it), and buttons missing from it join the right end. Buttons of every set count
// as known, so switching sets keeps their places.
// Each default tool the stored layout lacks, after the nearest one before it in the default order that the side
// holds, or at the end.
function withMissing(side: readonly string[], defaults: readonly string[], seen: ReadonlySet<string>): string[] {
  return defaults.reduce<string[]>((acc, id, i) => {
    if (seen.has(id)) return acc
    const before = defaults.slice(0, i).reverse().find(d => acc.includes(d))
    const at = before === undefined ? acc.length : acc.indexOf(before) + 1
    return [...acc.slice(0, at), id, ...acc.slice(at)]
  }, [...side])
}

export function normalizeLayout(raw: unknown, ctx: { state: { buttons: ButtonConfig } }): Layout {
  const buttons = ctx.state.buttons
  if (!isRecord(raw) || !(Array.isArray(raw.left) || Array.isArray(raw.right) || Array.isArray(raw.hidden))) {
    return defaultLayout(buttons)
  }
  const buttonIds = allButtons(buttons).map(b => buttonItemId(b.id))
  const known = new Set<string>([...LEFT_DEFAULT, ...RIGHT_DEFAULT, ...buttonIds])
  const seen = new Set<string>()
  const take = (list: unknown): string[] => {
    const kept: string[] = []
    for (const id of Array.isArray(list) ? list : []) {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue
      seen.add(id)
      kept.push(id)
    }
    return kept
  }
  const left = take(raw.left)
  const right = take(raw.right)
  const hidden = take(raw.hidden)
  const absent = (ids: readonly string[]): string[] => ids.filter(id => !seen.has(id))
  return {
    left: withMissing(left, LEFT_DEFAULT, seen),
    right: [...withMissing(right, RIGHT_DEFAULT, seen), ...absent(buttonIds)],
    hidden,
  }
}

// Whether the panel lists an item now: an available tool, or a button of the active set.
export function isItemShown(id: string, ctx: Ctx): boolean {
  if (id.startsWith(BUTTON_PREFIX)) return activeButtons(ctx.state.buttons).some(b => buttonItemId(b.id) === id)
  return isToolId(id) && TOOLS[id].isAvailable(ctx)
}

// Swaps `id` with the nearest neighbour the person can see, so a press never looks like a no-op
// because the neighbour is a tool that is unavailable right now.
function step(list: readonly string[], id: string, dir: -1 | 1, isShown: (id: string) => boolean): string[] {
  const out = [...list]
  const from = out.indexOf(id)
  for (let to = from + dir; from >= 0 && to >= 0 && to < out.length; to += dir) {
    const other = out[to]
    if (other === undefined || !isShown(other)) continue
    out[to] = id
    out[from] = other
    break
  }
  return out
}

export const moveUp = (layout: Layout, id: string, isShown: (id: string) => boolean = always): Layout => ({
  left: step(layout.left, id, -1, isShown), right: step(layout.right, id, -1, isShown), hidden: [...layout.hidden],
})

export const moveDown = (layout: Layout, id: string, isShown: (id: string) => boolean = always): Layout => ({
  left: step(layout.left, id, 1, isShown), right: step(layout.right, id, 1, isShown), hidden: [...layout.hidden],
})

// Left to the right end, or right to the left end ("the other side's end").
export function moveToOtherSide(layout: Layout, id: string): Layout {
  if (layout.left.includes(id)) return { left: without(layout.left, id), right: [...layout.right, id], hidden: [...layout.hidden] }
  if (layout.right.includes(id)) return { left: [...layout.left, id], right: without(layout.right, id), hidden: [...layout.hidden] }
  return copyLayout(layout)
}

export function hide(layout: Layout, id: string): Layout {
  if (!layout.left.includes(id) && !layout.right.includes(id)) return copyLayout(layout)
  return { left: without(layout.left, id), right: without(layout.right, id), hidden: [...layout.hidden, id] }
}

// Back to the end of its default side.
export function show(layout: Layout, id: string): Layout {
  if (!layout.hidden.includes(id)) return copyLayout(layout)
  const hidden = without(layout.hidden, id)
  return defaultSideOf(id) === 'left'
    ? { left: [...layout.left, id], right: [...layout.right], hidden }
    : { left: [...layout.left], right: [...layout.right, id], hidden }
}

// The tool that draws a layout item: a fixed tool, or a button of the active set (`btn:<id>`).
export function toolForItem(id: string, ctx: Ctx): Tool | undefined {
  if (id.startsWith(BUTTON_PREFIX)) {
    const button = activeButtons(ctx.state.buttons).find(b => buttonItemId(b.id) === id)
    return button === undefined ? undefined : userButtonTool(button)
  }
  return isToolId(id) ? TOOLS[id] : undefined
}

// The panel's layout rows: up, down, to the other side, hide and show.
export type LayoutOp = 'up' | 'down' | 'side' | 'hide' | 'show'

export function applyLayoutOp(layout: Layout, op: LayoutOp, id: string, isShown: (id: string) => boolean): Layout {
  switch (op) {
    case 'up': return moveUp(layout, id, isShown)
    case 'down': return moveDown(layout, id, isShown)
    case 'side': return moveToOtherSide(layout, id)
    case 'hide': return hide(layout, id)
    case 'show': return show(layout, id)
  }
}

// Every state value at its start. A caller overrides what it read; the rest keep these.
export const emptySnapshot = (): Snapshot => ({
  clockLabel: '',
  pomodoro: idlePomodoro(0),
  weather: offWeather(),
  curtain: false,
  voice: { isAvailable: false, requested: null },
  bandHidden: false,
  bandFolded: false,
  clipBoard: { clips: [], seen: null, changing: null },
  paneTab: 'tools',
  paneStarted: false,
  tocMoved: 0,
  turnRunning: false,
  guideSection: 'start',
  buttons: defaultButtons(),
  layout: defaultLayout(),
  icons: {},
  iconGroup: DEFAULT_ICON_GROUP,
  openPicker: null,
  notes: [],
  exportFormat: 'md',
  themeRow: null,
  settings: [],
  soundPick: null,
  settingsSource: 'engine',
  editDraft: null,
  lastError: null,
})
