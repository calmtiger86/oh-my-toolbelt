// The band above the prompt: what fits at each width, the person's layout, another mod's band below ours, yielding, and
// what a press does.
import { expect } from 'claude-code/testing'
import type { ConfigRow } from 'claude-code'
import { ACCENT } from '../hooks/card'
import { chipCells, shadeOf } from '../hooks/chip'
import { NOW, SLOW_MS, SURFACES, TEST_OPTIONS, boot, keysOf, mountBand, runCommand, seedButtons, test } from './helpers'

const MINUTE = 60_000
const ALL = ['pomodoro', 'btn:ex-review', 'btn:ex-usage', 'btn:b-deslop', 'btn:b-commit', 'edit']
// The clock's chip (hooks/chip.tsx): its icon and its time, on the terminal's row or inside a desktop's pill.
const clockChip = (_surface: string): string => '◷ 05:32'

test('wide bands show every tool with long labels, on every surface', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { store: { buttons: seedButtons() } })
  for (const surface of SURFACES) {
    // 83 rather than 79 since the export button joined the right side.
    for (const columns of [258, 119, 83]) {
      const ui = await mountBand($, surface, columns)
      const keys = keysOf(await ui.drawn())
      expect(ALL.every(key => keys.includes(key)), `${surface} ${columns}: ${keys.join(',')}`).toBe(true)
      expect(keys).not.toContain('more')
      // No city, attach off in these options, no /voice and no theme row: those four stay out.
      for (const absent of ['weather', 'attach', 'voice', 'theme']) expect(keys).not.toContain(absent)
      expect((await ui.find({ key: 'clock' }))?.text).toBe(clockChip(surface))
      // The curtain button is always there.
      expect(keys).toContain('curtain')
      // The desktop app's Tab never reaches the band, so it shows no letters.
      const letter = (key: string) => (surface === 'desktop' ? undefined : key)
      expect((await ui.find({ key: 'curtain' }))?.props.hotkey).toBe(letter('h'))
      // So is the notes button; do not disturb was taken out.
      if (columns === 258) {
        expect([(await ui.find({ key: 'notes' }))?.props.hotkey, (await ui.find({ key: 'notes' }))?.props.label]).toEqual([letter('n'), '📝 Notes'])
        expect(await ui.find({ key: 'dnd' })).toBeUndefined()
        // And the export button.
        expect([(await ui.find({ key: 'export' }))?.props.hotkey, (await ui.find({ key: 'export' }))?.props.label]).toEqual([letter('e'), '⇩ Export'])
      }
      // Every button carries `[ ]` chrome, so narrower bands turn labels short; since the export button joined the
      // right side, 119 cells no longer hold every long label.
      if (columns === 258) {
        expect((await ui.find({ key: 'curtain' }))?.props.label).toBe('▢ Hide')
        expect((await ui.find({ key: 'pomodoro' }))?.props.label).toBe('🍅 Start')
        expect((await ui.find({ key: 'btn:b-commit' }))?.props.label).toBe('Commit message')
      }
      await ui.unmount()
    }
  }
})

test('narrow bands use short labels, hide by priority and add the more button', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { store: { buttons: seedButtons() } })
  // The widths count the fold mark at the left end: a cell and a gap, and on a desktop its button's frame.
  for (const surface of SURFACES) {
    const fold = surface === 'terminal' ? 2 : 6
    const atRoomy = await mountBand($, surface, 51 + fold)
    const keysRoomy = keysOf(await atRoomy.drawn())
    expect(keysRoomy.filter(key => ALL.includes(key) || key === 'more')).toEqual(['btn:ex-review', 'btn:ex-usage', 'btn:b-deslop', 'edit', 'more'])
    expect((await atRoomy.find({ key: 'btn:ex-review' }))?.props.label).toBe('Revi')
    expect((await atRoomy.find({ key: 'clock' }))?.text).toBe(clockChip(surface))
    await atRoomy.unmount()

    const atTight = await mountBand($, surface, 32 + fold)
    expect(keysOf(await atTight.drawn()).filter(key => ALL.includes(key) || key === 'more')).toEqual(['btn:ex-review', 'edit', 'more'])
    await atTight.unmount()

    const at11 = await mountBand($, surface, 11)
    expect(keysOf(await at11.drawn())).not.toContain('band-row')
    expect((await at11.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
    await at11.unmount()
  }
})

