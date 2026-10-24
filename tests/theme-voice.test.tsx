// The theme button and the voice button: the pure rules, and the band on both surfaces.
import { expect, test } from 'claude-code/testing'
import type { ConfigRow } from 'claude-code'
import { otherTheme, themeEffects, themeLabel, themeRowOf } from '../hooks/tools/theme'
import { voiceEffects, voiceLabel, voiceModeOf, voiceModeToSync } from '../hooks/tools/voice'
import { COMMANDS, SURFACES, TEST_OPTIONS, boot, mountBand, mountPane, runCommand } from './helpers'
import { t } from './pure-helpers'

const OPTIONS = ['auto', 'dark', 'light', 'light-daltonized', 'dark-daltonized', 'light-ansi', 'dark-ansi']
const row = (value: string) => ({ value, options: OPTIONS })

test('the theme pair: dark and light swap by name, auto goes dark, and a theme with no pair or a custom one has none', () => {
  expect([otherTheme(row('dark')), otherTheme(row('light-ansi')), otherTheme(row('dark-daltonized')), otherTheme(row('auto'))]).toEqual(['light', 'dark-ansi', 'light-daltonized', 'dark'])
  expect(themeRowOf({ value: 'custom:my-custom', options: OPTIONS })).toBeNull()
  expect(themeRowOf({ value: 'dark', options: ['dark'] })).toBeNull()
  expect(themeRowOf(undefined)).toBeNull()
  expect(themeLabel(row('dark'), 'long', 'icon+label', undefined, t)).toBe('☀ Light')
  expect(themeLabel(row('light'), 'short', 'icon+label', undefined, t)).toBe('☾')
  expect(themeEffects(row('dark'))).toEqual([{ kind: 'config.set', key: 'theme', value: 'light' }])
})

test('voice asks for the mode the setting picks when off and off when on, and says which', () => {
  const off = { isAvailable: true, requested: null }
  expect(voiceLabel(off, 'long', 'icon+label', undefined, t)).toBe('🎤 Voice')
  expect(voiceLabel({ ...off, requested: 'tap' }, 'long', 'icon+label', undefined, t)).toBe('🎤 Voice on')
  expect(voiceEffects(off, 'tap')).toEqual([{ kind: 'voice', next: 'tap' }])
  expect(voiceEffects(off, 'hold')).toEqual([{ kind: 'voice', next: 'hold' }])
  expect(voiceEffects({ ...off, requested: 'hold' }, 'tap')).toEqual([{ kind: 'voice', next: 'off' }])
  expect([voiceModeOf('hold'), voiceModeOf('tap'), voiceModeOf('push'), voiceModeOf(undefined)]).toEqual(['hold', 'tap', 'tap', 'tap'])
})

const THEME_ROW = { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: OPTIONS, provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as unknown as ConfigRow

test('the theme button swaps the theme through /config and follows it; a refusal hides it with the reason', { options: TEST_OPTIONS }, async ($, on) => {
  const set: unknown[] = []
  let refuse = false
  on('config.set', (_, e) => (refuse ? { deny: 'locked by policy' } : (set.push(e.value), { value: e.value })))
  const { calls } = await boot($, on, { settings: [THEME_ROW] })
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, 258)
    expect((await band.find({ key: 'theme' }))?.props.label).toBe('☀ Light')
    await band.unmount()
  }
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'theme' })
  expect(set).toEqual(['light'])
  expect((await band.find({ key: 'theme' }))?.props.label).toBe('☾ Dark')
  refuse = true
  await band.press({ key: 'theme' })
  expect(calls.toasts.at(-1)).toBe('The theme was not changed: locked by policy')
  expect(await band.find({ key: 'theme' })).toBeUndefined()
  await band.unmount()
})

test('a custom theme, or no theme row, leaves the theme button out', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { settings: [{ ...THEME_ROW, value: 'custom:my-custom' } as ConfigRow] })
  const band = await mountBand($, 'terminal', 258)
  expect(await band.find({ key: 'theme' })).toBeUndefined()
  await band.unmount()
})

