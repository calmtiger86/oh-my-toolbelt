// The user's own buttons and their validation. Pure: widths come in as a `cells` function, and messages leave as keys
// for `t`.
import type { ButtonConfig, ToolButton } from '../../types/index'
import type { Effect } from '../lib/effects'
import type { TFn } from '../lib/i18n'
import { ICON_DEFAULT, ICON_NONE, faceOf, isListedIcon } from '../lib/icons'
import type { IconStyle } from '../lib/icons'
import { DEFAULT_SET, HOTKEY_PATTERN, defaultButtons, stripControls, stripTextControls } from '../lib/schema'

export type ButtonDraft = Partial<ToolButton>
// A message key for `t` plus its arguments; the panel translates it.
export type Issue = { key: string; args?: Record<string, unknown> }
export type Validation = { errors: Issue[]; warnings: Issue[] }
export type ValidateContext = {
  // The other buttons of the same set. A draft with an id that is listed here is an edit of it.
  existing: readonly ToolButton[]
  // The default letters of the fixed tools (registry FIXED_HOTKEYS).
  reserved: readonly string[]
  cells: (text: string) => number
  // The names from `$.command.list()`; when given, an unknown command gets a warning (save allowed).
  knownCommands?: readonly string[]
}

export const MAX_LABEL_CELLS = 24
export const SHORT_LABEL_CELLS = 4
export { DEFAULT_SET }
// Stable ids of the two example buttons; layouts refer to them as `btn:<id>`.
export const EXAMPLE_REVIEW_ID = 'ex-review' // matches schema.ts defaultButtons
export const EXAMPLE_USAGE_ID = 'ex-usage'

const KINDS: readonly unknown[] = ['prompt', 'command', 'skill']
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export const allButtons = (config: ButtonConfig): ToolButton[] => Object.values(config.sets).flat()
export const activeButtons = (config: ButtonConfig): ToolButton[] => config.sets[config.activeSet] ?? []

// The example buttons: one prompt example and one command example. The label and prompt body are in the language files.
export const defaultButtonConfig = (t: TFn): ButtonConfig =>
  defaultButtons(t('user.example.reviewText'), t('user.example.reviewLabel'))

// What pressing a button does. A button missing its required text or command does nothing.
export function buttonEffects(button: ToolButton): Effect[] {
  if (button.kind === 'prompt') {
    const text = button.text ?? ''
    if (text.trim() === '') return []
    return button.mode === 'send'
      ? [{ kind: 'prompt.submit', text, asUser: true }]
      : [{ kind: 'prompt.fill', text, mode: 'insert' }]
  }
  const command = (button.command ?? '').trim()
  if (command === '') return []
  const args = (button.args ?? '').trim()
  return [{ kind: 'command.run', command, ...(args === '' ? {} : { args }) }]
}

// Keeps whole characters from the front until `max` cells are used.
export function clipCells(text: string, max: number, cells: (text: string) => number): string {
  let used = 0
  let kept = ''
  for (const { segment } of segmenter.segment(text)) {
    used += cells(segment)
    if (used > max) break
    kept += segment
  }
  return kept
}

// Long form is the label, short form its first 4 cells; a button with an icon draws it by the icon style.
export const buttonLabel = (button: ToolButton, size: 'long' | 'short', cells: (text: string) => number, style: IconStyle): string =>
  faceOf(style, size, button.icon ?? '', button.label, clipCells(button.label, SHORT_LABEL_CELLS, cells))

// Trims what a form field leaves untidy: label, hotkey, args, and a leading "/" on a command name.
// Every field loses its control characters, which would break the band's one row or the panel's Text; a prompt's
// text keeps its line breaks and tabs.
export function normalizeDraft(draft: ButtonDraft): ButtonDraft {
  return {
    ...draft,
    label: stripControls(draft.label ?? '').trim(),
    hotkey: (draft.hotkey ?? '').trim(),
    command: stripControls(draft.command ?? '').trim().replace(/^\/+/, ''),
    args: stripControls(draft.args ?? '').trim(),
    ...(draft.text === undefined ? {} : { text: stripTextControls(draft.text) }),
  }
}

function labelIssues(label: string, ctx: ValidateContext): Issue[] {
  if (label === '') return [{ key: 'user.error.label.empty' }]
  const width = ctx.cells(label)
  return width > MAX_LABEL_CELLS ? [{ key: 'user.error.label.tooLong', args: { max: MAX_LABEL_CELLS, cells: width } }] : []
}

