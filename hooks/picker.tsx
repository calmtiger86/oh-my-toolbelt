// Pick lists made of Buttons: a Select's list answers only the arrow keys and Enter in a terminal, so the panel draws
// its own. A button shows the value; pressed, the choices open under it as plain Buttons a click (or Tab and Enter)
// picks, and the list closes. One list is open at a time: the state `openPicker`.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { Act } from './pane'
import type { Ctx } from './tools/registry'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type PickOption = { value: string; label: string }

// `key` addresses the button; each choice is `<key>/<value>`.
export type Picker = { key: string; label?: string; options: readonly PickOption[]; value: string; onPick: (value: string, surface: RenderSurface) => void }

const isOpen = (picker: Picker, ctx: Ctx): boolean => ctx.state.openPicker === picker.key

// `Label: value ▾`, plain as a Select's closed line was; `▴` while the list is open.
export function pickerButton(kit: Kit, picker: Picker, ctx: Ctx, act: Act): RenderElement {
  const { Button } = kit
  const shown = picker.options.find(option => option.value === picker.value)?.label ?? picker.value
  const text = `${picker.label === undefined ? '' : `${picker.label}: `}${shown} ${isOpen(picker, ctx) ? '▴' : '▾'}`
  const toggle = (press: { surface: RenderSurface }) => void act({ kind: 'picker.open', key: isOpen(picker, ctx) ? null : picker.key }, press.surface)
  return <Button key={picker.key} label={text} plain onPress={toggle} />
}

// The open list, under its button: the choice in use at full strength, the rest dim. Closed first, then picked, so a
// pick that reloads the module (a setting) does not come back open.
export function pickerList(kit: Kit, picker: Picker, ctx: Ctx, act: Act): RenderElement | null {
  const { Box, Button } = kit
  if (!isOpen(picker, ctx)) return null
  const choose = (value: string) => async (press: { surface: RenderSurface }) => {
    await act({ kind: 'picker.open', key: null }, press.surface)
    picker.onPick(value, press.surface)
  }
  return (
    <Box key={`${picker.key}-list`} flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2}>
      {picker.options.map(option => (
        <Button key={`${picker.key}/${option.value}`} label={option.label} plain {...(option.value === picker.value ? {} : { dimColor: true })} onPress={choose(option.value)} />
      ))}
    </Box>
  )
}

// The button with its list under it.
export function drawPicker(kit: Kit, picker: Picker, ctx: Ctx, act: Act): RenderElement {
  const { Box } = kit
  return (
    <Box key={`${picker.key}-box`} flexDirection="column">
      {pickerButton(kit, picker, ctx, act)}
      {pickerList(kit, picker, ctx, act)}
    </Box>
  )
}

// `Label: [ text ]`: a setting with two values, which flips with one press, or an action.
export function drawLabeledButton(kit: Kit, key: string, label: string, text: string, onPress: (press: { surface: RenderSurface }) => void): RenderElement {
  const { Box, Button, Text } = kit
  return (
    <Box key={`${key}-box`} flexDirection="row" flexWrap="wrap" columnGap={1}>
      <Text>{`${label}:`}</Text>
      <Button key={key} label={text} onPress={onPress} />
    </Box>
  )
}
