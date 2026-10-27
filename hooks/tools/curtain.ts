// Curtain tool. Pure: register.tsx keeps the state and draws what this decides.
import type { Effect } from '../lib/effects'
import { faceOf } from '../lib/icons'
import type { IconStyle } from '../lib/icons'
import type { TFn } from '../lib/i18n'

// Filled while the curtain is up, empty while it is down. The word beside it names what a press does.
const ICON = { on: '▣', off: '▢' } as const

// `▣ Show` / `▢ Hide`, the icon alone when the band is tight, by the icon style. `picked` is the icon the person chose
// for this button (`''` for none), which stands for both states.
export function curtainLabel(isOn: boolean, size: 'long' | 'short', style: IconStyle, picked: string | undefined, t: TFn): string {
  return faceOf(style, size, picked ?? (isOn ? ICON.on : ICON.off), t(isOn ? 'curtain.show' : 'curtain.hide'))
}

// Raising the curtain says once what it leaves out; lowering it needs no word.
export const curtainEffects = (isOn: boolean, t: TFn): Effect[] => [
  { kind: 'state.update', key: 'curtain', fn: () => isOn },
  // The engine's default 4 seconds: a toast cannot be taken back, and a longer one outlived a quick Show.
  ...(isOn ? [{ kind: 'ui.toast' as const, text: t('toast.curtainOn') }] : []),
]
