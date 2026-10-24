// The prompts tab's hooks on turns, out of register.tsx for its 800-line cap, and the debug line a failed hook leaves.
// They read no `$.state` value, so they need no atom of register.tsx.
import type { EngineInterface, HookFailure, On } from 'claude-code'
import { noteTranscript } from './toc-history'
import { noteAppend, notePromptRow, notePromptSent, noteTurnEnd, noteTurnStart } from './toc-live'
import { isOwnPrompt, isTocKind } from './tools/toc'
import { cleanText } from './tools/transcript'

// What this module load knows that the hooks ask (register.tsx's `runtime`).
type Live = () => { isActive: boolean; isStoreReadOnly: boolean }

export function logHookFailure($: EngineInterface, hook: string, failure?: HookFailure): void {
  $.ui.log(`oh-my-toolbelt: ${hook} hook failed (${failure?.kind ?? 'throw'}): ${failure?.message ?? ''}`, { to: 'debug' })
}

// Which rows answer which prompt and what each prompt's turn did, for the prompts tab's cards, and the prompts sent
// before this load, from the transcript file (startSession reads it after a reload). Each passes its event on
// unchanged; with the tab off (`live().isActive` false) they note nothing and read no file. SessionStart's runs after
// the one above, so the session is loaded again (or /clear has emptied the table) first.
export function registerTurns(on: On, live: Live): void {
  on('classic.SessionStart', async ($, e, next) => {
    await noteTranscript($, e, live().isActive, !live().isStoreReadOnly)
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'classic.SessionStart transcript', next.error), next(e)))

  // A person's prompt from Remote Control comes as a delivery: noted as prompt.submit notes one typed.
  on('session.receive', async ($, e, next) => {
    if (live().isActive && e.agentId === undefined && isTocKind(e.origin.kind)) await notePromptSent($, e.text, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'session.receive', next.error), next(e)))

  // The send button's prompt is listed as its row is appended: 2.1.310 draws that row to every plugin's UserMessage hook
  // but this mod's, and runs none of its prompt.submit. A row drawn too (the test host draws it) is the same entry.
  on('session.append', { door: ['prompt', 'response'] }, async ($, e, next) => {
    if (live().isActive) noteAppend(e, $.plugin.name)
    const isSent = e.door === 'prompt' && e.agentId === undefined && e.message.type === 'user' && e.message.isMeta !== true
    if (live().isActive && isSent && isOwnPrompt(e.origin, $.plugin.name)) notePromptRow($, e.uuid, cleanText(e.message.content), undefined, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'session.append', next.error), next(e)))

  on('turn.start', async ($, e, next) => {
    if (live().isActive) await noteTurnStart($, e.agentId)
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'turn.start', next.error), next(e)))

  on('turn.complete', async ($, e, next) => {
    if (live().isActive) await noteTurnEnd($, e)
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'turn.complete', next.error), next(e)))
}
