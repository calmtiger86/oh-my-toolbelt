// Toolbelt's hooks: every hook, the state they read, the effects they run and the timers; the prompts tab, the rows'
// hooks, settings, notes and exports keep their `$` functions in toc-live, toc-history, row-hooks, settings,
// own-settings, notes-run and export-run.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { atom, read, update } from 'claude-code'
import type { CommandInfo, CommandRunInput, CommandRunResult, ConfigValue, EngineInterface, HttpResponse, Register, RenderSurface } from 'claude-code'
import type { ButtonConfig, Layout, PaneTab } from '../types/index'
import { FOLD_ID, UNFOLD_ID, bandModel, drawBand, drawFolded, hidesButtonNames } from './band'
import { draftIssues, drawPane } from './pane'
import type { PaneAction } from './pane'
import type { Effect } from './lib/effects'
import { formatClock, isValidTimeZone } from './lib/format'
import { DEFAULT_ICON_GROUP, asIconGroup, asIcons, iconStyleOf, withToolIcon } from './lib/icons'
import { resolveLanguage, systemLocale, translator } from './lib/i18n'
import type { ResolvedLanguage, TFn } from './lib/i18n'
import { cellsOf } from './lib/width'
import { cleanButtonConfig, defaultButtons, defaultLayout, planLoad } from './lib/schema'
import type { StoreRead } from './lib/schema'
import { clockFormatOptions, clockLabel, configuredTimeZone } from './tools/clock'
import { ARGUMENT_HINT, isHumanOrigin, parseCommand, replyFor } from './tools/command'
import type { PomodoroVerb } from './tools/command'
import { curtainEffects } from './tools/curtain'
import { asPomodoro, idlePomodoro, mergePomodoro, pause, pomodoroConfig, pomodoroEffects, reset, start, stop, tick as advancePomodoro } from './tools/pomodoro'
import { BUTTON_PREFIX, applyLayoutOp, emptySnapshot, isItemShown, normalizeLayout, resetLayout, toolForItem } from './tools/registry'
import type { Ctx } from './tools/registry'
import { isTocTabOn } from './tools/toc'
import { addButton, addSetChange, allButtons, buildButton, defaultButtonConfig, deleteSetChange, draftFor, nextButtonId, pickSetChange, removeButton, setButtonIcon, setDraftField, updateButton } from './tools/user'
import type { SetChange } from './tools/user'
import { asWeatherCache, failedWeather, forecastUrl, isFresh, loadingWeather, newerCache, offWeather, parseForecast, sameTarget, shownWeather, weatherCity, weatherRefreshMs, weatherTarget } from './tools/weather'
import type { WeatherCache, WeatherLook, WeatherTarget } from './tools/weather'
import { EXPORT_TOAST_MS, MOVE_SETTINGS_MS, PANE_ID, PANE_ROWS, SYNC_MS, TICK_MS, VOICE_SYNC_MS, errorText, initialRuntime, makeCtx, withBandColumns } from './runtime'
import type { StoreIo } from './runtime'
import { moveToc, openedAnswer, noteTocView, resetToc, scrollToPrompt, tocBandCards, tocView, viewTocRow, watchToc } from './toc-live'
import { fillTranscript, refillTranscript } from './toc-history'
import { logHookFailure, registerTurns } from './toc-hooks'
import { changeCurtain, isCurtainOn, registerTranscript } from './row-hooks'
import { FOLDED_KEY, isBandFolded, loadFold, setBandFolded } from './fold'
import { clipEffects, deleteClip, isClipsTabOn, noteSelection, readClipBoard, restoreClips } from './clips'
import { exportOutcome, loadExportFormat, readExportFormat, rememberFormat, toastAndAnswer } from './export-run'
import type { ExportEnv } from './export-run'
import { addQuickNote, deleteQuickNote, noteFillEffects, readNotes, syncNotes } from './notes-run'
import { runAttach } from './attach-run'
import { changeSetting, dropSoundPick, listSettings, playPickedSound, previewSound, readSettings, readSettingsSource, readThemeRow, setTheme } from './settings'
import type { SettingChange } from './settings'
import { loadOverrides, moveOverrides, readVersions, saveOverride } from './own-settings'
import { voiceModeOf, voiceModeToSync } from './tools/voice'

const clockLabelState = atom({ plugin: 'oh-my-toolbelt', key: 'clockLabel' } as const, '')
const pomodoroState = atom({ plugin: 'oh-my-toolbelt', key: 'pomodoro' } as const, idlePomodoro(0))
const weatherState = atom({ plugin: 'oh-my-toolbelt', key: 'weather' } as const, offWeather())
const bandHiddenState = atom({ plugin: 'oh-my-toolbelt', key: 'bandHidden' } as const, false)
const paneTabState = atom({ plugin: 'oh-my-toolbelt', key: 'paneTab' } as const, 'tools')
const openPickerState = atom({ plugin: 'oh-my-toolbelt', key: 'openPicker' } as const, null)
const voiceState = atom({ plugin: 'oh-my-toolbelt', key: 'voice' } as const, { isAvailable: false, requested: null })
const paneStartedState = atom({ plugin: 'oh-my-toolbelt', key: 'paneStarted' } as const, false)
const guideSectionState = atom({ plugin: 'oh-my-toolbelt', key: 'guideSection' } as const, 'start')
const buttonsState = atom({ plugin: 'oh-my-toolbelt', key: 'buttons' } as const, defaultButtons())
const layoutState = atom({ plugin: 'oh-my-toolbelt', key: 'layout' } as const, defaultLayout())
const iconsState = atom({ plugin: 'oh-my-toolbelt', key: 'icons' } as const, {})
const iconGroupState = atom({ plugin: 'oh-my-toolbelt', key: 'iconGroup' } as const, DEFAULT_ICON_GROUP)
const editDraftState = atom({ plugin: 'oh-my-toolbelt', key: 'editDraft' } as const, null)
const lastErrorState = atom({ plugin: 'oh-my-toolbelt', key: 'lastError' } as const, null)

// What this module load knows besides `$.state` (hooks/runtime.ts).
let runtime = initialRuntime()
const tr = (): TFn => translator(runtime.lang.lang)

