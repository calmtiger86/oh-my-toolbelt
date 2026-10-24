import { test, expect } from 'claude-code/testing'
import { reservedHotkeys } from '../hooks/tools/registry'
import {
  EXAMPLE_REVIEW_ID, EXAMPLE_USAGE_ID, MAX_LABEL_CELLS, activeButtons, addButton, allButtons, buildButton, buttonEffects,
  buttonLabel, clipCells, defaultButtonConfig, nextButtonId, normalizeDraft, removeButton, updateButton, validateButton,
} from '../hooks/tools/user'
import type { ValidateContext } from '../hooks/tools/user'
import { translator } from '../hooks/lib/i18n'
import type { ToolButton } from '../types/index'
import { cells, makeButtons, promptButton, t } from './pure-helpers'

const base: ValidateContext = { existing: [promptButton('a', { hotkey: 's', label: 'Alpha' })], reserved: reservedHotkeys(), cells }
const errorKeys = (draft: Partial<ToolButton>, ctx: ValidateContext = base): string[] =>
  validateButton(draft, ctx).errors.map(e => e.key)
const good: Partial<ToolButton> = { kind: 'prompt', label: 'Ship it', text: 'Ship the change', mode: 'fill' }

test('prompt fill becomes prompt.fill with insert mode', () => {
  expect(buttonEffects(promptButton('p', { text: 'Hello' }))).toEqual([{ kind: 'prompt.fill', text: 'Hello', mode: 'insert' }])
})

test('prompt send becomes prompt.submit as the user', () => {
  expect(buttonEffects(promptButton('p', { text: 'Go', mode: 'send' }))).toEqual([{ kind: 'prompt.submit', text: 'Go', asUser: true }])
})

test('command and skill buttons become command.run, with args only when given', () => {
  const command: ToolButton = { id: 'c', kind: 'command', label: '/usage', command: 'usage', mode: 'run' }
  expect(buttonEffects(command)).toEqual([{ kind: 'command.run', command: 'usage' }])
  const skill: ToolButton = { id: 's', kind: 'skill', label: 'deslop', command: 'deslop', args: ' src/ ', mode: 'run' }
  expect(buttonEffects(skill)).toEqual([{ kind: 'command.run', command: 'deslop', args: 'src/' }])
  expect(buttonEffects({ ...skill, args: '   ' })).toEqual([{ kind: 'command.run', command: 'deslop' }])
})

test('a button without its required text or command does nothing', () => {
  expect(buttonEffects(promptButton('p', { text: '  ' }))).toEqual([])
  expect(buttonEffects({ id: 'c', kind: 'command', label: 'x', mode: 'run' })).toEqual([])
})

test('a valid draft has no errors and no warnings', () => {
  expect(validateButton(good, base)).toEqual({ errors: [], warnings: [] })
})

test('label: empty, and longer than 24 cells (a Hangul letter takes two)', () => {
  expect(errorKeys({ ...good, label: '   ' })).toEqual(['user.error.label.empty'])
  expect(errorKeys({ ...good, label: undefined })).toEqual(['user.error.label.empty'])
  expect(errorKeys({ ...good, label: 'a'.repeat(MAX_LABEL_CELLS) })).toEqual([])
  expect(errorKeys({ ...good, label: 'a'.repeat(MAX_LABEL_CELLS + 1) })).toEqual(['user.error.label.tooLong'])
  expect(errorKeys({ ...good, label: '가'.repeat(12) })).toEqual([])
  const long = validateButton({ ...good, label: '가'.repeat(13) }, base).errors[0]
  expect(long).toEqual({ key: 'user.error.label.tooLong', args: { max: 24, cells: 26 } })
})

test('hotkey: one lowercase letter only', () => {
  for (const bad of ['A', '1', 'ab', '-', 'é']) expect(errorKeys({ ...good, hotkey: bad })).toEqual(['user.error.hotkey.format'])
  expect(errorKeys({ ...good, hotkey: 'k' })).toEqual([])
  expect(errorKeys({ ...good, hotkey: '' })).toEqual([])
})

test('hotkey: the fixed tools keep their default letters', () => {
  for (const letter of reservedHotkeys()) {
    expect(validateButton({ ...good, hotkey: letter }, base).errors).toEqual([{ key: 'user.error.hotkey.reserved', args: { key: letter } }])
  }
})

