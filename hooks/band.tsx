// The band above the prompt: which items fit, and the tree that draws them.
// Pure: register.tsx hands in the element table from `$.ui.resolve(e)` and the press callback.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { ACCENT } from './card'
import { PILL_PADDING, chipCells, drawChip } from './chip'
import type { Chip } from './chip'
import { DEFAULT_GAPS, fitBand } from './lib/fit'
import type { FitItem, FitSize } from './lib/fit'
import { cellsOf, padCells } from './lib/width'
import { isVoiceOn } from './tools/voice'
import { BUTTON_PREFIX, TOOLS, isItemShown, priorityOf, toolForItem } from './tools/registry'
import type { Ctx, Tool } from './tools/registry'
import type { BandCard } from './tools/toc'
import { activeButtons } from './tools/user'

export type BandKit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
export type PressItem = (id: string, surface: RenderSurface) => unknown

export type BandItem = {
  // The layout id: a tool id, or `btn:<id>` for a user button.
  id: string
  kind: 'text' | 'button'
  label: string
  hotkey?: string
  // A command or skill this session does not have: drawn dim.
  isDim: boolean
  // The curtain while it is on, or voice: drawn in the accent colour. A running pomodoro shows in its chip's meter.
  isActive: boolean
  group: 'user' | 'tool'
  // Information drawn as a chip (hooks/chip.tsx) in place of the label.
  chip?: Chip
}

// The surface and Claude Code's theme pick the chips' look and tints; `size` is the room fitBand gave the items, and
// `hidesNames` whether a button drawn lost its name to it.
export type BandModel = { left: BandItem[]; right: BandItem[]; more: BandItem | null; size: FitSize; hidesNames: boolean; surface: RenderSurface; theme: string | undefined }

// The ◂ mark at the band's left end folds it to one ▸ mark that unfolds it: each a bracketless button of one cell, the
// fold mark and the gap after it away from the engine's [-] at the right end. A mark is the button's label, dim until
// pointed at, as a desktop draws the label of a native button (d.ts Button).
export const FOLD_ID = 'fold'
export const UNFOLD_ID = 'unfold'
const FOLD_MARK = '◂'
const UNFOLD_MARK = '▸'

type Entry = { item: (size: FitSize) => BandItem; fit: FitItem }

// Every band button is drawn `[ label ]` (4 cells of chrome): a plain Button would print its hotkey as `o: label`, and
// hotkeys are shown in the panel only. Information (every `text` tool) is a chip, which counts its own cells.
const BUTTON_CHROME = 4
const cellsOfItem = (item: BandItem, surface: RenderSurface): number =>
  item.chip === undefined ? cellsOf(item.label) + BUTTON_CHROME : chipCells(item.chip) + (surface === 'terminal' ? 0 : PILL_PADDING)
const GROUP_MARK = '❘'
// The terminal parts the information with a dim rule and a space either side; a desktop sets its pills a cell apart.
const INFO_RULE = '│'
const LEFT_COLUMN_GAP = 1
const gapsOf = (surface: RenderSurface) => ({ ...DEFAULT_GAPS, left: surface === 'terminal' ? cellsOf(INFO_RULE) + 2 * LEFT_COLUMN_GAP : LEFT_COLUMN_GAP })
// A desktop draws even a plain button in a native frame, counted as the bracketed buttons are.
const foldCells = (surface: RenderSurface) => cellsOf(FOLD_MARK) + (surface === 'terminal' ? 0 : BUTTON_CHROME) + LEFT_COLUMN_GAP

function isMissingCommand(id: string, ctx: Ctx, knownCommands: readonly string[] | null): boolean {
  if (knownCommands === null || !id.startsWith(BUTTON_PREFIX)) return false
  const button = activeButtons(ctx.state.buttons).find(b => BUTTON_PREFIX + b.id === id)
  return button !== undefined && button.kind !== 'prompt' && !knownCommands.includes(button.command ?? '')
}