// ---- Failures and the store ----
// The debug log in English, and the status tab's last error in the person's language (a key of the
// language files). A failure to record one has nowhere left to go.
async function noteError($: EngineInterface, key: string, args?: Record<string, unknown>): Promise<void> {
  $.ui.log(`oh-my-toolbelt: ${translator('en')(key, args)}`, { to: 'debug' })
  await update($, lastErrorState, () => tr()(key, args)).catch(() => undefined)
}

// Runs one call on `$`; a failure goes to the debug log and lastError, and `fallback` stands in.
// `call` runs once; a promise already started is waited for the same way. The plugin directory's check follows `$`
// into another file's function only from a plain call, not from inside a function written in the call, so those
// callers pass the started promise. Such a callee must be an async function, so that its throw arrives here as a
// rejection instead of escaping before `attempt` runs.
async function attempt<T>($: EngineInterface, what: string, call: Promise<T> | (() => Promise<T>), fallback: T): Promise<T> {
  try {
    return await (typeof call === 'function' ? call() : call)
  } catch (err) {
    await noteError($, 'error.call', { call: what, reason: errorText(err) })
    return fallback
  }
}

// A failed read comes back `isRead: false`, never as "unset".
function storeGet($: EngineInterface, key: string): Promise<StoreRead> {
  return attempt($, `store.get ${key}`, async (): Promise<StoreRead> => ({ isRead: true, value: await $.store.get(key) }), { isRead: false, value: undefined })
}

// True once written. A read-only store writes nothing; a refused write says so.
async function storeSet($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  if (runtime.isStoreReadOnly) return false
  const isSaved = await attempt($, `store.set ${key}`, () => $.store.set(key, value).then(() => true), false)
  if (!isSaved) $.ui.toast(tr()('toast.saveFailed'))
  return isSaved
}

// The panel saves to the store first and draws after, so a refused save changes nothing on screen.
async function panelSave($: EngineInterface, key: string, value: unknown): Promise<boolean> {
  if (runtime.isStoreReadOnly) $.ui.toast(tr()('status.storeNewer'))
  return storeSet($, key, value)
}

// Re-read before a write, as every session shares the store; a failed re-read stops the save.
async function freshRead($: EngineInterface, key: string): Promise<StoreRead> {
  const stored = runtime.isStoreReadOnly ? { isRead: true, value: undefined } : await storeGet($, key)
  if (!stored.isRead) $.ui.toast(tr()('toast.saveFailed'))
  return stored
}

// The calls above as the feature modules make them (hooks/notes-run.ts, export-run.ts).
function storeIo($: EngineInterface): StoreIo {
  const [get, fresh] = [(key: string) => storeGet($, key), (key: string) => freshRead($, key)]
  return { get, fresh, set: (key, value) => storeSet($, key, value), save: (key, value) => panelSave($, key, value), attempt: (what, call, fallback) => attempt($, what, call, fallback) }
}

// The buttons to change: the store's, else this session's; null when the re-read failed.
async function freshButtons($: EngineInterface): Promise<ButtonConfig | null> {
  const stored = await freshRead($, 'buttons')
  return stored.isRead ? (cleanButtonConfig(stored.value) ?? read($, buttonsState)) : null
}

// Copies the store into `$.state`: at start, and after /clear, /resume and /branch reset the state.
async function loadStore($: EngineInterface): Promise<void> {
  // First, so a band drawn after /clear meanwhile is not drawn unfolded.
  await attempt($, 'store.get bandFolded', loadFold($), undefined)
  await attempt($, 'clipboard restore', restoreClips($), undefined)
  const [version, buttons, layout] = [await storeGet($, 'schemaVersion'), await storeGet($, 'buttons'), await storeGet($, 'layout')]
  const plan = planLoad(version, buttons, layout, defaultButtonConfig(tr()), runtime.isStoreReadOnly)
  const snapshot = plan.snapshot
  runtime = { ...runtime, isStoreReadOnly: plan.isReadOnly }
  if (plan.isReadOnly) await noteError($, 'status.storeNewer')
  // The version goes last, so a write that fails halfway is tried again at the next start.
  if (plan.shouldWrite) for (const key of ['buttons', 'layout', 'schemaVersion'] as const) await storeSet($, key, snapshot[key])
  const normalized = normalizeLayout(snapshot.layout, { state: { buttons: snapshot.buttons } })
  const pomodoro = asPomodoro((await storeGet($, 'pomodoro')).value)
  const isHidden = (await storeGet($, 'bandHidden')).value === true
  const icons = await storeGet($, 'icons')
  await update($, buttonsState, () => snapshot.buttons)
  await update($, layoutState, () => normalized)
  await update($, pomodoroState, current => mergePomodoro(current, pomodoro))
  await update($, bandHiddenState, () => isHidden)
  await loadExportFormat($, storeIo($))
  if (icons.isRead) await update($, iconsState, () => asIcons(icons.value))
}

// ---- Clock and pomodoro: state is written only when the drawn text changes ----
async function refreshClock($: EngineInterface, now: number): Promise<void> {
  const { text, degraded } = clockLabel(now, clockFormatOptions(runtime.options, runtime.lang.locale), formatClock)
  if (text === (await read($, clockLabelState))) return
  await update($, clockLabelState, () => text)
  // Intl failed and the local time stands in: the status tab says so, once a load, and a later error stays shown.
  if (!degraded || runtime.hasClockNote) return
  runtime = { ...runtime, hasClockNote: true }
  await noteError($, 'clock.noTimeZone')
}

async function refreshPomodoro($: EngineInterface, now: number): Promise<void> {
  const current = await read($, pomodoroState)
  const result = advancePomodoro(current, now, { config: pomodoroConfig(runtime.options), t: tr() })
  if (result.state === current) return
  if (result.ended === null) return void (await update($, pomodoroState, latest => (latest.updatedAt === current.updatedAt ? result.state : latest)))
  // Each session sees the end; one finding a newer copy saved takes it and only toasts (notify and sound once).
  const stored = asPomodoro((await storeGet($, 'pomodoro')).value)
  if (stored === null || stored.updatedAt <= current.updatedAt) return runEffects($, [...pomodoroEffects(result.state), ...result.effects])
  await update($, pomodoroState, () => stored)
  await runEffects($, result.effects.filter(effect => effect.kind === 'ui.toast'))
}

