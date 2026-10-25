// What register.tsx keeps per module load besides `$.state`, and its fixed numbers. It holds no `$`; the one function
// here that calls the engine, `withBandColumns`, takes an `Engine`.
import type { ConfigRow, ConfigSetResult, ConfigValue, EngineInterface, PluginOptions, RenderSurface, SessionMessage, Timer } from 'claude-code'
import type { ClipBoard, ExportFormat, Note } from '../types/index'
import { translator, wordLocale } from './lib/i18n'
import type { ResolvedLanguage } from './lib/i18n'
import type { StoreRead } from './lib/schema'
import { cellsOf } from './lib/width'
import type { Ctx, Snapshot } from './tools/registry'
import type { ThemeRow } from './tools/theme'

export const PANE_ID = 'oh-my-toolbelt'
// A /config row of this mod's `userConfig` is named `<plugin>.<field>`.
export const CONFIG_PREFIX = `${PANE_ID}.`
export const PANE_ROWS = 12
export const TICK_MS = 1000
// Another session may start, pause or stop the shared timer; its copy is picked up this often.
export const SYNC_MS = 60_000
// A burst of new prompts in the table of contents draws the panel again once, this long after the last.
export const TOC_REDRAW_MS = 300
// An export moves on to `-2`, `-3`, … while a name is taken, and gives up after this many.
export const EXPORT_COPIES_MAX = 100
// The toast names a whole path, so it stays longer than the default 4 seconds.
export const EXPORT_TOAST_MS = 8000
// How long after a load its voice mode is set again (register.tsx syncVoiceMode).
export const VOICE_SYNC_MS = 500
// A terminal lists the mod's /config rows about 4 s after start; kept store changes move then.
export const MOVE_SETTINGS_MS = 5000

// A reload loses it and session.start builds it again; /clear keeps it.
export type Runtime = {
  // What the mod runs with: `baseOptions`, the settings file's, with the store's changes (hooks/own-settings.ts).
  options: PluginOptions
  baseOptions: PluginOptions
  isActive: boolean
  // The latest session.start's work, which session.attach waits for so the two never both start the mod.
  starting: Promise<void>
  lang: ResolvedLanguage
  // Names from `$.command.list()`, read at start, after /clear and when the panel opens.
  knownCommands: readonly string[] | null
  // A newer version of the mod wrote the store: read it, never write it.
  isStoreReadOnly: boolean
  // This load registered /tb, so the name is ours to register again after /clear.
  ownsAlias: boolean
  timers: readonly Timer[]
  // A forecast is being asked for, so another ask waits for it; and the failure toast was shown (once per load).
  isFetchingWeather: boolean
  hasWeatherToast: boolean
  // The clock's stand-in for a time zone it could not use was noted (once per load).
  hasClockNote: boolean
  // Each surface's band width as last drawn: the status tab works out from it whether the band shows icons only.
  bandColumns: Partial<Record<RenderSurface, number>>
  // The status tab's versions, read at start; null where either could not be read.
  versions: Versions | null
}

export type Versions = { toolbelt: string; claudeCode: string }

// register.tsx's store calls as a feature module makes them (notes-run.ts, export-run.ts). Each failure is noted in the
// debug log and the status tab; a store a newer version wrote is never written.
export type StoreIo = {
  // A failed read comes back `isRead: false`, never as "unset".
  get: (key: string) => Promise<StoreRead>
  // The re-read before a write, as every session shares the store; a failed one toasts that the save failed.
  fresh: (key: string) => Promise<StoreRead>
  // True once written; `save` is the panel's, which first says that a newer version's store keeps nothing.
  set: (key: string, value: unknown) => Promise<boolean>
  save: (key: string, value: unknown) => Promise<boolean>
  // A call whose failure is noted, `fallback` standing in.
  attempt: <T>(what: string, call: () => Promise<T>, fallback: T) => Promise<T>
}

// One `$.state` atom as a feature module sees it: Claude Code's loader reads `read` and `update` only with an atom that
// is a const of the same file, so register.tsx makes each Cell beside its atom.
export type Cell<T> = { read: () => Promise<T>; update: (change: (value: T) => T) => Promise<T> }

// The engine calls a feature module makes, as register.tsx hands them over (engineOf): the plugin directory lets `$`
// go only to a function of the same file, so every `$.noun.method(...)` call is written in register.tsx, which
// declares the hooks.
export type Engine = {
  // The `$.state` atoms the feature modules use, each read and changed through the file that defines it (register.tsx).
  cells: {
    settings: Cell<ConfigRow[]>
    settingsSource: Cell<'engine' | 'own'>
    themeRow: Cell<ThemeRow | null>
    soundPick: Cell<{ name: string; at: number } | null>
    bandFolded: Cell<boolean>
    clipBoard: Cell<ClipBoard>
    exportFormat: Cell<ExportFormat>
    notes: Cell<Note[]>
    curtain: Cell<boolean>
    tocMoved: Cell<number>
  }
  store: Pick<EngineInterface['store'], 'get' | 'set' | 'delete' | 'keys'>
  env: Pick<EngineInterface['env'], 'get'>
  ui: Pick<EngineInterface['ui'], 'toast' | 'log' | 'selection' | 'invalidate' | 'scroll' | 'resolve'>
  clock: Pick<EngineInterface['clock'], 'now' | 'after'>
  // `messages` and `fs.read` are overloaded in the engine's types; only the plain forms are handed over.
  session: Pick<EngineInterface['session'], 'surfaces' | 'id' | 'version' | 'cwd'> & { messages: () => Promise<SessionMessage[]> }
  prompt: Pick<EngineInterface['prompt'], 'fill'>
  process: Pick<EngineInterface['process'], 'run' | 'spawn'>
  fs: Pick<EngineInterface['fs'], 'exists' | 'write' | 'stat'> & { read: (path: string) => Promise<string> }
  command: Pick<EngineInterface['command'], 'list'>
  audio: Pick<EngineInterface['audio'], 'play'>
  config: Pick<EngineInterface['config'], 'list'> & { write: (key: string, value: ConfigValue) => Promise<ConfigSetResult> }
  plugin: { name: string; root: string }
}

export const initialRuntime = (): Runtime => ({
  options: {}, baseOptions: {}, isActive: false, starting: Promise.resolve(), lang: { lang: 'en', locale: 'en' }, knownCommands: null, isStoreReadOnly: false, ownsAlias: false, timers: [],
  isFetchingWeather: false, hasWeatherToast: false, hasClockNote: false, bandColumns: {}, versions: null,
})

// The band's width on `surface` as just drawn. A new one (a resize, the first band after a reload) draws everything
// again, so a status tab drawn before the band works its note out from this width, not the last.
export function withBandColumns(engine: Engine, known: Runtime['bandColumns'], surface: RenderSurface, columns: number): Runtime['bandColumns'] {
  if (known[surface] === columns) return known
  engine.ui.invalidate('ui.render')
  return { ...known, [surface]: columns }
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export const makeCtx = (runtime: Runtime, surface: RenderSurface, state: Snapshot, now: number): Ctx => ({
  surface, options: runtime.options, state, t: translator(runtime.lang.lang), now, locale: wordLocale(runtime.lang, runtime.options.language), cells: cellsOf,
})