function itemOf(id: string, tool: Tool, ctx: Ctx, size: FitSize, isDim: boolean): BandItem {
  const hotkey = tool.hotkey?.(ctx)
  const chip = tool.chip?.(ctx, size)
  return {
    id,
    kind: tool.kind,
    label: tool.label(ctx, size),
    ...(hotkey === undefined ? {} : { hotkey }),
    isDim,
    isActive: (tool.id === 'curtain' && ctx.state.curtain) || (tool.id === 'voice' && isVoiceOn(ctx.state.voice)),
    group: id.startsWith(BUTTON_PREFIX) ? 'user' : 'tool',
    ...(chip === undefined ? {} : { chip }),
  }
}

function entryOf(id: string, side: 'left' | 'right', order: number, ctx: Ctx, known: readonly string[] | null): Entry | null {
  const tool = toolForItem(id, ctx)
  if (tool === undefined || !isItemShown(id, ctx)) return null
  const isDim = isMissingCommand(id, ctx, known)
  const item = (size: FitSize) => itemOf(id, tool, ctx, size, isDim)
  const [long, short] = [item('long'), item('short')]
  // An empty label (the clock before its first tick) takes no room and draws nothing.
  if (long.label === '') return null
  return { item, fit: { id, side, order, priority: priorityOf(tool, ctx), longCells: cellsOfItem(long, ctx.surface), shortCells: cellsOfItem(short, ctx.surface), group: long.group } }
}

// What the band draws at this width, or null when it should yield to the rest of the chain:
// too narrow or nothing to show.
export function bandModel(ctx: Ctx, bodyColumns: number, knownCommands: readonly string[] | null): BandModel | null {
  const { left, right } = ctx.state.layout
  const entries = [
    ...left.map((id, order) => entryOf(id, 'left', order, ctx, knownCommands)),
    ...right.map((id, order) => entryOf(id, 'right', order, ctx, knownCommands)),
  ].filter((entry): entry is Entry => entry !== null)
  const more = itemOf('more', TOOLS.more, ctx, 'short', false)
  const moreCells = cellsOfItem(more, ctx.surface)
  const fitted = fitBand({ bodyColumns: bodyColumns - foldCells(ctx.surface), items: entries.map(entry => entry.fit), moreCells, gaps: gapsOf(ctx.surface) })
  if (fitted === null || fitted.left.length + fitted.right.length + (fitted.hasMore ? 1 : 0) === 0) return null
  const byId = new Map(entries.map(entry => [entry.fit.id, entry]))
  const pick = (ids: readonly string[]): BandItem[] =>
    ids.flatMap(id => {
      const entry = byId.get(id)
      return entry === undefined ? [] : [entry.item(fitted.size)]
    })
  // `icon name` drawn as `icon`, an icon holding no letter or digit: a button with no icon keeps a shortened word.
  const hidesNames = fitted.size === 'short' && [...fitted.left, ...fitted.right].some(id => {
    const [long, short] = [byId.get(id)?.item('long'), byId.get(id)?.item('short')]
    return long?.kind === 'button' && short !== undefined && short.label !== '' && !/[\p{L}\p{N}]/u.test(short.label) && long.label.startsWith(`${short.label} `)
  })
  return { left: pick(fitted.left), right: pick(fitted.right), more: fitted.hasMore ? more : null, size: fitted.size, hidesNames, surface: ctx.surface, theme: ctx.state.themeRow?.value }
}

// Whether the band, drawn `columns` wide, is too narrow for a button's name (a band of icon-less buttons was once said
// to show icons only).
export const hidesButtonNames = (ctx: Ctx, columns: number | undefined, knownCommands: readonly string[] | null): boolean =>
  bandModel(ctx, columns ?? 0, knownCommands)?.hidesNames === true