async function tick($: EngineInterface): Promise<void> {
  const now = await attempt($, 'clock.now', () => $.clock.now(), null)
  if (now === null) return
  await attempt($, 'clock tick', () => refreshClock($, now), undefined)
  await attempt($, 'pomodoro tick', () => refreshPomodoro($, now), undefined)
  if (runtime.isActive && isClipsTabOn(runtime.options)) await attempt($, 'clipboard tick', noteSelection($, now), undefined)
}

async function syncPomodoro($: EngineInterface): Promise<void> {
  const current = await read($, pomodoroState)
  const merged = mergePomodoro(current, asPomodoro((await storeGet($, 'pomodoro')).value))
  if (merged !== current) await update($, pomodoroState, latest => mergePomodoro(latest, merged))
}

// The timer as a press or a command sees it: this session's copy or a newer saved one.
async function currentPomodoro($: EngineInterface) {
  return mergePomodoro(await read($, pomodoroState), asPomodoro((await storeGet($, 'pomodoro')).value))
}

async function changePomodoro($: EngineInterface, verb: PomodoroVerb): Promise<void> {
  const now = await $.clock.now()
  const current = await currentPomodoro($)
  const config = pomodoroConfig(runtime.options)
  const next = verb === 'start' ? start(current, now, config) : verb === 'pause' ? pause(current, now) : verb === 'reset' ? reset(now) : stop(current, now)
  await runEffects($, pomodoroEffects(next))
}

// A reload drops the old module's timers; one left from an earlier start in this module is cancelled.
function startTimers($: EngineInterface): void {
  for (const timer of runtime.timers) timer.cancel()
  const timers = [
    $.clock.every(TICK_MS, () => void tick($)),
    $.clock.every(SYNC_MS, () => void attempt($, 'pomodoro sync', () => syncPomodoro($), undefined)),
    ...(weatherCity(runtime.options) === null ? [] : [$.clock.every(weatherRefreshMs(runtime.options), () => askWeatherInBackground($))]),
  ]
  runtime = { ...runtime, timers }
}

// ---- Weather: one city's forecast, saved in the store and drawn from `$.state` ----
const weatherLook = (): WeatherLook => ({ t: tr(), locale: runtime.lang.locale, style: iconStyleOf(runtime.options.iconStyle) === 'label' ? 'text' : 'emoji' })

// The one request this mod makes: the coordinates and the unit, nothing the person wrote.
function fetchWeather($: EngineInterface, target: WeatherTarget): Promise<HttpResponse | null> {
  return attempt($, 'http.fetch', (): Promise<HttpResponse | null> => $.http.fetch(forecastUrl(target), { headers: { Accept: 'application/json' } }), null)
}

// `☁ --` for a failed ask, and a toast once per load; the next period asks again.
async function weatherFailed($: EngineInterface, why: string): Promise<void> {
  await noteError($, 'error.call', { call: 'weather forecast', reason: why })
  await update($, weatherState, () => failedWeather(weatherLook()))
  if (runtime.hasWeatherToast) return
  runtime = { ...runtime, hasWeatherToast: true }
  $.ui.toast(tr()('toast.weatherFailed'))
}

async function askWeather($: EngineInterface, target: WeatherTarget): Promise<void> {
  await update($, weatherState, loadingWeather)
  const reply = await fetchWeather($, target)
  // A city or unit changed while the ask was out: its answer is no one's, neither saved over the new city's copy nor
  // drawn nor told as a failure; refreshWeather asks for the new one next.
  if (!sameTarget(target, weatherTarget(runtime.options))) return
  const current = reply?.ok === true ? parseForecast(reply.text) : null
  if (current === null) return weatherFailed($, reply === null ? 'request failed' : reply.ok ? 'answer unreadable' : `answered ${reply.status}`)
  const mine: WeatherCache = { ...target, fetchedAt: await $.clock.now(), current }
  // Every session shares the saved copy: read it again just before the write and keep a newer one for this city.
  const kept = newerCache(mine, asWeatherCache((await storeGet($, 'weatherCache')).value))
  if (kept === mine && !runtime.isStoreReadOnly) await attempt($, 'store.set weatherCache', () => $.store.set('weatherCache', mine), undefined)
  await update($, weatherState, () => shownWeather(kept, weatherLook()))
}

// One ask at a time: a second one wanted while another is out (a start with a /clear, a command) is dropped.
async function refreshWeather($: EngineInterface): Promise<void> {
  const target = weatherTarget(runtime.options)
  if (target === null || runtime.isFetchingWeather) return
  runtime = { ...runtime, isFetchingWeather: true }
  try {
    await askWeather($, target)
  } finally {
    runtime = { ...runtime, isFetchingWeather: false }
  }
  if (!sameTarget(target, weatherTarget(runtime.options))) await refreshWeather($)
}

// A slow network must not hold a hook, a timer or a command, so nothing waits for the ask.
function askWeatherInBackground($: EngineInterface): void {
  void attempt($, 'weather refresh', () => refreshWeather($), undefined)
}

// At start and after /clear: a saved forecast for this city and unit that is young enough is drawn as it is, else a
// new one is asked for. ponytail: the timer's first ask is a whole period after the start, so a forecast taken from
// the store can grow to twice the period; schedule that ask at the saved copy's expiry if that matters.
async function loadWeather($: EngineInterface): Promise<void> {
  const target = weatherTarget(runtime.options)
  if (target === null) return void (await update($, weatherState, () => offWeather()))
  const saved = asWeatherCache((await storeGet($, 'weatherCache')).value)
  if (isFresh(saved, target, await $.clock.now(), weatherRefreshMs(runtime.options))) {
    return void (await update($, weatherState, () => shownWeather(saved, weatherLook())))
  }
  // A city changed in /config must not keep the old city's label while the new one is on its way.
  await update($, weatherState, () => loadingWeather(offWeather()))
  askWeatherInBackground($)
}

// ---- Session start, language and commands ----
async function resolveLang($: EngineInterface): Promise<ResolvedLanguage> {
  const setting = typeof runtime.options.language === 'string' ? runtime.options.language : 'auto'
  const env = await attempt($, 'env.get', async () => [await $.env.get('LC_ALL'), await $.env.get('LC_MESSAGES'), await $.env.get('LANG')], [])
  return resolveLanguage(setting, env, systemLocale())
}

