// The notes tab: the field saves a note, the list shows the newest first with Insert and Delete, the store is shared by
// every session and is read again just before each write, and the `n` button toggles the tab.
import { expect, test } from 'claude-code/testing'
import type { Note } from '../types/index'
import { cellsOf } from '../hooks/lib/width'
import { NOW, SLOW_MS, SURFACES, TEST_OPTIONS, boot, mountBand, mountPane, runCommand } from './helpers'

type Pane = Awaited<ReturnType<typeof mountPane>>

const note = (id: string, text = id, createdAt = NOW): Note => ({ id, text, createdAt })
const notesOf = (store: Map<string, unknown>) => store.get('notes') as Note[]
const idsOf = (store: Map<string, unknown>) => notesOf(store).map(n => n.id)
const textsOf = (store: Map<string, unknown>) => notesOf(store).map(n => n.text)

// The notes tab on a surface.
async function openNotes(...args: [Parameters<typeof mountPane>[0], 'terminal' | 'desktop']): Promise<Pane> {
  const pane = await mountPane(...args)
  await pane.press({ key: 'tab-notes' })
  return pane
}

// The ids of the rows drawn, top to bottom.
const rowIds = async (pane: Pane) =>
  (await pane.findAll({ type: 'Button' })).flatMap(b => (b.key?.startsWith('note-fill-') ? [b.key.slice('note-fill-'.length)] : []))
const lineOf = async (pane: Pane, id: string) => (await pane.find({ key: `note-text-${id}` }))?.text

test('a note typed in the field is saved last in the store and listed first, on both surfaces', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, clock, store } = await boot($, on)
  for (const surface of SURFACES) {
    const pane = await openNotes($, surface)
    expect(await pane.find({ key: 'note-input' })).toBeDefined()
    await pane.input({ key: 'note-input', text: `First ${surface}` })
    await clock.advance(5)
    await pane.input({ key: 'note-input', text: `  Second ${surface}\nwith a second line  ` })
    // A blank text is ignored, with no word about it.
    await pane.input({ key: 'note-input', text: ' \n ' })
    const ids = await rowIds(pane)
    expect(ids).toHaveLength(surface === 'terminal' ? 2 : 4)
    expect(ids.slice(0, 2).reverse()).toEqual(idsOf(store).slice(-2))
    expect(textsOf(store).slice(-2)).toEqual([`First ${surface}`, `Second ${surface}\nwith a second line`])
    // Only the first line is drawn, with the date and time of the clock settings (24 hours, UTC here).
    expect(await lineOf(pane, ids[0] as string)).toBe(`Second ${surface}`)
    expect((await pane.findAll({ type: 'Text' })).filter(t => t.text === '10/22, 05:32').length).toBeGreaterThan(0)
    await pane.unmount()
  }
  expect(calls.toasts).toEqual([])
})

test('the list is newest first and follows the language and the 12-hour setting', { options: { clockFormat: '12', timeZone: 'Asia/Seoul' } }, async ($, on) => {
  await boot($, on, { env: { LANG: 'en_US.UTF-8' }, store: { notes: [note('a', 'old', NOW), note('b', 'new', NOW + 3_600_000)] } })
  const pane = await openNotes($, 'terminal')
  expect(await rowIds(pane)).toEqual(['b', 'a'])
  const stamps = (await pane.findAll({ type: 'Text' })).map(t => t.text).filter(text => /\d:\d\d/.test(text))
  expect(stamps).toEqual(['10/22, 3:32 PM', '10/22, 2:32 PM'])
  await pane.unmount()
})

test('the labels and the empty list read in the person\'s language', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  const pane = await openNotes($, 'terminal')
  // In the terminal a tab is a badge, its name with a space either side.
  expect((await pane.find({ key: 'tab-notes' }))?.text).toBe(' 메모 ')
  expect(await pane.find({ type: 'Text', text: '메모가 아직 없습니다. 모든 세션이 함께 쓰고, 평문으로 저장됩니다.' })).toBeDefined()
  await pane.input({ key: 'note-input', text: '우유 사기' })
  const [id] = await rowIds(pane)
  expect((await pane.find({ key: `note-fill-${id}` }))?.text).toBe('넣기')
  expect((await pane.find({ key: `note-delete-${id}` }))?.text).toBe('삭제')
  await pane.unmount()
})

