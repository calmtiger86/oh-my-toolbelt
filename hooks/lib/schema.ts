// Store schema version, per-key defaults and migration. Pure: no `$`.
import type { ButtonConfig, Layout, ToolButton } from '../../types'
import { isListedIcon } from './icons'

export const CURRENT_SCHEMA = 1
export const DEFAULT_SET = 'default'
// English fallback; the language files supply the localized body.
export const DEFAULT_REVIEW_TEXT = 'Review the change you just made and list the risks.'

// The keys a migration is responsible for. Other keys (notes, pomodoro, ...) have no stored shape to fix.
export type StoreSnapshot = { schemaVersion: typeof CURRENT_SCHEMA; buttons: ButtonConfig; layout: Layout }

export const LEFT_DEFAULT: readonly string[] = ['clock', 'date', 'weather', 'pomodoro']
export const RIGHT_DEFAULT: readonly string[] = ['attach', 'voice', 'theme', 'curtain', 'export', 'notes', 'edit']
const BUTTON_KINDS: readonly unknown[] = ['prompt', 'command', 'skill']
const BUTTON_MODES: readonly unknown[] = ['fill', 'send', 'run']
// A user button's hotkey: one lowercase letter (no digits).
export const HOTKEY_PATTERN = /^[a-z]$/
// Control characters and line or paragraph separators: in a label they would break the band's one row. And the
// invisible ones that reorder or hide text: the bidi marks, embeddings, overrides and isolates, the BOM and the tag
// characters. Not all of \p{Cf}: the zero-width joiner (U+200D) holds emoji like a family together.
const CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu

export const stripControls = (text: string): string => text.replace(CONTROLS, '')

// A prompt's text keeps its line breaks and tabs, the only control characters a Text draws.
const TEXT_CONTROLS = new RegExp(`(?![\\t\\n])${CONTROLS.source}`, 'gu')
export const stripTextControls = (text: string): string => text.replace(TEXT_CONTROLS, '')

export function defaultButtons(reviewText: string = DEFAULT_REVIEW_TEXT, reviewLabel = 'Review'): ButtonConfig {
  return {
    version: 1,
    sets: {
      [DEFAULT_SET]: [
        { id: 'ex-review', kind: 'prompt', label: reviewLabel, text: reviewText, mode: 'fill' },
        { id: 'ex-usage', kind: 'command', label: '/usage', command: 'usage', mode: 'run' },
      ],
    },
    activeSet: DEFAULT_SET,
  }
}

// `more` is never part of a layout: it is always drawn at the right end.
export function defaultLayout(buttons: ButtonConfig = defaultButtons()): Layout {
  const mine = (buttons.sets[buttons.activeSet] ?? []).map(button => `btn:${button.id}`)
  return { left: [...LEFT_DEFAULT], right: [...mine, ...RIGHT_DEFAULT], hidden: [] }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

function isToolButton(value: unknown): value is ToolButton {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    BUTTON_KINDS.includes(value.kind) &&
    BUTTON_MODES.includes(value.mode)
  )
}

export function isButtonConfig(value: unknown): value is ButtonConfig {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.activeSet === 'string' &&
    isRecord(value.sets) &&
    Object.hasOwn(value.sets, value.activeSet) &&
    Object.values(value.sets).every(list => Array.isArray(list) && list.every(isToolButton))
  )
}

// A stored button with its optional fields checked: a hotkey that is not one letter, or a text
// field that is not a string, or an icon that is in no icon group, is dropped, and the label loses its control characters. Hand-edited
// values and other versions' values never reach the band or a press unchecked.
function cleanButton(button: ToolButton): ToolButton {
  const { hotkey, text, command, args, icon } = button as Record<string, unknown>
  return {
    id: button.id,
    kind: button.kind,
    label: stripControls(button.label),
    mode: button.mode,
    ...(typeof hotkey === 'string' && HOTKEY_PATTERN.test(hotkey) ? { hotkey } : {}),
    ...(typeof text === 'string' ? { text: stripTextControls(text) } : {}),
    ...(typeof command === 'string' ? { command: stripControls(command) } : {}),
    ...(typeof args === 'string' ? { args: stripControls(args) } : {}),
    ...(isListedIcon(icon) ? { icon } : {}),
  }
}

