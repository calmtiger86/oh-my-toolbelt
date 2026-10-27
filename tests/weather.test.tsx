// The weather tile: the forecast is asked for with the city's coordinates, kept in the store, drawn in the band, asked
// for again on a timer and by /toolbelt weather refresh, and a failure reads `☁ --` with one toast.
import { expect } from 'claude-code/testing'
import type { HttpInit, On } from 'claude-code'
import { NOW, SLOW_MS, TEST_OPTIONS, boot, isManifestPath, mountBand, mountPane, pick, runCommand, test } from './helpers'

const MINUTE = 60_000
const SEOUL = { ...TEST_OPTIONS, weatherPlace: 'Seoul', temperatureUnit: 'celsius' } as const
const SUNNY = JSON.stringify({ current: { temperature_2m: 17.8, weather_code: 0 } })
const FAILED_TOAST = 'Could not get the weather. It will try again later.'

// `during` runs while a request is out, as another session's write would.
type Answer = { status: number; text: string; during?: () => void }
type Request = { url: string; init: HttpInit | undefined }

// Stands for the network: answers every forecast with what the test last set.
function stubForecast(on: On, answer: Answer): Request[] {
  const requests: Request[] = []
  on('http.fetch', (_, e) => {
    requests.push({ url: e.url, init: e.init })
    answer.during?.()
    return { value: { status: answer.status, ok: answer.status >= 200 && answer.status < 300, headers: {}, text: answer.text } }
  })
  return requests
}

const savedCache = (over: Record<string, unknown> = {}) => ({
  place: 'Seoul', unit: 'celsius', latitude: 37.566, longitude: 126.9784, fetchedAt: NOW - 5 * MINUTE,
  current: { temperature_2m: 9.2, weather_code: 63 }, ...over,
})

test('the tile shows the forecast of the chosen city, asked for with its coordinates only', { options: SEOUL }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock, store } = await boot($, on)
  await clock.settle()
  expect(requests).toHaveLength(1)
  expect(requests[0]?.url).toBe(
    'https://api.open-meteo.com/v1/forecast?latitude=37.566&longitude=126.9784&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=auto',
  )
  // Nothing the person wrote and no place name goes out: the only header added is the kind of answer wanted.
  expect(requests[0]?.init).toEqual({ headers: { Accept: 'application/json' } })
  expect(store.get('weatherCache')).toEqual({
    place: 'Seoul', unit: 'celsius', latitude: 37.566, longitude: 126.9784, fetchedAt: NOW, current: { temperature_2m: 17.8, weather_code: 0 },
  })
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('☀ 18°C Seoul')
  await band.unmount()
  // Narrower, the short label; narrower still, the weather is the first tile to go (priority 8).
  const narrow = await mountBand($, 'terminal', 70)
  expect((await narrow.find({ key: 'weather' }))?.text).toBe('☀ 18°')
  await narrow.unmount()
  const narrowest = await mountBand($, 'terminal', 40)
  expect(await narrowest.find({ key: 'weather' })).toBeUndefined()
  await narrowest.unmount()
})

test('with no city, or off, there is no tile and no request', { timeoutMs: SLOW_MS }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock } = await boot($, on)
  await clock.advance(120 * MINUTE)
  expect(requests).toHaveLength(0)
  const band = await mountBand($, 'terminal', 119)
  expect(await band.find({ key: 'weather' })).toBeUndefined()
  await band.unmount()
})

test('the unit follows the city when it is auto, and the icon style the setting', { options: { ...TEST_OPTIONS, weatherPlace: 'Boston', iconStyle: 'label' } }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock } = await boot($, on, { env: { LANG: 'en_US.UTF-8' } })
  await clock.settle()
  expect(requests[0]?.url).toContain('latitude=42.3584&longitude=-71.0598&')
  expect(requests[0]?.url).toContain('temperature_unit=fahrenheit')
  const band = await mountBand($, 'desktop', 119)
  // A desktop pill: the word for the icon, the degrees, the place.
  expect((await band.find({ key: 'weather' }))?.text).toBe('Sun 18°F Boston')
  await band.unmount()
})

test('a city outside the United States reads in Celsius even on an en-US computer', { options: { ...TEST_OPTIONS, weatherPlace: 'Busan' } }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock } = await boot($, on, { env: { LANG: 'en_US.UTF-8' } })
  await clock.settle()
  expect(requests[0]?.url).toContain('temperature_unit=celsius')
})

test('a language file names the text icons', { options: { ...SEOUL, iconStyle: 'label' } }, async ($, on) => {
  stubForecast(on, { status: 200, text: SUNNY })
  const { clock } = await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  await clock.settle()
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('맑음 18°C Seoul')
  await band.unmount()
})