function hotkeyIssues(d: ButtonDraft, ctx: ValidateContext): Issue[] {
  const key = d.hotkey ?? ''
  if (key === '') return []
  if (!HOTKEY_PATTERN.test(key)) return [{ key: 'user.error.hotkey.format' }]
  if (ctx.reserved.includes(key)) return [{ key: 'user.error.hotkey.reserved', args: { key } }]
  const other = ctx.existing.find(b => b.hotkey === key && b.id !== d.id)
  return other ? [{ key: 'user.error.hotkey.taken', args: { key, label: other.label } }] : []
}

function promptIssues(d: ButtonDraft): Validation {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  if ((d.text ?? '').trim() === '') errors.push({ key: 'user.error.text.missing' })
  if (d.mode !== undefined && d.mode !== 'fill' && d.mode !== 'send') errors.push({ key: 'user.error.mode.invalid' })
  if (d.mode === 'send' && (d.text ?? '').includes('@')) warnings.push({ key: 'user.warning.send.mention' })
  return { errors, warnings }
}

function commandIssues(d: ButtonDraft, ctx: ValidateContext): Validation {
  const command = d.command ?? ''
  if (command === '') return { errors: [{ key: 'user.error.command.missing' }], warnings: [] }
  if (/\s/.test(command)) return { errors: [{ key: 'user.error.command.format' }], warnings: [] }
  const unknown = ctx.knownCommands !== undefined && !ctx.knownCommands.includes(command)
  return { errors: [], warnings: unknown ? [{ key: 'user.warning.command.unknown', args: { command } }] : [] }
}

// The form's checks, run when it is saved. Warnings do not block saving.
export function validateButton(draft: ButtonDraft, ctx: ValidateContext): Validation {
  const d = normalizeDraft(draft)
  const common = [...labelIssues(d.label ?? '', ctx), ...hotkeyIssues(d, ctx)]
  if (!KINDS.includes(d.kind)) return { errors: [...common, { key: 'user.error.kind.missing' }], warnings: [] }
  const rest = d.kind === 'prompt' ? promptIssues(d) : commandIssues(d, ctx)
  return { errors: [...common, ...rest.errors], warnings: rest.warnings }
}

// Turns a (valid) form draft into a button. A prompt defaults to fill; commands and skills always run.
export function buildButton(draft: ButtonDraft, id: string): ToolButton {
  const d = normalizeDraft(draft)
  const base = { id, label: d.label ?? '', ...(d.hotkey ? { hotkey: d.hotkey } : {}), ...(isListedIcon(d.icon) ? { icon: d.icon } : {}) }
  if (d.kind === 'command' || d.kind === 'skill') {
    return { ...base, kind: d.kind, command: d.command ?? '', ...(d.args ? { args: d.args } : {}), mode: 'run' }
  }
  return { ...base, kind: 'prompt', text: d.text ?? '', mode: d.mode === 'send' ? 'send' : 'fill' }
}

