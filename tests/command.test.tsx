// /toolbelt and /tb, the pomodoro's end and the reload after /clear.
import { expect, test } from 'claude-code/testing'
import { COMMANDS, NOW, SLOW_MS, SURFACES, TEST_OPTIONS, boot, keysOf, mountBand, mountPane, runCommand } from './helpers'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const FOCUS_DONE = 'Focus session finished. Time for a break.'
const USAGE = 'Usage: /toolbelt [tools|toc|notes|clips|status|guide] | toc next|prev|first|last|<n>|find <words> | hide | show | pomodoro start|pause|stop|reset | weather refresh | curtain on|off | export [txt|md|html|pdf]'

test('session start registers /toolbelt and the /tb alias', async ($, on) => {
  const { calls } = await boot($, on)
  expect(calls.registered).toEqual(['toolbelt', 'tb'])
  // Both run at once when typed while a turn is in flight (/toolbelt used to reach the model).
  expect(calls.immediate).toEqual(['toolbelt', 'tb'])
})

test('the alias is skipped when another command owns /tb', async ($, on) => {
  const { calls } = await boot($, on, { commands: [{ name: 'tb', description: '', source: 'builtin' }] })
  expect(calls.registered).toEqual(['toolbelt'])
})

test('a refused /tb leaves /toolbelt working', async ($, on) => {
  const { calls } = await boot($, on, { refuse: ['tb'] })
  expect(calls.registered).toEqual(['toolbelt', 'tb'])
  expect(await runCommand($, 'toolbelt', '')).toEqual({})
  expect(calls.opened).toEqual([{ id: 'oh-my-toolbelt', title: 'Toolbelt', focus: true, closeOnEscape: true, rows: 12 }])
})

test('/tb opens the panel on the tab asked for', async ($, on) => {
  const { calls } = await boot($, on)
  await runCommand($, 'tb', 'more')
  expect(calls.opened).toHaveLength(1)
})

test('hide and show take the band away and bring it back, and are saved', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'hide')).text).toBe('Toolbelt hidden. Type /toolbelt show to bring it back.')
  expect(store.get('bandHidden')).toBe(true)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, 119)
    expect(keysOf(await ui.drawn())).not.toContain('band-row')
    await ui.unmount()
  }
  expect((await runCommand($, 'tb', 'show')).text).toBe('Toolbelt shown.')
  expect(store.get('bandHidden')).toBe(false)
  const ui = await mountBand($, 'terminal', 119)
  expect(keysOf(await ui.drawn())).toContain('band-row')
  await ui.unmount()
})

test('only a person can hide the band', async ($, on) => {
  const { store } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'hide', 'plugin')).text).toContain('This can only be changed by typing the command yourself.')
  expect(store.has('bandHidden')).toBe(false)
})

test('an unknown word answers the usage line, in the person\'s language', async ($, on) => {
  await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  expect((await runCommand($, 'toolbelt', 'dance')).text).toBe(
    '알 수 없는 인자: dance 사용법: /toolbelt [tools|toc|notes|clips|status|guide] | toc next|prev|first|last|<n>|find <words> | hide | show | pomodoro start|pause|stop|reset | weather refresh | curtain on|off | export [txt|md|html|pdf]',
  )
})

test('a focus round notifies once when it ends, with no sound by default', { timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, clock, store } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'pomodoro start')).text).toBe('Pomodoro started.')
  expect(store.get('pomodoro')).toMatchObject({ phase: 'focus', endsAt: NOW + 25 * MINUTE })
  await clock.advance(25 * MINUTE)
  expect(calls.notified).toEqual([FOCUS_DONE])
  expect(calls.toasts).toEqual([FOCUS_DONE])
  expect(calls.played).toEqual([])
  expect(store.get('pomodoro')).toMatchObject({ phase: 'idle', round: 1 })
})

test('the sound plays when pomodoroSound is on', { options: { pomodoroSound: true }, timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, clock } = await boot($, on)
  await runCommand($, 'toolbelt', 'pomodoro start')
  await clock.advance(25 * MINUTE)
  expect(calls.played).toEqual(['assets/sounds/done.wav'])
})

