// The Toolbelt panel: tabs, the layout rows, the button list and the edit form, the status tab with every tool, and the
// guide. Pure: register.tsx hands in the element table from `$.ui.resolve(e)` and `act`, which turns a PaneAction into
// `$` calls.
import type { ConfigRow, Elements, RenderElement, RenderSurface } from 'claude-code'
import type { ButtonConfig, ExportFormat, GuideSection, PaneTab, ToolButton } from '../types/index'
import { drawGuide } from './guide'
import { EXPORT_FORMATS, asExportFormat } from './lib/export'
import { formatStamp } from './lib/format'
import type { ClockOptions } from './lib/format'
import { ICON_DEFAULT, ICON_NONE, ICON_TOOLS, OWN_ICONS, groupChoices, iconChoices, iconStyleOf } from './lib/icons'
import { cellsOf, truncateCells } from './lib/width'
import { NOTE_CELLS_MAX } from './tools/notes'
import { isClipsTabOn } from './clips'
import { CONFIG_PREFIX } from './runtime'
import type { Versions } from './runtime'
import { weatherRefreshMs } from './tools/weather'
import { drawLabeledButton, drawPicker, pickerButton, pickerList } from './picker'
import { ACCENT, ACCENT_TEXT, cardFrame, drawCard } from './card'
import { pomodoroConfig, pomodoroProgress } from './tools/pomodoro'
import type { Picker } from './picker'
import { BUTTON_PREFIX, isItemShown, reservedHotkeys, toolForItem } from './tools/registry'
import type { Ctx, LayoutOp } from './tools/registry'
import { firstLine, isTocTabOn } from './tools/toc'
import type { TocView, TocViewOp } from './tools/toc'
import { TOC_CELLS_MIN, TOC_MARGIN, drawTocTab } from './toc-tab'
import { activeButtons, validateButton } from './tools/user'
import type { ButtonDraft, DraftField, Validation } from './tools/user'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
// Mobile draws no Input: there the form is left out. Lists are Buttons (hooks/picker.tsx), drawn everywhere.
export type PaneKit = Kit & Partial<Pick<Elements['terminal'], 'Input'>>
type FormKit = Kit & Pick<Elements['terminal'], 'Input'>

export type PaneAction =
  | { kind: 'tab'; tab: PaneTab }
  | { kind: 'layout'; op: LayoutOp; id: string }
  | { kind: 'layout.reset' }
  // An icon picked for a layout row: `id` is the row's item id (a tool, or `btn:<id>`); the value an icon, "none" or "default".
  | { kind: 'icon.set'; id: string; value: string }
  // The group of icons the lists show (this session only).
  | { kind: 'icon.group'; group: string }
  | { kind: 'button.delete'; id: string }
  // null opens an empty form for a new button.
  | { kind: 'draft.open'; id: string | null }
  | { kind: 'draft.field'; field: DraftField; value: string }
  | { kind: 'draft.save' }
  | { kind: 'draft.cancel' }
  // A tool pressed from the status tab, as its band button does.
  | { kind: 'press'; id: string }
  // A prompt of the contents tab: bring its transcript row into view.
  | { kind: 'toc.go'; requestId: string }
  // The desktop app's opened prompt row (hooks/toc-live.ts viewTocRow), and its answer saved alone.
  | { kind: 'toc.view'; op: TocViewOp | 'export'; key: string }
  // The notes tab: save what was typed, put a note in the prompt box, delete a note.
  | { kind: 'note.add'; text: string }
  | { kind: 'note.fill'; id: string }
  | { kind: 'note.delete'; id: string }
  // The clipboard tab (hooks/clips.ts): put a clip in the prompt box, delete it.
  | { kind: 'clip.fill'; id: string }
  | { kind: 'clip.delete'; id: string }
  // Button sets: show another set, make one (it starts empty and is shown), delete the one shown.
  | { kind: 'set.pick'; name: string }
  | { kind: 'set.add'; name: string }
  | { kind: 'set.delete' }
  // A /config row of this mod changed from the status tab; the value is a choice, or `true`/`false` for a toggle.
  | { kind: 'setting.set'; key: string; value: string }
  // The part of the guide to show.
  | { kind: 'guide.section'; section: GuideSection }
  // The status tab's export format: the band's export button saves in it from now on.
  | { kind: 'export.format'; format: ExportFormat }
  // The pick list to open (hooks/picker.tsx), or null to close the open one.
  | { kind: 'picker.open'; key: string | null }
  // The status tab's pomodoro reset, as /toolbelt pomodoro reset.
  | { kind: 'pomodoro'; verb: 'reset' }

export type Act = (action: PaneAction, surface: RenderSurface) => unknown

