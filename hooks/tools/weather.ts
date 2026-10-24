// Weather tool. Pure: register.tsx makes the request, keeps the timer and the saved copy.
import type { WeatherState } from '../../types/index'
import type { TFn } from '../lib/i18n'
import type { Hue } from '../chip'
import { CITY_COORDS } from './cities'
import { minutes } from './pomodoro'

export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type WeatherCity = { place: string; latitude: number; longitude: number }
// What a forecast is asked for: the one city of the weatherPlace setting, in the unit shown.
export type WeatherTarget = WeatherCity & { unit: TemperatureUnit }
// The two fields asked of Open-Meteo, as it names them.
export type Forecast = { temperature_2m: number; weather_code: number }
// The saved copy (with the unit, so a changed unit asks again).
export type WeatherCache = WeatherTarget & { fetchedAt: number; current: Forecast }
// How a label is written: the person's language, locale and icon style.
export type WeatherLook = { t: TFn; locale: string; style: 'emoji' | 'text' }
export type WeatherGroup = 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
// The listed cities whose own weather reports use Fahrenheit (the United States).
const FAHRENHEIT_CITIES: readonly string[] = ['New York', 'Boston', 'Chicago', 'San Francisco', 'Los Angeles', 'Seattle', 'Denver', 'Austin', 'Miami']
const MINUTE_MS = 60_000

const ICONS: Readonly<Record<WeatherGroup, string>> = { clear: '☀', cloud: '⛅', fog: '🌫', rain: '🌧', snow: '❄', storm: '⛈' }
const ERROR_ICON = '☁'

// WMO weather codes as Open-Meteo sends them (lower, upper, group). 80-82 are rain showers, so they are rain;
// a code in no row (Open-Meteo sends none) is cloud.
const GROUPS: readonly (readonly [number, number, WeatherGroup])[] = [
  [0, 0, 'clear'], [1, 3, 'cloud'], [45, 48, 'fog'], [51, 67, 'rain'], [71, 77, 'snow'],
  [80, 82, 'rain'], [85, 86, 'snow'], [95, 99, 'storm'],
]

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// The city of the weatherPlace setting, or null for `off` or a name the table does not hold.
export function weatherCity(options: Readonly<Record<string, unknown>>): WeatherCity | null {
  const place = options.weatherPlace
  if (typeof place !== 'string' || !Object.hasOwn(CITY_COORDS, place)) return null
  const at = CITY_COORDS[place]
  return at === undefined ? null : { place, latitude: at.lat, longitude: at.lon }
}

// `auto` follows the city shown, not the computer's locale: Busan reads in Celsius even on an
// en-US system, New York in Fahrenheit.
export function temperatureUnit(setting: unknown, place: string): TemperatureUnit {
  if (setting === 'celsius' || setting === 'fahrenheit') return setting
  return FAHRENHEIT_CITIES.includes(place) ? 'fahrenheit' : 'celsius'
}

export function weatherTarget(options: Readonly<Record<string, unknown>>): WeatherTarget | null {
  const city = weatherCity(options)
  return city === null ? null : { ...city, unit: temperatureUnit(options.temperatureUnit, city.place) }
}

// The refresh period, from the /config list's string ("30"), held to the setting's range again.
export const weatherRefreshMs = (options: Readonly<Record<string, unknown>>): number =>
  minutes(options.weatherRefreshMinutes, 10, 180, 30) * MINUTE_MS

// Only the coordinates and the unit leave the computer.
export const forecastUrl = (target: WeatherTarget): string =>
  `${FORECAST_URL}?latitude=${target.latitude}&longitude=${target.longitude}&current=temperature_2m,weather_code&temperature_unit=${target.unit}&timezone=auto`

function asForecast(raw: unknown): Forecast | null {
  if (!isRecord(raw)) return null
  const temperature = raw.temperature_2m
  const code = raw.weather_code
  return isNumber(temperature) && isNumber(code) && Number.isInteger(code) ? { temperature_2m: temperature, weather_code: code } : null
}

// The `current` part of an answer body; null for text that is not JSON or not that shape.
export function parseForecast(text: string): Forecast | null {
  try {
    const body: unknown = JSON.parse(text)
    return isRecord(body) ? asForecast(body.current) : null
  } catch {
    return null
  }
}

