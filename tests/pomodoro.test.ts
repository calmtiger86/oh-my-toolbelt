import { test, expect } from 'claude-code/testing'
import {
  DONE_SOUND, NOTIFY_TITLE, POMODORO_SOUNDS, STALE_END_MS, asPomodoro, formatRemaining, idlePomodoro, isLastMinute, mergePomodoro, pause, pomodoroConfig,
  pomodoroEffects, pomodoroLabel, pomodoroProgress, press, reset, resume, soundAssetOf, start, stop, tick,
} from '../hooks/tools/pomodoro'
import type { PomodoroConfig } from '../hooks/tools/pomodoro'
import type { Pomodoro } from '../types/index'
import { t } from './pure-helpers'

const T0 = 1_000_000
const MIN = 60_000
const config: PomodoroConfig = pomodoroConfig({})
const env = (over: Partial<PomodoroConfig> = {}) => ({ config: { ...config, ...over }, t })
// Frozen values make any in-place edit throw, which proves the state machine never mutates.
const frozen = (p: Pomodoro): Pomodoro => Object.freeze({ ...p })

test('config reads the userConfig values and keeps them in range', () => {
  expect(config).toEqual({ focusMs: 25 * MIN, breakMs: 5 * MIN, autoBreak: false, notify: true, sound: false, soundAsset: DONE_SOUND })
  const custom = pomodoroConfig({
    pomodoroFocusMinutes: 50, pomodoroBreakMinutes: 10, pomodoroAutoBreak: true, pomodoroNotify: false, pomodoroSound: true, pomodoroSoundName: 'marimba',
  })
  expect(custom).toEqual({ focusMs: 50 * MIN, breakMs: 10 * MIN, autoBreak: true, notify: false, sound: true, soundAsset: 'assets/sounds/marimba.wav' })
  expect(pomodoroConfig({ pomodoroFocusMinutes: 1, pomodoroBreakMinutes: 999 })).toMatchObject({ focusMs: 5 * MIN, breakMs: 60 * MIN })
  expect(pomodoroConfig({ pomodoroFocusMinutes: 500 }).focusMs).toBe(120 * MIN)
  expect(pomodoroConfig({ pomodoroFocusMinutes: '45', pomodoroBreakMinutes: '10' })).toMatchObject({ focusMs: 45 * MIN, breakMs: 10 * MIN })
  expect(pomodoroConfig({ pomodoroFocusMinutes: 'x', pomodoroBreakMinutes: NaN }).focusMs).toBe(25 * MIN)
})

test('start: idle becomes a focus round that ends 25 minutes later', () => {
  const p = start(frozen(idlePomodoro(T0)), T0, config)
  expect(p).toEqual({ phase: 'focus', endsAt: T0 + 25 * MIN, remainingMs: null, remainingSec: 1500, round: 0, updatedAt: T0 })
  expect(start(p, T0 + 5, config)).toBe(p)
})

test('tick changes only remainingSec while a phase runs, and keeps the object when nothing changed', () => {
  const p = frozen(start(idlePomodoro(T0), T0, config))
  expect(tick(p, T0 + 500, env()).state).toBe(p)
  const later = tick(p, T0 + 1_000, env())
  expect(later.effects).toEqual([])
  expect(later.ended).toBeNull()
  expect(later.state).toEqual({ ...p, remainingSec: 1499 })
  expect(later.state.updatedAt).toBe(T0)
  expect(tick(p, T0 + 25 * MIN - 1, env()).state.remainingSec).toBe(1)
})

test('tick leaves idle and paused timers alone', () => {
  const idle = frozen(idlePomodoro(T0))
  const paused = frozen(pause(start(idlePomodoro(T0), T0, config), T0 + 10_000))
  expect(tick(idle, T0 + 99 * MIN, env()).state).toBe(idle)
  expect(tick(paused, T0 + 99 * MIN, env()).state).toBe(paused)
})

test('focus ends: round counts, idle next, notification and its toast, no sound by default', () => {
  const p = frozen(start(idlePomodoro(T0), T0, config))
  const out = tick(p, T0 + 25 * MIN, env())
  expect(out.ended).toBe('focus')
  expect(out.state).toEqual({ ...idlePomodoro(T0 + 25 * MIN), round: 1 })
  const text = t('pomodoro.focusDone')
  expect(out.effects).toEqual([{ kind: 'notify', text, title: NOTIFY_TITLE }, { kind: 'ui.toast', text }])
})

test('focus ends with sound on: notify and toast first, then audio.play', () => {
  const p = start(idlePomodoro(T0), T0, config)
  const out = tick(p, T0 + 25 * MIN, env({ sound: true }))
  expect(out.effects.map(e => e.kind)).toEqual(['notify', 'ui.toast', 'audio.play'])
  expect(out.effects[2]).toEqual({ kind: 'audio.play', asset: DONE_SOUND })
  expect(tick(p, T0 + 25 * MIN, env({ sound: true, notify: false })).effects).toEqual([{ kind: 'audio.play', asset: DONE_SOUND }])
})

