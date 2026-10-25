// The panel: the layout rows move tools between sides and orders and save them, the form adds, edits and checks
// buttons, and the more and status tabs draw.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { ButtonConfig, Layout } from '../types/index'
import { SLOW_MS, SURFACES, TEST_OPTIONS, boot, isManifestPath, keysOf, listOf, mountBand, mountPane, pick, runCommand } from './helpers'
import { fitTabs } from '../hooks/pane'

const layoutOf = (store: Map<string, unknown>) => store.get('layout') as Layout
const buttonsOf = (store: Map<string, unknown>) => (store.get('buttons') as ButtonConfig).sets.default ?? []

test('layout rows move, hide, show and reset, and the band follows', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, store } = await boot($, on)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    await pane.press({ key: 'layout-reset' })
    await pane.press({ key: 'side-clock' })
    expect(layoutOf(store).left).toEqual(['date', 'weather', 'pomodoro'])
    expect(layoutOf(store).right.at(-1)).toBe('clock')
    const band = await mountBand($, surface, 119)
    expect((await band.find({ key: 'band-left' }))?.text).not.toContain('05:32')
    expect((await band.find({ key: 'band-right' }))?.text).toContain('05:32')
    await band.unmount()

    await pane.press({ key: 'up-btn:ex-usage' })
    expect(layoutOf(store).right.slice(0, 2)).toEqual(['btn:ex-usage', 'btn:ex-review'])
    await pane.press({ key: 'down-btn:ex-usage' })
    expect(layoutOf(store).right.slice(0, 2)).toEqual(['btn:ex-review', 'btn:ex-usage'])

    await pane.press({ key: 'hide-pomodoro' })
    expect(layoutOf(store)).toMatchObject({ left: ['date', 'weather'], hidden: ['pomodoro'] })
    expect(await pane.find({ key: 'show-pomodoro' })).toBeDefined()
    await pane.press({ key: 'show-pomodoro' })
    expect(layoutOf(store)).toMatchObject({ left: ['date', 'weather', 'pomodoro'], hidden: [] })
    await pane.press({ key: 'side-clock' })
    expect(layoutOf(store).left).toEqual(['date', 'weather', 'pomodoro', 'clock'])

    await pane.press({ key: 'layout-reset' })
    expect(layoutOf(store).left).toEqual(['clock', 'date', 'weather', 'pomodoro'])
    await pane.unmount()
  }
  expect(calls.toasts).toContain('Layout reset.')
})

test('a new button is checked, saved, laid out and drawn in the band', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on)
  const letters = { terminal: 's', desktop: 'x' } as const
  for (const surface of SURFACES) {
    const before = buttonsOf(store).length
    const pane = await mountPane($, surface)
    await pane.press({ key: 'button-new' })
    await pane.input({ key: 'field-label', text: `Deslop ${surface}` })
    await pick(pane, 'field-kind', 'skill')
    expect(await pane.find({ type: 'Text', text: 'The command or skill to run, without the slash. Example: usage' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Text added after the command. Optional. Example: src/' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: 'Enter a command.' })).toBeDefined()
    await pane.press({ key: 'save' })
    expect(calls.toasts.at(-1)).toBe('Enter a command.')
    expect(buttonsOf(store)).toHaveLength(before)

    await pane.input({ key: 'field-command', text: '/deslop' })
    await pane.input({ key: 'field-hotkey', text: 'b' })
    expect(await pane.find({ type: 'Text', text: 'The letter b is used by a built-in tool.' })).toBeDefined()
    await pane.press({ key: 'save' })
    expect(buttonsOf(store)).toHaveLength(before)

    await pane.input({ key: 'field-hotkey', text: letters[surface] })
    await pane.press({ key: 'save' })
    const added = buttonsOf(store).at(-1)
    expect(added).toMatchObject({ kind: 'skill', label: `Deslop ${surface}`, command: 'deslop', hotkey: letters[surface], mode: 'run' })
    expect(layoutOf(store).right.at(-1)).toBe(`btn:${added?.id}`)
    expect(await pane.find({ key: 'save' })).toBeUndefined()
    await pane.unmount()

    const band = await mountBand($, surface, 258)
    expect(keysOf(await band.drawn())).toContain(`btn:${added?.id}`)
    await band.unmount()
  }
  expect(calls.toasts).toContain('Button saved.')
})

test('a button can be edited and deleted', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'edit-ex-review' })
  expect((await pane.find({ key: 'field-label' }))?.props.value).toBe('Review')
  await pane.input({ key: 'field-label', text: 'Check' })
  await pane.press({ key: 'save' })
  expect(buttonsOf(store).find(b => b.id === 'ex-review')?.label).toBe('Check')

  await pane.press({ key: 'delete-ex-usage' })
  expect(buttonsOf(store).map(b => b.id)).toEqual(['ex-review'])
  expect(layoutOf(store).right).not.toContain('btn:ex-usage')
  expect(calls.toasts).toContain('Button deleted.')
  await pane.unmount()
})