// The engine's [-] leaves a line of its own, so the band folds itself from a mark at its left end to one button that
// unfolds it, and keeps the fold.
test('the fold mark folds the band to one button that unfolds it, and the fold is kept', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on)
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, 119)
    expect((await band.find({ key: 'fold' }))?.props).toMatchObject({ label: '◂', plain: true, dimColor: true })
    await band.press({ key: 'fold' })
    expect(store.get('bandFolded')).toBe(true)
    expect(keysOf(await band.drawn()).filter(key => key === 'clock' || key === 'edit' || key === 'fold')).toEqual([])
    expect((await band.find({ key: 'unfold' }))?.props.label).toBe('▸')
    await band.press({ key: 'unfold' })
    expect(store.get('bandFolded')).toBe(false)
    expect(await band.find({ key: 'clock' })).toBeDefined()
    await band.unmount()
  }
})

test('a store a newer version wrote folds the band on screen only', { options: TEST_OPTIONS }, async ($, on) => {
  const { store } = await boot($, on, { store: { schemaVersion: 99 } })
  const band = await mountBand($, 'terminal', 119)
  await band.press({ key: 'fold' })
  expect((await band.find({ key: 'unfold' }))?.props.label).toBe('▸')
  expect(store.has('bandFolded')).toBe(false)
  await band.unmount()
})

test('a band folded in an earlier session starts folded', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { store: { bandFolded: true } })
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'unfold' }))?.props.label).toBe('▸')
  expect(await band.find({ key: 'clock' })).toBeUndefined()
  await band.unmount()
})

test('the band draws the layout the person chose', { options: TEST_OPTIONS }, async ($, on) => {
  const layout = { left: [], right: ['clock', 'btn:ex-review', 'btn:ex-usage', 'edit'], hidden: ['pomodoro'] }
  await boot($, on, { store: { schemaVersion: 1, layout } })
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, 119)
    expect((await ui.find({ key: 'band-left' }))?.text).toBe('◂')
    expect((await ui.find({ key: 'band-right' }))?.text.startsWith(clockChip(surface))).toBe(true)
    expect(keysOf(await ui.drawn())).not.toContain('pomodoro')
    await ui.unmount()
  }
})

test('another mod draws below ours, one row shorter, and its failure leaves ours alone', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on)
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, 119)
    const drawn = await ui.drawn()
    expect(keysOf(drawn).slice(0, 2)).toEqual(['band', 'band-row'])
    expect(JSON.stringify((drawn as { children?: unknown[] }).children?.[1])).toContain('engine')
    await ui.unmount()
  }
  expect(calls.belowMaxRows).toContain(5)
})

test('when the band below throws, our row is drawn alone', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { belowThrows: true })
  const ui = await mountBand($, 'terminal', 119)
  expect(keysOf(await ui.drawn())[0]).toBe('band-row')
  await ui.unmount()
})

test('the band yields to a survey and to another agent\'s transcript', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on)
  for (const surface of SURFACES) {
    for (const over of [{ hasSurvey: true }, { agentId: 'a1' }]) {
      const ui = await mountBand($, surface, 119, over)
      expect(keysOf(await ui.drawn())).not.toContain('band-row')
      expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
      await ui.unmount()
    }
  }
})

test('pressing band buttons fills, sends, runs and starts the timer', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls, store } = await boot($, on, { store: { buttons: seedButtons() } })
  for (const surface of SURFACES) {
    const ui = await mountBand($, surface, 258)
    await ui.press({ key: 'btn:ex-review' })
    await ui.press({ key: 'btn:ex-usage' })
    await ui.press({ key: 'btn:b-commit' })
    await ui.unmount()
  }
  expect(calls.filled).toEqual(['Review it.', 'Review it.'])
  expect(calls.ran).toEqual([{ command: 'usage', args: '' }, { command: 'usage', args: '' }])
  expect(calls.submitted).toEqual(['Write the commit message.', 'Write the commit message.'])

  const ui = await mountBand($, 'terminal', 258)
  await ui.press({ key: 'pomodoro' })
  expect(store.get('pomodoro')).toMatchObject({ phase: 'focus', endsAt: NOW + 25 * MINUTE })
  expect((await ui.find({ key: 'pomodoro' }))?.props.label).toBe('🍅 25:00')
  await ui.unmount()
})