function drawItem(kit: BandKit, model: BandModel, item: BandItem, onPress: PressItem): RenderElement {
  const { Button, Text } = kit
  if (item.chip !== undefined) {
    const press = item.kind === 'button' ? { onPress: () => onPress(item.id, model.surface) } : {}
    return drawChip(kit, item.chip, { key: item.id, label: item.label, surface: model.surface, theme: model.theme, ...press })
  }
  const props = {
    key: item.id,
    label: item.label,
    onPress: (press: { surface: RenderSurface }) => onPress(item.id, press.surface),
    // The desktop app's own Tab never reaches the band, so a letter there could not be pressed.
    ...(item.hotkey === undefined || model.surface === 'desktop' ? {} : { hotkey: item.hotkey }),
    ...(item.isDim ? { dimColor: true } : {}),
    ...(item.isActive && model.surface !== 'terminal' ? { variant: 'primary' as const } : {}),
  }
  // On, on the terminal: the label in the toolbelt's accent (card.tsx), whatever the theme's accent is.
  return item.isActive && model.surface === 'terminal' ? <Button {...props}><Text color={ACCENT} weight="semibold">{item.label}</Text></Button> : <Button {...props} />
}

// One row: information on the left, buttons on the right, `…` at the right end when anything was hidden. Another mod's
// band, when given, goes below it. The prompts tab's cards lie hidden over the row, each padded to the band's width so
// it covers the row while a pointer on its panel row reveals it. A desktop lets the row show through a card, so there a
// card is a row of its own above it, a row apart.
export function drawBand(kit: BandKit, model: BandModel, onPress: PressItem, other?: RenderElement, cards: readonly BandCard[] = [], width = 0): RenderElement {
  const { Box, Button, Text } = kit
  const isOverlay = model.surface === 'terminal'
  const cardBoxes = cards.map(card => (
    <Box key={`band-card-${card.scope}`} {...(isOverlay ? { position: 'absolute' as const, top: 0, left: 0, width } : { marginBottom: 1 })} display="none" hover={{ scope: card.scope, display: 'flex' }}>
      <Text wrap="truncate-end">{isOverlay ? padCells(card.text, width) : card.text}</Text>
    </Box>
  ))
  const row = (
    <Box key="band-row" flexDirection="row" justifyContent="space-between">
      <Box key="band-left" flexDirection="row" flexShrink={0} columnGap={LEFT_COLUMN_GAP}>
        <Button key={FOLD_ID} label={FOLD_MARK} plain dimColor onPress={press => onPress(FOLD_ID, press.surface)} />
        {model.left.flatMap((item, i) => [
          ...(i > 0 && model.surface === 'terminal' ? [<Text dimColor>{INFO_RULE}</Text>] : []),
          drawItem(kit, model, item, onPress),
        ])}
      </Box>
      <Box key="band-right" flexDirection="row" flexShrink={0} columnGap={1}>
        {model.right.flatMap((item, i) => {
          const before = model.right[i - 1]
          const mark = before !== undefined && before.group !== item.group ? [<Text dimColor>{GROUP_MARK}</Text>] : []
          return [...mark, drawItem(kit, model, item, onPress)]
        })}
        {model.more === null ? null : drawItem(kit, model, model.more, onPress)}
      </Box>
      {isOverlay ? cardBoxes : null}
    </Box>
  )
  if (other === undefined && isOverlay) return row
  return (
    <Box key="band" flexDirection="column">
      {isOverlay ? null : cardBoxes}
      {row}
      {other ?? null}
    </Box>
  )
}

// The folded band: the ▸ mark that unfolds it, and another mod's band below it as drawBand puts it. The prompts tab's
// cards wait for the band to unfold.
export function drawFolded(kit: BandKit, onPress: PressItem, other?: RenderElement): RenderElement {
  const { Box, Button } = kit
  const row = (
    <Box key="band-row" flexDirection="row">
      <Button key={UNFOLD_ID} label={UNFOLD_MARK} plain dimColor onPress={press => onPress(UNFOLD_ID, press.surface)} />
    </Box>
  )
  return other === undefined ? row : <Box key="band" flexDirection="column">{row}{other}</Box>
}
