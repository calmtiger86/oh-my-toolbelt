// The /toolbelt (and /tb) arguments. Pure: register.tsx runs what this returns.
import type { PromptOrigin } from 'claude-code'
import type { ExportFormat, PaneTab } from '../../types/index'
import { asExportFormat } from '../lib/export'
import { stripControls } from '../lib/schema'
import type { TFn } from '../lib/i18n'
import type { TocMove } from './toc'

export type PomodoroVerb = 'start' | 'pause' | 'stop' | 'reset'

export type ToolbeltCommand =
  | { op: 'open'; tab: PaneTab }
  | { op: 'band'; isHidden: boolean }
  | { op: 'pomodoro'; verb: PomodoroVerb }
  | { op: 'weather' }
  | { op: 'curtain'; isOn: boolean }
  // A move through the prompts; `/toolbelt toc` alone opens the tab.
  | { op: 'toc'; move: TocMove }
  // Without a format, the last one chosen.
  | { op: 'export'; format?: ExportFormat }
  // Words it does not know: answer the usage line, naming the first unknown word when there is one.
  | { op: 'usage'; unknown?: string }

// Shown after the command name in the typeahead: the sub-command words, which are not translated.
export const ARGUMENT_HINT = '[tools|toc|notes|clips|status|guide|toc next|prev|first|last|<n>|find <words>|hide|show|pomodoro start|pause|stop|reset|weather refresh|curtain on|off|export txt|md|html|pdf]'

// `more` was the tab the status tab took in; the word still opens it.
const TABS: Readonly<Record<string, PaneTab>> = { '': 'tools', tools: 'tools', toc: 'toc', notes: 'notes', clips: 'clips', more: 'status', status: 'status', guide: 'guide' }
const VERBS: readonly string[] = ['start', 'pause', 'stop', 'reset']
const TOC_STEPS: readonly string[] = ['next', 'prev', 'first', 'last']

export function parseCommand(args: string): ToolbeltCommand {
  const [first = '', ...rest] = stripControls(args).trim().toLowerCase().split(/\s+/)
  // Own keys only: `constructor` or `__proto__` is not a tab.
  const tab = Object.hasOwn(TABS, first) ? TABS[first] : undefined
  const isBand = first === 'hide' || first === 'show'
  if (tab !== undefined && rest.length === 0) return { op: 'open', tab }
  if (isBand && rest.length === 0) return { op: 'band', isHidden: first === 'hide' }
  if (first === 'pomodoro') {
    const verb = rest[0] ?? ''
    return VERBS.includes(verb) && rest.length === 1 ? { op: 'pomodoro', verb: verb as PomodoroVerb } : unknownWord(rest[0] ?? '')
  }
  if (first === 'weather') {
    const verb = rest[0] ?? ''
    if (verb === 'refresh' && rest.length === 1) return { op: 'weather' }
    return unknownWord(verb === 'refresh' ? (rest[1] ?? '') : verb)
  }
  if (first === 'toc') return tocCommand(rest)
  if (first === 'export') {
    const format = asExportFormat(rest[0])
    if (rest.length === 0) return { op: 'export' }
    return format !== null && rest.length === 1 ? { op: 'export', format } : unknownWord(format === null ? (rest[0] ?? '') : (rest[1] ?? ''))
  }
  if (first === 'curtain') {
    const verb = rest[0] ?? ''
    const isVerb = verb === 'on' || verb === 'off'
    return isVerb && rest.length === 1 ? { op: first, isOn: verb === 'on' } : unknownWord(isVerb ? (rest[1] ?? '') : verb)
  }
  // After a word it knows, the first extra word is the unknown one.
  return unknownWord(tab !== undefined || isBand ? (rest[0] ?? '') : first)
}

const unknownWord = (word: string): ToolbeltCommand => (word === '' ? { op: 'usage' } : { op: 'usage', unknown: word })

// The words of a find go back to the person in a toast, so they are cut to this many characters.
const FIND_CHARS_MAX = 80

// `toc next|prev|first|last`, `toc 12` or `toc #12`, `toc find <words>`; the words of a find keep their order.
function tocCommand(rest: readonly string[]): ToolbeltCommand {
  const [verb = '', ...more] = rest
  const number = /^#?(\d+)$/.exec(verb)?.[1]
  if (verb === 'find') return more.length > 0 ? { op: 'toc', move: { kind: 'find', words: Array.from(more.join(' ')).slice(0, FIND_CHARS_MAX).join('') } } : unknownWord('')
  if (more.length > 0) return unknownWord(more[0] ?? '')
  if (number !== undefined) return { op: 'toc', move: { kind: 'number', n: Number(number) } }
  return TOC_STEPS.includes(verb) ? { op: 'toc', move: { kind: verb as 'next' | 'prev' | 'first' | 'last' } } : unknownWord(verb)
}

// Hiding the band or the transcript and writing the conversation to a file are for the person alone: a typed command,
// the remote bridge, or the desktop app, whose sessions run over the SDK so what a person types there is `sdk` (its
// transcripts: promptSource "sdk"); never another plugin.
// ponytail: any active session's sdk prompt counts, as only one with a surface runs the mod; an SDK script that a phone
// attaches to would count too, so check `$.session.surfaces()` for the desktop if such hosts show up
export const isHumanOrigin = (origin: PromptOrigin): boolean => origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk'

const POMODORO_REPLY = { start: 'command.pomodoro.started', pause: 'command.pomodoro.paused', stop: 'command.pomodoro.stopped', reset: 'command.pomodoro.reset' } as const

// The line /toolbelt answers once the command ran. Opening the panel answers with no text.
export function replyFor(command: ToolbeltCommand, t: TFn): string | undefined {
  switch (command.op) {
    case 'open': return undefined
    // A move answers with a toast, as the person reads far above where a reply row would land.
    case 'toc': return undefined
    case 'band': return t(command.isHidden ? 'command.hidden' : 'command.shown')
    case 'pomodoro': return t(POMODORO_REPLY[command.verb])
    case 'weather': return t('command.weather.refreshing')
    // Raising the curtain hides this very reply, so the toast says it instead.
    case 'curtain': return command.isOn ? undefined : t('command.curtain.off')
    // register.tsx answers with where the files went.
    case 'export': return undefined
    case 'usage':
      return command.unknown === undefined
        ? t('command.usage')
        : `${t('command.error.unknownArgument', { arg: command.unknown })} ${t('command.usage')}`
  }
}