test('the status tab presses every tool as the band does and names the language; /toolbelt more opens it', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on, { env: { LANG: 'ja_JP.UTF-8' } })
  await runCommand($, 'toolbelt', 'more')
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    expect((await pane.find({ key: 'more-pomodoro' }))?.props.label).toBe('🍅 開始')
    await pane.press({ key: 'more-btn:ex-review' })
    expect((await pane.find({ type: 'Text', text: 'ja (ja-JP)' }))?.text).toContain('ja (ja-JP)')
    await pane.unmount()
  }
  expect(calls.filled).toHaveLength(2)
})

test('the status tab shows a failure in the person\'s language', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { env: { LANG: 'ko_KR.UTF-8' }, failGet: ['bandHidden'] })
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: '마지막 오류: store.get bandHidden 호출이 실패했습니다: ' })).toBeDefined()
  await pane.unmount()
})

test('the guide walks six parts in order: the number buttons and Next switch them, help holds the keys and /config, the desktop part comes last', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    await pane.press({ key: 'tab-guide' })
    const has = async (text: string) => (await pane.find({ type: 'Text', text })) !== undefined
    expect(await has('Step 1. Find the toolbelt')).toBe(true)
    expect(await has('② Press Tab: the toolbelt is selected.')).toBe(true)
    await pane.press({ key: 'guide-next' })
    expect([await has('Pomodoro (focus timer)'), await has('Step 1. Find the toolbelt')]).toEqual([true, false])
    // Every tool of the toolbelt has its step.
    for (const title of ['Clock, date and weather', 'Notes', 'Clipboard', 'Your prompts', 'Hide the conversation', 'Export the conversation', 'All tools (…)']) expect(await has(title), title).toBe(true)
    await pane.press({ key: 'guide-help' })
    for (const text of ['When something fails', 'When ctrl+x then Tab does nothing', '        "ctrl+x t": "abovePrompt:focus"', '② Type toolbelt in the search box: every toolbelt setting is listed.']) expect(await has(text), text).toBe(true)
    await pane.press({ key: 'guide-next' })
    for (const title of ['Why Attach and Voice are missing', 'Exporting a PDF', 'Pomodoro alerts']) expect(await has(title), title).toBe(true)
    expect(await pane.find({ key: 'guide-next' })).toBeUndefined()
    await pane.press({ key: 'guide-start' })
    await pane.unmount()
  }
})

