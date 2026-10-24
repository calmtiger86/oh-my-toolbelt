// Settings where Claude Code lists none of the mod's rows. The engine lists a plugin's rows in `$.config.list()` only
// for sessions its terminal UI loaded (observed in 2.1.309), so an SDK session, the desktop app's, lists none and
// `$.config.set` refuses the keys; /reload-plugins answers that it
// "isn't available over a remote connection". The values themselves still reach the mod. There the status tab draws the
// rows from plugin.json and keeps a change in the store, applied at once. A terminal, whose list has the rows, writes
// each kept change to /config and drops it. A /config change made after one wins: each keeps the value it replaced.
// ponytail: a desktop session cannot see a row an organization locks; the terminal drops such a change and names it
import type { ConfigRow, ConfigValue, EngineInterface, PluginOptions } from 'claude-code'
import { CONFIG_PREFIX } from './runtime'
import type { Versions } from './runtime'

// One store key per setting, so two changes at once, in one session or two, never write over each other.
export const OVERRIDE_PREFIX = 'settingsOverride.'

type Scalar = string | number | boolean
// `base`: the option as the engine handed it when the change was made, or null when it handed none.
export type Override = { value: Scalar; base: Scalar | null }
export type Overrides = Readonly<Record<string, Override>>

const isScalar = (value: unknown): value is Scalar => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const isOverride = (value: unknown): value is Override =>
  typeof value === 'object' && value !== null && isScalar((value as Override).value) && ((value as Override).base === null || isScalar((value as Override).base))

export const baseOf = (options: PluginOptions, field: string): Scalar | null => {
  const value = options[field]
  return isScalar(value) ? value : null
}

// The options with each change whose replaced value still stands; the others were changed in /config since.
export function applyOverrides(options: PluginOptions, overrides: Overrides): { options: PluginOptions; kept: Overrides } {
  const kept = Object.fromEntries(Object.entries(overrides).filter(([field, change]) => baseOf(options, field) === change.base))
  return { options: { ...options, ...Object.fromEntries(Object.entries(kept).map(([field, change]) => [field, change.value])) }, kept }
}

const PROVIDER = { plugin: 'oh-my-toolbelt', tier: 'user' } as const
type Field = { type?: unknown; title?: unknown; description?: unknown; options?: unknown; default?: unknown; sensitive?: unknown; multiple?: unknown }

// The rows /config lists for the mod, from plugin.json's userConfig, as the engine builds them: no sensitive or
// multiple field; a toggle, or a choice from the field's options. The mod has no other kind.
export function manifestRows(manifest: unknown, options: PluginOptions): ConfigRow[] {
  const fields = typeof manifest === 'object' && manifest !== null ? (manifest as { userConfig?: unknown }).userConfig : undefined
  if (typeof fields !== 'object' || fields === null) return []
  return Object.entries(fields as Record<string, Field>).flatMap(([field, spec]): ConfigRow[] => {
    if (spec.sensitive === true || spec.multiple === true) return []
    const value = options[field] ?? spec.default
    const row = {
      key: `${CONFIG_PREFIX}${field}`,
      label: typeof spec.title === 'string' ? spec.title : field,
      ...(typeof spec.description === 'string' ? { description: spec.description } : {}),
      provider: PROVIDER,
      isLocked: false,
    }
    if (spec.type === 'boolean') return typeof value === 'boolean' ? [{ ...row, kind: 'boolean', value }] : []
    const choices = Array.isArray(spec.options) ? spec.options.filter((option): option is string => typeof option === 'string') : []
    return spec.type === 'string' && choices.length > 0 && isScalar(value) ? [{ ...row, kind: 'choice', value: String(value), options: choices }] : []
  })
}

// plugin.json sits in `.claude-plugin/` under the mod's folder, `$.plugin.root` (2.1.309, checked in an SDK session).
export async function readManifest($: EngineInterface): Promise<unknown> {
  return JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
}

// The status tab's versions: the toolbelt's from plugin.json, Claude Code's from the engine.
export async function readVersions($: EngineInterface): Promise<Versions> {
  const manifest = await readManifest($)
  const version = typeof manifest === 'object' && manifest !== null ? (manifest as { version?: unknown }).version : undefined
  if (typeof version !== 'string') throw new Error('plugin.json has no version')
  return { toolbelt: version, claudeCode: (await $.session.version()).version }
}

async function readOverrides($: EngineInterface): Promise<Overrides> {
  const keys = (await $.store.keys()).filter(key => key.startsWith(OVERRIDE_PREFIX))
  const entries = await Promise.all(keys.map(async key => [key.slice(OVERRIDE_PREFIX.length), await $.store.get(key)] as const))
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, Override] => isOverride(entry[1])))
}

// At start and after a change: the options with the kept changes, and how many there are. Nothing is written.
export async function loadOverrides($: EngineInterface, options: PluginOptions): Promise<{ options: PluginOptions; count: number }> {
  const merged = applyOverrides(options, await readOverrides($))
  return { options: merged.options, count: Object.keys(merged.kept).length }
}

// A change made in the status tab where the engine lists no rows; one back to the engine's value leaves the store.
export async function saveOverride($: EngineInterface, options: PluginOptions, field: string, value: ConfigValue): Promise<void> {
  if (!isScalar(value)) throw new Error(`${field} takes a toggle or a choice`)
  const base = baseOf(options, field)
  if (value === base) return $.store.delete(`${OVERRIDE_PREFIX}${field}`)
  return $.store.set(`${OVERRIDE_PREFIX}${field}`, { value, base })
}

// Once a terminal lists the rows, each kept change leaves the store and is written to /config. One /config changed
// since, or one for a field the mod no longer has, just leaves; one /config refuses (a locked row, a value it does
// not take) leaves and is named, for a toast. It leaves first, as the write reloads the module and a change left
// behind could come back once /config holds its base again; a write that fails puts it back and the others go on. Says
// how many were written, as a written one reloads the module, and why any failed.
export type Moved = { refused: string[]; moved: number; failed: string[] }

export async function moveOverrides($: EngineInterface, options: PluginOptions, rows: readonly ConfigRow[]): Promise<Moved> {
  const refused: string[] = []
  const failed: string[] = []
  let moved = 0
  for (const [field, change] of Object.entries(await readOverrides($))) {
    const key = `${OVERRIDE_PREFIX}${field}`
    const row = rows.find(r => r.key === `${CONFIG_PREFIX}${field}`)
    await $.store.delete(key)
    if (row === undefined || baseOf(options, field) !== change.base) continue
    if (row.isLocked) {
      refused.push(row.label)
      continue
    }
    try {
      if ((await $.config.set({ key: row.key, value: change.value })).deny !== undefined) refused.push(row.label)
      else moved += 1
    } catch (err) {
      await $.store.set(key, change)
      failed.push(`${field}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { refused, moved, failed }
}
