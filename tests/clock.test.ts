import { test, expect } from 'claude-code/testing'
import { formatClock } from '../hooks/lib/format'
import { clockFormatOptions, clockLabel, dateFormatOf, dateText, msUntilNextTick } from '../hooks/tools/clock'
import type { ClockFormatOptions } from '../hooks/tools/clock'

const echo = (now: number, o: ClockFormatOptions): string =>
  `${now}|${o.locale}|${o.timeZone ?? '-'}|${o.hour12 === undefined ? 'auto' : o.hour12}|${o.seconds}`

test('clockFormatOptions maps clockFormat, clockSeconds and timeZone', () => {
  expect(clockFormatOptions({ clockFormat: 'auto', timeZone: 'system', clockSeconds: false }, 'ko-KR')).toEqual({ locale: 'ko-KR', seconds: false })
  expect(clockFormatOptions({}, 'en-US')).toEqual({ locale: 'en-US', seconds: false })
  expect(clockFormatOptions({ clockFormat: 'auto', timeZone: '  ', clockSeconds: false }, 'ko-KR')).toEqual({ locale: 'ko-KR', seconds: false })
  expect(clockFormatOptions({ clockFormat: '12', clockSeconds: true, timeZone: 'Asia/Seoul' }, 'ko-KR')).toEqual({
    locale: 'ko-KR', timeZone: 'Asia/Seoul', hour12: true, seconds: true,
  })
  expect(clockFormatOptions({ clockFormat: '24' }, 'de-DE')).toEqual({ locale: 'de-DE', hour12: false, seconds: false })
})

test('clockLabel passes the options to the formatter', () => {
  const options = clockFormatOptions({ clockFormat: '24', timeZone: 'UTC' }, 'de-DE')
  expect(clockLabel(42, options, echo)).toEqual({ text: '42|de-DE|UTC|false|false', degraded: false })
})

test('clockLabel falls back to HH:MM from the Date getters when the formatter throws', () => {
  const boom = (): string => {
    throw new RangeError('bad zone')
  }
  const short = clockLabel(Date.now(), { locale: 'en', seconds: false }, boom)
  const long = clockLabel(Date.now(), { locale: 'en', seconds: true }, boom)
  expect(short.degraded).toBe(true)
  expect(short.text).toMatch(/^\d\d:\d\d$/)
  expect(long.text).toMatch(/^\d\d:\d\d:\d\d$/)
  const now = new Date(2026, 9, 22, 14, 5, 9).getTime()
  expect(clockLabel(now, { locale: 'en', seconds: true }, boom).text).toBe('14:05:09')
})

test('with the clock\'s formatter a bad time zone or locale draws the local 24-hour clock, degraded', () => {
  const now = new Date(2026, 9, 22, 14, 5, 9).getTime()
  expect(clockLabel(now, { locale: 'en-US', timeZone: 'Mars/Base', hour12: true, seconds: false }, formatClock)).toEqual({ text: '14:05', degraded: true })
  expect(clockLabel(now, { locale: 'not a locale!', seconds: true }, formatClock)).toEqual({ text: '14:05:09', degraded: true })
  expect(clockLabel(now, { locale: 'en-US', timeZone: 'UTC', seconds: false }, formatClock).degraded).toBe(false)
})

test('msUntilNextTick aims at the next minute boundary', () => {
  const minute = Date.UTC(2026, 9, 22, 5, 32, 0)
  expect(msUntilNextTick(minute + 59_500, false)).toBe(500)
  expect(msUntilNextTick(minute + 1_000, false)).toBe(59_000)
  expect(msUntilNextTick(minute, false)).toBe(60_000)
  expect(msUntilNextTick(-1, false)).toBe(1)
})

test('with seconds shown the tick is one second, aligned to the second', () => {
  expect(msUntilNextTick(12_345, true)).toBe(655)
  expect(msUntilNextTick(12_000, true)).toBe(1_000)
})

test('the date: off, the language\'s own order, or the year, day or month first, with the weekday', () => {
  // 2026-10-22 23:30 UTC is already Friday the 23rd in Seoul.
  const late = Date.UTC(2026, 9, 22, 23, 30)
  expect(dateText(late, 'off', 'en-US', 'UTC')).toBe('')
  expect(dateText(late, 'ymd', 'ko-KR', 'Asia/Seoul')).toBe('2026/10/23 금')
  expect(dateText(late, 'dmy', 'en-GB', 'UTC')).toBe('22/10/2026 Thu')
  expect(dateText(late, 'mdy', 'ja-JP', 'UTC')).toBe('10/22/2026 木')
  expect(dateText(late, 'auto', 'en-US', 'UTC')).toBe('10/22/2026 Thu')
  expect(dateText(late, 'auto', 'ja-JP', 'UTC')).toBe('2026/10/22 木')
  // A zone Intl does not know draws no date; the clock reports it.
  expect(dateText(late, 'ymd', 'en-US', 'Mars/Base')).toBe('')
  // A value outside the list reads as the schema's default.
  expect([dateFormatOf('dmy'), dateFormatOf('yyyy'), dateFormatOf(undefined)]).toEqual(['dmy', 'auto', 'auto'])
})