test('with the prompts tab off, the guide leaves out its step', { options: { ...TEST_OPTIONS, tocTab: false } }, async ($, on) => {
  await boot($, on)
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-guide' })
  await pane.press({ key: 'guide-daily' })
  expect(await pane.find({ type: 'Text', text: 'Your prompts' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Notes' })).toBeDefined()
})

// The mod's /config rows in the status tab.
const ROWS = [
  { key: 'oh-my-toolbelt.clockSeconds', label: 'Show seconds', kind: 'boolean', value: true, provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false },
  { key: 'oh-my-toolbelt.clockFormat', label: 'Clock format', kind: 'choice', value: 'auto', options: ['auto', '12', '24'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false },
  { key: 'oh-my-toolbelt.timeZone', label: 'Time zone', kind: 'choice', value: 'system', options: ['system', 'UTC'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: true },
  { key: 'oh-my-toolbelt.weatherPlace', label: 'Weather place', kind: 'choice', value: 'off', options: ['off', ...Array.from({ length: 75 }, (_, i) => `City ${i}`)], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false },
  { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
]

test('the status tab shows the mod\'s /config rows and changes them as /config would', { options: TEST_OPTIONS }, async ($, on) => {
  const set: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => (e.key === 'oh-my-toolbelt.clockFormat' && e.value === '12' ? { deny: 'policy' } : (set.push({ key: e.key, value: e.value }), { value: e.value })))
  const { calls } = await boot($, on, { settings: ROWS as never })
  await runCommand($, 'toolbelt', 'status')
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    expect(await pane.find({ key: 'setting-theme' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: "Time zone: This computer's" })).toBeDefined()
    // The lists are Buttons, so a list of 76 places is drawn too (a Select took 64 at most).
    expect(await listOf(pane, 'setting-oh-my-toolbelt.weatherPlace')).toEqual({ values: ROWS[3]?.options, current: 'off' })
    await pane.press({ key: 'setting-oh-my-toolbelt.clockSeconds' })
    await pick(pane, 'setting-oh-my-toolbelt.clockFormat', '24')
    await pick(pane, 'setting-oh-my-toolbelt.clockFormat', '12')
    await pane.unmount()
  }
  expect(set).toEqual([
    { key: 'oh-my-toolbelt.clockSeconds', value: false }, { key: 'oh-my-toolbelt.clockFormat', value: '24' },
    { key: 'oh-my-toolbelt.clockSeconds', value: false }, { key: 'oh-my-toolbelt.clockFormat', value: '24' },
  ])
  expect(calls.toasts.filter(text => text === 'The setting was not changed: policy')).toHaveLength(2)
})

test('the status tab names the settings and their worded values in the person\'s language', { options: { ...TEST_OPTIONS, language: 'ko' } }, async ($, on) => {
  const future = { key: 'oh-my-toolbelt.futureThing', label: 'Future thing', kind: 'boolean', value: false, provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  await boot($, on, { settings: [...ROWS, future] as never })
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: '시간대: 이 컴퓨터 설정' })).toBeDefined()
  expect((await pane.find({ key: 'setting-oh-my-toolbelt.clockFormat' }))?.props.label).toBe('시계 형식: 자동 ▾')
  await pane.press({ key: 'setting-oh-my-toolbelt.clockFormat' })
  expect((await pane.find({ key: 'setting-oh-my-toolbelt.clockFormat/12' }))?.props.label).toBe('12시간')
  expect(await pane.find({ type: 'Text', text: '시계 초 표시:' })).toBeDefined()
  expect((await pane.find({ key: 'setting-oh-my-toolbelt.weatherPlace' }))?.props.label).toBe('날씨 지역: 끔 ▾')
  // A field the language files do not know keeps the engine's name.
  expect(await pane.find({ type: 'Text', text: 'Future thing:' })).toBeDefined()
  await pane.unmount()
})

// This session comes first, with what a person needs to know.
test('the status tab starts with this session: versions, language, weather, finished rounds and where to read more on a failure', { options: { ...TEST_OPTIONS, weatherPlace: 'Busan' } }, async ($, on) => {
  on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: JSON.stringify({ name: 'oh-my-toolbelt', version: '0.1.0' }) } : { deny: 'ENOENT: no such file' }))
  on('session.version', () => ({ value: { version: '2.1.309', release: '2.1.309' } as never }))
  on('http.fetch', () => ({ deny: 'offline' }))
  const { clock } = await boot($, on)
  await clock.settle()
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  const keys = keysOf(await pane.drawn())
  expect(keys.indexOf('status-facts')).toBeLessThan(keys.indexOf('more'))
  for (const text of [
    'Oh My Toolbelt 0.1.0 · Claude Code 2.1.309',
    'Weather for Busan: could not be fetched. Check the internet connection; it is tried again in 30 minutes.',
    'Focus rounds finished: 0',
    'For the full record, start Claude Code with claude --debug in a terminal.',
  ]) expect(await pane.find({ type: 'Text', text })).toBeDefined()
  await pane.unmount()
})

test('a narrow panel keeps its tabs on one line: the tab shown, those that fit, and … for the rest', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  await runCommand($, 'toolbelt', 'status')
  const tabsOf = async (pane: { drawn: () => Promise<unknown> }) => keysOf(await pane.drawn()).filter(key => /^tab-(toc|notes|status|tools|guide|more)$/.test(key))
  for (const surface of SURFACES) {
    // 28 cells for the tabs: Status, then Prompts beside it, then … for Notes, Tools and Guide.
    const pane = await mountPane($, surface, 30)
    expect(await tabsOf(pane)).toEqual(['tab-toc', 'tab-status', 'tab-more'])
    expect((await listOf(pane, 'tab-more')).values).toEqual(['notes', 'tools', 'guide'])
    await pick(pane, 'tab-more', 'guide')
    expect(await pane.find({ key: 'guide-start' })).toBeDefined()
    expect(await tabsOf(pane)).toEqual(['tab-toc', 'tab-guide', 'tab-more'])
    await pick(pane, 'tab-more', 'status')
    await pane.unmount()
  }
  const wide = await mountPane($, 'terminal', 80)
  expect(await tabsOf(wide)).toEqual(['tab-toc', 'tab-notes', 'tab-status', 'tab-tools', 'tab-guide'])
  await wide.unmount()
})