test('with the notification and the sound turned off a round ends quietly, and the phase still advances', () => {
  const p = start(idlePomodoro(T0), T0, config)
  const out = tick(p, T0 + 25 * MIN, env({ notify: false, sound: false }))
  expect(out.effects).toEqual([])
  expect(out.ended).toBe('focus')
  expect(out.state.round).toBe(1)
})

test('autoBreak: focus end starts a break from the moment it ended, and the break ends in idle', () => {
  const p = start(idlePomodoro(T0), T0, config)
  const endAt = T0 + 25 * MIN + 3_000
  const brk = tick(p, endAt, env({ autoBreak: true })).state
  expect(brk).toEqual({ phase: 'break', endsAt: endAt + 5 * MIN, remainingMs: null, remainingSec: 300, round: 1, updatedAt: endAt })
  const done = tick(brk, endAt + 5 * MIN, env({ autoBreak: true }))
  expect(done.ended).toBe('break')
  expect(done.state).toEqual({ ...idlePomodoro(endAt + 5 * MIN), round: 1 })
  const text = t('pomodoro.breakDone')
  expect(done.effects).toEqual([{ kind: 'notify', text, title: NOTIFY_TITLE }, { kind: 'ui.toast', text }])
})

test('a round over for more than a minute goes to idle with no effects and no late break', () => {
  const p = frozen(start(idlePomodoro(T0), T0, config))
  const endsAt = T0 + 25 * MIN
  const late = tick(p, endsAt + STALE_END_MS + 1, env({ autoBreak: true, sound: true }))
  expect(late.ended).toBe('focus')
  expect(late.effects).toEqual([])
  expect(late.state).toEqual({ ...idlePomodoro(endsAt + STALE_END_MS + 1), round: 1 })
  // Within the minute the end is still announced.
  expect(tick(p, endsAt + STALE_END_MS, env()).effects.map(e => e.kind)).toEqual(['notify', 'ui.toast'])
})

test('pause keeps the time left; resume continues from there; paused time is not spent', () => {
  const p = frozen(start(idlePomodoro(T0), T0, config))
  const paused = pause(p, T0 + 10 * MIN)
  expect(paused).toEqual({
    phase: 'paused', endsAt: null, remainingMs: 15 * MIN, remainingSec: 900, pausedFrom: 'focus', round: 0, updatedAt: T0 + 10 * MIN,
  })
  const back = resume(frozen(paused), T0 + 60 * MIN)
  expect(back).toEqual({ phase: 'focus', endsAt: T0 + 60 * MIN + 15 * MIN, remainingMs: null, remainingSec: 900, round: 0, updatedAt: T0 + 60 * MIN })
  expect('pausedFrom' in back).toBe(false)
  expect(pause(frozen(idlePomodoro(T0)), T0)).toEqual(idlePomodoro(T0))
  expect(resume(p, T0)).toBe(p)
})

test('a paused break resumes as a break', () => {
  const brk = tick(start(idlePomodoro(T0), T0, config), T0 + 25 * MIN, env({ autoBreak: true })).state
  const back = resume(pause(brk, brk.updatedAt + 60_000), brk.updatedAt + 90_000)
  expect(back.phase).toBe('break')
  expect(back.remainingSec).toBe(240)
})

test('press cycles idle, running, paused, running', () => {
  const a = press(idlePomodoro(T0), T0, config)
  const b = press(frozen(a), T0 + 1_000, config)
  const c = press(frozen(b), T0 + 2_000, config)
  expect([a.phase, b.phase, c.phase]).toEqual(['focus', 'paused', 'focus'])
  expect(c.endsAt).toBe(T0 + 2_000 + 25 * MIN - 1_000)
})

test('stop keeps the finished-round count; reset clears it', () => {
  const p = start({ ...idlePomodoro(T0), round: 3 }, T0, config)
  expect(stop(frozen(p), T0 + 5)).toEqual({ ...idlePomodoro(T0 + 5), round: 3 })
  expect(reset(T0 + 5)).toEqual(idlePomodoro(T0 + 5))
})

test('pomodoroEffects draws the new timer and stores it for every session', () => {
  const next = start(idlePomodoro(T0), T0, config)
  const [draw, store] = pomodoroEffects(next)
  expect(draw).toMatchObject({ kind: 'state.update', key: 'pomodoro' })
  expect(draw && draw.kind === 'state.update' ? draw.fn(undefined) : null).toBe(next)
  expect(store).toEqual({ kind: 'store.set', key: 'pomodoro', value: next })
})

test('mergePomodoro: the newer updatedAt wins, a tie keeps the first, a missing second is ignored', () => {
  const old = idlePomodoro(100)
  const fresh = start(idlePomodoro(200), 200, config)
  expect(mergePomodoro(old, fresh)).toBe(fresh)
  expect(mergePomodoro(fresh, old)).toBe(fresh)
  const tie = { ...idlePomodoro(200), round: 9 }
  expect(mergePomodoro(fresh, tie)).toBe(fresh)
  expect(mergePomodoro(old, null)).toBe(old)
  expect(mergePomodoro(old, undefined)).toBe(old)
})

