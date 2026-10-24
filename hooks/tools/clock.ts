// Clock tool. Pure: the clock's formatter is passed in; the date beside it calls Intl itself and draws nothing where
// Intl fails.

export type ClockFormatOptions = { locale: string; timeZone?: string; hour12?: boolean; seconds: boolean }
export type ClockFormatter = (nowMs: number, options: ClockFormatOptions) => string
export type ClockLabel = { text: string; degraded: boolean }

const MINUTE_MS = 60_000
const SECOND_MS = 1_000

// The timeZone setting picks from a list whose first entry, "system", means the computer's own zone;
// an empty value (from before the list) means the same.
export const configuredTimeZone = (options: Readonly<Record<string, unknown>>): string => {
  const zone = typeof options.timeZone === 'string' ? options.timeZone.trim() : ''
  return zone === 'system' ? '' : zone
}

// Maps the userConfig values (clockFormat, clockSeconds, timeZone) to formatter options.
export function clockFormatOptions(options: Readonly<Record<string, unknown>>, locale: string): ClockFormatOptions {
  const zone = configuredTimeZone(options)
  return {
    locale,
    ...(zone === '' ? {} : { timeZone: zone }),
    ...(options.clockFormat === '12' ? { hour12: true } : options.clockFormat === '24' ? { hour12: false } : {}),
    seconds: options.clockSeconds === true,
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

// Date-getter fallback for a runtime where the formatter throws: 24-hour, local zone.
function localClock(nowMs: number, seconds: boolean): string {
  const date = new Date(nowMs)
  const hm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  return seconds ? `${hm}:${pad2(date.getSeconds())}` : hm
}

// The text to draw. Long and short forms are the same. `degraded` tells the caller to show
// "time zone support unavailable" in the status tab.
export function clockLabel(nowMs: number, options: ClockFormatOptions, format: ClockFormatter): ClockLabel {
  try {
    return { text: format(nowMs, options), degraded: false }
  } catch {
    return { text: localClock(nowMs, options.seconds), degraded: true }
  }
}

// Milliseconds until the label can change: the next minute boundary, or 1 s with seconds shown.
// A time exactly on the boundary waits a full period, so a timer never fires twice for one label.
export function msUntilNextTick(nowMs: number, seconds: boolean): number {
  const period = seconds ? SECOND_MS : MINUTE_MS
  return period - (((nowMs % period) + period) % period)
}

export type DateFormat = 'off' | 'auto' | 'ymd' | 'dmy' | 'mdy'
const DATE_FORMATS: readonly string[] = ['off', 'auto', 'ymd', 'dmy', 'mdy']
// A value outside the list reads as the schema's default, as the engine reads it.
export const dateFormatOf = (value: unknown): DateFormat => (typeof value === 'string' && DATE_FORMATS.includes(value) ? (value as DateFormat) : 'auto')

// The date tool, a tool of its own beside the clock: year, month and day in the language's own order (auto) or the one
// picked, and the weekday short (one letter in Korean and Japanese), in the clock's time zone. Null when off, or when
// Intl does not know the zone (the clock says so already).
// ponytail: one remembered answer per minute and setting, as a band draws the date several times a render; a map if two zones ever show
let lastParts: { key: string; parts: { date: string; weekday: string } | null } | null = null

export function dateParts(nowMs: number, format: DateFormat, locale: string, timeZone: string): { date: string; weekday: string } | null {
  const key = `${Math.floor(nowMs / 60_000)}|${format}|${locale}|${timeZone}`
  if (lastParts?.key !== key) lastParts = { key, parts: formatDate(nowMs, format, locale, timeZone) }
  return lastParts.parts
}

function formatDate(nowMs: number, format: DateFormat, locale: string, timeZone: string): { date: string; weekday: string } | null {
  if (format === 'off') return null
  try {
    const zone = timeZone === '' ? {} : { timeZone }
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', ...zone }).format(nowMs)
    // The Gregorian year in Western digits whatever the locale's calendar.
    const digits = { year: 'numeric', month: '2-digit', day: '2-digit', calendar: 'gregory', numberingSystem: 'latn', ...zone } as const
    if (format === 'auto') return { date: new Intl.DateTimeFormat(locale, digits).format(nowMs), weekday }
    const parts = new Intl.DateTimeFormat('en-US', digits).formatToParts(nowMs)
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? ''
    const [y, m, d] = [part('year'), part('month'), part('day')]
    return { date: format === 'ymd' ? `${y}/${m}/${d}` : format === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`, weekday }
  } catch {
    return null
  }
}

export const dateText = (nowMs: number, format: DateFormat, locale: string, timeZone: string): string => {
  const parts = dateParts(nowMs, format, locale, timeZone)
  return parts === null ? '' : `${parts.date} ${parts.weekday}`
}