test('an open list closes when the tab changes or the form opens or closes', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  const pane = await mountPane($, 'terminal')
  const isOpen = async (key: string) => keysOf(await pane.drawn()).some(drawn => drawn.startsWith(`${key}/`))
  await pane.press({ key: 'icon-group' })
  expect(await isOpen('icon-group')).toBe(true)
  await pane.press({ key: 'tab-status' })
  await pane.press({ key: 'tab-tools' })
  expect(await isOpen('icon-group')).toBe(false)
  await pane.press({ key: 'button-new' })
  await pane.press({ key: 'field-kind' })
  expect(await isOpen('field-kind')).toBe(true)
  await pane.press({ key: 'cancel' })
  await pane.press({ key: 'button-new' })
  expect(await isOpen('field-kind')).toBe(false)
  await pane.unmount()
})

test('fitTabs keeps the tab shown even when it alone is too wide, and counts wide letters as two cells', () => {
  const names = ['toc', 'notes', 'status', 'tools', 'guide'] as const
  const ko = { toc: '프롬프트', notes: '메모', clips: '클립보드', status: '상태', tools: '도구', guide: '가이드' } as const
  const cells = (tab: keyof typeof ko) => Array.from(ko[tab]).length * 2
  expect(fitTabs(names, 'guide', cells, 50)).toEqual({ fitted: [...names], rest: [] })
  expect(fitTabs(names, 'status', cells, 21)).toEqual({ fitted: ['status'], rest: ['toc', 'notes', 'tools', 'guide'] })
  expect(fitTabs(names, 'toc', cells, 5)).toEqual({ fitted: ['toc'], rest: ['notes', 'status', 'tools', 'guide'] })
})

test('the status tab draws its parts as cards, a narrow panel as bars, and the pomodoro bar while a round runs', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal', 60)
  expect((await pane.find({ key: 'settings' }))?.props.borderStyle).toBe('round')
  expect(await pane.find({ key: 'pomodoro-meter' })).toBeUndefined()
  await runCommand($, 'toolbelt', 'pomodoro start')
  expect(await pane.find({ key: 'pomodoro-meter' })).toBeDefined()
  await runCommand($, 'toolbelt', 'pomodoro reset')
  await pane.unmount()
  const narrow = await mountPane($, 'terminal', 24)
  expect((await narrow.find({ key: 'settings' }))?.props.borderStyle).toBeUndefined()
  expect(await narrow.find({ key: 'settings-bar' })).toBeDefined()
  await narrow.unmount()
})

test('an alert sound picked in the status tab plays once, in the person\'s language', { options: { ...TEST_OPTIONS, language: 'ko' } }, async ($, on) => {
  const sound = { key: 'oh-my-toolbelt.pomodoroSoundName', label: 'Pomodoro alert sound', kind: 'choice', value: 'bell', options: ['bell', 'chime', 'ding', 'digital', 'marimba', 'soft'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  on('config.set', (_, e) => ({ value: e.value }))
  const { calls } = await boot($, on, { settings: [sound] as never })
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  expect((await pane.find({ key: 'setting-oh-my-toolbelt.pomodoroSoundName' }))?.props.label).toBe('알림음: 벨 ▾')
  // A pick that changes the setting reloads the mod (the old load's clip was cut), so it waits for the new load's
  // start; the sound in use plays at once.
  await pick(pane, 'setting-oh-my-toolbelt.pomodoroSoundName', 'marimba')
  expect(calls.played).toEqual([])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(calls.played).toEqual(['assets/sounds/marimba.wav'])
  await pick(pane, 'setting-oh-my-toolbelt.pomodoroSoundName', 'bell')
  expect(calls.played).toEqual(['assets/sounds/marimba.wav', 'assets/sounds/done.wav'])
  await pane.unmount()
})

// The desktop app's sessions are never handed the mod's /config rows (2.1.309, hooks/own-settings.ts), so there the
// status tab draws them from plugin.json and the store keeps a change, one key per setting.
const MANIFEST = JSON.stringify({
  userConfig: {
    language: { type: 'string', title: 'Language', options: ['auto', 'en', 'ko', 'ja'], default: 'auto' },
    clockSeconds: { type: 'boolean', title: 'Show seconds', default: false },
    dateFormat: { type: 'string', title: 'Date format', options: ['off', 'auto', 'ymd'], default: 'auto' },
    apiKey: { type: 'string', title: 'Key', sensitive: true },
  },
})
const serveManifest = (on: On) => on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: MANIFEST } : { deny: 'ENOENT: no such file' }))
const desktopStatus = async ($: Engine) => {
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await runCommand($, 'toolbelt', 'status', 'sdk')
  return mountPane($, 'desktop')
}
const OWN_ROWS = ['setting-oh-my-toolbelt.language', 'setting-oh-my-toolbelt.clockSeconds', 'setting-oh-my-toolbelt.dateFormat']
const SECONDS = { key: 'setting-oh-my-toolbelt.clockSeconds' }
const overridesOf = (store: Map<string, unknown>) => Object.fromEntries([...store].filter(([key]) => key.startsWith('settingsOverride.')))
const clockTexts = async ($: Engine) => {
  const band = await mountBand($, 'desktop', 258)
  const texts = (await band.findAll({ type: 'Text' })).map(node => node.text)
  await band.unmount()
  return texts
}
const row = (field: string, value: unknown, over: Record<string, unknown> = {}) =>
  ({ key: `oh-my-toolbelt.${field}`, label: field, kind: typeof value === 'boolean' ? 'boolean' : 'choice', value, provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false, ...over })

