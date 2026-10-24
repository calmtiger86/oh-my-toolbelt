// Button sets: the panel picks the set the band shows, makes a new empty set and shows it, and deletes an empty set
// other than `default`.
import { expect, test } from 'claude-code/testing'
import type { ButtonConfig } from '../types/index'
import { SURFACES, TEST_OPTIONS, boot, listOf, mountBand, mountPane, pick, seedButtons } from './helpers'

const buttonsOf = (store: Map<string, unknown>) => store.get('buttons') as ButtonConfig

// + New set opens the name field; it stays open after a refused name.
type SetPane = { find: (q: { key: string }) => Promise<unknown>; press: (q: { key: string }) => Promise<unknown>; input: (q: { key: string; text: string }) => Promise<unknown> }
async function addSet(pane: SetPane, text: string): Promise<void> {
  if ((await pane.find({ key: 'set-new' })) === undefined) await pane.press({ key: 'set-new-open' })
  await pane.input({ key: 'set-new', text })
}

test('a new set is empty and shown; picking default brings its buttons back to the band', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { store: { schemaVersion: 1, buttons: seedButtons() } })
  for (const surface of SURFACES) {
    const name = `Work ${surface}`
    const pane = await mountPane($, surface)
    // A bare field was easy to miss: + New set shows it, and it closes once the set is made.
    expect(await pane.find({ key: 'set-new' })).toBeUndefined()
    await addSet(pane, `  ${name}  `)
    expect(await pane.find({ key: 'set-new' })).toBeUndefined()
    expect(buttonsOf(store).activeSet).toBe(name)
    expect(buttonsOf(store).sets[name]).toEqual([])
    expect(calls.toasts.at(-1)).toBe(`Set ${name} added.`)
    const band = await mountBand($, surface, 258)
    expect(await band.find({ key: 'btn:b-deslop' })).toBeUndefined()
    await pick(pane, 'set', 'default')
    expect(buttonsOf(store).activeSet).toBe('default')
    expect(await band.find({ key: 'btn:b-deslop' })).toBeDefined()
    await band.unmount()
    await pane.unmount()
  }
})

test('a set name that is empty, over 16 cells or taken is refused with a toast', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on)
  const pane = await mountPane($, 'terminal')
  for (const text of [' ', '가나다라마바사아자', 'default']) await addSet(pane, text)
  // A refused name keeps the field open; Cancel closes it.
  expect(await pane.find({ key: 'set-new' })).toBeDefined()
  await pane.press({ key: 'set-new-cancel' })
  expect([await pane.find({ key: 'set-new' }), await pane.find({ key: 'set-new-open' }) !== undefined]).toEqual([undefined, true])
  expect(Object.keys(buttonsOf(store)?.sets ?? { default: [] })).toEqual(['default'])
  expect(calls.toasts).toEqual(['Type a name for the set.', 'A set name can be at most 16 cells wide.', 'There is already a set named default.'])
  await addSet(pane, '가나다라마바사아')
  expect(buttonsOf(store).activeSet).toBe('가나다라마바사아')
})

test('default and a set with buttons stay; an empty set is deleted and default is shown', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { store: { schemaVersion: 1, buttons: seedButtons() } })
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'set-delete' })
  expect(calls.toasts.at(-1)).toBe('The default set cannot be deleted.')
  await addSet(pane, 'Spare')
  await pane.press({ key: 'button-new' })
  await pane.input({ key: 'field-label', text: 'Hi' })
  await pane.input({ key: 'field-text', text: 'hello' })
  await pane.press({ key: 'save' })
  expect(buttonsOf(store).sets.Spare).toHaveLength(1)
  await pane.press({ key: 'set-delete' })
  expect(calls.toasts.at(-1)).toBe("Delete the set's buttons first.")
  const id = buttonsOf(store).sets.Spare?.[0]?.id ?? ''
  await pane.press({ key: `delete-${id}` })
  await pane.press({ key: 'set-delete' })
  expect(calls.toasts.at(-1)).toBe('Set Spare deleted.')
  expect(buttonsOf(store)).toMatchObject({ activeSet: 'default' })
  expect(Object.keys(buttonsOf(store).sets)).toEqual(['default'])
})

test('the same hotkey letter may be used in two sets, and picking a set closes an open form', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { schemaVersion: 1, buttons: seedButtons() } })
  const pane = await mountPane($, 'terminal')
  await addSet(pane, 'Other')
  await pane.press({ key: 'button-new' })
  await pane.input({ key: 'field-label', text: 'Again' })
  await pane.input({ key: 'field-text', text: 'again' })
  await pane.input({ key: 'field-hotkey', text: 's' })
  await pane.press({ key: 'save' })
  expect(buttonsOf(store).sets.Other?.[0]?.hotkey).toBe('s')
  await pane.press({ key: 'button-new' })
  expect(await pane.find({ key: 'form' })).toBeDefined()
  await pick(pane, 'set', 'default')
  expect(await pane.find({ key: 'form' })).toBeUndefined()
})

test('sets stop at 32, and a store holding more lists them all', { options: TEST_OPTIONS }, async ($, on) => {
  const many = (n: number): ButtonConfig => ({ version: 1, activeSet: 'set-69', sets: { default: [], ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`set-${i}`, []])) } })
  const { calls, store } = await boot($, on, { store: { schemaVersion: 1, buttons: many(70) } })
  const pane = await mountPane($, 'terminal')
  const picker = await listOf(pane, 'set')
  expect([picker.values.length, picker.current]).toEqual([71, 'set-69'])
  await addSet(pane, 'one more')
  expect(Object.keys(buttonsOf(store).sets)).toHaveLength(71)
  expect(calls.toasts.at(-1)).toBe('There can be at most 32 sets.')
  await pane.unmount()
})
