// The status tab's settings: the mod's own /config rows (`oh-my-toolbelt.<field>`), read into `$.state` for the panel
// to draw, and changed as /config would change them. Read at start, after /clear and when the panel opens; a changed
// setting reloads the module, which reads them again. Where the engine lists none of them (the desktop app), the rows
// come from plugin.json and a change is the store's (hooks/own-settings.ts).
import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, EngineInterface, PluginOptions } from 'claude-code'
import { manifestRows, readManifest } from './own-settings'
import { CONFIG_PREFIX } from './runtime'
import { POMODORO_SOUNDS, soundAssetOf } from './tools/pomodoro'
import { themeRowOf } from './tools/theme'
import type { ThemeRow } from './tools/theme'

const settingsState = atom({ plugin: 'oh-my-toolbelt', key: 'settings' } as const, [])
// Whose rows the status tab draws: the engine's, or the mod's own from plugin.json.
const settingsSourceState = atom({ plugin: 'oh-my-toolbelt', key: 'settingsSource' } as const, 'engine')
// Claude Code's own theme row, for the theme button; read with the mod's rows.
const themeRowState = atom({ plugin: 'oh-my-toolbelt', key: 'themeRow' } as const, null)
const soundPickState = atom({ plugin: 'oh-my-toolbelt', key: 'soundPick' } as const, null)

export function readThemeRow($: EngineInterface): Promise<ThemeRow | null> {
  return read($, themeRowState)
}

export function readSettings($: EngineInterface): Promise<ConfigRow[]> {
  return read($, settingsState)
}

// What the theme button learnt this load: a refusal keeps it away, and the value it sent stands until the list says so
// too (a list read just after a change may still give the old value).
let themeTold: { isRefused: boolean; sent: string | undefined } = { isRefused: false, sent: undefined }

// `options`: what the mod runs with, store changes included, for the rows the mod draws itself.
export async function listSettings($: EngineInterface, options: PluginOptions): Promise<void> {
  const rows = await $.config.list()
  const theme = rows.find(row => row.key === 'theme')
  // A locked row would only refuse the press.
  const listed = theme === undefined || theme.isLocked || themeTold.isRefused ? null : themeRowOf(theme)
  if (listed !== null && listed.value === themeTold.sent) themeTold = { ...themeTold, sent: undefined }
  const sent = themeTold.sent
  await update($, themeRowState, () => (listed === null || sent === undefined || !listed.options.includes(sent) ? listed : { ...listed, value: sent }))
  const mine = rows.filter(row => row.key.startsWith(CONFIG_PREFIX))
  // A terminal lists them a few seconds after start (the mods load first), so only a session without one draws its own.
  const isOwn = mine.length === 0 && !(await $.session.surfaces()).includes('terminal')
  const shown = isOwn ? manifestRows(await readManifest($), options) : mine
  await update($, settingsSourceState, () => (isOwn ? 'own' : 'engine'))
  await update($, settingsState, () => shown)
}

export function readSettingsSource($: EngineInterface): Promise<'engine' | 'own'> {
  return read($, settingsSourceState)
}

// The theme button's press: why /config refused it, if it did (then the button goes for this load); otherwise the
// row holds the new value at once.
// ponytail: a theme changed in /config shows on the button at the next start or panel opening; a config.set watcher would show it at once
export async function setTheme($: EngineInterface, value: string): Promise<string | undefined> {
  const result = await $.config.set({ key: 'theme', value }).catch((err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) }))
  if (result.deny !== undefined) {
    themeTold = { isRefused: true, sent: undefined }
    await update($, themeRowState, () => null)
    return result.deny
  }
  themeTold = { ...themeTold, sent: value }
  await update($, themeRowState, row => (row === null ? null : { ...row, value }))
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

export async function changeSetting($: EngineInterface, key: string, raw: string, options: PluginOptions): Promise<SettingChange> {
  const row = (await read($, settingsState)).find(r => r.key === key)
  const value = row === undefined || row.isLocked ? null : settingValue(row, raw)
  if (row === undefined || value === null || value === row.value) return { kind: 'none' }
  if ((await read($, settingsSourceState)) === 'own') return { kind: 'own', field: key.slice(CONFIG_PREFIX.length), value }
  const result = await $.config.set({ key, value })
  if (result.deny !== undefined) return { kind: 'denied', reason: result.deny }
  await listSettings($, options)
  return { kind: 'done' }
}

// An alert sound picked in the status tab plays once (macOS plays it; elsewhere nothing), a pick the row offers only;
// a new pick stops the one still playing, as clips are not queued.
let preview: AbortController | null = null
function playOnce($: EngineInterface, name: string): void {
  preview?.abort()
  preview = new AbortController()
  void $.audio.play({ asset: soundAssetOf(name) }, { signal: preview.signal }).catch(() => undefined)
}

// A pick that changes the setting reloads the module, which stops a clip the old load started (a short blip, then
// nothing). So such a pick waits in `$.state` and the new load's start plays it (playPickedSound); the same sound
// picked again plays at once.
const PICK_FRESH_MS = 10_000
export async function previewSound($: EngineInterface, key: string, value: string): Promise<void> {
  if (key !== `${CONFIG_PREFIX}pomodoroSoundName` || !Object.hasOwn(POMODORO_SOUNDS, value)) return
  const row = (await read($, settingsState)).find(r => r.key === key)
  if (row === undefined || row.value === value) return playOnce($, value)
  const at = await $.clock.now()
  await update($, soundPickState, () => ({ name: value, at }))
}

// A refused or failed change reloads nothing, so its pick must not wait for the next reload.
export async function dropSoundPick($: EngineInterface): Promise<void> {
  await update($, soundPickState, () => null)
}

export async function playPickedSound($: EngineInterface): Promise<void> {
  const pick = await read($, soundPickState)
  if (pick === null) return
  await update($, soundPickState, () => null)
  if ((await $.clock.now()) - pick.at <= PICK_FRESH_MS) playOnce($, pick.name)
}
