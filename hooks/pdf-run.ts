// PDF export: the html export printed by a Chromium browser the person picked in `pdfBrowser`. No API names the system:
// Windows says so in `OS`, a macOS or Windows app is found by its install paths, and anything else is taken as Linux,
// where the browser runs by its name from PATH, each name tried until one starts.
import { isWindows } from './lib/platform'
import type { Engine } from './runtime'

export const PDF_TIMEOUT_MS = 60_000
const BROWSERS = ['chrome', 'edge', 'brave', 'chromium'] as const
type Browser = (typeof BROWSERS)[number]

const MAC_APPS: Readonly<Record<Browser, string>> = {
  chrome: 'Google Chrome.app/Contents/MacOS/Google Chrome',
  edge: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  brave: 'Brave Browser.app/Contents/MacOS/Brave Browser',
  chromium: 'Chromium.app/Contents/MacOS/Chromium',
}
const WINDOWS_APPS: Readonly<Record<Browser, string>> = {
  chrome: 'Google\\Chrome\\Application\\chrome.exe',
  edge: 'Microsoft\\Edge\\Application\\msedge.exe',
  brave: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  chromium: 'Chromium\\Application\\chrome.exe',
}
const LINUX_NAMES: Readonly<Record<Browser, readonly string[]>> = {
  chrome: ['google-chrome', 'google-chrome-stable'],
  edge: ['microsoft-edge', 'microsoft-edge-stable'],
  brave: ['brave-browser'],
  chromium: ['chromium', 'chromium-browser'],
}

// The browsers a setting asks for, in the order to try: one, or all for `auto`; none for `off` or anything else.
export function browsersOf(setting: unknown): Browser[] {
  if (setting === 'auto') return [...BROWSERS]
  return BROWSERS.filter(browser => browser === setting)
}

// Where to look on this system: the env values that name the install roots.
export type BrowserPlaces = { os: string | undefined; home: string | undefined; programFiles: readonly (string | undefined)[] }

// Every program to try, in order: installed paths on macOS and Windows (to be checked), names on Linux (to be run).
export function browserCandidates(setting: unknown, places: BrowserPlaces): { paths: string[]; names: string[] } {
  const wanted = browsersOf(setting)
  if (isWindows(places.os)) {
    const roots = places.programFiles.filter((root): root is string => root !== undefined && root !== '')
    return { paths: wanted.flatMap(browser => roots.map(root => `${root}\\${WINDOWS_APPS[browser]}`)), names: [] }
  }
  const macRoots = ['/Applications', ...(places.home === undefined ? [] : [`${places.home}/Applications`])]
  return { paths: wanted.flatMap(browser => macRoots.map(root => `${root}/${MAC_APPS[browser]}`)), names: wanted.flatMap(browser => LINUX_NAMES[browser]) }
}

export async function browserPlaces(engine: Engine): Promise<BrowserPlaces> {
  const programFiles = [await engine.env.get('ProgramFiles'), await engine.env.get('ProgramFiles(x86)'), await engine.env.get('LOCALAPPDATA')]
  return { os: await engine.env.get('OS'), home: await engine.env.get('HOME'), programFiles }
}

// A file path as the browser opens it: forward slashes, and the characters a URL reads as its own escaped.
export function fileUrl(path: string, os: string | undefined): string {
  const slashed = isWindows(os) ? `/${path.replace(/\\/g, '/')}` : path
  return `file://${encodeURI(slashed).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
}

export const printArgv = (browser: string, htmlPath: string, pdfPath: string, os: string | undefined): string[] =>
  [browser, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, fileUrl(htmlPath, os)]

// The programs to print with: the installed apps first; on Linux the names, which only running tells apart.
export async function findBrowsers(engine: Engine, setting: unknown, places: BrowserPlaces): Promise<string[]> {
  const { paths, names } = browserCandidates(setting, places)
  const installed = (await Promise.all(paths.map(async path => ((await engine.fs.exists(path)) ? [path] : [])))).flat()
  return installed.length > 0 ? installed.slice(0, 1) : names
}

// `printed` once the file is there; `failed` when a browser ran and made none; `absent` when none would start.
export async function printPdf(engine: Engine, browsers: readonly string[], htmlPath: string, pdfPath: string, os: string | undefined): Promise<'printed' | 'failed' | 'absent'> {
  for (const browser of browsers) {
    const result = await engine.process.run(printArgv(browser, htmlPath, pdfPath, os), { timeoutMs: PDF_TIMEOUT_MS }).catch(() => null)
    if (result === null) continue
    return result.exitCode === 0 && (await engine.fs.exists(pdfPath)) ? 'printed' : 'failed'
  }
  return 'absent'
}
