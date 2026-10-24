// Voice input on and off. It shows while this session has /voice. Claude Code's own voice state cannot be read, so the
// button follows what it asked for last: tap when off, off when on.
import type { VoiceState } from '../../types/index'
import type { Effect } from '../lib/effects'
import type { TFn } from '../lib/i18n'
import { faceOf } from '../lib/icons'
import type { IconStyle } from '../lib/icons'

const ICON = '🎤'

const isOn = (voice: VoiceState): boolean => voice.requested === 'tap' || voice.requested === 'hold'

export function voiceLabel(voice: VoiceState, size: 'long' | 'short', style: IconStyle, picked: string | undefined, t: TFn): string {
  return faceOf(style, size, picked ?? ICON, t(isOn(voice) ? 'voice.on' : 'voice.label'))
}

// The mode the voiceMode setting picks: tap starts and stops with Space and sends three words or more at once; hold
// records while Space is held and sends nothing by itself. Any other value is tap.
export type VoiceMode = 'tap' | 'hold'
export const voiceModeOf = (value: unknown): VoiceMode => (value === 'hold' ? 'hold' : 'tap')

// The mode a new load switches voice to (register.tsx syncVoiceMode): the setting's, while the voice this mod turned on
// is on in another; null otherwise.
export const voiceModeToSync = (voice: VoiceState, mode: VoiceMode): VoiceMode | null =>
  voice.isAvailable && isOn(voice) && voice.requested !== mode ? mode : null

export const voiceEffects = (voice: VoiceState, mode: VoiceMode): Effect[] => [{ kind: 'voice', next: isOn(voice) ? 'off' : mode }]

// Voice on shows in the accent colour, as a running tool does (the short label is the same icon either way).
export const isVoiceOn = isOn