test('with no notification surface the end shows as a toast', { timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, clock } = await boot($, on, { notify: { isSent: false, reason: 'no-surface' } })
  await runCommand($, 'toolbelt', 'pomodoro start')
  await clock.advance(25 * MINUTE)
  expect(calls.toasts).toContain(FOCUS_DONE)
})

test('pause keeps the time left, and start goes on from it', { timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, clock, store } = await boot($, on)
  await runCommand($, 'toolbelt', 'pomodoro start')
  await clock.advance(10 * MINUTE)
  expect((await runCommand($, 'toolbelt', 'pomodoro pause')).text).toBe('Pomodoro paused.')
  expect(store.get('pomodoro')).toMatchObject({ phase: 'paused', remainingMs: 15 * MINUTE })
  await clock.advance(30 * MINUTE)
  expect(calls.notified).toEqual([])
  await runCommand($, 'toolbelt', 'pomodoro start')
  expect(store.get('pomodoro')).toMatchObject({ phase: 'focus', endsAt: NOW + 55 * MINUTE })
  expect((await runCommand($, 'toolbelt', 'pomodoro stop')).text).toBe('Pomodoro stopped.')
  expect(store.get('pomodoro')).toMatchObject({ phase: 'idle' })
})

test('after /clear the commands come back and the band draws from the store', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on)
  store.set('layout', { left: ['pomodoro'], right: ['edit', 'clock'], hidden: [] })
  const running = { phase: 'focus', endsAt: NOW + 10 * MINUTE, remainingMs: null, remainingSec: 600, round: 0, updatedAt: NOW + 1 }
  store.set('pomodoro', running)
  await $.classic.SessionStart({ source: 'clear' })
  expect(calls.registered).toEqual(['toolbelt', 'tb', 'toolbelt', 'tb'])
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, 119)
    expect((await ui.find({ key: 'band-left' }))?.text).not.toContain('05:32')
    expect((await ui.find({ key: 'band-right' }))?.text).toContain('05:32')
    expect((await ui.find({ key: 'pomodoro' }))?.props.label).toBe('🍅 10:00')
    await ui.unmount()
  }
})

test('after /clear the alias comes back even when the list does not name its plugin', async ($, on) => {
  const commands = [...COMMANDS]
  const { calls } = await boot($, on, { commands })
  commands.push({ name: 'tb', description: '', source: 'plugin' })
  await $.classic.SessionStart({ source: 'clear' })
  expect(calls.registered).toEqual(['toolbelt', 'tb', 'toolbelt', 'tb'])
})

test('a session that finds the round ended elsewhere shows the toast, with no second notification or sound', { options: { pomodoroSound: true }, timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, clock, store } = await boot($, on)
  // Off the 60-second sync beat, so this session's own tick sees the end.
  await clock.advance(30_000)
  await runCommand($, 'toolbelt', 'pomodoro start')
  await clock.advance(25 * MINUTE - 1000)
  // Another session ended the round a moment earlier and saved the result.
  store.set('pomodoro', { phase: 'idle', endsAt: null, remainingMs: null, remainingSec: null, round: 1, updatedAt: clock.now() + 500 })
  await clock.advance(1000)
  expect(calls.toasts).toEqual([FOCUS_DONE])
  expect(calls.notified).toEqual([])
  expect(calls.played).toEqual([])
})

test('a round that ended while the app was closed is tidied without a notification', async ($, on) => {
  const stale = { phase: 'focus', endsAt: NOW - 3 * HOUR, remainingMs: null, remainingSec: 600, round: 0, updatedAt: NOW - 4 * HOUR }
  const { calls, clock, store } = await boot($, on, { store: { pomodoro: stale } })
  await clock.advance(1000)
  expect(calls.notified).toEqual([])
  expect(calls.toasts).toEqual([])
  expect(store.get('pomodoro')).toMatchObject({ phase: 'idle', round: 1 })
})

test('names an object inherits are not tabs, and an extra word after hide is the one named', async ($, on) => {
  const { calls } = await boot($, on)
  for (const word of ['constructor', '__proto__']) {
    expect((await runCommand($, 'toolbelt', word)).text).toBe(`Unknown argument: ${word} ${USAGE}`)
  }
  expect((await runCommand($, 'toolbelt', 'hide extra')).text).toBe(`Unknown argument: extra ${USAGE}`)
  expect((await runCommand($, 'tb', 'more now')).text).toBe(`Unknown argument: now ${USAGE}`)
  expect(calls.opened).toEqual([])
})