// A saved copy as read back from the store; null for anything else.
export function asWeatherCache(raw: unknown): WeatherCache | null {
  if (!isRecord(raw)) return null
  const { place, latitude, longitude, unit, fetchedAt } = raw
  const current = asForecast(raw.current)
  if (typeof place !== 'string' || !isNumber(latitude) || !isNumber(longitude) || !isNumber(fetchedAt) || current === null) return null
  return unit === 'celsius' || unit === 'fahrenheit' ? { place, latitude, longitude, unit, fetchedAt, current } : null
}

// Null, weather turned off, is no target.
export const sameTarget = (a: WeatherTarget, b: WeatherTarget | null): boolean =>
  b !== null && a.place === b.place && a.unit === b.unit && a.latitude === b.latitude && a.longitude === b.longitude

// A saved copy still good for this city and unit; one dated in the future (the clock was set back) is not.
export function isFresh(cache: WeatherCache | null, target: WeatherTarget, now: number, maxAgeMs: number): cache is WeatherCache {
  if (cache === null || !sameTarget(cache, target)) return false
  const age = now - cache.fetchedAt
  return age >= 0 && age < maxAgeMs
}

// Every session shares the saved copy: another session's, when it is for the same target and newer, wins.
export const newerCache = (mine: WeatherCache, saved: WeatherCache | null): WeatherCache =>
  saved !== null && sameTarget(saved, mine) && saved.fetchedAt > mine.fetchedAt ? saved : mine

export const weatherGroup = (code: number): WeatherGroup => GROUPS.find(([low, high]) => code >= low && code <= high)?.[2] ?? 'cloud'

const iconOf = (group: WeatherGroup, look: WeatherLook): string => (look.style === 'text' ? look.t(`weather.icon.${group}`) : ICONS[group])

// Whole degrees in the locale's digits; `+ 0` keeps a -0 from printing as "-0".
function degrees(value: number, locale: string): string {
  const rounded = Math.round(value) + 0
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(rounded)
  } catch {
    return String(rounded)
  }
}

export const offWeather = (): WeatherState => ({ status: 'off', label: '', shortLabel: '', fetchedAt: null })

// A refresh under way keeps the last label on screen.
export const loadingWeather = (current: WeatherState): WeatherState => ({ ...current, status: 'loading' })

export function failedWeather(look: WeatherLook): WeatherState {
  const label = `${look.style === 'text' ? look.t('weather.icon.cloud') : ERROR_ICON} --`
  return { status: 'error', label, shortLabel: label, fetchedAt: null }
}

// The band chip's symbol for each icon: one cell, drawn in the chip's colour (an emoji keeps its own), after
// augiefra/claude-mods; a word (the text style) stays.
const CHIP_ICONS: Readonly<Record<string, readonly [string, Hue]>> = {
  '☀': ['☀', 'yellow'], '⛅': ['☁', 'gray'], '🌫': ['≡', 'gray'], '🌧': ['☂', 'blue'], '❄': ['❄', 'cyan'], '⛈': ['☇', 'magenta'], [ERROR_ICON]: ['☁', 'gray'],
}

// The band chip's parts of a label written below: the icon (or its one word), the degrees, the place.
export function weatherParts(label: string): { hue: Hue; icon: string; value: string; detail: string } {
  const [mark = '', value = '', ...place] = label.split(' ')
  const [icon, hue] = CHIP_ICONS[mark] ?? [mark, 'cyan']
  return { hue, icon, value, detail: place.join(' ') }
}

// The long label `☀ 18°C Seoul` and the short one `☀ 18°`.
export function shownWeather(cache: WeatherCache, look: WeatherLook): WeatherState {
  const icon = iconOf(weatherGroup(cache.current.weather_code), look)
  const degree = degrees(cache.current.temperature_2m, look.locale)
  const letter = cache.unit === 'fahrenheit' ? 'F' : 'C'
  return { status: 'ok', label: `${icon} ${degree}°${letter} ${cache.place}`, shortLabel: `${icon} ${degree}°`, fetchedAt: cache.fetchedAt }
}