async function listCommands($: EngineInterface): Promise<CommandInfo[] | null> {
  const list = await attempt($, 'command.list', (): Promise<CommandInfo[] | null> => $.command.list(), null)
  if (list !== null) runtime = { ...runtime, knownCommands: list.map(command => command.name) }
  if (list !== null) await update($, voiceState, voice => ({ ...voice, isAvailable: list.some(command => command.name === 'voice') }))
  return list
}

// The status tab's settings (hooks/settings.ts), a failed read keeping the last; kept store changes go to /config.
// A change /config refused or a locked row holds is named, and the mod runs with /config's value again.
async function refreshSettings($: EngineInterface): Promise<void> {
  await attempt($, 'config.list', listSettings($, runtime.options), undefined)
  const rows = await readSettings($)
  if (runtime.isStoreReadOnly || rows.length === 0 || (await readSettingsSource($)) !== 'engine') return
  const result = await attempt($, 'settings move', moveOverrides($, runtime.baseOptions, rows), { refused: [], moved: 0, failed: [] })
  // One that failed stays in the store for the next try, and the status tab says why.
  if (result.failed.length > 0) await noteError($, 'error.call', { call: 'settings move', reason: result.failed.join('; ') })
  if (result.refused.length === 0) return
  $.ui.toast(tr()('toast.settingsNotMoved', { names: result.refused.join(', ') }))
  // A change written to /config reloads the module, which applies the settings again; with none written, it is done here.
  if (result.moved === 0) await applySettings($)
}

async function pickSetting($: EngineInterface, key: string, value: string): Promise<void> {
  await previewSound($, key, value)
  let change: SettingChange
  try {
    change = await changeSetting($, key, value, runtime.options)
  } catch (err) {
    await dropSoundPick($)
    throw err
  }
  if (change.kind === 'own') return saveOwnSetting($, change.field, change.value)
  if (change.kind !== 'denied') return
  await dropSoundPick($)
  return $.ui.toast(tr()('toast.settingRefused', { reason: change.reason }))
}

// A change to the mod's own rows (hooks/own-settings.ts): kept first, then applied as a load applies one, as no reload
// follows. A prompts tab turned on reads the conversation again: nothing noted it while the tab was off.
async function saveOwnSetting($: EngineInterface, field: string, value: ConfigValue): Promise<void> {
  const saving = runtime.isStoreReadOnly ? null : saveOverride($, runtime.baseOptions, field, value)
  const isSaved = saving !== null && (await attempt($, 'settings save', saving.then(() => true), false))
  if (!isSaved) return void (await dropSoundPick($), $.ui.toast(tr()(runtime.isStoreReadOnly ? 'status.storeNewer' : 'toast.saveFailed')))
  const wasToc = isTocLive()
  await applySettings($)
  if (!wasToc && isTocLive()) await refillTranscript($, !runtime.isStoreReadOnly)
  // As a start says it after a /config change.
  if (field === 'timeZone') warnBadTimeZone($)
}

// A zone this computer's clock data lacks draws the clock in the computer's own zone.
function warnBadTimeZone($: EngineInterface): void {
  const zone = configuredTimeZone(runtime.options)
  if (zone !== '' && !isValidTimeZone(zone)) $.ui.toast(tr()('clock.badTimeZone', { zone }))
}

// /toolbelt always; /tb only while no one else owns that name. Registering a name again replaces it.
async function registerCommands($: EngineInterface): Promise<void> {
  const t = tr()
  const list = await listCommands($)
  await refreshSettings($)
  // immediate: typed while a turn runs, /toolbelt runs at once (it used to reach the model instead).
  // Its hook keeps to the mod's own state, not the turn's, as the flag asks.
  const main = () => $.command.register({ name: 'toolbelt', description: t('command.description'), argumentHint: ARGUMENT_HINT, immediate: true })
  await attempt($, 'command.register toolbelt', main, undefined)
  const owner = list?.find(command => command.name === 'tb')
  if (owner !== undefined && owner.plugin !== 'oh-my-toolbelt' && !runtime.ownsAlias) return
  const alias = () => $.command.register({ name: 'tb', description: t('command.aliasDescription'), argumentHint: ARGUMENT_HINT, immediate: true })
  // Awaited before `runtime` is spread, so a start and a /clear running together keep each other's fields.
  const ownsAlias = await attempt($, 'command.register tb', () => alias().then(() => true), false)
  runtime = { ...runtime, ownsAlias }
}

// Timers first, so a failure below cannot leave the clock and the pomodoro stopped. After /clear this
// also revives a timer whose period the host refused; the old handles are cancelled first.
async function reloadSession($: EngineInterface): Promise<void> {
  startTimers($)
  await loadStore($)
  await syncNotes($, storeIo($))
  await refreshClock($, await $.clock.now())
  await registerCommands($)
  await attempt($, 'weather load', () => loadWeather($), undefined)
}

// A voice mode changed in the status tab or /config takes over at once while the voice this mod turned on is on: the
// change reloads the module, which stops what the old load had begun (the sound), so the new load runs /voice <mode>,
// from a timer as the band's buttons and timers run commands. Only when the mode differs.
async function syncVoiceMode($: EngineInterface): Promise<void> {
  const mode = voiceModeToSync(await read($, voiceState), voiceModeOf(runtime.options.voiceMode))
  if (mode !== null) $.clock.after(VOICE_SYNC_MS, () => attempt($, 'voice sync', () => runEffect($, { kind: 'voice', next: mode }), undefined))
}

// A load's work with the settings, done again by a change to the mod's own rows; returns how many store changes stand.
async function applySettings($: EngineInterface): Promise<number> {
  const kept = await attempt($, 'settings load', loadOverrides($, runtime.baseOptions), { options: runtime.baseOptions, count: 0 })
  runtime = { ...runtime, options: kept.options }
  const lang = await resolveLang($)
  runtime = { ...runtime, lang }
  await reloadSession($)
  // The band and the panel draw from the options, which no state they read follows (a changed icon style did not show).
  $.ui.invalidate('ui.render')
  // Neither may keep the session from starting.
  await attempt($, 'sound pick', playPickedSound($), undefined)
  await attempt($, 'voice sync', () => syncVoiceMode($), undefined)
  return kept.count
}

