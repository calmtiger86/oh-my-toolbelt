// The clipboard tab (hooks/clips.ts): what the person copied by dragging, read each second from `$.ui.selection()`,
// newest first, for this session only.
import { expect, test } from 'claude-code/testing'
import type { ClipBoard } from '../types/index'
import type { EngineInterface } from 'claude-code'
import { CLIPS_MAX, CLIP_CHARS_MAX, clipEffects, noteSelection, restoreClips, withReading } from '../hooks/clips'
import { engineOf } from '../hooks/register'
import { TEST_OPTIONS, boot, keysOf, mountPane } from './helpers'

const EMPTY: ClipBoard = { clips: [], seen: null, changing: null }
// The texts the board keeps after each reading, a second apart.
const after = (...readings: (string | undefined)[]): string[] =>
  readings.reduce((board, text, i) => withReading(board, text, `c${i}`), EMPTY).clips.map(clip => clip.text)

test('a drag read while it grows or shrinks keeps its last text, once', () => {
  expect(after('hel', 'hello wor', 'hello world', 'hello world')).toEqual(['hello world'])
  expect(after('hello world', 'hello', 'hello')).toEqual(['hello'])
})

// Regression: the first piece of a new drag took the place of the clip before it.
test('a clip read twice, or whose selection went, stays: the next drag starts a clip of its own', () => {
  expect(after('hello world', 'hello world', 'w', 'wow, great', 'wow, great')).toEqual(['wow, great', 'hello world'])
  expect(after('hello world', undefined, 'w', 'wow')).toEqual(['wow', 'hello world'])
  expect(after('npm install left-pad failed', 'npm install left-pad failed', 'left-pad')).toEqual(['left-pad', 'npm install left-pad failed'])
})

// Regression: a later copy that began with the newest clip took its place, however long after.
test('a copy that begins or ends with the newest clip is a clip of its own once that selection went', () => {
  expect(after('error', 'error', undefined, 'error: file not found', 'error: file not found')).toEqual(['error: file not found', 'error'])
  expect(after('src/app.ts', 'src/app.ts', undefined, 'open src/app.ts')).toEqual(['open src/app.ts', 'src/app.ts'])
})

// Regression: a copy a second after another took its place.
test('a new drag read the second after a clip shares no end with it, so both stay', () => {
  expect(after('hello world', 'w', 'wow, great', 'wow, great')).toEqual(['wow, great', 'hello world'])
  expect(after('a1', 'a1', 'b2', 'b2', 'a1', 'x', 'xyz')).toEqual(['xyz', 'a1', 'b2'])
})

test('a drag that pauses and goes on at either end is still one clip', () => {
  expect(after('hello', 'hello', 'hello world', 'hello world')).toEqual(['hello world'])
  expect(after('world', 'world', 'hello world', 'hello world')).toEqual(['hello world'])
})

test('a blank selection or one past the cap is skipped; the same text again moves up; the newest few stay', () => {
  expect(after('a', 'a', '   ', 'x'.repeat(CLIP_CHARS_MAX + 1))).toEqual(['a'])
  expect(after('a', 'a', 'b', 'b', undefined, 'a', 'a')).toEqual(['a', 'b'])
  const many = Array.from({ length: CLIPS_MAX + 2 }, (_, i) => [`t${i}!`, undefined]).flat()
  expect(after(...many)).toHaveLength(CLIPS_MAX)
})