test('a command this session lacks is dim; hotkeys can be turned off', { options: { ...TEST_OPTIONS, hotkeysEnabled: false } }, async ($, on) => {
  await boot($, on, { store: { buttons: seedButtons() }, commands: [{ name: 'usage', description: '', source: 'builtin' }] })
  const ui = await mountBand($, 'terminal', 258)
  expect((await ui.find({ key: 'btn:b-deslop' }))?.props.dimColor).toBe(true)
  expect((await ui.find({ key: 'btn:ex-usage' }))?.props.dimColor).toBeUndefined()
  expect((await ui.find({ key: 'btn:b-deslop' }))?.props.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'edit' }))?.props.plain).toBeUndefined()
  await ui.unmount()
})

// 24 minutes of one-second redraws of a band that now carries two more buttons: well over the 5 s default on a busy machine.
test('the last minute of a running round is drawn in the warning color', { options: TEST_OPTIONS, timeoutMs: SLOW_MS }, async ($, on) => {
  const { clock } = await boot($, on)
  const ui = await mountBand($, 'terminal', 119)
  await ui.press({ key: 'pomodoro' })
  await clock.advance(24 * MINUTE - 1000)
  expect(JSON.stringify((await ui.find({ key: 'pomodoro' }))?.children)).not.toContain('warning')
  await clock.advance(1000)
  const timer = await ui.find({ key: 'pomodoro' })
  expect(timer?.props.label).toBe('🍅 01:00')
  expect(JSON.stringify(timer?.children)).toContain('warning')
  await ui.unmount()
})

test('stored buttons with a bad hotkey, a non-text field or a two-line label still draw, cleaned', { options: TEST_OPTIONS }, async ($, on) => {
  const list = [
    { id: 'two', kind: 'prompt', label: 'Two', text: 'hi', mode: 'fill', hotkey: 'AB' },
    { id: 'digit', kind: 'prompt', label: 'Digit', text: 'hi', mode: 'fill', hotkey: '1' },
    { id: 'empty', kind: 'prompt', label: 'Empty', text: 'hi', mode: 'fill', hotkey: '' },
    { id: 'num', kind: 'prompt', label: 'Num', text: 5, mode: 'fill' },
    { id: 'lines', kind: 'prompt', label: 'Line1\nLine2', text: 'hi', mode: 'fill' },
  ]
  const { calls } = await boot($, on, { store: { schemaVersion: 1, buttons: { version: 1, activeSet: 'default', sets: { default: list } } } })
  const ui = await mountBand($, 'terminal', 258)
  const keys = keysOf(await ui.drawn())
  for (const { id } of list) expect(keys).toContain(`btn:${id}`)
  for (const id of ['two', 'digit', 'empty']) expect((await ui.find({ key: `btn:${id}` }))?.props.hotkey).toBeUndefined()
  expect((await ui.find({ key: 'btn:lines' }))?.props.label).toBe('Line1Line2')
  await ui.press({ key: 'btn:num' })
  expect(calls.filled).toEqual([])
  await ui.unmount()
})

test('the edit button opens the panel and a second press closes it', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on)
  const ui = await mountBand($, 'terminal', 258)
  await ui.press({ key: 'edit' })
  expect(calls.opened).toHaveLength(1)
  await ui.press({ key: 'edit' })
  expect(calls.closed).toBe(1)
  await ui.press({ key: 'edit' })
  expect(calls.opened).toHaveLength(2)
  await ui.unmount()
})

// Regression: Notes pressed while the panel showed another tab left the cursor in the prompt box.
test('notes pressed over another tab asks for the keys again, so its field takes the cursor', { options: TEST_OPTIONS }, async ($, on) => {
  const { calls } = await boot($, on)
  const ui = await mountBand($, 'terminal', 258)
  await ui.press({ key: 'edit' })
  await ui.press({ key: 'notes' })
  expect(calls.opened.map(open => open.focus)).toEqual([true, true])
  await ui.unmount()
})