export type PaneModel = {
  ctx: Ctx
  // How the status tab names the language in use, e.g. "ko (ko-KR)", and the versions running.
  language: string
  versions: Versions | null
  knownCommands: readonly string[] | null
  // The mod's own /config rows, which the status tab shows and changes, and whose they are: the engine's, or the mod's
  // own from plugin.json where the engine lists none (the desktop app, hooks/own-settings.ts).
  settings: readonly ConfigRow[]
  settingsSource: 'engine' | 'own'
  // The band is drawn at its short size and a button there shows its icon without its name.
  isBandShort: boolean
  // This surface tells the mod what the person selects: a terminal Claude Code draws in full, or the desktop app
  // (hooks/clips.ts).
  canSelect: boolean
  // The prompts tab as hooks/toc-live.ts sees it, and the panel's width in cells.
  toc: TocView
  columns: number
  // The clock's locale, zone and cycle, which the notes' dates follow.
  clock: ClockOptions
}

const tabsOf = (ctx: Ctx): readonly PaneTab[] => [
  ...(isTocTabOn(ctx.options) ? ['toc' as const] : []), 'notes', ...(isClipsTabOn(ctx.options) ? ['clips' as const] : []), 'status', 'tools', 'guide',
]
const NAME_CELLS_MAX = 24
const ARROW = { up: '↑', down: '↓', toRight: '→', toLeft: '←' } as const

const pressOf = (act: Act, action: PaneAction) => (press: { surface: RenderSurface }) => void act(action, press.surface)

function itemName(id: string, ctx: Ctx): string {
  if (!id.startsWith(BUTTON_PREFIX)) return ctx.t(`tool.${id}`)
  return activeButtons(ctx.state.buttons).find(b => BUTTON_PREFIX + b.id === id)?.label ?? id
}

// A fixed-width name cell so the row buttons line up.
function nameCell(kit: Kit, key: string, name: string, width: number): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key={key} width={width} flexShrink={0}>
      <Text wrap="truncate-end">{name}</Text>
    </Box>
  )
}

// Row controls are plain and dim: bracketed Buttons are drawn bold, which some terminals color loudly.
function control(kit: Kit, key: string, label: string, onPress: (press: { surface: RenderSurface }) => void): RenderElement {
  const { Button } = kit
  return <Button key={key} label={label} plain dimColor onPress={onPress} />
}

// The band shows no hotkeys; the panel names them, `h:` before the tool. Not in the desktop app, where no letter
// reaches the band; the cell keeps the names in line.
function hotkeyCell(kit: Kit, id: string, ctx: Ctx): RenderElement {
  const { Box, Text } = kit
  const hotkey = ctx.surface === 'desktop' ? undefined : toolForItem(id, ctx)?.hotkey?.(ctx)
  return (
    <Box key={`hotkey-${id}`} width={2} flexShrink={0}>
      <Text dimColor>{hotkey === undefined ? '' : `${hotkey}:`}</Text>
    </Box>
  )
}

// A layout row's icon button, `icon ▾`: the longest text it shows (an icon, or "None") and a space and the arrow.
const ICON_PICK_FRAME = 2
const pickCells = (ctx: Ctx): number => ICON_PICK_FRAME + Math.max(2, cellsOf(ctx.t('icon.none')))

// What a row leaves for the name: the panel's width less the margin, the hotkey, the icon list, the controls and the
// one-cell gaps between them. A narrow panel cuts the name instead of wrapping the row.
function nameRoom(ctx: Ctx, columns: number, pick: number): number {
  const controls = 3 + Math.max(cellsOf(ctx.t('layout.hide')), cellsOf(ctx.t('layout.show')))
  return columns - TOC_MARGIN - 2 - pick - controls - (pick === 0 ? 5 : 6)
}

type RowWidths = { name: number; pick: number }

// The icon list of a row: a fixed tool that takes an icon (with "default") or a button of the set; none for the clock,
// the date and the weather, whose cell is left blank so the names line up.
function iconPicker(id: string, ctx: Ctx, act: Act): Picker | null {
  const button = id.startsWith(BUTTON_PREFIX) ? activeButtons(ctx.state.buttons).find(b => BUTTON_PREFIX + b.id === id) : undefined
  const isTool = ICON_TOOLS.includes(id)
  if (!isTool && button === undefined) return null
  const current = button === undefined ? (ctx.state.icons[id] ?? ICON_DEFAULT) : (button.icon ?? ICON_NONE)
  const options = iconChoices(ctx.t, ctx.state.iconGroup, current, isTool ? (OWN_ICONS[id] ?? null) : null)
  return { key: `icon-${id}`, options, value: current, onPick: (value, surface) => void act({ kind: 'icon.set', id, value }, surface) }
}

function layoutRow(kit: PaneKit, id: string, side: 'left' | 'right' | 'hidden', widths: RowWidths, ctx: Ctx, act: Act): RenderElement {
  const { Box } = kit
  const op = (o: LayoutOp) => pressOf(act, { kind: 'layout', op: o, id })
  const controls =
    side === 'hidden'
      ? [control(kit, `show-${id}`, ctx.t('layout.show'), op('show'))]
      : [
          control(kit, `up-${id}`, ARROW.up, op('up')),
          control(kit, `down-${id}`, ARROW.down, op('down')),
          control(kit, `side-${id}`, side === 'left' ? ARROW.toRight : ARROW.toLeft, op('side')),
          control(kit, `hide-${id}`, ctx.t('layout.hide'), op('hide')),
        ]
  const picker = iconPicker(id, ctx, act)
  const row = (
    <Box key={`row-${id}`} flexDirection="row" columnGap={1}>
      {hotkeyCell(kit, id, ctx)}
      <Box key={`icon-box-${id}`} width={widths.pick} flexShrink={0}>
        {picker === null ? null : pickerButton(kit, picker, ctx, act)}
      </Box>
      {nameCell(kit, `name-${id}`, itemName(id, ctx), widths.name)}
      {controls}
    </Box>
  )
  // The open icon list goes under the row, as wide as the panel.
  const list = picker === null ? null : pickerList(kit, picker, ctx, act)
  return list === null ? row : <Box key={`item-${id}`} flexDirection="column">{row}{list}</Box>
}

