// The weather tool's pure functions: the request, the answer, the icons and labels, the unit, the saved copy.
import { expect, test } from 'claude-code/testing'
import { CITY_COORDS } from '../hooks/tools/cities'
import {
  asWeatherCache, failedWeather, forecastUrl, isFresh, loadingWeather, newerCache, offWeather, parseForecast,
  shownWeather, temperatureUnit, weatherCity, weatherGroup, weatherRefreshMs, weatherTarget,
} from '../hooks/tools/weather'
import type { WeatherCache, WeatherLook, WeatherTarget } from '../hooks/tools/weather'
import { translator } from '../hooks/lib/i18n'
import { NOW } from './pure-helpers'

const MINUTE = 60_000
const en: WeatherLook = { t: translator('en'), locale: 'en-US', style: 'emoji' }
const SEOUL: WeatherTarget = { place: 'Seoul', latitude: 37.566, longitude: 126.9784, unit: 'celsius' }
const cacheOf = (over: Partial<WeatherCache> = {}): WeatherCache => ({ ...SEOUL, fetchedAt: NOW, current: { temperature_2m: 17.8, weather_code: 0 }, ...over })

test('the city comes from the coordinate table; off and unknown names have none', () => {
  expect(weatherCity({ weatherPlace: 'Seoul' })).toEqual({ place: 'Seoul', latitude: 37.566, longitude: 126.9784 })
  for (const place of ['off', 'Nowhere', 'constructor', '__proto__', '', 5, undefined]) expect(weatherCity({ weatherPlace: place })).toBeNull()
  expect(weatherCity({})).toBeNull()
  // With `off`, the 64 options a Select takes (the status tab).
  expect(Object.keys(CITY_COORDS)).toHaveLength(63)
})

test('the request names the coordinates and the unit, and no place name', () => {
  expect(forecastUrl(SEOUL)).toBe(
    'https://api.open-meteo.com/v1/forecast?latitude=37.566&longitude=126.9784&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto',
  )
  const london = weatherTarget({ weatherPlace: 'London', temperatureUnit: 'fahrenheit' })
  expect(forecastUrl(london as WeatherTarget)).toContain('latitude=51.5085&longitude=-0.1257&')
  expect(forecastUrl(london as WeatherTarget)).toContain('temperature_unit=fahrenheit')
  expect(forecastUrl(SEOUL)).not.toContain('Seoul')
})

test('the unit follows the setting; auto follows the region of the locale', () => {
  expect(temperatureUnit('celsius', 'New York')).toBe('celsius')
  expect(temperatureUnit('fahrenheit', 'Seoul')).toBe('fahrenheit')
  for (const place of ['New York', 'Chicago', 'Miami']) expect(temperatureUnit('auto', place)).toBe('fahrenheit')
  for (const place of ['Busan', 'Seoul', 'London', 'Toronto', 'Sao Paulo']) expect(temperatureUnit('auto', place)).toBe('celsius')
  expect(temperatureUnit(undefined, 'Busan')).toBe('celsius')
})

test('an answer is read for the temperature and the code; other shapes are errors', () => {
  expect(parseForecast('{"current":{"temperature_2m":17.8,"weather_code":3,"time":"x"}}')).toEqual({ temperature_2m: 17.8, weather_code: 3 })
  const bad = [
    '', 'not json', 'null', '[]', '{}', '{"current":null}', '{"current":[]}', '{"current":{}}',
    '{"current":{"temperature_2m":"17","weather_code":3}}',
    '{"current":{"temperature_2m":null,"weather_code":3}}',
    '{"current":{"temperature_2m":17,"weather_code":1.5}}',
    '{"current":{"temperature_2m":17}}',
    '{"error":true,"reason":"nope"}',
  ]
  for (const text of bad) expect(parseForecast(text), text).toBeNull()
})

test('weather codes fall into six groups; rain showers are rain', () => {
  const table: [number[], string][] = [
    [[0], 'clear'], [[1, 2, 3], 'cloud'], [[45, 48], 'fog'], [[51, 55, 56, 61, 65, 66, 67], 'rain'],
    [[71, 73, 75, 77], 'snow'], [[80, 81, 82], 'rain'], [[85, 86], 'snow'], [[95, 96, 99], 'storm'],
  ]
  for (const [codes, group] of table) for (const code of codes) expect(weatherGroup(code), String(code)).toBe(group)
  expect(weatherGroup(10)).toBe('cloud')
})

test('the long label is icon, degrees, unit letter and city; the short one is icon and degrees', () => {
  const shown = shownWeather(cacheOf(), en)
  expect(shown).toEqual({ status: 'ok', label: '☀ 18°C Seoul', shortLabel: '☀ 18°', fetchedAt: NOW })
  const icons = { 0: '☀', 2: '⛅', 45: '🌫', 63: '🌧', 73: '❄', 95: '⛈' }
  for (const [code, icon] of Object.entries(icons)) {
    expect(shownWeather(cacheOf({ current: { temperature_2m: 3, weather_code: Number(code) } }), en).shortLabel).toBe(`${icon} 3°`)
  }
  const fahrenheit = shownWeather(cacheOf({ unit: 'fahrenheit', place: 'Boston' }), en)
  expect(fahrenheit.label).toBe('☀ 18°F Boston')
})