// A reload in the desktop app (a settings file change) starts again with isInteractive false and no surface, the desktop
// still attached (in the real engine the toolbelt vanished), so the attached surfaces count too.
async function startIfActive($: EngineInterface, e: { isInteractive: boolean; surface: RenderSurface | null }): Promise<void> {
  const isActive = e.isInteractive || e.surface !== null || (await $.session.surfaces()).length > 0
  runtime = { ...runtime, isActive }
  if (isActive) await startSession($)
}

async function startSession($: EngineInterface): Promise<void> {
  // ponytail: kept store changes go to /config one look later (rows list ~4 s on); a slower load leaves them to the panel
  if ((await applySettings($)) > 0 && (await $.session.surfaces()).includes('terminal')) $.clock.after(MOVE_SETTINGS_MS, () => void attempt($, 'settings refresh', () => refreshSettings($), undefined))
  warnBadTimeZone($)
  // Not a failure the status tab names: the versions line is left out.
  const versions = await readVersions($).catch((err: unknown) => ($.ui.log(`oh-my-toolbelt: versions unread: ${errorText(err)}`, { to: 'debug' }), null))
  runtime = { ...runtime, versions }
  if (runtime.options.paneOpenOnStart === true) await openPaneAtStart($)
  // The prompts sent before this load, from the transcript file a SessionStart or the store names.
  if (isTocTabOn(runtime.options)) await fillTranscript($, !runtime.isStoreReadOnly)
}

// ---- Effects: the one place a tool's wish becomes a `$` call ----
// True when the command ran; a refusal says why in a toast.
async function runCommand($: EngineInterface, command: string, args: string | undefined): Promise<boolean> {
  const ran = await attempt($, `command.run ${command}`, () => $.command.run({ command, ...(args === undefined ? {} : { args }) }), null)
  if (ran !== null) return true
  const known = runtime.knownCommands
  $.ui.toast(tr()(known !== null && !known.includes(command) ? 'toast.commandMissing' : 'toast.commandRejected', { command }))
  return false
}

// A second press of the button that opened a tab closes the panel; from another tab it moves to this one.
async function togglePane($: EngineInterface, tab: PaneTab): Promise<void> {
  const panes = await attempt($, 'ui.panes', () => $.ui.panes(), [])
  if (!panes.some(pane => pane.id === PANE_ID && pane.isShown)) return openPane($, tab)
  if ((await read($, paneTabState)) === tab) return $.ui.close({ id: PANE_ID })
  // Opened again, not only switched, so it asks for the keys as a first open does (notes pressed over another tab used
  // to leave the cursor in the prompt box).
  return openPane($, tab)
}

// The notes tab shows what the store holds now: another session may have saved a note since this one read them.
async function showTab($: EngineInterface, tab: PaneTab): Promise<void> {
  if (tab === 'notes') await syncNotes($, storeIo($))
  await update($, openPickerState, () => null)
  await update($, paneTabState, () => tab)
}

async function openPane($: EngineInterface, tab: PaneTab): Promise<void> {
  await showTab($, tab)
  await listCommands($)
  await refreshSettings($)
  const placed = await $.ui.open({ id: PANE_ID, title: tr()('pane.title'), focus: true, closeOnEscape: true, rows: PANE_ROWS })
  if (!placed.isPlaced) await noteError($, 'error.paneNotPlaced', { reason: placed.reason })
  // The desktop app gives the keys to the panel but not to its autoFocus field, so notes move them.
  else if (tab === 'notes') await attempt($, 'ui.focus', () => $.ui.focus({ requestId: PANE_ID, key: 'note-input' }), undefined)
}

// Asks for no keyboard focus, and shows the contents tab when there is one. An unrequested pane waits for a wide
// screen, so `isPlaced: false` is not worth a word. A reload starts the session again but keeps `$.state`, so the panel
// opens once a run: a tab moved to, or a panel closed, stays as the person left it.
async function openPaneAtStart($: EngineInterface): Promise<void> {
  if (await read($, paneStartedState)) return
  await update($, paneStartedState, () => true)
  await update($, paneTabState, () => (isTocTabOn(runtime.options) ? 'toc' : 'tools'))
  await attempt($, 'ui.open', () => $.ui.open({ id: PANE_ID, title: tr()('pane.title'), rows: PANE_ROWS }), null)
}

async function runEffect($: EngineInterface, effect: Effect): Promise<void> {
  const t = tr()
  switch (effect.kind) {
    case 'prompt.fill':
      return (await $.prompt.fill({ text: effect.text, mode: effect.mode })).isFilled ? undefined : $.ui.toast(t('toast.fillRejected'))
    case 'prompt.submit': {
      const sent = await $.prompt.submit({ text: effect.text, ...(effect.asUser ? { asUser: true as const } : {}) })
      if (sent.drop !== undefined) return $.ui.toast(t('toast.promptRejected'))
      // The send button's prompt is the person's words (`asUser`), so curtainRestoreOnSubmit lowers the curtain for it
      // as for one typed. 2.1.310 runs none of this mod's prompt.submit or ui.render hooks on its own submit (only
      // session.append, where the prompts tab lists it), so it is judged here.
      if (effect.asUser && runtime.options.curtainRestoreOnSubmit === true) await changeCurtain($, () => false)
      return
    }
    case 'command.run': return void (await runCommand($, effect.command, effect.args))
    // The button follows a /voice that ran; one refused goes for this session.
    case 'voice': {
      const ran = await runCommand($, 'voice', effect.next)
      // /voice only turns voice on; Space records, so the toast says how, for the mode.
      if (ran && effect.next !== 'off') $.ui.toast(t(`toast.voiceOn.${effect.next}`), { timeoutMs: EXPORT_TOAST_MS })
      return void (await update($, voiceState, voice => (ran ? { ...voice, requested: effect.next } : { ...voice, isAvailable: false })))
    }
    // Only the theme button sets a /config row through an effect.
    case 'config.set': {
      if (effect.key !== 'theme') return noteError($, 'error.effectUnavailable', { effect: `config.set ${effect.key}` })
      const deny = await setTheme($, String(effect.value))
      return deny === undefined ? undefined : $.ui.toast(t('toast.themeRefused', { reason: deny }))
    }
    case 'ui.open': return openPane($, effect.tab)
    case 'ui.toggle': return togglePane($, effect.tab)
    case 'ui.close': return $.ui.close({ id: PANE_ID })
    case 'ui.toast': return $.ui.toast(effect.text, effect.timeoutMs === undefined ? {} : { timeoutMs: effect.timeoutMs })
    // Raised alone: the tool adds a toast for a bell without text or a desktop without a channel.
    case 'notify':
      return void (await $.ui.notify(effect.text, effect.title === undefined ? {} : { title: effect.title }))
    // A sound that cannot play (not macOS, no file) stays quiet.
    case 'audio.play':
      return $.audio.play({ asset: effect.asset }).catch(() => undefined)
    case 'state.update':
      if (effect.key === 'curtain') return void (await changeCurtain($, value => effect.fn(value) === true))
      if (effect.key !== 'pomodoro') return noteError($, 'error.effectUnavailable', { effect: `state.update ${effect.key}` })
      return void (await update($, pomodoroState, value => asPomodoro(effect.fn(value)) ?? value))
    case 'store.set': return void (await storeSet($, effect.key, effect.value))
    case 'export': return $.ui.toast(await exportOutcome($, storeIo($), exportEnv(), effect.format), { timeoutMs: EXPORT_TOAST_MS })
    case 'attach': return runAttach($, t)
    case 'log': return $.ui.log(effect.text, { to: 'debug' })
    // A kind added to Effect without a case fails to compile here, and one that reaches it anyway leaves a line why.
    default: {
      const unhandled: never = effect
      return noteError($, 'error.effectUnavailable', { effect: String((unhandled as { kind?: unknown }).kind) })
    }
  }
}