function layoutGroup(kit: PaneKit, side: 'left' | 'right' | 'hidden', ids: readonly string[], widths: RowWidths, ctx: Ctx, act: Act): RenderElement {
  const { Box, Text } = kit
  const title = { left: 'layout.left', right: 'layout.right', hidden: 'layout.hiddenTools' }[side]
  return (
    <Box key={`group-${side}`} flexDirection="column">
      <Text dimColor>{ctx.t(title)}</Text>
      {ids.length === 0 ? <Text dimColor>{ctx.t('layout.empty')}</Text> : ids.map(id => layoutRow(kit, id, side, widths, ctx, act))}
    </Box>
  )
}

// The icon group the icon lists show (this session only).
const groupPicker = (key: string, ctx: Ctx, act: Act): Picker => ({
  key, label: ctx.t('icon.group'), options: groupChoices(ctx.t), value: ctx.state.iconGroup,
  onPick: (group, surface) => void act({ kind: 'icon.group', group }, surface),
})

// The layout: the items shown now (fixed tools and the active set's buttons), per side.
function layoutSection(kit: PaneKit, ctx: Ctx, act: Act, columns: number): RenderElement {
  const { Box, Button, Text } = kit
  const inner = columns - cardFrame(columns)
  const shown = (ids: readonly string[]) => ids.filter(id => isItemShown(id, ctx))
  const { left, right, hidden } = ctx.state.layout
  const sides = { left: shown(left), right: shown(right), hidden: shown(hidden) }
  const names = [...sides.left, ...sides.right, ...sides.hidden].map(id => cellsOf(itemName(id, ctx)))
  const pick = pickCells(ctx)
  const longest = Math.max(0, ...names)
  const widths = { name: Math.max(4, Math.min(NAME_CELLS_MAX, nameRoom(ctx, inner, pick), longest)), pick }
  return drawCard(kit, { key: 'layout', title: ctx.t('layout.title'), columns }, [
    <Box key="layout-body" flexDirection="column" rowGap={1}>
      <Box key="icon-group-help" flexDirection="column">
        {drawPicker(kit, groupPicker('icon-group', ctx, act), ctx, act)}
        <Text dimColor>{ctx.t('layout.iconHelp')}</Text>
      </Box>
      {layoutGroup(kit, 'left', sides.left, widths, ctx, act)}
      {layoutGroup(kit, 'right', sides.right, widths, ctx, act)}
      <Text dimColor>{ctx.t('layout.moreNote')}</Text>
      {layoutGroup(kit, 'hidden', sides.hidden, widths, ctx, act)}
      <Button key="layout-reset" label={ctx.t('layout.reset')} onPress={pressOf(act, { kind: 'layout.reset' })} />
    </Box>,
  ])
}

function buttonRow(kit: Kit, button: ToolButton, width: number, canEdit: boolean, ctx: Ctx, act: Act): RenderElement {
  const { Box, Text } = kit
  const hotkey = button.hotkey ? ctx.t('pane.hotkey', { key: button.hotkey }) : ctx.t('pane.hotkeyNone')
  const facts = [ctx.t(`pane.kind.${button.kind}`), ctx.t(`pane.mode.${button.mode}`), hotkey].join(' · ')
  return (
    <Box key={`button-${button.id}`} flexDirection="row" columnGap={2}>
      {nameCell(kit, `label-${button.id}`, button.label, width)}
      <Text dimColor wrap="truncate-end">{facts}</Text>
      {canEdit ? control(kit, `edit-${button.id}`, ctx.t('pane.edit'), pressOf(act, { kind: 'draft.open', id: button.id })) : null}
      {control(kit, `delete-${button.id}`, ctx.t('pane.delete'), pressOf(act, { kind: 'button.delete', id: button.id }))}
    </Box>
  )
}

// The check of the form, drawn live under it and run again on Save: errors block saving, warnings do not.
export function draftIssues(draft: ButtonDraft, buttons: ButtonConfig, knownCommands: readonly string[] | null): Validation {
  return validateButton(draft, {
    existing: activeButtons(buttons),
    reserved: reservedHotkeys(),
    cells: cellsOf,
    ...(knownCommands === null ? {} : { knownCommands }),
  })
}

