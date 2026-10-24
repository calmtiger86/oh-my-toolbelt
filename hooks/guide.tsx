// The guide tab: how to use every tool from the first day, in parts read in order; the last is for the desktop app.
// Pure: the part shown is the `guideSection` state, and every word comes from the language files.
import type { Elements, RenderElement } from 'claude-code'
import type { GuideSection } from '../types/index'
import type { Act } from './pane'
import type { Ctx } from './tools/registry'
import { isTocTabOn } from './tools/toc'
import { ACCENT, drawCard } from './card'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export const GUIDE_SECTIONS: readonly GuideSection[] = ['start', 'daily', 'custom', 'commands', 'help', 'desktop']

export const asGuideSection = (value: unknown): GuideSection =>
  GUIDE_SECTIONS.find(section => section === value) ?? 'start'

// The rebinding example. Not translated: it is what goes in the file.
const KEYBINDING_EXAMPLE = [
  '{',
  '  "bindings": [',
  '    {',
  '      "context": "Chat",',
  '      "bindings": {',
  '        "ctrl+x t": "abovePrompt:focus"',
  '      }',
  '    }',
  '  ]',
  '}',
]

// A step is `<key>.title` and `<key>.body`, the body's lines split at newlines; an example is drawn as it is.
type Step = { key: string; example?: readonly string[] }

const steps = (section: GuideSection, names: readonly string[]): Step[] => names.map(name => ({ key: `guide.${section}.${name}` }))

function stepsOf(section: GuideSection, ctx: Ctx): readonly Step[] {
  switch (section) {
    case 'start': return steps(section, ['find', 'press', 'panel', 'settings'])
    // The prompts step only while that tab exists; the clipboard step always, as it says how to turn its tab on.
    case 'daily': return steps(section, ['clock', 'pomodoro', 'notes', 'clips', ...(isTocTabOn(ctx.options) ? ['prompts'] : []), 'curtain', 'export', 'attach', 'voice', 'theme', 'all'])
    case 'custom': return steps(section, ['buttons', 'sets', 'layout', 'fold'])
    case 'commands': return steps(section, ['list'])
    // Where to look when something fails first, then the keys.
    case 'help': return [...steps(section, ['error']), { key: 'guide.help.rebind', example: KEYBINDING_EXAMPLE }, ...steps(section, ['hotkeys', 'weather', 'curtain', 'config'])]
    // What the desktop app's Code tab does differently.
    case 'desktop': return steps(section, ['look', 'missing', 'settings', 'prompts', 'export', 'alert', 'theme'])
  }
}

// Each step is a card: its title, then its lines and any example.
function drawStep(kit: Kit, step: Step, ctx: Ctx, columns: number): RenderElement {
  const { Box, Text } = kit
  return drawCard(kit, { key: step.key, title: ctx.t(`${step.key}.title`), columns }, [
    ...ctx.t(`${step.key}.body`).split('\n').map(line => <Text>{line}</Text>),
    step.example === undefined ? null : (
      <Box key={`${step.key}-example`} flexDirection="column" paddingX={2}>
        {step.example.map(line => <Text dimColor>{line}</Text>)}
      </Box>
    ),
  ])
}

export function drawGuide(kit: Kit, ctx: Ctx, act: Act, columns: number): RenderElement {
  const { Box, Button, Text } = kit
  const shown = asGuideSection(ctx.state.guideSection)
  const go = (section: GuideSection) => (press: { surface: Parameters<Act>[1] }) => void act({ kind: 'guide.section', section }, press.surface)
  const next = GUIDE_SECTIONS[GUIDE_SECTIONS.indexOf(shown) + 1]
  return (
    <Box key="guide" flexDirection="column" rowGap={1}>
      <Text dimColor>{ctx.t('guide.intro')}</Text>
      <Box key="guide-parts" flexDirection="row" flexWrap="wrap" columnGap={1}>
        {GUIDE_SECTIONS.map(section => (
          // The part shown: on the terminal in the toolbelt's accent (card.tsx), on a desktop its primary button.
          section === shown && ctx.surface === 'terminal'
            ? <Button key={`guide-${section}`} label={ctx.t(`guide.section.${section}`)} onPress={go(section)}><Text color={ACCENT} weight="semibold">{ctx.t(`guide.section.${section}`)}</Text></Button>
            : <Button key={`guide-${section}`} label={ctx.t(`guide.section.${section}`)} {...(section === shown ? { variant: 'primary' as const } : {})} onPress={go(section)} />
        ))}
      </Box>
      {stepsOf(shown, ctx).map(step => drawStep(kit, step, ctx, columns))}
      {next === undefined ? null : <Button key="guide-next" label={ctx.t('guide.next', { name: ctx.t(`guide.section.${next}`) })} onPress={go(next)} />}
    </Box>
  )
}