test('hotkey: no two buttons of a set share a letter, but editing a button may keep its own', () => {
  const taken = validateButton({ ...good, hotkey: 's' }, base).errors
  expect(taken).toEqual([{ key: 'user.error.hotkey.taken', args: { key: 's', label: 'Alpha' } }])
  expect(errorKeys({ ...good, id: 'a', hotkey: 's' })).toEqual([])
  expect(errorKeys({ ...good, id: 'other', hotkey: 's' })).toEqual(['user.error.hotkey.taken'])
})

test('kind is required and must be known', () => {
  expect(errorKeys({ label: 'x' })).toEqual(['user.error.kind.missing'])
  expect(errorKeys({ label: 'x', kind: 'weird' as ToolButton['kind'] })).toEqual(['user.error.kind.missing'])
})

test('prompt needs text and a fill or send mode', () => {
  expect(errorKeys({ ...good, text: '  ' })).toEqual(['user.error.text.missing'])
  expect(errorKeys({ ...good, text: undefined })).toEqual(['user.error.text.missing'])
  expect(errorKeys({ ...good, mode: 'run' })).toEqual(['user.error.mode.invalid'])
  expect(errorKeys({ ...good, mode: undefined })).toEqual([])
})

test('command and skill need a command name without spaces; a leading slash is accepted', () => {
  expect(errorKeys({ kind: 'command', label: 'x' })).toEqual(['user.error.command.missing'])
  expect(errorKeys({ kind: 'skill', label: 'x', command: '/' })).toEqual(['user.error.command.missing'])
  expect(errorKeys({ kind: 'command', label: 'x', command: 'two words' })).toEqual(['user.error.command.format'])
  expect(errorKeys({ kind: 'command', label: 'x', command: '/usage' })).toEqual([])
  expect(errorKeys({ kind: 'skill', label: 'x', command: 'deslop', args: 'anything' })).toEqual([])
})

test('send with @ only warns; fill with @ does not', () => {
  const send = validateButton({ ...good, mode: 'send', text: 'Look at @src/a.ts' }, base)
  expect(send.errors).toEqual([])
  expect(send.warnings).toEqual([{ key: 'user.warning.send.mention' }])
  expect(validateButton({ ...good, mode: 'fill', text: 'Look at @src/a.ts' }, base).warnings).toEqual([])
  expect(validateButton({ ...good, mode: 'send', text: 'No mention' }, base).warnings).toEqual([])
})

test('an unknown command warns only when the session command list is given', () => {
  const draft: Partial<ToolButton> = { kind: 'command', label: 'x', command: 'gone' }
  expect(validateButton(draft, base).warnings).toEqual([])
  const withList = validateButton(draft, { ...base, knownCommands: ['usage'] })
  expect(withList.errors).toEqual([])
  expect(withList.warnings).toEqual([{ key: 'user.warning.command.unknown', args: { command: 'gone' } }])
  expect(validateButton({ ...draft, command: 'usage' }, { ...base, knownCommands: ['usage'] }).warnings).toEqual([])
})

test('several problems are all reported', () => {
  expect(errorKeys({ kind: 'prompt', label: '', hotkey: 'Z', text: '' })).toEqual([
    'user.error.label.empty', 'user.error.hotkey.format', 'user.error.text.missing',
  ])
})

test('every error and warning key exists in the English table', () => {
  const keys = [
    ...errorKeys({ kind: 'prompt', label: '', hotkey: 'Z', text: '' }),
    ...errorKeys({ label: 'x' }), ...errorKeys({ kind: 'command', label: 'x', command: 'a b' }),
    ...errorKeys({ ...good, mode: 'run' }), ...errorKeys({ ...good, hotkey: 'a' }), ...errorKeys({ kind: 'command', label: 'x' }),
    ...errorKeys({ ...good, label: 'a'.repeat(30) }), 'user.warning.send.mention', 'user.warning.command.unknown',
  ]
  for (const key of keys) expect(t(key)).not.toBe(key)
})