function issueLines(kit: Kit, issues: Validation, ctx: Ctx): RenderElement[] {
  const { Text } = kit
  return [
    ...issues.errors.map(i => <Text color="error">{ctx.t(i.key, i.args)}</Text>),
    ...issues.warnings.map(i => <Text color="warning">{ctx.t(i.key, i.args)}</Text>),
  ]
}

// A field's one-line description, under it.
const help = (kit: Kit, ctx: Ctx, key: string): RenderElement => <kit.Text dimColor>{ctx.t(key)}</kit.Text>

function kindFields(kit: FormKit, draft: ButtonDraft, ctx: Ctx, act: Act, field: (f: DraftField) => FieldHandlers): RenderElement[] {
  const { Input } = kit
  if (draft.kind === 'prompt' || draft.kind === undefined) {
    const modes = (['fill', 'send'] as const).map(m => ({ value: m, label: ctx.t(`pane.mode.${m}`) }))
    return [
      <Input key="field-text" label={ctx.t('pane.field.text')} rows={3} value={draft.text ?? ''} {...field('text')} />,
      help(kit, ctx, 'pane.help.prompt'),
      drawPicker(kit, { key: 'field-mode', label: ctx.t('pane.field.mode'), options: modes, value: draft.mode === 'send' ? 'send' : 'fill', onPick: field('mode').onSubmit }, ctx, act),
    ]
  }
  return [
    <Input key="field-command" label={ctx.t('pane.field.command')} value={draft.command ?? ''} {...field('command')} />,
    help(kit, ctx, 'pane.help.command'),
    // One "prompt" field for every kind: here it is what follows the command (stored as `args`).
    <Input key="field-args" label={ctx.t('pane.field.text')} value={draft.args ?? ''} {...field('args')} />,
    help(kit, ctx, 'pane.help.commandPrompt'),
  ]
}

type FieldHandlers = { onInput: (value: string) => void; onSubmit: (value: string) => void }

// The edit form. Every edit and Enter writes the draft, so Save reads what is on screen.
function draftForm(kit: FormKit, draft: ButtonDraft, model: PaneModel, act: Act, surface: RenderSurface): RenderElement {
  const { Box, Button, Input, Text } = kit
  const { ctx } = model
  const set = (f: DraftField) => (value: string) => void act({ kind: 'draft.field', field: f, value }, surface)
  const field = (f: DraftField): FieldHandlers => ({ onInput: set(f), onSubmit: set(f) })
  const kinds = (['prompt', 'command', 'skill'] as const).map(k => ({ value: k, label: ctx.t(`pane.kind.${k}`) }))
  return drawCard(kit, { key: 'form', title: ctx.t(draft.id === undefined ? 'pane.formNew' : 'pane.formEdit'), columns: model.columns }, [
    <Box key="form-body" flexDirection="column">
      <Input key="field-label" label={ctx.t('pane.field.label')} value={draft.label ?? ''} {...field('label')} />
      {help(kit, ctx, 'pane.help.label')}
      {drawPicker(kit, groupPicker('field-icon-group', ctx, act), ctx, act)}
      {drawPicker(kit, { key: 'field-icon', label: ctx.t('pane.field.icon'), options: iconChoices(ctx.t, ctx.state.iconGroup, draft.icon || ICON_NONE, null), value: draft.icon || ICON_NONE, onPick: set('icon') }, ctx, act)}
      {help(kit, ctx, 'pane.help.icon')}
      {drawPicker(kit, { key: 'field-kind', label: ctx.t('pane.field.kind'), options: kinds, value: draft.kind ?? 'prompt', onPick: set('kind') }, ctx, act)}
      {kindFields(kit, draft, ctx, act, field)}
      <Input key="field-hotkey" label={ctx.t('pane.field.hotkey')} value={draft.hotkey ?? ''} {...field('hotkey')} />
      {issueLines(kit, draftIssues(draft, ctx.state.buttons, model.knownCommands), ctx)}
      <Box key="form-actions" flexDirection="row" columnGap={1}>
        {ctx.surface === 'terminal'
          ? <Button key="save" label={ctx.t('pane.save')} onPress={pressOf(act, { kind: 'draft.save' })}><Text color={ACCENT} weight="semibold">{ctx.t('pane.save')}</Text></Button>
          : <Button key="save" variant="primary" label={ctx.t('pane.save')} onPress={pressOf(act, { kind: 'draft.save' })} />}
        <Button key="cancel" label={ctx.t('pane.cancel')} onPress={pressOf(act, { kind: 'draft.cancel' })} />
      </Box>
    </Box>,
  ])
}

// The sets: which set the band shows, Delete for that set, and + New set, which opens a field for the new one's name (a
// bare field was easy to miss). The field is open while `openPicker` names it.
export const SET_NEW_FIELD = 'set-new'