test('the voice button shows while /voice exists, and runs it on and off', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on, { commands: [...COMMANDS, { name: 'voice', description: 'Toggle voice mode', source: 'builtin' }] })
  const band = await mountBand($, 'terminal', 258)
  expect((await band.find({ key: 'voice' }))?.props.label).toBe('🎤 Voice')
  await band.press({ key: 'voice' })
  // Turning voice on does not record: the toast says Space does.
  expect(calls.toasts.at(-1)).toContain('press Space to start recording')
  await band.press({ key: 'voice' })
  expect(calls.ran.filter(ran => ran.command === 'voice')).toEqual([{ command: 'voice', args: 'tap' }, { command: 'voice', args: 'off' }])
  expect(calls.toasts.filter(text => text.includes('Space'))).toHaveLength(1)
  expect((await band.find({ key: 'voice' }))?.props.label).toBe('🎤 Voice')
  await band.unmount()
})

test('without /voice there is no voice button', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  const band = await mountBand($, 'terminal', 258)
  expect(await band.find({ key: 'voice' })).toBeUndefined()
  await band.unmount()
})

test('the tools tab lays out the theme and voice buttons, so they can be hidden', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { settings: [THEME_ROW], commands: [...COMMANDS, { name: 'voice', description: '', source: 'builtin' }] })
  const pane = await mountPane($, 'terminal', 80)
  expect(await pane.find({ key: 'row-theme' })).toBeDefined()
  expect(await pane.find({ key: 'row-voice' })).toBeDefined()
  await pane.press({ key: 'hide-voice' })
  const band = await mountBand($, 'terminal', 258)
  expect(await band.find({ key: 'voice' })).toBeUndefined()
  expect(await band.find({ key: 'theme' })).toBeDefined()
  await band.unmount()
  await pane.unmount()
})

test('a refused /voice leaves the label as it was and takes the button away', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on, { commands: [...COMMANDS, { name: 'voice', description: '', source: 'builtin' }], failRun: ['voice'] })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'voice' })
  expect(calls.toasts.at(-1)).toContain('/voice')
  expect(await band.find({ key: 'voice' })).toBeUndefined()
  await band.unmount()
})

test('a refused theme stays away after the panel opens, and a locked theme never shows', { options: TEST_OPTIONS }, async ($, on) => {
  on('config.set', () => ({ deny: 'locked by policy' }))
  await boot($, on, { settings: [THEME_ROW] })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'theme' })
  await runCommand($, 'toolbelt', 'status')
  expect(await band.find({ key: 'theme' })).toBeUndefined()
  await band.unmount()
})

test('a locked theme row has no button', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { settings: [{ ...THEME_ROW, isLocked: true } as ConfigRow] })
  const band = await mountBand($, 'terminal', 258)
  expect(await band.find({ key: 'theme' })).toBeUndefined()
  await band.unmount()
})

test('the hold mode turns voice on with /voice hold', { options: { ...TEST_OPTIONS, voiceMode: 'hold' } }, async ($, on) => {
  const { calls } = await boot($, on, { commands: [...COMMANDS, { name: 'voice', description: 'Toggle voice mode', source: 'builtin' }] })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'voice' })
  expect(calls.toasts.at(-1)).toContain('Hold Space while you speak')
  expect(calls.ran.filter(ran => ran.command === 'voice').map(ran => ran.args)).toEqual(['hold'])
  await band.unmount()
})

// A changed setting reloads the mod, which stops what the old load began, so the new load's start switches the mode:
// only while the voice this mod turned on is on in another mode.
test('a new load switches voice to the setting\'s mode only while voice is on in another', () => {
  const on = (requested: 'tap' | 'hold' | 'off' | null, isAvailable = true) => ({ isAvailable, requested })
  expect(voiceModeToSync(on('tap'), 'hold')).toBe('hold')
  expect(voiceModeToSync(on('hold'), 'hold')).toBeNull()
  expect(voiceModeToSync(on('off'), 'hold')).toBeNull()
  expect(voiceModeToSync(on(null), 'tap')).toBeNull()
  expect(voiceModeToSync(on('tap', false), 'hold')).toBeNull()
})