test('a long first line is cut to 60 cells, wide letters counted as two', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { store: { notes: [note('a', 'x'.repeat(200)), note('b', '가'.repeat(100)), note('c', '\n\n  short  \nlater lines')] } })
  const pane = await openNotes($, 'terminal')
  const [c, b, a] = await rowIds(pane)
  for (const id of [a, b]) {
    const line = (await lineOf(pane, id as string)) ?? ''
    expect(cellsOf(line)).toBeLessThanOrEqual(60)
    expect(line.endsWith('…')).toBe(true)
  }
  expect(await lineOf(pane, c as string)).toBe('short')
  await pane.unmount()
})

test('Insert puts the whole note at the cursor of the prompt box', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on, { store: { notes: [note('a', 'line one\nline two'), note('b', 'other')] } })
  for (const surface of SURFACES) {
    const pane = await openNotes($, surface)
    await pane.press({ key: 'note-fill-a' })
    await pane.unmount()
  }
  expect(calls.filled).toEqual(['line one\nline two', 'line one\nline two'])
  expect(calls.fillModes).toEqual(['insert', 'insert'])
})

test('Delete removes the note from the store and the list', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { notes: [note('a'), note('b'), note('c')] } })
  for (const surface of SURFACES) {
    const pane = await openNotes($, surface)
    if (surface === 'terminal') {
      await pane.press({ key: 'note-delete-b' })
      expect(idsOf(store)).toEqual(['a', 'c'])
      expect(await rowIds(pane)).toEqual(['c', 'a'])
    } else {
      await pane.press({ key: 'note-delete-a' })
      expect(idsOf(store)).toEqual(['c'])
      expect(await rowIds(pane)).toEqual(['c'])
    }
    await pane.unmount()
  }
})

test('past 500 notes the oldest go and a toast says so; short of it there is none', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const full = Array.from({ length: 499 }, (_, i) => note(`s${i}`))
  const { calls, store } = await boot($, on, { store: { notes: full } })
  const pane = await openNotes($, 'terminal')
  await pane.input({ key: 'note-input', text: 'five hundredth' })
  expect(notesOf(store)).toHaveLength(500)
  expect(calls.toasts).toEqual([])
  await pane.input({ key: 'note-input', text: 'five hundred and first' })
  expect(notesOf(store)).toHaveLength(500)
  expect(idsOf(store)[0]).toBe('s1')
  expect(textsOf(store).slice(-2)).toEqual(['five hundredth', 'five hundred and first'])
  expect(calls.toasts).toEqual(['Over the limit of 500 notes or 256 KiB: removed 1 of the oldest.'])
  expect(await rowIds(pane)).toHaveLength(500)
  await pane.unmount()
})

test('past 256 KiB the oldest go too, and a note that alone is too big is refused', { options: TEST_OPTIONS }, async ($, on) => {
  const big = (id: string) => note(id, '가'.repeat(30_000))
  const { calls, store } = await boot($, on, { store: { notes: [big('a'), big('b')] } })
  const pane = await openNotes($, 'terminal')
  await pane.input({ key: 'note-input', text: '가'.repeat(30_000) })
  expect(notesOf(store)).toHaveLength(2)
  expect(idsOf(store)[0]).toBe('b')
  expect(calls.toasts).toEqual(['Over the limit of 500 notes or 256 KiB: removed 1 of the oldest.'])
  const before = JSON.stringify(notesOf(store))
  await pane.input({ key: 'note-input', text: 'x'.repeat(300 * 1024) })
  expect(JSON.stringify(notesOf(store))).toBe(before)
  expect(calls.toasts.at(-1)).toBe('That note is too big to save (up to 256 KiB).')
  await pane.unmount()
})