function setControls(kit: FormKit, ctx: Ctx, act: Act): RenderElement {
  const { Box, Button, Input, Text } = kit
  const isAdding = ctx.state.openPicker === SET_NEW_FIELD
  const toggleNew = pressOf(act, { kind: 'picker.open', key: isAdding ? null : SET_NEW_FIELD })
  const { sets, activeSet } = ctx.state.buttons
  const picker: Picker = {
    key: 'set', label: ctx.t('pane.set'), options: Object.keys(sets).map(name => ({ value: name, label: name })), value: activeSet,
    onPick: (name, surface) => void act({ kind: 'set.pick', name }, surface),
  }
  return (
    <Box key="sets" flexDirection="column" rowGap={1}>
      <Box key="set-pick" flexDirection="column">
        <Box key="set-row" flexDirection="row" columnGap={2}>
          {pickerButton(kit, picker, ctx, act)}
          {control(kit, 'set-delete', ctx.t('pane.setDelete'), pressOf(act, { kind: 'set.delete' }))}
        </Box>
        {pickerList(kit, picker, ctx, act)}
        {/* On its own line under the set row; the name field opens in its place. */}
        {isAdding ? (
          <Box key="set-new-field" flexDirection="column">
            <Input key={SET_NEW_FIELD} autoFocus placeholder={ctx.t('pane.setNew')} submitLabel={ctx.t('pane.setAdd')} value="" onSubmit={name => void act({ kind: 'set.add', name }, ctx.surface)} />
            <Button key="set-new-cancel" label={ctx.t('pane.cancel')} onPress={toggleNew} />
          </Box>
        ) : <Button key="set-new-open" label={ctx.t('pane.newSet')} onPress={toggleNew} />}
        <Text dimColor>{ctx.t('pane.setHelp')}</Text>
      </Box>
    </Box>
  )
}

function toolsTab(kit: PaneKit, model: PaneModel, act: Act): RenderElement {
  const { Box, Button, Input } = kit
  const { ctx } = model
  const form = Input === undefined ? null : { ...kit, Input }
  const draft = ctx.state.editDraft
  const buttons = activeButtons(ctx.state.buttons)
  const width = Math.min(NAME_CELLS_MAX, Math.max(4, ...buttons.map(b => cellsOf(b.label))))
  return (
    <Box key="tools" flexDirection="column" rowGap={1}>
      {layoutSection(kit, ctx, act, model.columns)}
      {drawCard(kit, { key: 'buttons', title: ctx.t('pane.setName', { name: ctx.state.buttons.activeSet }), columns: model.columns }, [
        <Box key="buttons-body" flexDirection="column" rowGap={1}>
          {form === null ? null : setControls(form, ctx, act)}
          <Box key="button-rows" flexDirection="column">
            {buttons.map(b => buttonRow(kit, b, width, form !== null, ctx, act))}
          </Box>
          {form === null ? null : <Button key="button-new" label={ctx.t('pane.newButton')} onPress={pressOf(act, { kind: 'draft.open', id: null })} />}
        </Box>,
      ])}
      {form === null || draft === null ? null : draftForm(form, draft, model, act, ctx.surface)}
    </Box>
  )
}

// The pomodoro's bar under its button while a round runs or waits: spaces on a colour, focus in the accent colour and a
// break in the success colour, the rest in the subtle one, then the percent.
const METER_CELLS_MAX = 20

function pomodoroMeter(kit: Kit, ctx: Ctx, columns: number): RenderElement | null {
  const { Box, Text } = kit
  const progress = pomodoroProgress(ctx.state.pomodoro, ctx.now, pomodoroConfig(ctx.options))
  const width = Math.min(METER_CELLS_MAX, columns - 6)
  if (progress === null || width < 4) return null
  const filled = Math.round(progress.ratio * width)
  return (
    <Box key="pomodoro-meter" flexDirection="row" columnGap={1}>
      <Box key="pomodoro-meter-bar" flexDirection="row">
        {filled > 0 ? <Text backgroundColor={progress.phase === 'break' ? 'success' : ACCENT}>{' '.repeat(filled)}</Text> : null}
        {width - filled > 0 ? <Text backgroundColor="subtle">{' '.repeat(width - filled)}</Text> : null}
      </Box>
      <Text dimColor>{`${Math.round(progress.ratio * 100)}%`}</Text>
    </Box>
  )
}

// Every tool the person has not hidden, pressable here whatever fits in the band (the band's … opens it).
function allTools(kit: Kit, ctx: Ctx, act: Act, columns: number): RenderElement {
  const { Button, Text } = kit
  const ids = [...ctx.state.layout.left, ...ctx.state.layout.right].filter(id => isItemShown(id, ctx))
  // This list is where the names are: the icon-only style is drawn with its words here.
  const named = ctx.options.iconStyle === 'icon' ? { ...ctx, options: { ...ctx.options, iconStyle: 'icon+label' } } : ctx
  const rows = ids.flatMap(id => {
    const tool = toolForItem(id, ctx)
    if (tool === undefined) return []
    const label = tool.label(named, 'long')
    if (label === '') return []
    if (tool.kind === 'text') return [<Text>{label}</Text>]
    const button = <Button key={`more-${id}`} label={label} onPress={pressOf(act, { kind: 'press', id })} />
    return id === 'pomodoro' ? [button, pomodoroMeter(kit, ctx, columns - cardFrame(columns))] : [button]
  })
  return drawCard(kit, { key: 'more', title: ctx.t('more.title'), columns }, [<Text dimColor>{ctx.t('more.description')}</Text>, ...rows])
}