test('a saved forecast inside the period is drawn without asking', { options: SEOUL }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock, store } = await boot($, on, { store: { weatherCache: savedCache() } })
  await clock.settle()
  expect(requests).toHaveLength(0)
  expect(store.get('weatherCache')).toEqual(savedCache())
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('☂ 9°C Seoul')
  await band.unmount()
  // /clear draws it again from the store, still without asking.
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(requests).toHaveLength(0)
  const again = await mountBand($, 'terminal', 119)
  expect((await again.find({ key: 'weather' }))?.text).toBe('☂ 9°C Seoul')
  await again.unmount()
})

test('an old saved forecast is asked for again, and the new one replaces it', { options: SEOUL }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock, store } = await boot($, on, { store: { weatherCache: savedCache({ fetchedAt: NOW - 31 * MINUTE }) } })
  await clock.settle()
  expect(requests).toHaveLength(1)
  expect(store.get('weatherCache')).toMatchObject({ fetchedAt: NOW, current: { temperature_2m: 17.8, weather_code: 0 } })
})

test('another city or unit in the saved forecast is asked for again', { options: SEOUL }, async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock, store } = await boot($, on, { store: { weatherCache: savedCache({ place: 'Busan' }) } })
  await clock.settle()
  expect(requests).toHaveLength(1)
  expect(store.get('weatherCache')).toMatchObject({ place: 'Seoul' })
})

test('the forecast is asked for again every period, and the label follows', { options: { ...SEOUL, weatherRefreshMinutes: '10' } }, async ($, on) => {
  const answer: Answer = { status: 200, text: SUNNY }
  const requests = stubForecast(on, answer)
  const { clock, store } = await boot($, on)
  await clock.settle()
  expect(requests).toHaveLength(1)
  answer.text = JSON.stringify({ current: { temperature_2m: -3.2, weather_code: 73 } })
  await clock.advance(10 * MINUTE - 1)
  expect(requests).toHaveLength(1)
  await clock.advance(1)
  expect(requests).toHaveLength(2)
  expect(store.get('weatherCache')).toMatchObject({ fetchedAt: NOW + 10 * MINUTE })
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('❄ -3°C Seoul')
  await band.unmount()
  await clock.advance(10 * MINUTE)
  expect(requests).toHaveLength(3)
})

test('an error answer reads cloud and two dashes, toasts once, and the next period tries again', { options: SEOUL, timeoutMs: SLOW_MS }, async ($, on) => {
  const answer: Answer = { status: 500, text: 'oops' }
  const requests = stubForecast(on, answer)
  const { calls, clock, store } = await boot($, on)
  await clock.settle()
  expect(requests).toHaveLength(1)
  expect(calls.toasts).toEqual([FAILED_TOAST])
  expect(store.has('weatherCache')).toBe(false)
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('☁ --')
  await band.unmount()
  await clock.advance(30 * MINUTE)
  expect(requests).toHaveLength(2)
  expect(calls.toasts).toEqual([FAILED_TOAST])
  answer.status = 200
  answer.text = SUNNY
  await clock.advance(30 * MINUTE)
  expect(requests).toHaveLength(3)
  const again = await mountBand($, 'terminal', 119)
  expect((await again.find({ key: 'weather' }))?.text).toBe('☀ 18°C Seoul')
  await again.unmount()
  expect(calls.toasts).toEqual([FAILED_TOAST])
})

test('an answer that is not the expected shape is an error too', { options: SEOUL }, async ($, on) => {
  stubForecast(on, { status: 200, text: '{"current":{"temperature_2m":"warm"}}' })
  const { calls, clock } = await boot($, on)
  await clock.settle()
  expect(calls.toasts).toEqual([FAILED_TOAST])
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('☁ --')
  await band.unmount()
})

test('a request that throws is an error too, and is noted for the status tab', { options: SEOUL }, async ($, on) => {
  on('http.fetch', () => ({ deny: 'offline' }))
  const { calls, clock } = await boot($, on)
  await clock.settle()
  expect(calls.toasts).toEqual([FAILED_TOAST])
  expect(calls.logged.join('\n')).toContain('http.fetch failed')
})

test('/toolbelt weather refresh asks at once', { options: SEOUL }, async ($, on) => {
  const answer: Answer = { status: 200, text: SUNNY }
  const requests = stubForecast(on, answer)
  const { clock } = await boot($, on)
  await clock.settle()
  answer.text = JSON.stringify({ current: { temperature_2m: 21.4, weather_code: 95 } })
  expect((await runCommand($, 'toolbelt', 'weather refresh')).text).toBe('Refreshing the weather.')
  await clock.settle()
  expect(requests).toHaveLength(2)
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('☇ 21°C Seoul')
  await band.unmount()
  expect((await runCommand($, 'tb', 'weather refresh')).text).toBe('Refreshing the weather.')
  expect((await runCommand($, 'tb', 'weather soon')).text).toContain('Unknown argument: soon')
  expect((await runCommand($, 'tb', 'weather')).text).toContain('weather refresh')
})

