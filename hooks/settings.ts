// The status tab's settings: the mod's own /config rows (`oh-my-toolbelt.<field>`), read into `$.state` for the panel
// to draw, and changed as /config would change them. Read at start, after /clear and when the panel opens; a changed
// setting reloads the module, which reads them again. Where the engine lists none of them (the desktop app), the rows
// come from plugin.json and a change is the store's (hooks/own-settings.ts).
import type { ConfigRow, ConfigSetResult, ConfigValue, PluginOptions } from 'claude-code'
import { manifestRows, readManifest } from './own-settings'
import { CONFIG_PREFIX } from './runtime'
import type { Engine } from './runtime'
import { POMODORO_SOUNDS, soundAssetOf } from './tools/pomodoro'
import { themeRowOf } from './tools/theme'
import type { ThemeRow } from './tools/theme'

export function readThemeRow(engine: Engine): Promise<ThemeRow | null> {
  return engine.cells.themeRow.read()
}

export function readSettings(engine: Engine): Promise<ConfigRow[]> {
  return engine.cells.settings.read()
}

// What the theme button learnt this load: a refusal keeps it away, and the value it sent stands until the list says so
// too (a list read just after a change may still give the old value).
let themeTold: { isRefused: boolean; sent: string | undefined } = { isRefused: false, sent: undefined }

// `options`: what the mod runs with, store changes included, for the rows the mod draws itself.
export async function listSettings(engine: Engine, options: PluginOptions): Promise<void> {
  const rows = await engine.config.list()
  const theme = rows.find(row => row.key === 'theme')
  // A locked row would only refuse the press.
  const listed = theme === undefined || theme.isLocked || themeTold.isRefused ? null : themeRowOf(theme)
  if (listed !== null && listed.value === themeTold.sent) themeTold = { ...themeTold, sent: undefined }
  const sent = themeTold.sent
  await engine.cells.themeRow.update(() => (listed === null || sent === undefined || !listed.options.includes(sent) ? listed : { ...listed, value: sent }))
  const mine = rows.filter(row => row.key.startsWith(CONFIG_PREFIX))
  // A terminal lists them a few seconds after start (the mods load first), so only a session without one draws its own.
  const isOwn = mine.length === 0 && !(await engine.session.surfaces()).includes('terminal')
  const shown = isOwn ? manifestRows(await readManifest(engine), options) : mine
  await engine.cells.settingsSource.update(() => (isOwn ? 'own' : 'engine'))
  await engine.cells.settings.update(() => shown)
}

export function readSettingsSource(engine: Engine): Promise<'engine' | 'own'> {
  return engine.cells.settingsSource.read()
}

// The theme button's press: why /config refused it, if it did (then the button goes for this load); otherwise the
// row holds the new value at once.
// ponytail: a theme changed in /config shows on the button at the next start or panel opening; a config.set watcher would show it at once
export async function setTheme(engine: Engine, value: string): Promise<string | undefined> {
  let result: ConfigSetResult
  try {
    result = await engine.config.write('theme', value)
  } catch (err) {
    result = { deny: err instanceof Error ? err.message : String(err) }
  }
  if (result.deny !== undefined) {
    themeTold = { isRefused: true, sent: undefined }
    await engine.cells.themeRow.update(() => null)
    return result.deny
  }
  themeTold = { ...themeTold, sent: value }
  await engine.cells.themeRow.update(row => (row === null ? null : { ...row, value }))
  return undefined
}

// The value a pick means, only if the row offers it: true or false for a toggle, one of a choice's options.
export function settingValue(row: ConfigRow, raw: string): ConfigValue | null {
  if (row.kind === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : null
  return row.kind === 'choice' && row.options?.includes(raw) === true ? raw : null
}

// What a pick did: nothing (a locked row, a value the row does not offer, the value it holds), a change /config made
// or refused, or one for the store to keep, as the mod's own rows are not /config's; its row is drawn again once kept.
export type SettingChange = { kind: 'none' } | { kind: 'done' } | { kind: 'denied'; reason: string } | { kind: 'own'; field: string; value: ConfigValue }

export async function changeSetting(engine: Engine, key: string, raw: string, options: PluginOptions): Promise<SettingChange> {
  const row = (await engine.cells.settings.read()).find(r => r.key === key)
  const value = row === undefined || row.isLocked ? null : settingValue(row, raw)
  if (row === undefined || value === null || value === row.value) return { kind: 'none' }
  if ((await engine.cells.settingsSource.read()) === 'own') return { kind: 'own', field: key.slice(CONFIG_PREFIX.length), value }
  const result = await engine.config.write(key, value)
  if (result.deny !== undefined) return { kind: 'denied', reason: result.deny }
  await listSettings(engine, options)
  return { kind: 'done' }
}

// An alert sound picked in the status tab plays once (macOS plays it; elsewhere nothing), a pick the row offers only;
// a new pick stops the one still playing, as clips are not queued.
let preview: AbortController | null = null
function playOnce(engine: Engine, name: string): void {
  preview?.abort()
  preview = new AbortController()
  void engine.audio.play({ asset: soundAssetOf(name) }, { signal: preview.signal }).catch(() => undefined)
}

// A pick that changes the setting reloads the module, which stops a clip the old load started (a short blip, then
// nothing). So such a pick waits in `$.state` and the new load's start plays it (playPickedSound); the same sound
// picked again plays at once.
const PICK_FRESH_MS = 10_000
export async function previewSound(engine: Engine, key: string, value: string): Promise<void> {
  if (key !== `${CONFIG_PREFIX}pomodoroSoundName` || !Object.hasOwn(POMODORO_SOUNDS, value)) return
  const row = (await engine.cells.settings.read()).find(r => r.key === key)
  if (row === undefined || row.value === value) return playOnce(engine, value)
  const at = await engine.clock.now()
  await engine.cells.soundPick.update(() => ({ name: value, at }))
}

// A refused or failed change reloads nothing, so its pick must not wait for the next reload.
export async function dropSoundPick(engine: Engine): Promise<void> {
  await engine.cells.soundPick.update(() => null)
}

export async function playPickedSound(engine: Engine): Promise<void> {
  const pick = await engine.cells.soundPick.read()
  if (pick === null) return
  await engine.cells.soundPick.update(() => null)
  if ((await engine.clock.now()) - pick.at <= PICK_FRESH_MS) playOnce(engine, pick.name)
}