// The clipboard tab: the selections copied by dragging, newest first, as the notes are drawn but with no time, so
// Insert and Delete stay in a narrow panel: the first line, Insert and Delete. A surface where no selection reaches the
// mod (the main screen, a surface not known to answer) says so in place of the empty list's line.
function clipsTab(kit: PaneKit, model: PaneModel, act: Act): RenderElement {
  const { Box, Text } = kit
  const { ctx } = model
  const clips = ctx.state.clipBoard.clips
  const buttons = cellsOf(ctx.t('notes.insert')) + cellsOf(ctx.t('pane.delete'))
  // The row's gaps are two one-cell columns; the panel may draw a focus mark in the margin.
  const room = model.columns - TOC_MARGIN - buttons - 2
  // A clip of several lines says how many after its first, as Insert puts them all.
  const lines = clips.map(clip => {
    const count = clip.text.split('\n').length
    const more = count > 1 ? ` ${ctx.t('clips.lines', { count })}` : ''
    return `${truncateCells(firstLine(clip.text), Math.max(1, Math.min(NOTE_CELLS_MAX, Math.max(TOC_CELLS_MIN, room)) - cellsOf(more)))}${more}`
  })
  const lineCells = Math.max(0, ...lines.map(cellsOf))
  return (
    <Box key="clips" flexDirection="column" rowGap={1}>
      <Text dimColor>{ctx.t('clips.intro')}</Text>
      {!model.canSelect ? <Text dimColor>{ctx.t('clips.notHere')}</Text> : clips.length === 0 ? <Text dimColor>{ctx.t('clips.empty')}</Text> : null}
      <Box key="clip-list" flexDirection="column">
        {clips.map((clip, i) => (
          <Box key={`clip-${clip.id}`} flexDirection="row" columnGap={1}>
            {nameCell(kit, `clip-text-${clip.id}`, lines[i] ?? '', lineCells)}
            {control(kit, `clip-fill-${clip.id}`, ctx.t('notes.insert'), pressOf(act, { kind: 'clip.fill', id: clip.id }))}
            {control(kit, `clip-delete-${clip.id}`, ctx.t('pane.delete'), pressOf(act, { kind: 'clip.delete', id: clip.id }))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// The notes tab: the field to type in, then the notes newest first: date and time, the first line, Insert and Delete.
// Mobile draws no Input, so there only the list shows.
function notesTab(kit: PaneKit, model: PaneModel, act: Act): RenderElement {
  const { Box, Text, Input } = kit
  const { ctx } = model
  const notes = [...ctx.state.notes].reverse()
  const stamps = notes.map(note => formatStamp(note.createdAt, model.clock))
  const stampCells = Math.max(0, ...stamps.map(cellsOf))
  const buttons = cellsOf(ctx.t('notes.insert')) + cellsOf(ctx.t('pane.delete'))
  // The row's gaps are three one-cell columns; the panel may draw a focus mark in the margin.
  const room = model.columns - TOC_MARGIN - stampCells - buttons - 3
  const lines = notes.map(note => truncateCells(firstLine(note.text), Math.min(NOTE_CELLS_MAX, Math.max(TOC_CELLS_MIN, room))))
  const lineCells = Math.max(0, ...lines.map(cellsOf))
  return (
    <Box key="notes" flexDirection="column" rowGap={1}>
      {Input === undefined ? null : (
        <Input
          key="note-input"
          rows={3}
          placeholder={ctx.t('notes.placeholder')}
          submitLabel={ctx.t('notes.add')}
          autoFocus
          value=""
          onSubmit={text => void act({ kind: 'note.add', text }, ctx.surface)}
        />
      )}
      {notes.length === 0 ? <Text dimColor>{ctx.t('notes.empty')}</Text> : null}
      <Box key="note-list" flexDirection="column">
        {notes.map((note, i) => (
          <Box key={`note-${note.id}`} flexDirection="row" columnGap={1}>
            <Box key={`note-stamp-${note.id}`} width={stampCells} flexShrink={0}>
              <Text dimColor>{stamps[i]}</Text>
            </Box>
            {nameCell(kit, `note-text-${note.id}`, lines[i] ?? '', lineCells)}
            {control(kit, `note-fill-${note.id}`, ctx.t('notes.insert'), pressOf(act, { kind: 'note.fill', id: note.id }))}
            {control(kit, `note-delete-${note.id}`, ctx.t('pane.delete'), pressOf(act, { kind: 'note.delete', id: note.id }))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// The export format (kept in the store, not /config): a settings row after the export folder. pdf needs a browser to
// print with (pdfBrowser) and a terminal to run it in.
function exportFormatRow(kit: PaneKit, ctx: Ctx, act: Act): RenderElement {
  const choose = (value: string, surface: RenderSurface) => {
    const format = asExportFormat(value)
    if (format !== null) void act({ kind: 'export.format', format }, surface)
  }
  const canPdf = ctx.surface === 'terminal' && ctx.options.pdfBrowser !== undefined && ctx.options.pdfBrowser !== 'off'
  const formats = EXPORT_FORMATS.filter(format => format !== 'pdf' || canPdf).map(format => ({ value: format, label: format }))
  const value = formats.some(f => f.value === ctx.state.exportFormat) ? ctx.state.exportFormat : 'html'
  return drawPicker(kit, { key: 'export-format', label: ctx.t('status.exportFormat'), options: formats, value, onPick: choose }, ctx, act)
}

// The weather as the status tab tells it: when it came, how often it comes, or why it did not; nothing while it is off.
function weatherFact(ctx: Ctx, clock: ClockOptions): string | null {
  const place = ctx.options.weatherPlace
  if (typeof place !== 'string' || place === 'off') return null
  const minutes = weatherRefreshMs(ctx.options) / 60_000
  const weather = ctx.state.weather
  if (weather.status === 'ok' && weather.fetchedAt !== null) return ctx.t('status.weatherOk', { place, time: formatStamp(weather.fetchedAt, clock), minutes })
  return weather.status === 'error' ? ctx.t('status.weatherError', { place, minutes }) : ctx.t('status.weatherLoading', { place })
}

// This session first: the versions, the language, the weather, the finished focus rounds and whether anything failed,
// with where to read more when it did; then every tool, then the settings.
function statusTab(kit: PaneKit, model: PaneModel, act: Act): RenderElement {
  const { Box, Text } = kit
  const { ctx } = model
  const error = ctx.state.lastError
  const weather = weatherFact(ctx, model.clock)
  return (
    <Box key="status" flexDirection="column" rowGap={1}>
      {drawCard(kit, { key: 'status-facts', title: ctx.t('status.title'), columns: model.columns }, [
        model.versions === null ? null : <Text>{ctx.t('status.versions', model.versions)}</Text>,
        <Text>{ctx.t('status.language', { lang: model.language })}</Text>,
        weather === null ? null : <Text>{weather}</Text>,
        <Text>{ctx.t('status.pomodoroRounds', { count: ctx.state.pomodoro.round })}</Text>,
        // A mark beside the words, so the colour is not the only sign.
        <Box key="status-error" flexDirection="row" columnGap={1}>
          <Text color={error === null ? 'success' : 'error'}>{error === null ? '✓' : '✗'}</Text>
          <Text>{error === null ? ctx.t('status.noError') : ctx.t('status.lastError', { error })}</Text>
        </Box>,
        error === null ? null : <Text dimColor>{ctx.t('status.debugHint')}</Text>,
      ])}
      {allTools(kit, ctx, act, model.columns)}
      {settingsSection(kit, model, act)}
    </Box>
  )
}

// The text a language file has for `key`, or undefined: t answers a key it does not know with the key itself.
const known = (ctx: Ctx, key: string): string | undefined => {
  const text = ctx.t(key)
  return text === key ? undefined : text
}

// The mod's /config rows: a toggle flips with one press, a choice opens its list. A locked row, or one with nothing to
// pick, shows the value as text. Names and worded values are the person's language (`settings.field.<field>`,
// `settings.value.<field>.<value>` or `settings.value.<value>`); /config shows plugin.json's English, and a field or
// value the files lack keeps the engine's text.
function settingsSection(kit: PaneKit, model: PaneModel, act: Act): RenderElement {
  const { Box, Text } = kit
  const { ctx } = model
  const rows = model.settings.map(row => {
    const field = row.key.slice(CONFIG_PREFIX.length)
    const name = known(ctx, `settings.field.${field}`) ?? row.label
    const word = (value: string) => known(ctx, `settings.value.${field}.${value}`) ?? known(ctx, `settings.value.${value}`) ?? value
    const shown = typeof row.value === 'boolean' ? ctx.t(row.value ? 'settings.on' : 'settings.off') : word(String(row.value))
    const key = `setting-${row.key}`
    const pick = (value: string, surface: RenderSurface) => void act({ kind: 'setting.set', key: row.key, value }, surface)
    if (!row.isLocked && row.kind === 'boolean') return drawLabeledButton(kit, key, name, shown, press => pick(String(row.value !== true), press.surface))
    const options = (row.options ?? []).map(option => ({ value: option, label: word(option) }))
    // A Text takes no key: a line of text goes in a keyed Box.
    if (row.isLocked || row.kind !== 'choice' || options.length === 0) return <Box key={key}><Text>{`${name}: ${shown}`}</Text></Box>
    return drawPicker(kit, { key, label: name, options, value: String(row.value), onPick: pick }, ctx, act)
  })
  // Rows the panel adds among them, each after the last row it follows or last: the pomodoro's reset after its
  // settings, the export format after the export folder, and under the icon style, while the band is too narrow for
  // names, a note that it shows icons only.
  const isIconsOnly = model.isBandShort && iconStyleOf(ctx.options.iconStyle) === 'icon+label'
  const extras = [
    { follows: (key: string) => key.startsWith(`${CONFIG_PREFIX}pomodoro`), row: drawLabeledButton(kit, 'pomodoro-reset', ctx.t('settings.pomodoro'), ctx.t('settings.pomodoroReset'), pressOf(act, { kind: 'pomodoro', verb: 'reset' })) },
    { follows: (key: string) => key === `${CONFIG_PREFIX}exportDirectory`, row: exportFormatRow(kit, ctx, act) },
    ...(isIconsOnly ? [{ follows: (key: string) => key === `${CONFIG_PREFIX}iconStyle`, row: <Box key="icon-style-short"><Text dimColor>{ctx.t('settings.iconsOnly')}</Text></Box> }] : []),
  ].map(extra => ({ ...extra, at: model.settings.findLastIndex(row => extra.follows(row.key)) }))
  const listed = [...rows.flatMap((row, i) => [row, ...extras.filter(x => x.at === i).map(x => x.row)]), ...extras.filter(x => x.at === -1).map(x => x.row)]
  const isOwn = model.settingsSource === 'own'
  return drawCard(kit, { key: 'settings', title: ctx.t(isOwn ? 'settings.titleOwn' : 'settings.title'), columns: model.columns }, [
    rows.length === 0 ? <Text dimColor>{ctx.t(isOwn ? 'settings.noneOwn' : 'settings.none')}</Text> : null,
    ...listed,
  ])
}

// The tabs that fit on one line (wrapped tabs took the top of a narrow panel): all of them, or the one shown and those
// after it in order that fit beside a … button, which lists the rest.
// A tab is `[ name ]` (4 cells around the name), or ` name ` as a badge in the terminal (2 cells).
const TAB_FRAME = 4
const BADGE_FRAME = 2
const MORE_TABS = '…'

export function fitTabs(names: readonly PaneTab[], shown: PaneTab, cells: (tab: PaneTab) => number, room: number, frame = TAB_FRAME): { fitted: PaneTab[]; rest: PaneTab[] } {
  const width = (tab: PaneTab) => cells(tab) + frame + 1
  if (names.reduce((sum, tab) => sum + width(tab), 0) - 1 <= room) return { fitted: [...names], rest: [] }
  const budget = room - (cellsOf(MORE_TABS) + frame)
  const chosen = names.reduce((kept, tab) => (tab !== shown && kept.used + width(tab) <= budget ? { used: kept.used + width(tab), tabs: [...kept.tabs, tab] } : kept), { used: width(shown), tabs: [shown] })
  return { fitted: names.filter(tab => chosen.tabs.includes(tab)), rest: names.filter(tab => !chosen.tabs.includes(tab)) }
}

export function drawPane(kit: PaneKit, model: PaneModel, act: Act): RenderElement {
  const { Box, Button, Text } = kit
  const { ctx } = model
  const names = tabsOf(ctx)
  const tab = names.includes(ctx.state.paneTab) ? ctx.state.paneTab : 'tools'
  const label = (name: PaneTab) => ctx.t(`pane.tab.${name}`)
  // The terminal shows the tab in use as a badge, the accent colour behind its name, and the others dim; a desktop
  // keeps its own buttons.
  const isBadge = ctx.surface === 'terminal'
  const { fitted, rest } = fitTabs(names, tab, name => cellsOf(label(name)), model.columns - TOC_MARGIN, isBadge ? BADGE_FRAME : TAB_FRAME)
  const go = (name: PaneTab) => pressOf(act, { kind: 'tab', tab: name })
  const tabs = fitted.map(name =>
    !isBadge ? <Button key={`tab-${name}`} label={label(name)} {...(name === tab ? { variant: 'primary' as const } : {})} onPress={go(name)} />
    : name === tab ? <Button key={`tab-${name}`} plain onPress={go(name)}><Text backgroundColor={ACCENT} color={ACCENT_TEXT} weight="semibold">{` ${label(name)} `}</Text></Button>
    : <Button key={`tab-${name}`} label={` ${label(name)} `} plain dimColor onPress={go(name)} />,
  )
  const more: Picker = { key: 'tab-more', options: rest.map(name => ({ value: name, label: label(name) })), value: '', onPick: (name, surface) => void act({ kind: 'tab', tab: name as PaneTab }, surface) }
  const isMoreOpen = ctx.state.openPicker === more.key
  const body =
    tab === 'toc' ? drawTocTab(kit, { view: model.toc, columns: model.columns }, ctx, act)
    : tab === 'notes' ? notesTab(kit, model, act)
    : tab === 'clips' ? clipsTab(kit, model, act)
    : tab === 'status' ? statusTab(kit, model, act)
    : tab === 'guide' ? drawGuide(kit, ctx, act, model.columns)
    : toolsTab(kit, model, act)
  return (
    <Box key="pane" flexDirection="column" rowGap={1}>
      <Box key="tab-bar" flexDirection="column">
        <Box key="tabs" flexDirection="row" columnGap={1}>
          {tabs}
          {rest.length === 0 ? null : <Button key="tab-more" label={isBadge ? ` ${MORE_TABS} ` : MORE_TABS} {...(isBadge ? { plain: true as const, dimColor: true } : {})} onPress={pressOf(act, { kind: 'picker.open', key: isMoreOpen ? null : more.key })} />}
        </Box>
        {pickerList(kit, more, ctx, act)}
      </Box>
      {body}
    </Box>
  )
}