test('/toolbelt weather refresh says so when the weather is off', async ($, on) => {
  const requests = stubForecast(on, { status: 200, text: SUNNY })
  const { clock } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'weather refresh')).text).toBe('Weather is off. Pick a city under Weather in the Status tab or /config.')
  await clock.settle()
  expect(requests).toHaveLength(0)
})

test('a copy saved by another session while ours was on its way is kept when it is newer', { options: SEOUL }, async ($, on) => {
  const answer: Answer = { status: 200, text: SUNNY }
  stubForecast(on, answer)
  const { clock, store } = await boot($, on)
  await clock.settle()
  const other = savedCache({ fetchedAt: NOW + 1, current: { temperature_2m: 5.1, weather_code: 45 } })
  answer.during = () => store.set('weatherCache', other)
  await runCommand($, 'toolbelt', 'weather refresh')
  await clock.settle()
  expect(store.get('weatherCache')).toEqual(other)
  const band = await mountBand($, 'terminal', 119)
  expect((await band.find({ key: 'weather' }))?.text).toBe('≡ 5°C Seoul')
  await band.unmount()
})

test('an older copy written meanwhile, or one for another city, does not win', { options: SEOUL }, async ($, on) => {
  const answer: Answer = { status: 200, text: SUNNY }
  stubForecast(on, answer)
  const { clock, store } = await boot($, on)
  await clock.settle()
  for (const other of [savedCache({ fetchedAt: NOW - 1 }), savedCache({ place: 'Busan', fetchedAt: NOW + 1 })]) {
    answer.during = () => store.set('weatherCache', other)
    await runCommand($, 'toolbelt', 'weather refresh')
    await clock.settle()
    expect(store.get('weatherCache')).toMatchObject({ place: 'Seoul', fetchedAt: NOW, current: { temperature_2m: 17.8 } })
  }
})

test('the status tab lists the weather as text', { options: SEOUL }, async ($, on) => {
  stubForecast(on, { status: 200, text: SUNNY })
  const { clock } = await boot($, on)
  await clock.settle()
  const pane = await mountPane($, 'terminal')
  await pane.press({ key: 'tab-status' })
  expect((await pane.find({ type: 'Text', text: '☀ 18°C Seoul' }))?.text).toBe('☀ 18°C Seoul')
  await pane.unmount()
})

// The desktop app's status tab applies a city at once, without a reload (hooks/own-settings.ts): an answer still out
// for the old city is not drawn, and the new city is asked for once it is in.
// Regression: the old city's answer was saved as the shared copy, over another session's copy of the new city.
test('the old city\'s answer is not saved once the city changed, nor told as the new city\'s failure', { options: SEOUL }, async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { weatherPlace: { type: 'string', title: 'City', options: ['off', 'Seoul', 'Busan'], default: 'off' } } })
  on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: manifest } : { deny: 'ENOENT: no such file' }))
  let release = (): void => undefined
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  let asked = 0
  on('http.fetch', async () => {
    asked += 1
    if (asked === 1) await held
    return { value: asked === 1 ? { status: 200, ok: true, headers: {}, text: SUNNY } : { status: 503, ok: false, headers: {}, text: '' } }
  })
  const { calls, clock, store } = await boot($, on, { isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const pane = await mountPane($, 'desktop')
  await pick(pane, 'setting-oh-my-toolbelt.weatherPlace', 'Busan')
  release()
  await clock.settle()
  expect(asked).toBe(2)
  expect(store.get('weatherCache')).toBeUndefined()
  expect(calls.toasts.filter(text => text.includes('weather'))).toHaveLength(1)
  await pane.unmount()
})

test('a city changed while a forecast is out is asked for next, and the old answer is not drawn', { options: SEOUL }, async ($, on) => {
  const manifest = JSON.stringify({ userConfig: { weatherPlace: { type: 'string', title: 'City', options: ['off', 'Seoul', 'Busan'], default: 'off' } } })
  on('fs.read', (_, e) => (isManifestPath(e.path) ? { value: manifest } : { deny: 'ENOENT: no such file' }))
  let release = (): void => undefined
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const urls: string[] = []
  on('http.fetch', async (_, e) => {
    urls.push(e.url)
    if (urls.length === 1) await held
    return { value: { status: 200, ok: true, headers: {}, text: SUNNY } }
  })
  const { clock } = await boot($, on, { isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  expect(urls).toHaveLength(1)
  await runCommand($, 'toolbelt', 'status', 'sdk')
  const pane = await mountPane($, 'desktop')
  await pick(pane, 'setting-oh-my-toolbelt.weatherPlace', 'Busan')
  release()
  await clock.settle()
  expect(urls).toHaveLength(2)
  expect(urls[1]).not.toBe(urls[0])
  const band = await mountBand($, 'desktop', 258)
  const texts = (await band.findAll({ type: 'Text' })).map(node => node.text)
  expect([texts.includes('Busan'), texts.includes('Seoul')]).toEqual([true, false])
  await band.unmount()
  await pane.unmount()
})
