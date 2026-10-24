import { test, expect } from 'claude-code/testing'
import { formatClock, formatDuration, isValidTimeZone, resolveHour12 } from '../hooks/lib/format'

// 2026-10-22 05:32:07 UTC = 14:32:07 in Seoul.
const NOW = Date.UTC(2026, 9, 22, 5, 32, 7)
// Newer ICU puts a narrow no-break space before AM/PM; compare with plain spaces.
const plain = (text: string): string => text.replace(/\s/g, ' ')

test('ko-KR in Seoul, auto (12-hour) and 24-hour', () => {
  const base = { locale: 'ko-KR', timeZone: 'Asia/Seoul', seconds: false }
  expect(plain(formatClock(NOW, { ...base, hour12: true }))).toBe('오후 2:32')
  expect(formatClock(NOW, { ...base, hour12: false })).toBe('14:32')
  expect(plain(formatClock(NOW, base))).toBe('오후 2:32')
})

test('seconds are shown only when asked for', () => {
  const base = { locale: 'ko-KR', timeZone: 'Asia/Seoul', hour12: false }
  expect(formatClock(NOW, { ...base, seconds: true })).toBe('14:32:07')
  expect(formatClock(NOW, { ...base, seconds: false })).toBe('14:32')
})

test('en-US 12-hour', () => {
  const options = { locale: 'en-US', timeZone: 'Asia/Seoul', hour12: true, seconds: false }
  expect(plain(formatClock(NOW, options))).toBe('2:32 PM')
  expect(plain(formatClock(NOW + 10 * 3600 * 1000, options))).toBe('12:32 AM')
})

test('de-DE follows its 24-hour default', () => {
  const options = { locale: 'de-DE', timeZone: 'Asia/Seoul', seconds: false }
  expect(formatClock(NOW, options)).toBe('14:32')
  expect(formatClock(NOW, { ...options, hour12: false })).toBe('14:32')
})

test('time zone changes the hour: UTC and Seoul differ by nine hours', () => {
  const base = { locale: 'en-US', hour12: false, seconds: false }
  expect(formatClock(NOW, { ...base, timeZone: 'UTC' })).toBe('05:32')
  expect(formatClock(NOW, { ...base, timeZone: 'Asia/Seoul' })).toBe('14:32')
})

test('an empty time zone means the system time zone', () => {
  const base = { locale: 'en-US', hour12: false, seconds: false }
  expect(formatClock(NOW, { ...base, timeZone: '' })).toBe(formatClock(NOW, base))
})

// Regression: formatClock fell back by itself, so the clock never said it did (tools/clock.ts clockLabel falls back).
test('a bad time zone or locale throws a RangeError for the caller to fall back on', () => {
  expect(() => formatClock(NOW, { locale: 'en-US', timeZone: 'Mars/Base', hour12: true, seconds: false })).toThrow(RangeError)
  expect(() => formatClock(NOW, { locale: 'not a locale!', seconds: false })).toThrow(RangeError)
})

test('isValidTimeZone accepts IANA names and rejects the rest', () => {
  expect(isValidTimeZone('Asia/Seoul')).toBe(true)
  expect(isValidTimeZone('UTC')).toBe(true)
  expect(isValidTimeZone('America/New_York')).toBe(true)
  expect(isValidTimeZone('Mars/Base')).toBe(false)
  expect(isValidTimeZone('')).toBe(false)
})

test('resolveHour12: explicit settings win over the locale', () => {
  expect(resolveHour12('12', 'de-DE')).toBe(true)
  expect(resolveHour12('24', 'en-US')).toBe(false)
})

test('resolveHour12: auto follows the locale', () => {
  expect(resolveHour12('auto', 'en-US')).toBe(true)
  expect(resolveHour12('auto', 'ko-KR')).toBe(true)
  expect(resolveHour12('auto', 'de-DE')).toBe(false)
  expect(resolveHour12('auto', 'ja-JP')).toBe(false)
  expect(resolveHour12('auto', 'not a locale!')).toBe(false)
})

test('formatDuration shows mm:ss under an hour', () => {
  expect(formatDuration(0)).toBe('00:00')
  expect(formatDuration(1000)).toBe('00:01')
  expect(formatDuration(5 * 60 * 1000)).toBe('05:00')
  expect(formatDuration(25 * 60 * 1000)).toBe('25:00')
  expect(formatDuration(59 * 60 * 1000 + 59 * 1000)).toBe('59:59')
})

test('formatDuration switches to h:mm:ss at one hour', () => {
  expect(formatDuration(3600 * 1000)).toBe('1:00:00')
  expect(formatDuration(3661 * 1000)).toBe('1:01:01')
  expect(formatDuration(10 * 3600 * 1000)).toBe('10:00:00')
})

test('formatDuration rounds partial seconds up and clamps bad input to zero', () => {
  expect(formatDuration(1)).toBe('00:01')
  expect(formatDuration(59_001)).toBe('01:00')
  expect(formatDuration(-5000)).toBe('00:00')
  expect(formatDuration(Number.NaN)).toBe('00:00')
  expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00')
})