test('in a terminal Claude Code draws in full, each new selection is listed; Insert puts it in the prompt whole and Delete removes it for good', { options: { ...TEST_OPTIONS, clipboardTab: true } }, async ($, on) => {
  let selected: string | undefined
  on('ui.selection', () => ({ value: selected === undefined ? undefined : { text: selected } }))
  const { calls, clock } = await boot($, on)
  const pane = await mountPane($, 'terminal', 80, { columns: 80, rows: 40, isFullscreen: true })
  await pane.press({ key: 'tab-clips' })
  const rows = async () => {
    const keys = keysOf(await pane.drawn()).filter(key => key.startsWith('clip-text-'))
    return Promise.all(keys.map(async key => (await pane.find({ key }))?.text))
  }
  expect(await pane.find({ type: 'Text', text: 'Nothing yet. Drag over text in the conversation to copy it, and it shows here.' })).toBeDefined()
  selected = 'first copy'
  await clock.advance(3000)
  selected = 'second\ncopy'
  await clock.advance(3000)
  // A clip of several lines says how many.
  expect(await rows()).toEqual(['second (2 lines)', 'first copy'])
  const fill = keysOf(await pane.drawn()).find(key => key.startsWith('clip-fill-'))
  await pane.press({ key: fill ?? '' })
  expect(calls.filled).toEqual(['second\ncopy'])
  expect(calls.fillModes).toEqual(['insert'])
  // The selection is still there after the delete, and does not come back.
  const remove = keysOf(await pane.drawn()).find(key => key.startsWith('clip-delete-'))
  await pane.press({ key: remove ?? '' })
  await clock.advance(3000)
  expect(await rows()).toEqual(['first copy'])
  await pane.unmount()
})

// The test host keeps `$.state` over a /clear, so the module is driven here with a stand-in for `$` whose state a
// /clear empties, as the engine's does.
test('a /clear, which empties the state, gives the list back', async () => {
  const held = { value: EMPTY as ClipBoard | undefined, version: 0 }
  const stand = {
    // engineOf reads the plugin's name and root once.
    plugin: { name: 'oh-my-toolbelt', root: '/' },
    ui: { selection: async () => ({ text: 'kept copy' }) },
    state: {
      get: async () => ({ value: held.value, version: held.version }),
      set: async (_: unknown, value: ClipBoard) => ((held.value = value), (held.version += 1), { isSet: true, version: held.version }),
    },
  } as unknown as EngineInterface
  const engine = engineOf(stand)
  await noteSelection(engine, 1000)
  held.value = undefined
  await restoreClips(engine)
  expect(held.value).toEqual({ clips: [{ id: 'c1000', text: 'kept copy' }], seen: null, changing: null })
  // Regression: Insert on a clip gone since the tab was drawn did nothing, saying nothing.
  expect(await clipEffects(engine, 'c1000', 'gone')).toEqual([{ kind: 'prompt.fill', text: 'kept copy', mode: 'insert' }])
  expect(await clipEffects(engine, 'c999', 'gone')).toEqual([{ kind: 'ui.toast', text: 'gone' }])
})

test('with the tab off, nothing is read and there is no such tab', { options: TEST_OPTIONS }, async ($, on) => {
  let asked = 0
  on('ui.selection', () => ((asked += 1), { value: { text: 'copied' } }))
  const { clock } = await boot($, on)
  await clock.advance(3000)
  expect(asked).toBe(0)
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ key: 'tab-clips' })).toBeUndefined()
  await pane.unmount()
})

// Regression: on the main screen nothing is collected, and the tab said only that drags show up. The desktop app
// answers the selection, so there the empty list says to drag.
test('the main screen says no selection reaches the toolbelt there; a desktop is told to drag', { options: { ...TEST_OPTIONS, clipboardTab: true } }, async ($, on) => {
  await boot($, on)
  const notHere = { type: 'Text', text: 'Only what you select in the desktop app or in a terminal that Claude Code draws in full (tui fullscreen) is collected; nothing you select on this screen is.' } as const
  const empty = { type: 'Text', text: 'Nothing yet. Drag over text in the conversation to copy it, and it shows here.' } as const
  for (const [surface, isFullscreen, shown] of [['terminal', false, notHere], ['desktop', true, empty], ['desktop', false, empty]] as const) {
    const pane = await mountPane($, surface, 80, { columns: 80, rows: 40, isFullscreen })
    await pane.press({ key: 'tab-clips' })
    expect(await pane.find(shown)).toBeDefined()
    await pane.unmount()
  }
})

test('a selection that cannot be read is logged once, not each second', { options: { ...TEST_OPTIONS, clipboardTab: true } }, async ($, on) => {
  on('ui.selection', () => ({ deny: 'no selection here' }))
  const { calls, clock } = await boot($, on)
  await clock.advance(5000)
  expect(calls.logged.filter(text => text.includes('clipboard tick'))).toHaveLength(1)
})
