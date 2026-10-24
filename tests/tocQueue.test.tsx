// A prompt sent while a turn runs is listed once: the engine draws it under an id it never stores, then draws the row
// the turn read (delivered into the turn) or its stored row (queued behind it). The prompts tab used to list such a
// prompt twice.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'
import { PLUGIN, SURFACES, TEST_OPTIONS, boot, mountPane } from './helpers'

const id = (n: number): string => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`
// The engine's own answers beneath the mod for the turns these tests raise.
function stubTurns(on: On): void {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}
const mountPrompt = ($: Engine, requestId: string, text: string) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', requestId, props: { text, origin: { kind: 'composer' as const }, isExpanded: false } })
// A prompt that starts a turn is drawn under the provisional id, then under its stored one.
async function typed($: Engine, n: number, text: string): Promise<void> {
  await (await mountPrompt($, 'placeholder', text)).unmount()
  await mountPrompt($, id(n), text)
}
const submit = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const turnEnd = ($: Engine, turnId: string) => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })

type Found = { key?: string; text: string }
type Pane = { findAll: (query: { type: 'Button' }) => Promise<Found[]>; press: (target: { key: string }) => Promise<unknown>; unmount: () => Promise<void> }
async function tocRows($: Engine, surface: RenderSurface): Promise<{ key?: string; text: string }[]> {
  const pane: Pane = await mountPane($, surface)
  await pane.press({ key: 'tab-toc' })
  const rows = (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('toc-')).map(b => ({ key: b.key, text: b.text }))
  await pane.unmount()
  return rows
}

test('a prompt delivered into the running turn is one row on both surfaces, which jumps to the row the turn read', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  await typed($, 1, 'first')
  await $.turn.start({ text: 'first', turnId: 't1' })
  await submit($, 'second')
  await mountPrompt($, 'queued-second', 'second')
  await clock.advance(1000)
  // The turn reads the queued prompt: the engine draws the row it stored for it.
  await mountPrompt($, id(2), 'second')
  await turnEnd($, 't1')
  await clock.advance(300)
  for (const surface of SURFACES) {
    expect(await tocRows($, surface)).toEqual([{ key: `toc-${id(1)}`, text: '─ 1. first' }, { key: `toc-${id(2)}`, text: '─ 2. second' }])
  }
})

test('a queued prompt\'s row drawn just before it is sent is still one row', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  await typed($, 1, 'first')
  await $.turn.start({ text: 'first', turnId: 't1' })
  await mountPrompt($, 'queued-second', 'second')
  await submit($, 'second')
  await clock.advance(1000)
  await mountPrompt($, id(2), 'second')
  await clock.advance(300)
  expect((await tocRows($, 'terminal')).map(row => row.text)).toEqual(['─ 1. first', '─ 2. second'])
})

test('a prompt queued behind the turn keeps its place, and its stored row takes it when its own turn starts', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  const { clock } = await boot($, on)
  await typed($, 1, 'first')
  await $.turn.start({ text: 'first', turnId: 't1' })
  await submit($, 'second')
  const queued = await mountPrompt($, 'queued-second', 'second')
  await turnEnd($, 't1')
  // The engine takes the queued row away as it starts the prompt's own turn.
  await queued.unmount()
  await $.turn.start({ text: 'second', turnId: 't2' })
  await typed($, 2, 'second')
  await typed($, 3, 'third')
  await clock.advance(300)
  for (const surface of SURFACES) {
    expect(await tocRows($, surface)).toEqual([
      { key: `toc-${id(1)}`, text: '─ 1. first' },
      { key: `toc-${id(2)}`, text: '─ 2. second' },
      { key: `toc-${id(3)}`, text: '─ 3. third' },
    ])
  }
})

// Regression: a prompt sent while no turn runs is not held for a queued one's rows, so the same text sent in two turns
// is two rows whether or not the engine draws a provisional row first.
for (const isProvisional of [true, false]) {
  test(`the same text sent twice while no turn runs is two rows on both surfaces, ${isProvisional ? 'with' : 'without'} a provisional row`, { options: TEST_OPTIONS }, async ($, on) => {
    stubTurns(on)
    const { clock } = await boot($, on)
    for (const n of [1, 2]) {
      await submit($, 'continue')
      await $.turn.start({ text: 'continue', turnId: `t${n}` })
      if (isProvisional) await (await mountPrompt($, 'placeholder', 'continue')).unmount()
      await mountPrompt($, id(n), 'continue')
      await turnEnd($, `t${n}`)
      await clock.advance(60_000)
    }
    for (const surface of SURFACES) {
      expect(await tocRows($, surface)).toEqual([{ key: `toc-${id(1)}`, text: '─ 1. continue' }, { key: `toc-${id(2)}`, text: '─ 2. continue' }])
    }
  })
}