test('normalizeDraft and buildButton tidy a form draft into a button', () => {
  expect(normalizeDraft({ label: ' Hi ', hotkey: ' k ', command: '//run', args: ' x ' })).toMatchObject({
    label: 'Hi', hotkey: 'k', command: 'run', args: 'x',
  })
  expect(normalizeDraft({ label: 'Two\nlines\t' }).label).toBe('Twolines')
  expect(buildButton({ kind: 'prompt', label: ' Hi ', text: 'T', hotkey: ' k ' }, 'id1')).toEqual({
    id: 'id1', label: 'Hi', hotkey: 'k', kind: 'prompt', text: 'T', mode: 'fill',
  })
  expect(buildButton({ kind: 'prompt', label: 'Hi', text: 'T', mode: 'send', hotkey: '' }, 'id2')).toEqual({
    id: 'id2', label: 'Hi', kind: 'prompt', text: 'T', mode: 'send',
  })
  expect(buildButton({ kind: 'skill', label: 'S', command: '/deslop', args: '', mode: 'fill' }, 'id3')).toEqual({
    id: 'id3', label: 'S', kind: 'skill', command: 'deslop', mode: 'run',
  })
})

test('add, update and remove return new configs and leave the old one alone', () => {
  const config = Object.freeze(makeButtons())
  const added = addButton(config, promptButton('n1'))
  expect(activeButtons(added).map(b => b.id)).toEqual([EXAMPLE_REVIEW_ID, EXAMPLE_USAGE_ID, 'n1'])
  expect(activeButtons(config)).toHaveLength(2)
  const edited = updateButton(added, promptButton('n1', { label: 'Renamed' }))
  expect(allButtons(edited).find(b => b.id === 'n1')?.label).toBe('Renamed')
  expect(allButtons(added).find(b => b.id === 'n1')?.label).toBe('n1')
  const removed = removeButton(edited, EXAMPLE_REVIEW_ID)
  expect(allButtons(removed).map(b => b.id)).toEqual([EXAMPLE_USAGE_ID, 'n1'])
  expect(removed).not.toBe(edited)
  expect(removeButton(config, 'missing')).toEqual(config)
})

test('addButton can target another set and creates it when missing', () => {
  const out = addButton(makeButtons(), promptButton('w1'), 'work')
  expect(out.sets.work?.map(b => b.id)).toEqual(['w1'])
  expect(out.activeSet).toBe('default')
  expect(allButtons(out)).toHaveLength(3)
})

test('nextButtonId is unique across every set', () => {
  const config = addButton(makeButtons(), promptButton('x'), 'work')
  const first = nextButtonId(config, 1234)
  expect(first).toBe((1234).toString(36).replace(/^/, 'b'))
  const again = nextButtonId(addButton(config, promptButton(first)), 1234)
  expect(again).not.toBe(first)
  expect(allButtons(addButton(config, promptButton(first))).map(b => b.id)).not.toContain(again)
})

test('the default config has the two examples with stable ids, in the language of t', () => {
  const en = defaultButtonConfig(t)
  expect(en.activeSet).toBe('default')
  expect(en.sets.default).toEqual([
    { id: 'ex-review', kind: 'prompt', label: 'Review', text: 'Review the change you just made and list the risks.', mode: 'fill' },
    { id: 'ex-usage', kind: 'command', label: '/usage', command: 'usage', mode: 'run' },
  ])
  const ko = defaultButtonConfig(translator('ko'))
  expect(ko.sets.default?.[0]?.label).toBe('검토')
  expect(ko.sets.default?.[1]).toEqual(en.sets.default?.[1])
  expect(defaultButtonConfig(t)).not.toBe(defaultButtonConfig(t))
})

test('short labels keep whole characters up to 4 cells; long labels are untouched', () => {
  const wide = promptButton('w', { label: '한글라벨' })
  expect(buttonLabel(wide, 'long', cells, 'icon+label')).toBe('한글라벨')
  expect(buttonLabel(wide, 'short', cells, 'icon+label')).toBe('한글')
  expect(buttonLabel(promptButton('a', { label: '/commit' }), 'short', cells, 'label')).toBe('/com')
  expect(buttonLabel(promptButton('a', { label: 'Go' }), 'short', cells, 'icon')).toBe('Go')
  expect(clipCells('a😀b', 2, cells)).toBe('a')
  expect(clipCells('a😀b', 3, cells)).toBe('a😀')
  expect(clipCells('abc', 0, cells)).toBe('')
})
