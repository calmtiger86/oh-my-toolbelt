// When the host fails: store reads and writes that fail, a read-only store, a band drawn before the start, a press that
// throws, and timers that stopped.
import { expect, test } from 'claude-code/testing'
import type { ButtonConfig, Layout } from '../types/index'
import { SLOW_MS, TEST_OPTIONS, boot, keysOf, mountBand, mountPane, seedButtons } from './helpers'

const MINUTE = 60_000
const FOCUS_DONE = 'Focus session finished. Time for a break.'
const SAVE_FAILED = 'Could not save your settings.'
const STORE_NEWER = 'Your settings were saved by a newer version of Oh My Toolbelt, so changes made here are not saved.'
const LAYOUT: Layout = { left: ['pomodoro', 'clock'], right: ['btn:b-deslop', 'edit'], hidden: [] }
const idsOf = (store: Map<string, unknown>) => ((store.get('buttons') as ButtonConfig).sets.default ?? []).map(b => b.id)
const userKeys = (keys: string[]) => keys.filter(key => key.startsWith('btn:'))

type Pane = Awaited<ReturnType<typeof mountPane<'terminal'>>>
async function fillNewButton(pane: Pane): Promise<void> {
  await pane.press({ key: 'button-new' })
  await pane.input({ key: 'field-label', text: 'X' })
  await pane.input({ key: 'field-text', text: 'hello' })
}

test('failed reads at start write nothing over the stored buttons and layout', async ($, on) => {
  const buttons = seedButtons()
  const { calls, store } = await boot($, on, { store: { schemaVersion: 1, buttons, layout: LAYOUT }, failGet: ['schemaVersion', 'buttons', 'layout'] })
  expect(store.get('buttons')).toEqual(buttons)
  expect(store.get('layout')).toEqual(LAYOUT)
  expect(calls.logged.some(line => line.includes('store.get buttons failed'))).toBe(true)
})

test('a store due for its first write is left alone when one read failed, and what was read is drawn', async ($, on) => {
  const { store } = await boot($, on, { store: { buttons: seedButtons(), layout: LAYOUT }, failGet: ['layout'] })
  expect(store.has('schemaVersion')).toBe(false)
  expect(store.get('layout')).toEqual(LAYOUT)
  const ui = await mountBand($, 'terminal', 258)
  expect(keysOf(await ui.drawn())).toContain('btn:b-deslop')
  await ui.unmount()
})

test('a save whose fresh read fails is stopped, so newer buttons from another session stay', { options: TEST_OPTIONS }, async ($, on) => {
  const failGet: string[] = []
  const { calls, store } = await boot($, on, { store: { schemaVersion: 1, buttons: seedButtons() }, failGet })
  const pane = await mountPane($, 'terminal')
  await fillNewButton(pane)
  const newer = seedButtons()
  store.set('buttons', { ...newer, sets: { default: [...(newer.sets.default ?? []), { id: 'b-other', kind: 'prompt', label: 'Other', text: 'o', mode: 'fill' }] } })
  failGet.push('buttons')
  await pane.press({ key: 'save' })
  expect(idsOf(store)).toEqual(['ex-review', 'ex-usage', 'b-deslop', 'b-commit', 'b-other'])
  expect(calls.toasts).toEqual([SAVE_FAILED])
  expect(await pane.find({ key: 'save' })).toBeDefined()
  await pane.unmount()
})

test('a read-only store saves nothing, says why, keeps the form open and the band as it was', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { store: { schemaVersion: 2, buttons: seedButtons() } })
  const pane = await mountPane($, 'terminal')
  await fillNewButton(pane)
  await pane.press({ key: 'save' })
  expect(calls.toasts).toEqual([STORE_NEWER])
  expect(idsOf(store)).toHaveLength(4)
  expect(await pane.find({ key: 'save' })).toBeDefined()
  await pane.press({ key: 'side-clock' })
  expect(store.has('layout')).toBe(false)
  const band = await mountBand($, 'terminal', 258)
  expect(userKeys(keysOf(await band.drawn()))).toHaveLength(4)
  expect((await band.find({ key: 'band-left' }))?.text).toContain('05:32')
  await band.unmount()
  await pane.unmount()
})