test('where the engine lists no rows the status tab draws them from plugin.json; a change is kept and applied at once', { options: TEST_OPTIONS }, async ($, on) => {
  serveManifest(on)
  const set: string[] = []
  on('config.set', (_, e) => (set.push(e.key), { value: e.value }))
  const { store } = await boot($, on, { isInteractive: false })
  const pane = await desktopStatus($)
  expect(keysOf(await pane.drawn()).filter(key => OWN_ROWS.includes(key) || key.includes('apiKey'))).toEqual(OWN_ROWS)
  expect((await pane.find({ type: 'Text', text: 'Settings (kept by the toolbelt, copied to /config in the terminal next time)' }))).toBeDefined()
  expect((await clockTexts($)).some(text => /^\d\d:\d\d:\d\d$/.test(text))).toBe(false)
  await pane.press(SECONDS)
  expect(set).toEqual([])
  // The base is the option the engine handed the mod, its default when the settings file has none.
  expect(overridesOf(store)).toEqual({ 'settingsOverride.clockSeconds': { value: true, base: false } })
  // Applied as a reload would apply it: the band's clock has its seconds, the row reads On, a language the tabs.
  expect((await clockTexts($)).some(text => /^\d\d:\d\d:\d\d$/.test(text))).toBe(true)
  expect((await pane.find(SECONDS))?.props.label).toBe('On')
  expect((await pane.find({ key: 'tab-status' }))?.props.label).toBe('Status')
  await pick(pane, 'setting-oh-my-toolbelt.language', 'ko')
  expect((await pane.find({ key: 'tab-status' }))?.props.label).toBe('상태')
  // Back to the value the engine hands: nothing to keep.
  await pane.press(SECONDS)
  expect(Object.keys(overridesOf(store))).toEqual(['settingsOverride.language'])
  await pane.unmount()
})

test('with a store a newer version wrote, a change to the mod\'s own rows keeps nothing and says why', { options: TEST_OPTIONS }, async ($, on) => {
  serveManifest(on)
  const { store, calls } = await boot($, on, { isInteractive: false, store: { schemaVersion: 99 } })
  const pane = await desktopStatus($)
  await pane.press(SECONDS)
  expect(overridesOf(store)).toEqual({})
  expect(calls.toasts.at(-1)).toBe('Your settings were saved by a newer version of Oh My Toolbelt, so changes made here are not saved.')
  await pane.unmount()
})

test('a change to the mod\'s own rows that the store fails to keep says so and keeps nothing', { options: TEST_OPTIONS }, async ($, on) => {
  serveManifest(on)
  const failSet = { on: false }
  const { store, calls } = await boot($, on, { isInteractive: false, failSet })
  const pane = await desktopStatus($)
  failSet.on = true
  await pane.press(SECONDS)
  expect(overridesOf(store)).toEqual({})
  expect(calls.toasts.at(-1)).toBe('Could not save your settings.')
  expect(calls.logged.some(line => line.startsWith('oh-my-toolbelt: settings save failed: '))).toBe(true)
  await pane.unmount()
})

// Regression: the icon style changed in the desktop app's status tab did not show; the band draws from the options,
// which no state it reads follows, so a change draws everything again.
test('a change to the mod\'s own rows draws the band and the panel again at once', { options: TEST_OPTIONS }, async ($, on) => {
  on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: JSON.stringify({ userConfig: { iconStyle: { type: 'string', title: 'Icon style', options: ['icon+label', 'icon', 'label'], default: 'icon+label' } } }) } : { deny: 'ENOENT: no such file' }))
  const { calls } = await boot($, on, { isInteractive: false })
  const pane = await desktopStatus($)
  const band = await mountBand($, 'desktop', 258)
  expect((await band.find({ key: 'curtain' }))?.props.label).toBe('▢ Hide')
  const before = calls.invalidated
  await pick(pane, 'setting-oh-my-toolbelt.iconStyle', 'icon')
  expect(calls.invalidated).toBeGreaterThan(before)
  expect((await band.find({ key: 'curtain' }))?.props.label).toBe('▢')
  await band.unmount()
  await pane.unmount()
})

