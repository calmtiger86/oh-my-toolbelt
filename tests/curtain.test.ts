// The curtain tool without the engine: its label, its effects and the /toolbelt words.
import { expect, test } from 'claude-code/testing'
import { translator } from '../hooks/lib/i18n'
import { parseCommand, replyFor } from '../hooks/tools/command'
import { curtainEffects, curtainLabel } from '../hooks/tools/curtain'
import { TOOLS } from '../hooks/tools/registry'
import { makeCtx, t } from './pure-helpers'

test('the label names what a press does: Hide while the screen shows, Show while it is covered', () => {
  expect(curtainLabel(false, 'long', 'icon+label', undefined, t)).toBe('▢ Hide')
  expect(curtainLabel(true, 'long', 'icon+label', undefined, t)).toBe('▣ Show')
  expect(curtainLabel(false, 'short', 'icon+label', undefined, t)).toBe('▢')
  expect(curtainLabel(true, 'short', 'icon+label', undefined, t)).toBe('▣')
})

test('with the label style the label is the word alone, in the person\'s language', () => {
  expect(curtainLabel(false, 'long', 'label', undefined, t)).toBe('Hide')
  expect(curtainLabel(true, 'short', 'label', undefined, t)).toBe('Show')
  expect(curtainLabel(false, 'long', 'label', undefined, translator('ko'))).toBe('가리기')
  expect(curtainLabel(true, 'long', 'icon+label', undefined, translator('ja'))).toBe('▣ 表示')
})

test('a picked icon stands for both states; the icon style keeps it alone, and none leaves the word', () => {
  expect([curtainLabel(false, 'long', 'icon+label', '🔒', t), curtainLabel(true, 'long', 'icon+label', '🔒', t)]).toEqual(['🔒 Hide', '🔒 Show'])
  expect([curtainLabel(false, 'short', 'icon+label', '🔒', t), curtainLabel(false, 'long', 'icon', '🔒', t)]).toEqual(['🔒', '🔒'])
  expect([curtainLabel(false, 'long', 'icon', undefined, t), curtainLabel(true, 'long', 'icon', undefined, t)]).toEqual(['▢', '▣'])
  expect([curtainLabel(false, 'long', 'icon+label', '', t), curtainLabel(true, 'long', 'icon', '', t), curtainLabel(true, 'short', 'label', '🔒', t)]).toEqual(['Hide', 'Show', 'Show'])
})

test('raising the curtain sets the state and toasts; lowering it only sets the state', () => {
  const [update, toast, ...rest] = curtainEffects(true, t)
  expect(update?.kind === 'state.update' && update.key === 'curtain' && update.fn(false)).toBe(true)
  expect(toast).toEqual({ kind: 'ui.toast', text: t('toast.curtainOn') })
  expect(rest).toEqual([])
  const lowered = curtainEffects(false, t)
  expect(lowered).toHaveLength(1)
  const only = lowered[0]
  expect(only?.kind === 'state.update' && only.fn(true)).toBe(false)
})

test('the tool is always on the right at priority 6, h presses it, and a press flips the state it was drawn with', () => {
  const tool = TOOLS.curtain
  expect([tool.side, tool.priority, tool.kind]).toEqual(['right', 6, 'button'])
  expect(tool.hotkey?.(makeCtx())).toBe('h')
  expect(tool.hotkey?.(makeCtx({ options: { hotkeysEnabled: false } }))).toBeUndefined()
  expect(tool.label(makeCtx({ options: { iconStyle: 'label' } }), 'long')).toBe('Hide')
  const up = tool.onPress?.(makeCtx({ state: { curtain: false } }), { surface: 'terminal' }) ?? []
  const down = tool.onPress?.(makeCtx({ state: { curtain: true } }), { surface: 'terminal' }) ?? []
  expect(up.map(effect => effect.kind)).toEqual(['state.update', 'ui.toast'])
  expect(down.map(effect => effect.kind)).toEqual(['state.update'])
})

test('/toolbelt curtain takes on or off and names any other word', () => {
  expect(parseCommand('curtain on')).toEqual({ op: 'curtain', isOn: true })
  expect(parseCommand(' Curtain  OFF ')).toEqual({ op: 'curtain', isOn: false })
  expect(parseCommand('curtain')).toEqual({ op: 'usage' })
  expect(parseCommand('curtain maybe')).toEqual({ op: 'usage', unknown: 'maybe' })
  expect(parseCommand('curtain on now')).toEqual({ op: 'usage', unknown: 'now' })
})

test('the reply to off is a line; the reply to on is none, as the curtain would hide it', () => {
  expect(replyFor({ op: 'curtain', isOn: false }, t)).toBe('Conversation shown.')
  expect(replyFor({ op: 'curtain', isOn: true }, t)).toBeUndefined()
})