test('a refused write toasts the failure once, never success, and changes nothing on screen', { options: TEST_OPTIONS }, async ($, on) => {
  const failSet = { on: false }
  const { calls, store } = await boot($, on, { failSet })
  const before = { buttons: store.get('buttons'), layout: store.get('layout') }
  const pane = await mountPane($, 'terminal')
  await fillNewButton(pane)
  failSet.on = true
  await pane.press({ key: 'save' })
  await pane.press({ key: 'layout-reset' })
  expect(calls.toasts).toEqual([SAVE_FAILED, SAVE_FAILED])
  expect(await pane.find({ key: 'save' })).toBeDefined()
  expect({ buttons: store.get('buttons'), layout: store.get('layout') }).toEqual(before)
  const band = await mountBand($, 'terminal', 258)
  expect(userKeys(keysOf(await band.drawn()))).toEqual(['btn:ex-review', 'btn:ex-usage'])
  await band.unmount()
  await pane.unmount()
})

test('a band drawn before session.start fills in once the session starts', { options: TEST_OPTIONS }, async ($, on) => {
  const early: { ui?: Awaited<ReturnType<typeof mountBand<'terminal'>>>; keys: string[] } = { keys: [] }
  await boot($, on, {
    beforeStart: async () => {
      const ui = await mountBand($, 'terminal', 119)
      early.ui = ui
      early.keys = keysOf(await ui.drawn())
    },
  })
  expect(early.keys).not.toContain('band-row')
  expect(keysOf(await early.ui?.drawn())).toContain('band-row')
  await early.ui?.unmount()
})

test('a press that throws in the band or the panel is caught and logged', { options: TEST_OPTIONS }, async ($, on) => {
  const failStateGet = { on: false }
  const { calls } = await boot($, on, { failStateGet })
  const band = await mountBand($, 'terminal', 119)
  const pane = await mountPane($, 'terminal')
  failStateGet.on = true
  await band.press({ key: 'pomodoro' })
  await pane.press({ key: 'tab-status' })
  failStateGet.on = false
  expect(calls.logged.some(line => line.includes('press pomodoro failed'))).toBe(true)
  expect(calls.logged.some(line => line.includes('panel tab failed'))).toBe(true)
  await band.unmount()
  await pane.unmount()
})

// 25 minutes of one-second redraws of the band: see the warning-color test in band.test.tsx.
test('a failure while the session starts leaves a debug line and the timers running', { timeoutMs: SLOW_MS }, async ($, on) => {
  const failStateSet = { on: true }
  const { calls, clock } = await boot($, on, { failStateSet })
  failStateSet.on = false
  const band = await mountBand($, 'terminal', 119)
  await band.press({ key: 'pomodoro' })
  await clock.advance(25 * MINUTE)
  expect(calls.notified).toEqual([FOCUS_DONE])
  expect(calls.logged.some(line => line.includes('session.start hook failed'))).toBe(true)
  await band.unmount()
})

test('after /clear the timers start again, even one whose period the host refused', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const refuseTick = { on: false }
  const { calls, clock } = await boot($, on, { refuseTick })
  const band = await mountBand($, 'terminal', 119)
  await band.press({ key: 'pomodoro' })
  refuseTick.on = true
  await clock.advance(2000)
  refuseTick.on = false
  await clock.advance(10 * MINUTE)
  expect((await band.find({ key: 'pomodoro' }))?.props.label).toBe('🍅 24:59')
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(1000)
  expect((await band.find({ key: 'pomodoro' }))?.props.label).toBe('🍅 14:57')
  await clock.advance(15 * MINUTE)
  expect(calls.notified).toEqual([FOCUS_DONE])
  await band.unmount()
})