// A band too narrow for the buttons' names draws icons only, which the icon style row says.
test('under the icon style, the status tab says when the band is too narrow for the buttons\' names', { options: TEST_OPTIONS }, async ($, on) => {
  const style = { key: 'oh-my-toolbelt.iconStyle', label: 'Icon style', kind: 'choice', value: 'icon+label', options: ['icon+label', 'icon', 'label'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  await boot($, on, { settings: [style] as never })
  await runCommand($, 'toolbelt', 'status')
  const note = { type: 'Text', text: 'The toolbelt is narrow now, so its buttons show icons only. A wider window shows their names too.' } as const
  for (const surface of SURFACES) {
    for (const [columns, hasNote] of [[80, true], [258, false]] as const) {
      const band = await mountBand($, surface, columns)
      expect((await band.find({ key: 'curtain' }))?.props.label).toBe(hasNote ? '▢' : '▢ Hide')
      const pane = await mountPane($, surface)
      expect((await pane.find(note)) !== undefined).toBe(hasNote)
      await pane.unmount()
      await band.unmount()
    }
  }
  // A panel drawn before the band draws again once the band has a width.
  const pane = await mountPane($, 'terminal')
  expect(await pane.find(note)).toBeUndefined()
  const band = await mountBand($, 'terminal', 80)
  expect(await pane.find(note)).toBeDefined()
  // A folded or hidden band shows no buttons at all.
  await band.press({ key: 'fold' })
  expect(await pane.find(note)).toBeUndefined()
  await band.press({ key: 'unfold' })
  expect(await pane.find(note)).toBeDefined()
  await runCommand($, 'toolbelt', 'hide')
  expect(await pane.find(note)).toBeUndefined()
  await band.unmount()
  await pane.unmount()
})

// Regression: with no icons, a narrow band shortens the words, and the note said it showed icons only.
test('a narrow band whose buttons have no icon draws no icons-only note', { options: TEST_OPTIONS }, async ($, on) => {
  const style = { key: 'oh-my-toolbelt.iconStyle', label: 'Icon style', kind: 'choice', value: 'icon+label', options: ['icon+label', 'icon', 'label'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  const icons = Object.fromEntries(['pomodoro', 'curtain', 'export', 'notes', 'edit', 'theme', 'voice', 'attach'].map(id => [id, 'none']))
  await boot($, on, { settings: [style] as never, store: { icons } })
  await runCommand($, 'toolbelt', 'status')
  const band = await mountBand($, 'terminal', 80)
  expect((await band.find({ key: 'curtain' }))?.props.label).not.toContain('▢')
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: 'The toolbelt is narrow now, so its buttons show icons only. A wider window shows their names too.' })).toBeUndefined()
  await pane.unmount()
  await band.unmount()
})

test('a narrow band under the icon-only style draws no such note', { options: { ...TEST_OPTIONS, iconStyle: 'icon' } }, async ($, on) => {
  const style = { key: 'oh-my-toolbelt.iconStyle', label: 'Icon style', kind: 'choice', value: 'icon', options: ['icon+label', 'icon', 'label'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  await boot($, on, { settings: [style] as never })
  await runCommand($, 'toolbelt', 'status')
  const band = await mountBand($, 'terminal', 80)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: 'The toolbelt is narrow now, so its buttons show icons only. A wider window shows their names too.' })).toBeUndefined()
  await pane.unmount()
  await band.unmount()
})

// Regression: a start says a zone is unknown, a change in the desktop app's status tab said nothing.
test('a time zone this computer lacks, picked in the desktop app, is said at once', { options: TEST_OPTIONS }, async ($, on) => {
  const zones = JSON.stringify({ userConfig: { timeZone: { type: 'string', title: 'Time zone', options: ['system', 'UTC', 'Mars/Phobos'], default: 'system' } } })
  on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: zones } : { deny: 'ENOENT: no such file' }))
  const { calls } = await boot($, on, { isInteractive: false })
  const pane = await desktopStatus($)
  await pick(pane, 'setting-oh-my-toolbelt.timeZone', 'UTC')
  expect(calls.toasts.some(text => text.startsWith('Unknown time zone'))).toBe(false)
  await pick(pane, 'setting-oh-my-toolbelt.timeZone', 'Mars/Phobos')
  expect(calls.toasts).toContain('Unknown time zone "Mars/Phobos"; showing system time.')
  await pane.unmount()
})

