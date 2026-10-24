// Time and duration formatting. Thin wrappers over Intl.

export type ClockFormat = 'auto' | '12' | '24'

export type ClockOptions = {
  locale: string
  // Empty or missing means the system time zone.
  timeZone?: string
  // Missing means the locale default.
  hour12?: boolean
  seconds: boolean
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

// Throws a RangeError where Intl rejects the locale or time zone: tools/clock.ts clockLabel then draws the local time
// and says so in the status tab.
export function formatClock(nowMs: number, options: ClockOptions): string {
  // hourCycle states the cycle outright (h12 or h23).
  const hourCycle = options.hour12 === undefined ? undefined : options.hour12 ? 'h12' : 'h23'
  return new Intl.DateTimeFormat(options.locale, {
    hour: 'numeric',
    minute: '2-digit',
    second: options.seconds ? '2-digit' : undefined,
    hourCycle,
    timeZone: options.timeZone || undefined,
  }).format(nowMs)
}

// A note's date and time: month and day, then the clock, in the clock's locale, zone and cycle.
export function formatStamp(nowMs: number, options: ClockOptions): string {
  const hourCycle = options.hour12 === undefined ? undefined : options.hour12 ? 'h12' : 'h23'
  try {
    return new Intl.DateTimeFormat(options.locale, {
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle,
      timeZone: options.timeZone || undefined,
    }).format(nowMs)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    const date = new Date(nowMs)
    return `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }
}

// The export's header date: medium date and short time, in the clock's locale, zone and cycle.
export function formatDateTime(nowMs: number, options: ClockOptions): string {
  const hourCycle = options.hour12 === undefined ? undefined : options.hour12 ? 'h12' : 'h23'
  try {
    return new Intl.DateTimeFormat(options.locale, { dateStyle: 'medium', timeStyle: 'short', hourCycle, timeZone: options.timeZone || undefined }).format(nowMs)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    const date = new Date(nowMs)
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  }
}

// `YYYYMMDD-HHmm` for an export's file name, in the clock's zone; the local zone when Intl refuses it.
export function fileStamp(nowMs: number, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timeZone || undefined,
    }).formatToParts(nowMs)
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? '00'
    return `${part('year')}${part('month')}${part('day')}-${part('hour')}${part('minute')}`
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    const date = new Date(nowMs)
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`
  }
}

// Countdown text: mm:ss, or h:mm:ss from one hour on. Partial seconds round up, as timers do.
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`
}

// Intl throws RangeError for a time zone it does not know (confirmed on 2.1.308).
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

// true when the clock shows 12 hours: fixed by the setting, or by the locale when it is auto.
export function resolveHour12(clockFormat: ClockFormat, locale: string): boolean {
  if (clockFormat === '12') return true
  if (clockFormat === '24') return false
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle
    return cycle === 'h12' || cycle === 'h11'
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}