// The stored buttons, each cleaned, or null when the value does not have the ButtonConfig shape.
// Set names lose their control characters as a new set's do; two that become one name keep both sets' buttons.
export function cleanButtonConfig(value: unknown): ButtonConfig | null {
  if (!isButtonConfig(value)) return null
  const named = Object.entries(value.sets).map(([name, list]) => [stripControls(name).trim(), list.map(cleanButton)] as const)
  const sets = named.reduce<Record<string, ToolButton[]>>((all, [name, list]) => (name === '' ? all : { ...all, [name]: [...(all[name] ?? []), ...list] }), {})
  const active = stripControls(value.activeSet).trim()
  const activeSet = Object.hasOwn(sets, active) ? active : Object.hasOwn(sets, DEFAULT_SET) ? DEFAULT_SET : (Object.keys(sets)[0] ?? DEFAULT_SET)
  return { version: 1, sets: Object.keys(sets).length === 0 ? { [DEFAULT_SET]: [] } : sets, activeSet }
}

function isLayout(value: unknown): value is Layout {
  return (
    isRecord(value) &&
    isStringArray(value.left) &&
    isStringArray(value.right) &&
    isStringArray(value.hidden)
  )
}

// v0 is "no schemaVersion stored". Anything already stored that has the v1 shape is kept, so a lost
// version key never wipes the user's buttons; the rest gets the defaults.
function v0ToV1(raw: unknown): StoreSnapshot {
  const stored = isRecord(raw) ? raw : {}
  const buttons = cleanButtonConfig(stored.buttons) ?? defaultButtons()
  const layout = isLayout(stored.layout) ? stored.layout : defaultLayout(buttons)
  return { schemaVersion: CURRENT_SCHEMA, buttons, layout }
}

// Brings what was stored at `fromVersion` up to CURRENT_SCHEMA. Call it only for versions below
// CURRENT_SCHEMA; a newer store is read-only (see isNewerSchema).
export function migrate(raw: unknown, fromVersion: number): StoreSnapshot {
  if (fromVersion === 0) return v0ToV1(raw)
  throw new RangeError(`cannot migrate from schema version ${fromVersion}`)
}

// True when a newer version of the mod wrote the store: read it, never write it.
export function isNewerSchema(version: unknown): boolean {
  return typeof version === 'number' && version > CURRENT_SCHEMA
}

// One `$.store.get`. `isRead` is false when the read failed, which is not the same as unset.
export type StoreRead = { isRead: boolean; value: unknown }
export type LoadPlan = { snapshot: StoreSnapshot; isReadOnly: boolean; shouldWrite: boolean }

// What a start makes of the stored schemaVersion, buttons and layout. `fresh` is the new-install buttons, in the
// person's language, which also stand in for stored buttons too broken to read. The store is written only when all three
// were read: after a failed read the session works from what it could read and writes
// nothing, so a passing failure never puts defaults over the person's buttons. An unreadable version keeps the
// read-only flag it had.
export function planLoad(version: StoreRead, buttons: StoreRead, layout: StoreRead, fresh: ButtonConfig, wasReadOnly: boolean): LoadPlan {
  const snapshot = migrate({ buttons: cleanButtonConfig(buttons.value) ?? fresh, layout: layout.value }, 0)
  const isReadOnly = version.isRead ? isNewerSchema(version.value) : wasReadOnly
  const isAllRead = version.isRead && buttons.isRead && layout.isRead
  return { snapshot, isReadOnly, shouldWrite: isAllRead && !isReadOnly && version.value !== CURRENT_SCHEMA }
}