// Regression: the clock fell back to the local time without a word, so the status tab never said it did; then it said so
// again each minute, over any error since.
test('a time zone this computer lacks draws the local time, and the status tab says so once', { options: TEST_OPTIONS }, async ($, on) => {
  const zones = JSON.stringify({ userConfig: { timeZone: { type: 'string', title: 'Time zone', options: ['system', 'UTC', 'Mars/Phobos', 'Mars/Deimos'], default: 'system' } } })
  on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: zones } : { deny: 'ENOENT: no such file' }))
  const failSet = { on: false }
  const { calls, clock } = await boot($, on, { isInteractive: false, failSet })
  const pane = await desktopStatus($)
  const lastError = async () => (await pane.findAll({ type: 'Text' })).map(node => node.text).find(text => text.startsWith('Last error: '))
  const NO_ZONE = 'Last error: Time zone support is unavailable; showing system time.'
  expect(await lastError()).toBeUndefined()
  await pick(pane, 'setting-oh-my-toolbelt.timeZone', 'Mars/Phobos')
  // By the next minute the label changed, whatever zone the computer is in.
  await clock.advance(60_000)
  expect(await lastError()).toBe(NO_ZONE)
  // A later error stays shown as the clock goes on.
  failSet.on = true
  await pick(pane, 'setting-oh-my-toolbelt.timeZone', 'Mars/Deimos')
  failSet.on = false
  const later = await lastError()
  expect(later === undefined || later === NO_ZONE).toBe(false)
  await clock.advance(180_000)
  expect(await lastError()).toBe(later)
  expect(calls.logged.filter(line => line.includes('Time zone support is unavailable'))).toHaveLength(1)
  await pane.unmount()
})

test('two settings changed at once are both kept, each under its own key', { options: TEST_OPTIONS }, async ($, on) => {
  serveManifest(on)
  const { store } = await boot($, on, { isInteractive: false })
  const pane = await desktopStatus($)
  await pane.press({ key: 'setting-oh-my-toolbelt.dateFormat' })
  await Promise.all([pane.press(SECONDS), pane.press({ key: 'setting-oh-my-toolbelt.dateFormat/ymd' })])
  expect(overridesOf(store)).toEqual({ 'settingsOverride.clockSeconds': { value: true, base: false }, 'settingsOverride.dateFormat': { value: 'ymd', base: 'off' } })
  await pane.unmount()
})

test('at start a kept change applies while the engine hands what it replaced; one /config changed since does not', { options: { ...TEST_OPTIONS, clockSeconds: false } }, async ($, on) => {
  serveManifest(on)
  const kept = { 'settingsOverride.clockSeconds': { value: true, base: false }, 'settingsOverride.dateFormat': { value: 'ymd', base: 'auto' } }
  const { store } = await boot($, on, { isInteractive: false, store: kept })
  const pane = await desktopStatus($)
  expect((await pane.find(SECONDS))?.props.label).toBe('On')
  expect((await listOf(pane, 'setting-oh-my-toolbelt.dateFormat')).current).toBe('off')
  // A desktop writes nothing back: the terminal tidies the store once it lists the rows.
  expect(overridesOf(store)).toEqual(kept)
  await pane.unmount()
})

test('a terminal lists the rows a few seconds on, then writes kept changes to /config and drops them', { options: { ...TEST_OPTIONS, clockSeconds: false, dateFormat: 'off' } }, async ($, on) => {
  const set: [string, unknown][] = []
  on('config.set', (_, e) => (set.push([e.key, e.value]), { value: e.value }))
  const rows: unknown[] = []
  const kept = { 'settingsOverride.clockSeconds': { value: true, base: false }, 'settingsOverride.dateFormat': { value: 'ymd', base: 'auto' } }
  const { store, clock } = await boot($, on, { settings: rows as never, store: kept })
  expect(set).toEqual([])
  rows.push(row('clockSeconds', false), row('dateFormat', 'off'))
  await clock.advance(5000)
  expect(set).toEqual([['oh-my-toolbelt.clockSeconds', true]])
  // dateFormat's base no longer stands (/config changed it since), so it leaves without a write.
  expect(overridesOf(store)).toEqual({})
})

test('a kept change /config refuses, or a row it locks, leaves the store, is named and the mod runs with /config\'s value', { options: { ...TEST_OPTIONS, clockSeconds: false, dateFormat: 'off' } }, async ($, on) => {
  on('config.set', () => ({ deny: 'not now' }))
  const kept = { 'settingsOverride.clockSeconds': { value: true, base: false }, 'settingsOverride.dateFormat': { value: 'ymd', base: 'off' } }
  const settings = [row('clockSeconds', false), row('dateFormat', 'off', { isLocked: true })]
  const { store, calls } = await boot($, on, { settings: settings as never, store: kept })
  expect(overridesOf(store)).toEqual({})
  expect(calls.toasts).toContain('/config did not take these settings changed in the desktop app, so they are back as they were: clockSeconds, dateFormat')
  expect((await clockTexts($)).some(text => /^\d\d:\d\d:\d\d$/.test(text))).toBe(false)
})

