// The panel's cards: each part of a tab in a round-bordered box, its title first in the accent colour and bold. A
// narrow panel keeps the 4 cells a border and its padding take: a one-cell colour bar stands at the left instead. Both
// were drawn on a real screen with text, buttons and an input inside (2.1.308 and 2.1.309); the box that lost its
// content in 2.1.308 held a Select, which the panel no longer draws.
import type { Elements, RenderElement } from 'claude-code'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text'>

// The toolbelt's own accent, whatever the theme: an ANSI theme's accent is bright red, and a custom one may be
// anything. Claude's own orange, rgb(215,119,87), with dark words on it.
export const ACCENT = '#d77757'
export const ACCENT_TEXT = '#1f1f22'

// Below this many columns the bar is drawn instead of the border.
export const CARD_COLUMNS_MIN = 30
// The cells a card takes from the width inside it: the border and the padding, or the bar and its gap.
export const cardFrame = (columns: number): number => (columns >= CARD_COLUMNS_MIN ? 4 : 2)

// `▸ Title`: the mark and the words as two Texts, so the title can still be found by its words alone.
export function cardTitle(kit: Kit, key: string, title: string): RenderElement {
  const { Box, Text } = kit
  return (
    <Box key={`${key}-title`} flexDirection="row" columnGap={1}>
      <Text color={ACCENT}>▸</Text>
      <Text weight="semibold" color={ACCENT}>{title}</Text>
    </Box>
  )
}

export function drawCard(kit: Kit, card: { key: string; title: string; columns: number }, children: readonly (RenderElement | null)[]): RenderElement {
  const { Box } = kit
  const body = [cardTitle(kit, card.key, card.title), ...children]
  if (card.columns >= CARD_COLUMNS_MIN) {
    return (
      <Box key={card.key} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        {body}
      </Box>
    )
  }
  return (
    <Box key={card.key} flexDirection="row" columnGap={1}>
      <Box key={`${card.key}-bar`} width={1} flexShrink={0} backgroundColor={ACCENT} />
      <Box key={`${card.key}-body`} flexDirection="column">
        {body}
      </Box>
    </Box>
  )
}