test('degrees are whole numbers, and a small negative one is 0, not -0', () => {
  const at = (temperature_2m: number) => shownWeather(cacheOf({ current: { temperature_2m, weather_code: 3 } }), en).shortLabel
  expect(at(-0.4)).toBe('⛅ 0°')
  expect(at(-5.5)).toBe('⛅ -5°')
  expect(at(-5.6)).toBe('⛅ -6°')
  expect(at(0.5)).toBe('⛅ 1°')
})

test('text icons are short words from the language file', () => {
  const text = (lang: 'en' | 'ko' | 'ja', code: number) =>
    shownWeather(cacheOf({ current: { temperature_2m: 18, weather_code: code } }), { t: translator(lang), locale: lang, style: 'text' }).label
  expect(text('en', 0)).toBe('Sun 18°C Seoul')
  expect(text('ko', 0)).toBe('맑음 18°C Seoul')
  expect(text('ja', 0)).toBe('晴れ 18°C Seoul')
  expect(['en', 'ko', 'ja'].map(lang => text(lang as 'en', 95))).toEqual(['Storm 18°C Seoul', '뇌우 18°C Seoul', '雷雨 18°C Seoul'])
})

test('a failed ask reads cloud and two dashes; a refresh keeps the label, nothing else is off', () => {
  expect(failedWeather(en)).toEqual({ status: 'error', label: '☁ --', shortLabel: '☁ --', fetchedAt: null })
  expect(failedWeather({ ...en, style: 'text' }).label).toBe('Cloud --')
  const shown = shownWeather(cacheOf(), en)
  expect(loadingWeather(shown)).toEqual({ ...shown, status: 'loading' })
  expect(offWeather()).toEqual({ status: 'off', label: '', shortLabel: '', fetchedAt: null })
})

test('the refresh period is read from the list string and held to 10-180 minutes', () => {
  const ms = (value: unknown) => weatherRefreshMs({ weatherRefreshMinutes: value })
  expect(ms('30')).toBe(30 * MINUTE)
  expect(ms('10')).toBe(10 * MINUTE)
  expect(ms('180')).toBe(180 * MINUTE)
  expect(ms('5')).toBe(10 * MINUTE)
  expect(ms('999')).toBe(180 * MINUTE)
  expect(ms(15)).toBe(15 * MINUTE)
  for (const odd of ['abc', '', undefined, null, NaN]) expect(ms(odd)).toBe(30 * MINUTE)
  expect(weatherRefreshMs({})).toBe(30 * MINUTE)
})

test('a saved copy is read back only when every field has its shape', () => {
  expect(asWeatherCache(JSON.parse(JSON.stringify(cacheOf())))).toEqual(cacheOf())
  const bad = [null, 'x', [], {}, { ...cacheOf(), place: 5 }, { ...cacheOf(), unit: 'kelvin' }, { ...cacheOf(), fetchedAt: 'now' }, { ...cacheOf(), latitude: null }, { ...cacheOf(), current: { temperature_2m: 1 } }]
  for (const raw of bad) expect(asWeatherCache(raw)).toBeNull()
})

test('a saved copy is fresh for the same city and unit inside the period only', () => {
  const period = 30 * MINUTE
  const fresh = (cache: WeatherCache | null, target: WeatherTarget, now: number) => isFresh(cache, target, now, period)
  expect(fresh(cacheOf(), SEOUL, NOW)).toBe(true)
  expect(fresh(cacheOf(), SEOUL, NOW + period - 1)).toBe(true)
  expect(fresh(cacheOf(), SEOUL, NOW + period)).toBe(false)
  expect(fresh(cacheOf(), SEOUL, NOW - 1)).toBe(false)
  expect(fresh(cacheOf(), { ...SEOUL, place: 'Busan' }, NOW)).toBe(false)
  expect(fresh(cacheOf(), { ...SEOUL, unit: 'fahrenheit' }, NOW)).toBe(false)
  expect(fresh(cacheOf(), { ...SEOUL, latitude: 1 }, NOW)).toBe(false)
  expect(fresh(null, SEOUL, NOW)).toBe(false)
})

test('before a write, a newer saved copy for the same target wins; anything else does not', () => {
  const mine = cacheOf({ fetchedAt: NOW })
  const newer = cacheOf({ fetchedAt: NOW + 1, current: { temperature_2m: 1, weather_code: 3 } })
  expect(newerCache(mine, newer)).toBe(newer)
  expect(newerCache(mine, cacheOf({ fetchedAt: NOW - 1 }))).toBe(mine)
  expect(newerCache(mine, cacheOf({ fetchedAt: NOW }))).toBe(mine)
  expect(newerCache(mine, { ...newer, place: 'Busan' })).toBe(mine)
  expect(newerCache(mine, { ...newer, unit: 'fahrenheit' })).toBe(mine)
  expect(newerCache(mine, null)).toBe(mine)
})