async function runEffects($: EngineInterface, effects: readonly Effect[]): Promise<void> {
  for (const effect of effects) await attempt($, effect.kind, () => runEffect($, effect), undefined)
}

// ---- Presses and the panel: a press reads state now, never what a drawing captured ----
async function pressItem($: EngineInterface, id: string, surface: RenderSurface): Promise<void> {
  if (id === FOLD_ID || id === UNFOLD_ID) return void (await setBandFolded($, id === FOLD_ID), await storeSet($, FOLDED_KEY, id === FOLD_ID))
  const state = { ...emptySnapshot(), buttons: await read($, buttonsState), layout: await read($, layoutState), pomodoro: await currentPomodoro($), curtain: await isCurtainOn($), themeRow: await readThemeRow($), voice: await read($, voiceState) }
  const ctx = makeCtx(runtime, surface, state, await $.clock.now())
  await runEffects($, toolForItem(id, ctx)?.onPress?.(ctx, { surface }) ?? [])
}

// True once the changed layout is saved; until then nothing changes.
async function changeLayout($: EngineInterface, surface: RenderSurface, change: (layout: Layout, ctx: Ctx) => Layout, buttons?: ButtonConfig): Promise<boolean> {
  const current = buttons ?? (await freshButtons($))
  const stored = current === null ? null : await freshRead($, 'layout')
  if (current === null || stored === null || !stored.isRead) return false
  const base = normalizeLayout(stored.value === undefined ? await read($, layoutState) : stored.value, { state: { buttons: current } })
  const shownBy = { themeRow: await readThemeRow($), voice: await read($, voiceState) }
  const next = change(base, makeCtx(runtime, surface, { ...emptySnapshot(), buttons: current, layout: base, ...shownBy }, await $.clock.now()))
  if (!(await panelSave($, 'layout', next))) return false
  await update($, layoutState, () => next)
  return true
}

// A pick from a layout row's icon list: a fixed tool's goes to the shared `icons`, a button's into its own `icon`.
async function changeIcon($: EngineInterface, surface: RenderSurface, id: string, value: string): Promise<void> {
  if (id.startsWith(BUTTON_PREFIX)) {
    const buttons = await freshButtons($)
    const next = buttons === null ? null : setButtonIcon(buttons, id.slice(BUTTON_PREFIX.length), value)
    if (next !== null) await saveButtons($, surface, next)
    return
  }
  const stored = await freshRead($, 'icons')
  const next = stored.isRead ? withToolIcon(asIcons(stored.value), id, value) : null
  if (next !== null && (await panelSave($, 'icons', next))) await update($, iconsState, () => next)
}

// Saving buttons also tidies the layout: a new button joins the right end, a deleted one leaves.
// True once the buttons are saved; a tidy that fails is done again by the next load.
async function saveButtons($: EngineInterface, surface: RenderSurface, next: ButtonConfig): Promise<boolean> {
  if (!(await panelSave($, 'buttons', next))) return false
  await update($, buttonsState, () => next)
  await changeLayout($, surface, layout => layout, next)
  return true
}

async function saveDraft($: EngineInterface, surface: RenderSurface): Promise<void> {
  const draft = await read($, editDraftState)
  const buttons = draft === null ? null : await freshButtons($)
  if (draft === null || buttons === null) return
  const first = draftIssues(draft, buttons, runtime.knownCommands).errors[0]
  if (first !== undefined) return $.ui.toast(tr()(first.key, first.args))
  const id = draft.id
  const isEdit = id !== undefined && allButtons(buttons).some(b => b.id === id)
  const button = buildButton(draft, isEdit ? id : nextButtonId(buttons, await $.clock.now()))
  if (!(await saveButtons($, surface, isEdit ? updateButton(buttons, button) : addButton(buttons, button)))) return
  await update($, editDraftState, () => null)
  $.ui.toast(tr()('toast.buttonSaved'))
}

async function deleteButton($: EngineInterface, surface: RenderSurface, id: string): Promise<void> {
  const buttons = await freshButtons($)
  if (buttons === null || !(await saveButtons($, surface, removeButton(buttons, id)))) return
  await update($, editDraftState, draft => (draft?.id === id ? null : draft))
  $.ui.toast(tr()('toast.buttonDeleted'))
}

// Sets: tools/user.ts decides what a press changes and says; the save closes an open form.
// True when the sets changed and were saved.
async function changeSets($: EngineInterface, surface: RenderSurface, plan: (buttons: ButtonConfig) => SetChange): Promise<boolean> {
  const buttons = await freshButtons($)
  if (buttons === null) return false
  const { next, say } = plan(buttons)
  if (next !== undefined && !(await saveButtons($, surface, next))) return false
  if (next !== undefined) await update($, editDraftState, () => null)
  if (say !== undefined) $.ui.toast(tr()(say.key, say.args))
  return next !== undefined
}

