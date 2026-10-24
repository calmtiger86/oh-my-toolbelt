// The band's information chips (after augiefra/claude-mods): the icon in the chip's colour, the value bold, a meter,
// the rest dim. The terminal writes them on one row with no background, a dim `│` between them, as the reference does
// in a terminal (picked on a dark background); a desktop draws the reference's pill, a round outline around a
// see-through tint.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import { cellsOf } from './lib/width'

export type Hue = 'blue' | 'cyan' | 'green' | 'yellow' | 'gray' | 'magenta'

export type Chip = {
  hue: Hue
  icon: string
  value: string
  // 0 to 1: how far the meter is filled.
  meter?: number
  detail?: string
  isWarning?: boolean
}

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const METER_CELLS = 6

// The icon's colour on a dark and a light terminal (drawn on #1e1e2d, 2.1.309), and the desktop pill's icon, tint and
// outline, which let the app's background through as the reference's do.
const HUES: Readonly<Record<Hue, { dark: string; light: string; desktop: readonly [string, string, string] }>> = {
  blue: { dark: '#6d9eeb', light: '#2f68c0', desktop: ['#2f68c0', 'rgba(47,104,192,0.10)', 'rgba(47,104,192,0.28)'] },
  cyan: { dark: '#3cb8d8', light: '#1b8fae', desktop: ['#1b9cbe', 'rgba(27,161,196,0.11)', 'rgba(27,161,196,0.30)'] },
  green: { dark: '#4fc27f', light: '#2f8a55', desktop: ['#3a9a62', 'rgba(63,166,107,0.13)', 'rgba(63,166,107,0.32)'] },
  yellow: { dark: '#e0b000', light: '#a8690a', desktop: ['#c79a00', 'rgba(224,176,0,0.12)', 'rgba(224,176,0,0.32)'] },
  gray: { dark: '#9aa5b1', light: '#5f6b78', desktop: ['#7f8a96', 'rgba(127,127,127,0.10)', 'rgba(127,127,127,0.28)'] },
  magenta: { dark: '#c77bd4', light: '#9a3fae', desktop: ['#b04fc0', 'rgba(176,79,192,0.11)', 'rgba(176,79,192,0.30)'] },
}

// ponytail: a custom or auto theme, or none read yet, gets the dark colours; read the custom theme's base if light-theme users report it
export const shadeOf = (theme: string | undefined): 'dark' | 'light' => (theme?.includes('light') === true ? 'light' : 'dark')

// What the chip shows, in order.
// ponytail: the meter's line glyphs, as the reference draws them, are ambiguous-width; a terminal that draws those wide gets a 12-cell bar
type Piece = { name: 'icon' | 'value' | 'meter' | 'detail'; text: string }
const pieces = (chip: Chip): Piece[] =>
  ([
    { name: 'icon', text: chip.icon },
    { name: 'value', text: chip.value },
    { name: 'meter', text: chip.meter === undefined ? '' : '─'.repeat(METER_CELLS) },
    { name: 'detail', text: chip.detail ?? '' },
  ] satisfies Piece[]).filter(piece => piece.text !== '')

// The pieces with a space between them; a desktop pill adds its padding.
export const chipCells = (chip: Chip): number => cellsOf(pieces(chip).map(piece => piece.text).join(' '))

function pieceRun(kit: Kit, chip: Chip, piece: Piece, color: string): RenderElement[] {
  const { Text } = kit
  switch (piece.name) {
    case 'icon': return [<Text key="icon" weight="semibold" color={color}>{piece.text}</Text>]
    case 'value': return [<Text key="value" weight="semibold" tabular {...(chip.isWarning === true ? { color: 'warning' } : {})}>{piece.text}</Text>]
    case 'meter': {
      const filled = Math.round(Math.min(1, Math.max(0, chip.meter ?? 0)) * METER_CELLS)
      return [<Text key="meter-on" color={color}>{'━'.repeat(filled)}</Text>, <Text key="meter-off" dimColor>{'─'.repeat(METER_CELLS - filled)}</Text>]
    }
    case 'detail': return [<Text key="detail" dimColor>{piece.text}</Text>]
  }
}

// The chip's runs with a space between pieces (a Button holds Texts alone, no Box).
function runs(kit: Kit, chip: Chip, color: string): RenderElement[] {
  const { Text } = kit
  return pieces(chip).flatMap((piece, i) => [...(i === 0 ? [] : [<Text key={`gap-${piece.name}`}> </Text>]), ...pieceRun(kit, chip, piece, color)])
}

// A chip that presses is a plain Button: its hotkey would print `o:` before it, so it has none.
export function drawChip(kit: Kit, chip: Chip, o: { key: string; label: string; surface: RenderSurface; theme: string | undefined; onPress?: () => void }): RenderElement {
  const { Box, Button } = kit
  if (o.surface === 'terminal') {
    const body = runs(kit, chip, HUES[chip.hue][shadeOf(o.theme)])
    if (o.onPress !== undefined) return <Button key={o.key} plain label={o.label} onPress={o.onPress}>{body}</Button>
    // A Text drops its key; the Box keeps it.
    return <Box key={o.key} flexDirection="row">{body}</Box>
  }
  const [icon, back, line] = HUES[chip.hue].desktop
  const body = runs(kit, chip, icon)
  // A pill that presses holds the Button, which keeps the item's key.
  const inside = o.onPress === undefined ? body : [<Button key={o.key} plain label={o.label} onPress={o.onPress}>{body}</Button>]
  // ponytail: text glyphs in the pill and a native button inside the pomodoro's; draw Svg icons and gauges as the reference does once the desktop app is checked
  return (
    <Box key={o.onPress === undefined ? o.key : `${o.key}-pill`} flexDirection="row" alignItems="center" flexShrink={0} paddingX={1} paddingY={0} borderStyle="round" borderColor={line} backgroundColor={back}>
      {inside}
    </Box>
  )
}

// The desktop pill's padding, beside the pieces.
export const PILL_PADDING = 2