test('a change /config could not be asked about (the call failed) stays for the next try', { options: { ...TEST_OPTIONS, clockSeconds: false } }, async ($, on) => {
  on('config.set', () => {
    throw new Error('engine busy')
  })
  const kept = { 'settingsOverride.clockSeconds': { value: true, base: false } }
  const { store, calls } = await boot($, on, { settings: [row('clockSeconds', false)] as never, store: kept })
  expect(overridesOf(store)).toEqual(kept)
  // Regression: the failure went to the debug log alone; the status tab says it too.
  expect(calls.logged.some(line => line.startsWith('oh-my-toolbelt: settings move failed: clockSeconds: '))).toBe(true)
})

// Regression: a refusal before a failure lost its toast and left the mod running with the refused value.
test('a refusal and a failure in one move: the refused is named and undone, the failed stays, a gone field leaves', { options: { ...TEST_OPTIONS, clockSeconds: false, dateFormat: 'off' } }, async ($, on) => {
  on('config.set', (_, e) => {
    if (e.key === 'oh-my-toolbelt.dateFormat') throw new Error('engine busy')
    return { deny: 'not now' }
  })
  const kept = {
    'settingsOverride.clockSeconds': { value: true, base: false },
    'settingsOverride.dateFormat': { value: 'ymd', base: 'off' },
    'settingsOverride.gone': { value: true, base: null },
  }
  const { store, calls } = await boot($, on, { settings: [row('clockSeconds', false), row('dateFormat', 'off')] as never, store: kept })
  expect(overridesOf(store)).toEqual({ 'settingsOverride.dateFormat': { value: 'ymd', base: 'off' } })
  expect(calls.toasts).toContain('/config did not take these settings changed in the desktop app, so they are back as they were: clockSeconds')
  expect((await clockTexts($)).some(text => /^\d\d:\d\d:\d\d$/.test(text))).toBe(false)
})

test('a terminal whose list is still empty draws no rows of its own and says the read failed', { options: TEST_OPTIONS }, async ($, on) => {
  serveManifest(on)
  await boot($, on)
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  expect(keysOf(await pane.drawn()).some(key => key.startsWith('setting-oh-my-toolbelt.'))).toBe(false)
  expect(await pane.find({ type: 'Text', text: 'The settings could not be read. Change them in /config.' })).toBeDefined()
  await pane.unmount()
})

// A refused change reloads nothing, so its pick must not play at a later reload.
test('a refused alert sound pick is dropped', { options: TEST_OPTIONS }, async ($, on) => {
  const sound = { key: 'oh-my-toolbelt.pomodoroSoundName', label: 'Pomodoro alert sound', kind: 'choice', value: 'bell', options: ['bell', 'marimba'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  on('config.set', () => ({ deny: 'managed by policy' }))
  const { calls } = await boot($, on, { settings: [sound] as never })
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  await pick(pane, 'setting-oh-my-toolbelt.pomodoroSoundName', 'marimba')
  expect(calls.toasts.at(-1)).toContain('managed by policy')
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(calls.played).toEqual([])
  await pane.unmount()
})

test('an alert sound pick whose /config call fails is dropped', { options: TEST_OPTIONS }, async ($, on) => {
  const sound = { key: 'oh-my-toolbelt.pomodoroSoundName', label: 'Pomodoro alert sound', kind: 'choice', value: 'bell', options: ['bell', 'marimba'], provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false }
  on('config.set', () => {
    throw new Error('engine busy')
  })
  const { calls } = await boot($, on, { settings: [sound] as never })
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  await pick(pane, 'setting-oh-my-toolbelt.pomodoroSoundName', 'marimba')
  expect(calls.logged.some(line => line.startsWith('oh-my-toolbelt: panel setting.set failed: '))).toBe(true)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(calls.played).toEqual([])
  await pane.unmount()
})

test('the export format is a settings row after the export folder, and the status card keeps no note of it', { options: TEST_OPTIONS }, async ($, on) => {
  const row = (field: string, value: string, options: string[]) => ({ key: `oh-my-toolbelt.${field}`, label: field, kind: 'choice', value, options, provider: { plugin: 'oh-my-toolbelt', tier: 'user' }, isLocked: false })
  await boot($, on, { settings: [row('exportDirectory', 'downloads', ['session', 'downloads']), row('pdfBrowser', 'off', ['off', 'auto'])] as never })
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  const keys = keysOf(await pane.drawn())
  const at = keys.indexOf('setting-oh-my-toolbelt.exportDirectory')
  expect(keys.slice(at, at + 2)).toEqual(['setting-oh-my-toolbelt.exportDirectory', 'export-format-box'])
  expect(await pane.find({ type: 'Text', text: 'saves this conversation in this format' })).toBeUndefined()
  await pane.unmount()
})