async function runPaneAction($: EngineInterface, action: PaneAction, surface: RenderSurface): Promise<void> {
  switch (action.kind) {
    case 'tab': return showTab($, action.tab)
    case 'press': return pressItem($, action.id, surface)
    case 'toc.go': return scrollToPrompt($, action.requestId, tr())
    case 'toc.view': return action.op === 'export' ? exportAnswer($) : viewTocRow($, action.op, action.key, tr())
    case 'note.add': return addQuickNote($, storeIo($), action.text, tr())
    case 'note.fill': return runEffects($, await noteFillEffects($, action.id))
    case 'note.delete': return deleteQuickNote($, storeIo($), action.id)
    case 'clip.fill': return runEffects($, await clipEffects($, action.id, tr()('toast.clipGone')))
    case 'clip.delete': return deleteClip($, action.id)
    case 'export.format': return rememberFormat($, storeIo($), action.format)
    case 'layout':
      return void (await changeLayout($, surface, (layout, ctx) => applyLayoutOp(layout, action.op, action.id, id => isItemShown(id, ctx))))
    case 'layout.reset':
      if (await changeLayout($, surface, (_, ctx) => resetLayout(ctx.state.buttons))) $.ui.toast(tr()('toast.layoutReset'))
      return
    case 'icon.set': return changeIcon($, surface, action.id, action.value)
    case 'icon.group': return void (await update($, iconGroupState, () => asIconGroup(action.group)))
    case 'button.delete': return deleteButton($, surface, action.id)
    case 'draft.open': {
      const draft = draftFor(await read($, buttonsState), action.id)
      await update($, openPickerState, () => null)
      return void (await update($, editDraftState, () => draft))
    }
    case 'draft.field':
      return void (await update($, editDraftState, draft => (draft === null ? null : setDraftField(draft, action.field, action.value))))
    case 'draft.save': return saveDraft($, surface)
    case 'draft.cancel': return void (await Promise.all([update($, editDraftState, () => null), update($, openPickerState, () => null)]))
    case 'set.pick': return void (await changeSets($, surface, buttons => pickSetChange(buttons, action.name)))
    // The name field closes once the set is made; a refused name keeps it open, the toast saying why.
    case 'set.add': return void ((await changeSets($, surface, buttons => addSetChange(buttons, action.name, cellsOf))) && (await update($, openPickerState, () => null)))
    case 'set.delete': return void (await changeSets($, surface, deleteSetChange))
    case 'setting.set': return pickSetting($, action.key, action.value)
    case 'guide.section': return void (await update($, guideSectionState, () => action.section))
    case 'picker.open': return void (await update($, openPickerState, () => action.key))
    case 'pomodoro': return changePomodoro($, action.verb).then(() => $.ui.toast(tr()(`command.pomodoro.${action.verb}`)))
  }
}

// ---- The prompts tab: hooks/toc-live.ts keeps the table, the turns and where the person reads ----
const isTocLive = (): boolean => runtime.isActive && isTocTabOn(runtime.options)

// ---- Export (hooks/export-run.ts): the settings it writes with, and the desktop app's opened prompt row's answer ----
const exportEnv = (): ExportEnv => ({ t: tr(), lang: runtime.lang.lang, clock: clockFormatOptions(runtime.options, runtime.lang.locale), exportDirectory: runtime.options.exportDirectory, pdfBrowser: runtime.options.pdfBrowser })

async function exportAnswer($: EngineInterface): Promise<void> {
  const only = await openedAnswer($)
  if (only !== null) $.ui.toast(await exportOutcome($, storeIo($), exportEnv(), undefined, only), { timeoutMs: EXPORT_TOAST_MS })
}

// ---- /toolbelt and /tb ----
async function runToolbelt($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  const t = tr()
  const command = parseCommand(e.args)
  if (command.op === 'toc') return moveToc($, command.move, tr(), isTocLive())
  if (command.op === 'open') await openPane($, command.tab)
  const isPersonOnly = command.op === 'band' || command.op === 'curtain' || command.op === 'export'
  if (isPersonOnly && !isHumanOrigin(e.origin)) return { text: `${t('command.error.humanOnly')} ${t('command.usage')}` }
  if (command.op === 'export') return toastAndAnswer($, await exportOutcome($, storeIo($), exportEnv(), command.format))
  if (command.op === 'band') {
    await update($, bandHiddenState, () => command.isHidden)
    await storeSet($, 'bandHidden', command.isHidden)
  }
  // The curtain flips through the band button's effects; asked for the state it is in, it changes and toasts nothing.
  if (command.op === 'curtain' && command.isOn !== (await isCurtainOn($))) await runEffects($, curtainEffects(command.isOn, t))
  if (command.op === 'pomodoro') await changePomodoro($, command.verb)
  if (command.op === 'weather') {
    if (weatherCity(runtime.options) === null) return { text: t('command.weather.off') }
    askWeatherInBackground($)
  }
  const text = replyFor(command, t)
  return text === undefined ? {} : { text }
}

// ---- Drawing reads: each site reads only what it draws, so it redraws only for that ----
async function bandCtx($: EngineInterface, surface: RenderSurface): Promise<Ctx> {
  const [clockLabel, pomodoro] = [await read($, clockLabelState), await read($, pomodoroState)]
  const [weather, buttons, layout] = [await read($, weatherState), await read($, buttonsState), await read($, layoutState)]
  const [curtain, icons, themeRow, voice] = [await isCurtainOn($), await read($, iconsState), await readThemeRow($), await read($, voiceState)]
  // The band carries the prompts' cards, so it draws again as the prompts tab does.
  if (isTocTabOn(runtime.options)) await watchToc($)
  return makeCtx(runtime, surface, { ...emptySnapshot(), clockLabel, pomodoro, weather, buttons, layout, curtain, icons, themeRow, voice }, await $.clock.now())
}