test('formatRemaining: mm:ss, and h:mm:ss from one hour', () => {
  expect([0, 5, 65, 1500, 3599, 3600, 7199, -4].map(formatRemaining)).toEqual(['00:00', '00:05', '01:05', '25:00', '59:59', '1:00:00', '1:59:59', '00:00'])
})

test('labels for every phase, long and short, emoji and text icons', () => {
  const emoji = { style: 'icon+label', picked: undefined, t } as const
  const text = { style: 'label', picked: undefined, t } as const
  const running = { ...idlePomodoro(T0), phase: 'focus', endsAt: T0 + 1, remainingSec: 1499 } as const
  const rest = { ...running, phase: 'break', remainingSec: 299 } as const
  const paused = { ...idlePomodoro(T0), phase: 'paused', remainingMs: 720_000, remainingSec: 720, pausedFrom: 'focus' } as const
  expect(pomodoroLabel(idlePomodoro(T0), 'long', emoji)).toBe('🍅 Start')
  expect(pomodoroLabel(idlePomodoro(T0), 'short', emoji)).toBe('🍅')
  expect(pomodoroLabel(running, 'long', emoji)).toBe('🍅 24:59')
  expect(pomodoroLabel(running, 'short', emoji)).toBe('🍅 24:59')
  expect(pomodoroLabel(rest, 'long', emoji)).toBe('☕ 04:59')
  expect(pomodoroLabel(paused, 'long', emoji)).toBe('⏸ 12:00')
  expect(pomodoroLabel(idlePomodoro(T0), 'long', text)).toBe('Pomo Start')
  expect(pomodoroLabel(running, 'long', text)).toBe('Focus 24:59')
  expect(pomodoroLabel(rest, 'short', text)).toBe('Break 04:59')
  expect(pomodoroLabel(paused, 'short', text)).toBe('Paused 12:00')
})

test('the last minute of a running phase is flagged for the warning color', () => {
  const at = (phase: Pomodoro['phase'], sec: number | null): Pomodoro => ({ ...idlePomodoro(T0), phase, endsAt: T0, remainingSec: sec })
  expect(isLastMinute(at('focus', 60))).toBe(true)
  expect(isLastMinute(at('break', 1))).toBe(true)
  expect(isLastMinute(at('focus', 61))).toBe(false)
  expect(isLastMinute(at('paused', 30))).toBe(false)
  expect(isLastMinute(at('idle', null))).toBe(false)
})

test('asPomodoro rejects a running phase without its end and a paused one without the time kept', () => {
  const running = start(idlePomodoro(T0), T0, config)
  const paused = pause(running, T0 + MIN)
  expect(asPomodoro(running)).toBe(running)
  expect(asPomodoro(paused)).toBe(paused)
  expect(asPomodoro(idlePomodoro(T0))).toEqual(idlePomodoro(T0))
  expect(asPomodoro({ ...running, endsAt: null })).toBeNull()
  expect(asPomodoro({ ...running, phase: 'break', endsAt: null })).toBeNull()
  expect(asPomodoro({ ...paused, remainingMs: null })).toBeNull()
})

test('progress: none while idle, the share of the round gone while it runs or waits', () => {
  const config = pomodoroConfig({ pomodoroFocusMinutes: '20', pomodoroBreakMinutes: '5' })
  expect(pomodoroProgress(idlePomodoro(T0), T0, config)).toBeNull()
  const running = start(idlePomodoro(T0), T0, config)
  expect(pomodoroProgress(running, T0 + 5 * 60_000, config)).toEqual({ phase: 'focus', ratio: 0.25 })
  expect(pomodoroProgress(pause(running, T0 + 10 * 60_000), T0 + 15 * 60_000, config)).toEqual({ phase: 'focus', ratio: 0.5 })
  expect(pomodoroProgress(running, T0 + 30 * 60_000, config)?.ratio).toBe(1)
})

test('six alert sounds to pick from; a value that names none is the bell, and the picked one ends the round', () => {
  expect(Object.keys(POMODORO_SOUNDS)).toEqual(['bell', 'chime', 'ding', 'digital', 'marimba', 'soft'])
  expect([soundAssetOf('chime'), soundAssetOf('toString'), soundAssetOf(undefined)]).toEqual(['assets/sounds/chime.wav', DONE_SOUND, DONE_SOUND])
  const p = start(idlePomodoro(T0), T0, config)
  expect(tick(p, T0 + 25 * MIN, env({ sound: true, notify: false, soundAsset: POMODORO_SOUNDS.soft })).effects).toEqual([{ kind: 'audio.play', asset: 'assets/sounds/soft.wav' }])
  // Every sound has a name in every language (the status tab's list).
  for (const name of Object.keys(POMODORO_SOUNDS)) expect(t(`settings.value.pomodoroSoundName.${name}`)).not.toBe(`settings.value.pomodoroSoundName.${name}`)
})
