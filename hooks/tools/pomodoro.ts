// Pomodoro tool: a pure state machine. One timer per computer, shared by all sessions through the store; `updatedAt`
// decides which copy is newer.
import type { Pomodoro } from '../../types/index'
import type { Effect } from '../lib/effects'
import type { TFn } from '../lib/i18n'
import { formatDuration } from '../lib/format'
import type { IconStyle } from '../lib/icons'

export type PomodoroConfig = {
  focusMs: number
  breakMs: number
  autoBreak: boolean
  notify: boolean
  sound: boolean
  // The file the sound plays (pomodoroSoundName).
  soundAsset: string
}

export type TickEnv = { config: PomodoroConfig; t: TFn }
export type TickResult = {
  state: Pomodoro
  effects: Effect[]
  // The phase that just ended, or null. Persist the state to the store when this is set.
  ended: 'focus' | 'break' | null
}
// `picked` is the icon the person chose (`''` for none), or undefined for the tomato.
export type PomodoroLabelOptions = { style: IconStyle; picked: string | undefined; t: TFn }

export const NOTIFY_TITLE = 'Toolbelt'
export const DONE_SOUND = 'assets/sounds/done.wav'
// The alert sounds the pomodoroSoundName setting picks from. All are made for this mod by a script
// (assets/sounds/LICENSE); the bell is the first one, done.wav.
export const POMODORO_SOUNDS = {
  bell: DONE_SOUND,
  chime: 'assets/sounds/chime.wav',
  ding: 'assets/sounds/ding.wav',
  digital: 'assets/sounds/digital.wav',
  marimba: 'assets/sounds/marimba.wav',
  soft: 'assets/sounds/soft.wav',
} as const satisfies Record<string, string>
// The file a setting value names; the bell for any other value.
export const soundAssetOf = (name: unknown): string =>
  typeof name === 'string' && Object.hasOwn(POMODORO_SOUNDS, name) ? POMODORO_SOUNDS[name as keyof typeof POMODORO_SOUNDS] : DONE_SOUND
const MINUTE_MS = 60_000
// A round found over by more than this ended while no session ticked (the app closed, the computer
// asleep): it is tidied away without a notification, which would only come late.
export const STALE_END_MS = 60_000