test('reset takes the pomodoro back to the start and its count to zero, from the command and the status tab', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { calls, clock, store } = await boot($, on)
  await runCommand($, 'toolbelt', 'pomodoro start')
  await clock.advance(25 * MINUTE)
  await runCommand($, 'toolbelt', 'pomodoro start')
  await clock.advance(3 * MINUTE)
  expect(store.get('pomodoro')).toMatchObject({ phase: 'focus', round: 1 })
  expect((await runCommand($, 'toolbelt', 'pomodoro reset')).text).toBe('Pomodoro reset: stopped, and the count of finished rounds is back to 0.')
  expect(store.get('pomodoro')).toMatchObject({ phase: 'idle', round: 0, endsAt: null })
  // The status tab's button, after the settings (none are listed here, so it comes last).
  await runCommand($, 'toolbelt', 'pomodoro start')
  await runCommand($, 'toolbelt', 'status')
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    expect(await pane.find({ type: 'Text', text: 'Pomodoro timer:' })).toBeDefined()
    await pane.press({ key: 'pomodoro-reset' })
    expect(store.get('pomodoro')).toMatchObject({ phase: 'idle', round: 0 })
    expect(calls.toasts.at(-1)).toBe('Pomodoro reset: stopped, and the count of finished rounds is back to 0.')
    await pane.unmount()
  }
})

// The desktop app hosts its sessions through the SDK: no start until a surface attaches, then one start; a -p run
// attaches nothing and stays off.
test('a session an SDK host starts begins when the desktop attaches, once', async ($, on) => {
  const { calls } = await boot($, on, { isInteractive: false })
  expect(calls.registered).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(calls.registered).toEqual(['toolbelt', 'tb'])
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:phone' })
  expect(calls.registered).toEqual(['toolbelt', 'tb'])
})

// Regression: a surface attaching while session.start still asked for the surfaces started the mod, and then the start,
// which had seen no surface, turned it off again (or, seeing the new one, started it a second time).
test('a surface attaching while the start asks for the surfaces starts the mod once, and it stays on', async ($, on) => {
  let reach = (): void => undefined
  let release = (): void => undefined
  const reached = new Promise<void>(resolve => (reach = resolve))
  const released = new Promise<void>(resolve => (release = resolve))
  // The start's question about the surfaces waits until the desktop has attached.
  const booting = boot($, on, { isInteractive: false, firstSurfaces: () => (reach(), released) })
  await reached
  const attaching = $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  release()
  await attaching
  const { calls } = await booting
  expect(calls.registered).toEqual(['toolbelt', 'tb'])
  const ui = await mountBand($, 'desktop', 119)
  expect(keysOf(await ui.drawn())).toContain('edit')
  await ui.unmount()
})

// The desktop app runs its sessions over the SDK, so what a person types there is `sdk` (the prompts tab used to stay
// empty). It is the person's: their prompts are listed and their commands are not refused.
test('in the desktop app a prompt and a command typed there are the person\'s', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.prompt.submit({ text: 'Plan the release', wait: false, origin: { kind: 'sdk' } })
  await $.ui.mount({ plugin: 'oh-my-toolbelt', surface: 'desktop', component: 'UserMessage', requestId: 'd1', props: { text: 'Plan the release', origin: { kind: 'sdk' }, isExpanded: false } })
  expect((await runCommand($, 'toolbelt', 'hide', 'sdk')).text).not.toContain('typing the command yourself')
  await runCommand($, 'toolbelt', 'show', 'sdk')
  await runCommand($, 'toolbelt', 'toc')
  const pane = await mountPane($, 'desktop')
  const rows = (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => b.text)
  expect(rows.some(text => text.includes('Plan the release')), rows.join(' | ')).toBe(true)
  await pane.unmount()
})

// A settings file change reloads the module, whose session.start in the desktop app carries no surface, though the
// desktop is still attached (in the real engine the toolbelt vanished after a terminal changed /config).
test('a desktop session stays on through a reload', async ($, on) => {
  await boot($, on, { isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const ui = await mountBand($, 'desktop', 119)
  expect(keysOf(await ui.drawn())).toContain('edit')
  await ui.unmount()
})
