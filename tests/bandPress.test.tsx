// Regression: the band's buttons dropped the promise of their press, so 2.1.310 took the panel a button opened for an
// open nobody asked for (d.ts UiOpenResult: asked is a Button the person worked), and under 144 columns it waited
// undrawn without a word. A press now hands its work back (register.tsx pressItem holds it while the panel opens).
import { expect, test } from 'claude-code/testing'
import { bandModel, drawBand, drawFolded } from '../hooks/band'
import type { BandKit } from '../hooks/band'
import { makeCtx } from './pure-helpers'

type Node = { type?: unknown; props?: { key?: string }; children?: unknown[]; onPress?: (press: { surface: 'terminal' }) => unknown }

const KIT = { Box: 'Box', Text: 'Text', Button: 'Button' } as unknown as BandKit

function buttons(node: unknown): Node[] {
  if (typeof node !== 'object' || node === null) return []
  const n = node as Node
  return [...(n.type === 'Button' ? [n] : []), ...(n.children ?? []).flatMap(buttons)]
}

test('every band button hands back the work its press starts', async () => {
  const work = Promise.resolve('opened')
  const pressed: string[] = []
  const press = (id: string) => (pressed.push(id), work)
  const model = bandModel(makeCtx(), 258, null)
  if (model === null) throw new Error('no band drawn')
  const all = [...buttons(drawBand(KIT, model, press)), ...buttons(drawFolded(KIT, press))]
  expect(all.map(b => b.props?.key)).toContain('edit')
  for (const b of all) expect(b.onPress?.({ surface: 'terminal' })).toBe(work)
  expect(pressed).toHaveLength(all.length)
})