test('information is drawn as chips parted by a dim rule, a mark parts my buttons from the tools, a running pomodoro fills its meter and the curtain is in the accent colour', { options: TEST_OPTIONS }, async ($, on) => {
  await boot($, on, { store: { schemaVersion: 1, buttons: seedButtons() } })
  const ui = await mountBand($, 'terminal', 258)
  // On the terminal: no background; the icon in the chip's colour, the time semibold.
  const runs = ((await ui.find({ key: 'clock' }))?.children ?? []) as { props?: Record<string, unknown> }[]
  const [icon, value] = [runs[0]?.props, runs[2]?.props]
  expect([icon?.color, icon?.backgroundColor, value?.weight, value?.backgroundColor]).toEqual(['#6d9eeb', undefined, 'semibold', undefined])
  // The rule between them (the row's gap puts a space either side on screen, not in the text).
  expect((await ui.find({ key: 'band-left' }))?.text).toBe('◂◷ 05:32│▶ Start')
  const right = keysOf(await ui.drawn())
  expect(right.filter(key => key.startsWith('btn:') || ['curtain', 'export', 'notes', 'edit'].includes(key)).length).toBeGreaterThan(1)
  expect(await ui.find({ type: 'Text', text: '❘' })).toBeDefined()
  // The pomodoro is a chip that presses: a plain Button with no hotkey, which would print `o:` before it.
  const idle = await ui.find({ key: 'pomodoro' })
  expect([idle?.text, idle?.props.plain, idle?.props.hotkey]).toEqual(['▶ Start', true, undefined])
  await runCommand($, 'toolbelt', 'pomodoro start')
  // The tomato is a one-cell play sign in the chip's colour; the meter is six cells, none filled yet.
  expect((await ui.find({ key: 'pomodoro' }))?.text).toBe('▶ 25:00 ──────')
  await runCommand($, 'toolbelt', 'curtain on')
  // On the terminal the label is in the toolbelt's own accent, not the theme's.
  const curtain = (await ui.find({ key: 'curtain' })) as { props: Record<string, unknown>; children?: { props?: Record<string, unknown> }[] } | undefined
  expect([curtain?.props.variant, curtain?.children?.[0]?.props?.color]).toEqual([undefined, ACCENT])
  await runCommand($, 'toolbelt', 'curtain off')
  await runCommand($, 'toolbelt', 'pomodoro reset')
  await ui.unmount()
})

test('a light theme draws the deeper icon colours, and a desktop draws each chip as an outlined pill', { options: TEST_OPTIONS }, async ($, on) => {
  expect([shadeOf('light-ansi'), shadeOf('dark-daltonized'), shadeOf('auto'), shadeOf(undefined)]).toEqual(['light', 'dark', 'dark', 'dark'])
  const theme = { key: 'theme', label: 'Theme', kind: 'choice', value: 'light', options: ['dark', 'light'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as unknown as ConfigRow
  await boot($, on, { settings: [theme] })
  const terminal = await mountBand($, 'terminal', 119)
  const runs = ((await terminal.find({ key: 'clock' }))?.children ?? []) as { props?: Record<string, unknown> }[]
  expect(runs[0]?.props?.color).toBe('#2f68c0')
  await terminal.unmount()
  const desktop = await mountBand($, 'desktop', 119)
  const pill = await desktop.find({ key: 'pomodoro-pill' })
  expect([pill?.props.borderStyle, pill?.props.backgroundColor]).toEqual(['round', 'rgba(63,166,107,0.13)'])
  // The pill that presses holds the Button, which keeps the tool's key.
  expect((await desktop.find({ key: 'pomodoro' }))?.type).toBe('Button')
  await desktop.unmount()
})

test('a chip counts the cells it draws: a space between its pieces, the meter six', () => {
  expect(chipCells({ hue: 'blue', icon: '◷', value: '05:32' })).toBe(7)
  expect(chipCells({ hue: 'blue', icon: '', value: '05:32' })).toBe(5)
  expect(chipCells({ hue: 'green', icon: '🍅', value: '' })).toBe(2)
  expect(chipCells({ hue: 'green', icon: '▶', value: '25:00', meter: 0.5, detail: 'Seoul' })).toBe(20)
})

test('the date is a tool of its own beside the clock; its weekday speaks the screen\'s language', { options: { ...TEST_OPTIONS, dateFormat: 'ymd', language: 'ko' } }, async ($, on) => {
  // Korean on a computer whose LANG is English: the weekday is Korean all the same.
  await boot($, on, { env: { LANG: 'en_US.UTF-8' } })
  const band = await mountBand($, 'terminal', 258)
  expect([(await band.find({ key: 'clock' }))?.text, (await band.find({ key: 'date' }))?.text]).toEqual(['◷ 05:32', '▦ 2026/10/22 목'])
  await band.unmount()
  // A narrow band lets the date go before the clock.
  const narrow = await mountBand($, 'terminal', 40)
  expect([(await narrow.find({ key: 'clock' }))?.text, await narrow.find({ key: 'date' })]).toEqual(['◷ 05:32', undefined])
  await narrow.unmount()
})
