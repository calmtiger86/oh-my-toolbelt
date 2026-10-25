// What the prompts tab's hooks on turns do, and the debug line a failed hook leaves. The hook bodies are here;
// register.tsx registers them. They read no `$.state` value, so they need no cell of register.tsx.
import type { Hook, HookFailure, MatchedHook } from 'claude-code'
import type { Engine } from './runtime'
import { noteTranscript } from './toc-history'
import { noteAppend, notePromptRow, notePromptSent, noteTurnEnd, noteTurnStart } from './toc-live'
import { isOwnPrompt, isTocKind } from './tools/toc'
import { cleanText } from './tools/transcript'

// What this module load knows that the hooks ask (register.tsx's `runtime`).
type Live = () => { isActive: boolean; isStoreReadOnly: boolean }

// The hooks as register.tsx registers them, for their `e`, `next` and result.
type SessionStartHook = Hook<'classic.SessionStart'>
type ReceiveHook = Hook<'session.receive'>
type AppendHook = MatchedHook<'session.append', { readonly door: readonly ['prompt', 'response'] }>
type TurnStartHook = Hook<'turn.start'>
type TurnCompleteHook = Hook<'turn.complete'>

export function logHookFailure(engine: Engine, hook: string, failure?: HookFailure): void {
  engine.ui.log(`oh-my-toolbelt: ${hook} hook failed (${failure?.kind ?? 'throw'}): ${failure?.message ?? ''}`, { to: 'debug' })
}

// Which rows answer which prompt and what each prompt's turn did, for the prompts tab's cards, and the prompts sent
// before this load, from the transcript file (startSession reads it after a reload). Each passes its event on
// unchanged; with the tab off (`live().isActive` false) they note nothing and read no file.
export async function readTranscript(engine: Engine, e: Parameters<SessionStartHook>[1], next: Parameters<SessionStartHook>[2], live: Live): Promise<Awaited<ReturnType<SessionStartHook>>> {
  await noteTranscript(engine, e, live().isActive, !live().isStoreReadOnly)
  return next(e)
}

// A person's prompt from Remote Control comes as a delivery: noted as prompt.submit notes one typed.
export async function receivePrompt(engine: Engine, e: Parameters<ReceiveHook>[1], next: Parameters<ReceiveHook>[2], live: Live): Promise<Awaited<ReturnType<ReceiveHook>>> {
  if (live().isActive && e.agentId === undefined && isTocKind(e.origin.kind)) await notePromptSent(engine, e.text, await engine.clock.now())
  return next(e)
}

// The send button's prompt is listed as its row is appended: 2.1.310 draws that row to every plugin's UserMessage hook
// but this mod's, and runs none of its prompt.submit. A row drawn too (the test host draws it) is the same entry.
export async function appendRow(engine: Engine, e: Parameters<AppendHook>[1], next: Parameters<AppendHook>[2], live: Live): Promise<Awaited<ReturnType<AppendHook>>> {
  if (live().isActive) noteAppend(e, engine.plugin.name)
  const isSent = e.door === 'prompt' && e.agentId === undefined && e.message.type === 'user' && e.message.isMeta !== true
  if (live().isActive && isSent && isOwnPrompt(e.origin, engine.plugin.name)) notePromptRow(engine, e.uuid, cleanText(e.message.content), undefined, await engine.clock.now())
  return next(e)
}

export async function startTurn(engine: Engine, e: Parameters<TurnStartHook>[1], next: Parameters<TurnStartHook>[2], live: Live): Promise<Awaited<ReturnType<TurnStartHook>>> {
  if (live().isActive) await noteTurnStart(engine, e.agentId)
  return next(e)
}

export async function completeTurn(engine: Engine, e: Parameters<TurnCompleteHook>[1], next: Parameters<TurnCompleteHook>[2], live: Live): Promise<Awaited<ReturnType<TurnCompleteHook>>> {
  if (live().isActive) await noteTurnEnd(engine, e)
  return next(e)
}
