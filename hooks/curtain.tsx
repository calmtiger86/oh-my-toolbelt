// What a row draws in place of itself while the curtain is up. Pure: row-hooks.ts hands in the element table from
// `$.ui.resolve(e)`.
import type { Elements, RenderElement } from 'claude-code'

export type CurtainKit = Pick<Elements['terminal'], 'Box'>

// An empty box of no height: the row takes no space while the curtain is up.
export function drawCurtain(kit: CurtainKit): RenderElement {
  const { Box } = kit
  return <Box height={0} />
}