// The /config lists hand minutes over as strings ("25"); older settings may hold numbers.
export function minutes(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// How far the round has gone, 0 to 1, and which round it is; null while idle (the status tab's bar).
export function pomodoroProgress(p: Pomodoro, now: number, config: PomodoroConfig): { phase: 'focus' | 'break'; ratio: number } | null {
  const phase = p.phase === 'paused' ? p.pausedFrom : p.phase === 'idle' ? undefined : p.phase
  if (phase === undefined) return null
  const total = phase === 'focus' ? config.focusMs : config.breakMs
  const left = p.phase === 'paused' ? (p.remainingMs ?? total) : Math.max(0, (p.endsAt ?? now) - now)
  return { phase, ratio: Math.min(1, Math.max(0, 1 - left / total)) }
}

// Reads the userConfig values with their ranges enforced again in code.
export function pomodoroConfig(options: Readonly<Record<string, unknown>>): PomodoroConfig {
  return {
    focusMs: minutes(options.pomodoroFocusMinutes, 5, 120, 25) * MINUTE_MS,
    breakMs: minutes(options.pomodoroBreakMinutes, 1, 60, 5) * MINUTE_MS,
    autoBreak: options.pomodoroAutoBreak === true,
    notify: options.pomodoroNotify !== false,
    sound: options.pomodoroSound === true,
    soundAsset: soundAssetOf(options.pomodoroSoundName),
  }
}

export const idlePomodoro = (now: number, round = 0): Pomodoro => ({
  phase: 'idle',
  endsAt: null,
  remainingMs: null,
  remainingSec: null,
  round,
  updatedAt: now,
})

const running = (phase: 'focus' | 'break', now: number, ms: number, round: number): Pomodoro => ({
  phase,
  endsAt: now + ms,
  remainingMs: null,
  remainingSec: Math.ceil(ms / 1000),
  round,
  updatedAt: now,
})

const secondsLeft = (endsAt: number, now: number): number => Math.max(0, Math.ceil((endsAt - now) / 1000))

// Idle starts a focus round; a paused timer picks up where it stopped; a running one is left alone.
export function start(p: Pomodoro, now: number, config: PomodoroConfig): Pomodoro {
  if (p.phase === 'paused') return resume(p, now)
  return p.phase === 'idle' ? running('focus', now, config.focusMs, p.round) : p
}

export function pause(p: Pomodoro, now: number): Pomodoro {
  if ((p.phase !== 'focus' && p.phase !== 'break') || p.endsAt === null) return p
  const remainingMs = Math.max(0, p.endsAt - now)
  return {
    phase: 'paused',
    endsAt: null,
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    pausedFrom: p.phase,
    round: p.round,
    updatedAt: now,
  }
}

export function resume(p: Pomodoro, now: number): Pomodoro {
  if (p.phase !== 'paused') return p
  const phase = p.pausedFrom ?? 'focus'
  return running(phase, now, p.remainingMs ?? 0, p.round)
}

// A click on the band button: idle starts, running pauses, paused resumes.
export function press(p: Pomodoro, now: number, config: PomodoroConfig): Pomodoro {
  return p.phase === 'focus' || p.phase === 'break' ? pause(p, now) : start(p, now, config)
}

// Where a phase leads: focus goes to a break when pomodoroAutoBreak is on, otherwise idle; a break always idles.
function after(phase: 'focus' | 'break', now: number, round: number, config: PomodoroConfig): Pomodoro {
  return phase === 'focus' && config.autoBreak ? running('break', now, config.breakMs, round) : idlePomodoro(now, round)
}

// Back to idle; the count of finished rounds stays.
export const stop = (p: Pomodoro, now: number): Pomodoro => idlePomodoro(now, p.round)

// Back to idle and the count of finished rounds goes to zero.
export const reset = (now: number): Pomodoro => idlePomodoro(now, 0)

// The notification, its toast and the sound. Every session that sees the end shows the toast, so the
// screen the person looks at says it; one session alone raises the notification and the sound.
function endEffects(phase: 'focus' | 'break', env: TickEnv): Effect[] {
  const effects: Effect[] = []
  if (env.config.notify) {
    const text = env.t(phase === 'focus' ? 'pomodoro.focusDone' : 'pomodoro.breakDone')
    effects.push({ kind: 'notify', text, title: NOTIFY_TITLE }, { kind: 'ui.toast', text })
  }
  if (env.config.sound) effects.push({ kind: 'audio.play', asset: env.config.soundAsset })
  return effects
}

// One clock tick. While a phase runs it changes `remainingSec` only (and returns the same object
// when that is unchanged, so the caller writes state only on change). When the phase ends it
// returns the next phase and the notification effects; do-not-disturb drops all of them.
export function tick(p: Pomodoro, now: number, env: TickEnv): TickResult {
  if ((p.phase !== 'focus' && p.phase !== 'break') || p.endsAt === null) return { state: p, effects: [], ended: null }
  const left = secondsLeft(p.endsAt, now)
  if (left > 0) return { state: left === p.remainingSec ? p : { ...p, remainingSec: left }, effects: [], ended: null }
  const round = p.phase === 'focus' ? p.round + 1 : p.round
  // Long over: straight to idle, with no notification and no break starting hours late.
  if (now - p.endsAt > STALE_END_MS) return { state: idlePomodoro(now, round), effects: [], ended: p.phase }
  return { state: after(p.phase, now, round, env.config), effects: endEffects(p.phase, env), ended: p.phase }
}

// The effects that apply a new timer value: draw it and save it for every session.
export const pomodoroEffects = (next: Pomodoro): Effect[] => [
  { kind: 'state.update', key: 'pomodoro', fn: () => next },
  { kind: 'store.set', key: 'pomodoro', value: next },
]

// Sessions write the same store key; the copy with the newer `updatedAt` wins, a tie keeps `a`.
export function mergePomodoro(a: Pomodoro, b: Pomodoro | null | undefined): Pomodoro {
  return b && b.updatedAt > a.updatedAt ? b : a
}

// mm:ss, or h:mm:ss from one hour on. Takes whole seconds, as `remainingSec` holds them.
export const formatRemaining = (totalSec: number): string => formatDuration(Math.floor(totalSec) * 1000)

const PHASE_ICON = { idle: '🍅', focus: '🍅', break: '☕', paused: '⏸' } as const

// The label: idle shows the icon (long: with "Start"), the others show icon and time. The icon the person picked takes
// the tomato's place in idle and focus; the break and the pause keep theirs, which say the state. With the label style,
// or no icon picked, a word from the language file stands in for the icon. The time is always shown.
// Its two parts, the icon (or its word) and the time or "Start", are the band chip's icon and value.
export function pomodoroParts(p: Pomodoro, size: 'long' | 'short', o: PomodoroLabelOptions): { head: string; rest: string } {
  const own = p.phase === 'idle' || p.phase === 'focus' ? (o.picked ?? PHASE_ICON[p.phase]) : PHASE_ICON[p.phase]
  const mark = o.picked === '' ? '' : own
  const isIcon = o.style !== 'label' && mark !== ''
  const head = isIcon ? mark : o.t(`pomodoro.icon.${p.phase}`)
  if (p.phase === 'idle') {
    const isShort = size === 'short' || (isIcon && o.style === 'icon')
    return { head, rest: isShort ? '' : o.t('pomodoro.start') }
  }
  const sec = p.remainingSec ?? Math.ceil((p.remainingMs ?? 0) / 1000)
  return { head, rest: formatRemaining(sec) }
}

// The band chip's symbol for the phase icons, one cell in the chip's colour: start and focus play, a break plays
// hollow, a pause stays. An icon the person picked, or a word, stays as it is.
const CHIP_ICONS: Readonly<Record<string, string>> = { '🍅': '▶', '☕': '▷', '⏸': '⏸' }
export const pomodoroChipIcon = (head: string, p: Pomodoro, picked: string | undefined): string =>
  picked === undefined || p.phase === 'break' || p.phase === 'paused' ? (CHIP_ICONS[head] ?? head) : head

export function pomodoroLabel(p: Pomodoro, size: 'long' | 'short', o: PomodoroLabelOptions): string {
  const { head, rest } = pomodoroParts(p, size, o)
  return rest === '' ? head : `${head} ${rest}`
}

// The last minute of a running phase is drawn with color 'warning'.
export const isLastMinute = (p: Pomodoro): boolean =>
  (p.phase === 'focus' || p.phase === 'break') && p.remainingSec !== null && p.remainingSec > 0 && p.remainingSec <= 60

const PHASES: readonly unknown[] = ['idle', 'focus', 'break', 'paused']
const isNumberOrNull = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v))
// A running phase needs the time it ends, a paused one the time it kept: without them the timer
// would never end, or resume into a round that is over at once.
const hasPhaseFields = (v: Record<string, unknown>): boolean =>
  v.phase === 'focus' || v.phase === 'break' ? typeof v.endsAt === 'number' : v.phase !== 'paused' || typeof v.remainingMs === 'number'

// The stored timer when it has the Pomodoro shape (another session or version may have written
// anything under the key), else null.
export function asPomodoro(value: unknown): Pomodoro | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const isShaped =
    PHASES.includes(v.phase) &&
    isNumberOrNull(v.endsAt) && isNumberOrNull(v.remainingMs) && isNumberOrNull(v.remainingSec) &&
    typeof v.round === 'number' && typeof v.updatedAt === 'number' &&
    (v.pausedFrom === undefined || v.pausedFrom === 'focus' || v.pausedFrom === 'break') &&
    hasPhaseFields(v)
  return isShaped ? (value as Pomodoro) : null
}