test('a note another session saved is kept: the store is read again just before the write', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { notes: [note('a')] } })
  const pane = await openNotes($, 'terminal')
  // Another session adds b and c after this one read the notes.
  store.set('notes', [note('a'), note('b'), note('c')])
  await pane.input({ key: 'note-input', text: 'mine' })
  expect(idsOf(store).slice(0, 3)).toEqual(['a', 'b', 'c'])
  expect(textsOf(store)).toEqual(['a', 'b', 'c', 'mine'])
  // The list now shows what was written, theirs included.
  expect(await rowIds(pane)).toHaveLength(4)
  // A delete also starts from the store: another session's d stays, and a note it deleted does not come back.
  store.set('notes', [note('b'), note('c'), note('d'), notesOf(store)[3] as Note])
  await pane.press({ key: 'note-delete-c' })
  expect(textsOf(store)).toEqual(['b', 'd', 'mine'])
  await pane.unmount()
})

test('opening the tab shows what the store holds now', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { notes: [note('a')] } })
  const pane = await mountPane($, 'terminal')
  store.set('notes', [note('a'), note('z', 'from elsewhere')])
  await pane.press({ key: 'tab-notes' })
  expect(await rowIds(pane)).toEqual(['z', 'a'])
  await pane.unmount()
})

test('a refused save changes nothing on screen and says so', { options: TEST_OPTIONS }, async ($, on) => {
  const failSet = { on: false }
  const { calls, store } = await boot($, on, { failSet, store: { notes: [note('a')] } })
  const pane = await openNotes($, 'terminal')
  failSet.on = true
  await pane.input({ key: 'note-input', text: 'lost' })
  await pane.press({ key: 'note-delete-a' })
  expect(await rowIds(pane)).toEqual(['a'])
  expect(idsOf(store)).toEqual(['a'])
  expect(calls.toasts).toEqual(['Could not save your settings.', 'Could not save your settings.'])
  await pane.unmount()
})

test('an unreadable store stops a save instead of replacing the notes', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { failGet: ['notes'], store: { notes: [note('a')] } })
  const pane = await openNotes($, 'terminal')
  await pane.input({ key: 'note-input', text: 'would replace' })
  expect(idsOf(store)).toEqual(['a'])
  expect(calls.toasts).toEqual(['Could not save your settings.'])
  await pane.unmount()
})

test('a store of a newer version is read but not written', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { store: { schemaVersion: 99, notes: [note('a')] } })
  const pane = await openNotes($, 'terminal')
  expect(await rowIds(pane)).toEqual(['a'])
  await pane.input({ key: 'note-input', text: 'new' })
  expect(idsOf(store)).toEqual(['a'])
  expect(calls.toasts).toContain('Your settings were saved by a newer version of Oh My Toolbelt, so changes made here are not saved.')
  await pane.unmount()
})

test('stored notes of the wrong shape are left out of the list', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { store: { notes: [note('a'), { id: 5 }, 'text', null] } })
  const pane = await openNotes($, 'terminal')
  expect(await rowIds(pane)).toEqual(['a'])
  await pane.unmount()
})

test('after /clear the notes come back from the store', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on)
  store.set('notes', [note('a', 'kept')])
  await $.classic.SessionStart({ source: 'clear' })
  const pane = await openNotes($, 'terminal')
  expect(await rowIds(pane)).toEqual(['a'])
  await pane.unmount()
})

test('the n button opens the notes tab, a second press closes the panel, and from another tab it moves to notes', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on)
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, 258)
    const opened = calls.opened.length
    const closed = calls.closed
    await band.press({ key: 'notes' })
    expect([calls.opened.length - opened, calls.closed - closed]).toEqual([1, 0])
    const pane = await mountPane($, surface)
    expect(await pane.find({ key: 'note-input' })).toBeDefined()
    await pane.unmount()
    await band.press({ key: 'notes' })
    expect(calls.closed - closed).toBe(1)
    // The panel open on the tools tab: a press moves to the notes, a second press closes.
    await band.press({ key: 'edit' })
    await band.press({ key: 'notes' })
    expect(calls.closed - closed).toBe(1)
    const moved = await mountPane($, surface)
    expect(await moved.find({ key: 'note-input' })).toBeDefined()
    await moved.unmount()
    await band.press({ key: 'notes' })
    expect(calls.closed - closed).toBe(2)
    await band.unmount()
  }
})

test('/toolbelt notes opens the notes tab', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on)
  expect(await runCommand($, 'toolbelt', 'notes')).toEqual({})
  expect(calls.opened).toHaveLength(1)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ key: 'note-input' })).toBeDefined()
  await pane.unmount()
})