async function paneCtx($: EngineInterface, surface: RenderSurface): Promise<Ctx> {
  const paneTab = await read($, paneTabState)
  // The prompts tab draws again as where the person reads or a turn changes (toc-live's count).
  if (paneTab === 'toc') await watchToc($)
  // Only the status tab draws the clock, the weather, the timer, the curtain button and the export format, and only
  // the notes tab the notes, so each redraws only as its own values change.
  const live = paneTab === 'status'
    ? { clockLabel: await read($, clockLabelState), weather: await read($, weatherState), pomodoro: await read($, pomodoroState), curtain: await isCurtainOn($), exportFormat: await readExportFormat($) }
    : paneTab === 'notes' ? { notes: await readNotes($) }
    : paneTab === 'clips' ? { clipBoard: await readClipBoard($) }
    : paneTab === 'guide' ? { guideSection: await read($, guideSectionState) } : {}
  const [buttons, layout] = [await read($, buttonsState), await read($, layoutState)]
  const [editDraft, lastError] = [await read($, editDraftState), await read($, lastErrorState)]
  // Whether the theme and voice buttons exist: the status tab lists them and the tools tab lays them out.
  const [themeRow, voice] = [await readThemeRow($), await read($, voiceState)]
  const [icons, iconGroup, openPicker] = [await read($, iconsState), await read($, iconGroupState), await read($, openPickerState)]
  return makeCtx(runtime, surface, { ...emptySnapshot(), ...live, paneTab, buttons, layout, icons, iconGroup, openPicker, editDraft, lastError, themeRow, voice }, await $.clock.now())
}

export const register: Register = (on, options) => {
  runtime = { ...runtime, options, baseOptions: options }

  // `claude -p` and SDK hosts get nothing: no command, no timer, no drawing.
  on('session.start', async ($, e, next) => {
    const starting = startIfActive($, e)
    runtime = { ...runtime, starting }
    await starting
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'session.start', next.error), next(e)))

  // The desktop app hosts its Code tab's sessions through the SDK, so they start with isInteractive false and no
  // surface (d.ts SessionStartInput); a person is there once a surface attaches (without this, /toolbelt was missing in
  // the desktop app). The mod starts then, once; a -p run, which attaches nothing, stays off. A start still asking for
  // the surfaces decides first, so the two cannot both start it, nor that start turn it off; it logs its own failure.
  on('session.attach', async ($, e, next) => {
    await runtime.starting.catch(() => undefined)
    if (!runtime.isActive) {
      runtime = { ...runtime, isActive: true }
      await startSession($)
    }
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'session.attach', next.error), next(e)))

  // /clear, /resume and /branch reset `$.state` without a new session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    // Nothing the table holds is in the new, empty conversation. The panel is drawn again after the usual wait,
    // when the old rows are gone and cannot be noted again.
    if (e.source === 'clear') resetToc($)
    // These empty `$.state`, and the panel is not opened by itself after them, nor after a reload that follows.
    await update($, paneStartedState, () => true)
    if (runtime.isActive) await reloadSession($)
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'classic.SessionStart', next.error), next(e)))

  // This `.catch` must not read `next`, or validate no longer sees a hook that answers its own command.
  on('command.run', { command: ['toolbelt', 'tb'] }, ($, e) => runToolbelt($, e)).catch($ => (logHookFailure($, 'command.run'), { text: tr()('command.failed') }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const props = e.props
    noteTocView(props.view.agentId)
    // Read before the guards: a band drawn before session.start draws again when loadStore writes it.
    if ((await read($, bandHiddenState)) || !runtime.isActive || props.hasSurvey || props.view.agentId !== undefined || props.maxRows < 1) return next(e)
    runtime = { ...runtime, bandColumns: withBandColumns($, runtime.bandColumns, e.surface, props.bodyColumns) }
    // Folded, it reads nothing it does not draw, so the clock's tick leaves it be.
    const isFolded = await isBandFolded($)
    const model = isFolded ? null : bandModel(await bandCtx($, e.surface), props.bodyColumns, runtime.knownCommands)
    if (model === null && !isFolded) return next(e)
    // Another mod's band goes below ours, one row shorter; if it fails, ours draws alone.
    const other = await next({ ...e, props: { ...props, maxRows: Math.max(0, props.maxRows - 1) } }).catch(() => undefined)
    const press = (id: string, surface: RenderSurface) => attempt($, `press ${id}`, () => pressItem($, id, surface), undefined)
    if (model === null) return drawFolded($.ui.resolve(e), press, other)
    return drawBand($.ui.resolve(e), model, press, other, tocBandCards(props.bodyColumns, tr()), props.bodyColumns)
  }).catch(($, e, next) => (logHookFailure($, 'ui.render AbovePrompt', next.error), next(e)))

  on('ui.render', { component: 'Pane', requestId: 'oh-my-toolbelt' }, async ($, e, next) => {
    // Read before the guard, as the band does: a panel kept open over a reload draws again.
    const ctx = await paneCtx($, e.surface)
    if (!runtime.isActive) return next(e)
    noteTocView(e.props.view.agentId)
    // Only the prompts tab draws the list, so only it works out where the person reads.
    const toc = ctx.state.paneTab === 'toc' ? tocView() : { rows: [], hidden: 0, isElsewhere: false }
    const isStatus = ctx.state.paneTab === 'status'
    const model = {
      ctx, language: `${runtime.lang.lang} (${runtime.lang.locale})`, versions: runtime.versions, knownCommands: runtime.knownCommands,
      settings: isStatus ? await readSettings($) : [], settingsSource: await readSettingsSource($),
      canSelect: e.surface === 'desktop' || (e.surface === 'terminal' && e.viewport?.isFullscreen === true),
      isBandShort: isStatus && !(await read($, bandHiddenState)) && !(await isBandFolded($)) && hidesButtonNames(ctx, runtime.bandColumns[e.surface], runtime.knownCommands),
      toc, columns: e.props.bodyColumns, clock: clockFormatOptions(runtime.options, runtime.lang.locale),
    }
    const act = (action: PaneAction, surface: RenderSurface) => attempt($, `panel ${action.kind}`, () => runPaneAction($, action, surface), undefined)
    return drawPane($.ui.resolve(e), model, act)
  }).catch(($, e, next) => (logHookFailure($, 'ui.render Pane', next.error), next(e)))

  // Registered whatever the settings say, and asked at each event: a change to the mod's own rows comes without a reload.
  registerTranscript(on, () => ({ isTocLive: isTocLive(), restoresCurtain: runtime.options.curtainRestoreOnSubmit === true }))
  registerTurns(on, () => ({ isActive: isTocLive(), isStoreReadOnly: runtime.isStoreReadOnly }))
}