// An id no button in any set uses yet. Time-based so a deleted button's id is not reused by accident.
export function nextButtonId(config: ButtonConfig, now: number): string {
  const taken = new Set(allButtons(config).map(b => b.id))
  const base = `b${now.toString(36)}`
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

export const addButton = (config: ButtonConfig, button: ToolButton, set: string = config.activeSet): ButtonConfig => ({
  ...config,
  sets: { ...config.sets, [set]: [...(config.sets[set] ?? []), button] },
})

export const removeButton = (config: ButtonConfig, id: string): ButtonConfig => ({
  ...config,
  sets: Object.fromEntries(Object.entries(config.sets).map(([name, list]) => [name, list.filter(b => b.id !== id)])),
})

// Replaces the button that has the same id, wherever it is.
export const updateButton = (config: ButtonConfig, button: ToolButton): ButtonConfig => ({
  ...config,
  sets: Object.fromEntries(
    Object.entries(config.sets).map(([name, list]) => [name, list.map(b => (b.id === button.id ? button : b))]),
  ),
})

// ---- Sets: the band shows the chosen set's buttons. A new set starts empty and is chosen. ----

export const SET_CELLS_MAX = 16
// Well under a Select's 64 options, the set picker's list.
export const SETS_MAX = 32

export const cleanSetName = (raw: string): string => stripControls(raw).trim()

// Why a cleaned name cannot be a new set, or null. `Object.hasOwn`: the name is typed text used as a key.
export function setNameIssue(name: string, config: ButtonConfig, cells: (text: string) => number): Issue | null {
  if (name === '') return { key: 'set.error.empty' }
  if (Object.keys(config.sets).length >= SETS_MAX) return { key: 'set.error.tooMany', args: { max: SETS_MAX } }
  if (cells(name) > SET_CELLS_MAX) return { key: 'set.error.long', args: { max: SET_CELLS_MAX } }
  return Object.hasOwn(config.sets, name) ? { key: 'set.error.taken', args: { name } } : null
}

// `default` stays, and a set that still has buttons is not deleted: the panel has no confirm step, and one stray
// Enter must not lose a set of buttons.
export function setDeleteIssue(config: ButtonConfig, name: string): Issue | null {
  if (name === DEFAULT_SET) return { key: 'set.error.default' }
  return (config.sets[name]?.length ?? 0) > 0 ? { key: 'set.error.notEmpty' } : null
}

export const addSet = (config: ButtonConfig, name: string): ButtonConfig => ({ ...config, sets: { ...config.sets, [name]: [] }, activeSet: name })

export const pickSet = (config: ButtonConfig, name: string): ButtonConfig =>
  Object.hasOwn(config.sets, name) ? { ...config, activeSet: name } : config

// The set goes; when it was the chosen one, `default` is chosen.
export const removeSet = (config: ButtonConfig, name: string): ButtonConfig => ({
  ...config,
  sets: Object.fromEntries(Object.entries(config.sets).filter(([key]) => key !== name)),
  activeSet: config.activeSet === name ? DEFAULT_SET : config.activeSet,
})

// What a press in the set controls does to the buttons read just now: the buttons to save (a form left open checks its
// hotkey against the set it was opened in, so a save closes it), and what to say. Nothing when the press changes nothing.
export type SetChange = { next?: ButtonConfig; say?: Issue }

export function pickSetChange(config: ButtonConfig, name: string): SetChange {
  return config.activeSet === name || !Object.hasOwn(config.sets, name) ? {} : { next: pickSet(config, name) }
}

export function addSetChange(config: ButtonConfig, raw: string, cells: (text: string) => number): SetChange {
  const name = cleanSetName(raw)
  const issue = setNameIssue(name, config, cells)
  return issue !== null ? { say: issue } : { next: addSet(config, name), say: { key: 'toast.setAdded', args: { name } } }
}

export function deleteSetChange(config: ButtonConfig): SetChange {
  const name = config.activeSet
  const issue = setDeleteIssue(config, name)
  return issue !== null ? { say: issue } : { next: removeSet(config, name), say: { key: 'toast.setDeleted', args: { name } } }
}

// ---- The edit form: what a field change does to the draft held in `editDraft`. ----

export type DraftField = 'label' | 'kind' | 'text' | 'command' | 'args' | 'mode' | 'hotkey' | 'icon'

// The form a "+ New button" press opens: a prompt that is inserted, with nothing filled in yet.
export const newDraft = (): ButtonDraft => ({ kind: 'prompt', mode: 'fill', label: '', text: '', hotkey: '' })

// A changed type also picks its action: a prompt is inserted, a command or skill runs.
export function setDraftField(draft: ButtonDraft, field: DraftField, value: string): ButtonDraft {
  switch (field) {
    case 'kind':
      return value === 'prompt' || value === 'command' || value === 'skill'
        ? { ...draft, kind: value, mode: value === 'prompt' ? 'fill' : 'run' }
        : draft
    case 'mode': return value === 'fill' || value === 'send' ? { ...draft, mode: value } : draft
    case 'label': return { ...draft, label: value }
    case 'text': return { ...draft, text: value }
    case 'command': return { ...draft, command: value }
    case 'args': return { ...draft, args: value }
    case 'hotkey': return { ...draft, hotkey: value }
    // "none" is an empty icon; a value that is no icon of a group changes nothing.
    case 'icon': return value === ICON_NONE ? { ...draft, icon: '' } : isListedIcon(value) ? { ...draft, icon: value } : draft
  }
}

// A button after an icon pick from the layout rows (id is the button's, without the layout prefix): "none" and
// "default" both take the icon off, since a button has no icon of its own. Null when the button or the value is unknown.
export function setButtonIcon(config: ButtonConfig, id: string, value: string): ButtonConfig | null {
  const button = allButtons(config).find(b => b.id === id)
  if (button === undefined || !(value === ICON_NONE || value === ICON_DEFAULT || isListedIcon(value))) return null
  const { icon: _, ...rest } = button
  return updateButton(config, isListedIcon(value) ? { ...rest, icon: value } : rest)
}

// The form for editing a button of the active set, or an empty one for a new button.
export function draftFor(config: ButtonConfig, id: string | null): ButtonDraft {
  const button = id === null ? undefined : activeButtons(config).find(b => b.id === id)
  return button === undefined ? newDraft() : { ...button }
}
