// What the hooks on the rows of the conversation do: the prompts tab's notes, the curtain and its restore. The hook
// bodies are here; register.tsx registers them and holds the curtain's `$.state` value (its `curtain` cell), which it
// reads and changes through the two functions below.
import type { Hook, MatchedHook } from 'claude-code'
import { drawCurtain } from './curtain'
import type { Engine } from './runtime'
import { noteCommandSent, notePromptRow, notePromptSent, noteReplyRow } from './toc-live'
import { isHumanOrigin } from './tools/command'
import { isOwn, isTocKind, isTocRow } from './tools/toc'

export function isCurtainOn(engine: Engine): Promise<boolean> {
  return engine.cells.curtain.read()
}

export async function changeCurtain(engine: Engine, change: (isOn: boolean) => boolean): Promise<void> {
  await engine.cells.curtain.update(change)
}

// What this module load knows that the hooks ask (register.tsx's `runtime`), asked at each event: a change to the
// mod's own rows comes without a reload.
type Live = () => { isTocLive: boolean; restoresCurtain: boolean }

// The hooks as register.tsx registers them, for their `e`, `next` and result.
type PromptRowHook = MatchedHook<'ui.render', { readonly component: 'UserMessage' }>
type RowHook = MatchedHook<'ui.render', { readonly component: readonly ['AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'TurnDuration', 'InfoNotice', 'ToolProgress'] }>
type SubmitHook = Hook<'prompt.submit'>

// Note each prompt the person sent as its row is drawn, and where it is on screen, then draw the row as it was (or,
// under the curtain, as nothing: the note comes first, so the prompts tab keeps filling). The engine draws only the
// rows in range; the transcript file fills in the prompts sent before this load (toc-hooks.ts). The send button's
// row never comes here (2.1.310): session.append lists it, and the curtain cannot cover it.
export async function drawPromptRow(engine: Engine, e: Parameters<PromptRowHook>[1], next: Parameters<PromptRowHook>[2], live: Live): Promise<Awaited<ReturnType<PromptRowHook>>> {
  if (live().isTocLive && isTocRow(e.props, engine.plugin.name)) notePromptRow(engine, e.requestId, e.props.text, e.props.onScreen, await engine.clock.now())
  if (!(await isCurtainOn(engine))) return next(e)
  return drawCurtain(engine.ui.resolve(e))
}

// Under the curtain every other row that carries the conversation draws an empty box, with no line why (the band's
// button reads Show); a hook that fails draws the row as it was, so a failure lifts the curtain. A reply or tool
// row's place on screen is noted first, as the prompt's is in drawPromptRow.
export async function drawRow(engine: Engine, e: Parameters<RowHook>[1], next: Parameters<RowHook>[2], live: Live): Promise<Awaited<ReturnType<RowHook>>> {
  if (live().isTocLive && 'onScreen' in e.props) noteReplyRow(engine, e.component, e.requestId, e.props.onScreen, 'calls' in e.props ? e.props.calls : undefined)
  if (!(await isCurtainOn(engine))) return next(e)
  return drawCurtain(engine.ui.resolve(e))
}

// With curtainRestoreOnSubmit the person's own prompt lowers the curtain; only a prompt the person sent counts, so a
// background task or another plugin cannot lift it. The prompts tab notes a prompt the person sent, as one sent while
// a turn runs is drawn under ids the engine never stores, and a slash command the person or this mod's button ran, as
// its own row comes next (toc-live.ts noteCommandSent). Either way it passes the prompt on. 2.1.310 runs none of this
// mod's prompt.submit for its own submit, so the send button's prompt is judged where register.tsx sends it; a command
// this mod runs comes here.
export async function submitPrompt(engine: Engine, e: Parameters<SubmitHook>[1], next: Parameters<SubmitHook>[2], live: Live): Promise<Awaited<ReturnType<SubmitHook>>> {
  if (live().restoresCurtain && isHumanOrigin(e.origin) && (await isCurtainOn(engine))) await changeCurtain(engine, () => false)
  if (live().isTocLive && isTocKind(e.origin.kind) && e.command === undefined && e.isMeta !== true) await notePromptSent(engine, e.text, await engine.clock.now())
  if (live().isTocLive && (isTocKind(e.origin.kind) || isOwn(e.origin, engine.plugin.name)) && e.command !== undefined && e.isMeta !== true) noteCommandSent(e.command.name)
  return next(e)
}
