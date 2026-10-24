// The hooks on the rows of the conversation: the prompts tab's notes, the curtain and its restore, out of register.tsx
// for its 800-line cap. The curtain's `$.state` value lives here, as validate wants each atom in the file that reads
// and writes it; register.tsx reads and changes it through the two functions below.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import { drawCurtain } from './curtain'
import { notePromptRow, notePromptSent, noteReplyRow } from './toc-live'
import { logHookFailure } from './toc-hooks'
import { isHumanOrigin } from './tools/command'
import { isTocKind, isTocRow } from './tools/toc'

const curtainState = atom({ plugin: 'oh-my-toolbelt', key: 'curtain' } as const, false)

export function isCurtainOn($: EngineInterface): Promise<boolean> {
  return read($, curtainState)
}

export async function changeCurtain($: EngineInterface, change: (isOn: boolean) => boolean): Promise<void> {
  await update($, curtainState, change)
}

// What this module load knows that the hooks ask (register.tsx's `runtime`), asked at each event: a change to the
// mod's own rows comes without a reload.
type Live = () => { isTocLive: boolean; restoresCurtain: boolean }

export function registerTranscript(on: On, live: Live): void {
  // Note each prompt the person sent as its row is drawn, and where it is on screen, then draw the row as it was (or,
  // under the curtain, as nothing: the note comes first, so the prompts tab keeps filling). The engine draws only the
  // rows in range; the transcript file fills in the prompts sent before this load (registerTurns). The send button's
  // row never comes here (2.1.310): session.append lists it, and the curtain cannot cover it.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (live().isTocLive && isTocRow(e.props, $.plugin.name)) notePromptRow($, e.requestId, e.props.text, e.props.onScreen, await $.clock.now())
    if (!(await isCurtainOn($))) return next(e)
    return drawCurtain($.ui.resolve(e))
  }).catch(($, e, next) => (logHookFailure($, 'ui.render UserMessage', next.error), next(e)))

  // Under the curtain every other row that carries the conversation draws an empty box, with no line why (the band's
  // button reads Show); a hook that fails draws the row as it was, so a failure lifts the curtain. A reply or tool
  // row's place on screen is noted first, as the prompt's is in the UserMessage hook above.
  on('ui.render', { component: ['AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'TurnDuration', 'InfoNotice', 'ToolProgress'] }, async ($, e, next) => {
    if (live().isTocLive && 'onScreen' in e.props) noteReplyRow($, e.component, e.requestId, e.props.onScreen, 'calls' in e.props ? e.props.calls : undefined)
    if (!(await isCurtainOn($))) return next(e)
    return drawCurtain($.ui.resolve(e))
  }).catch(($, e, next) => (logHookFailure($, 'ui.render curtain', next.error), next(e)))

  // With curtainRestoreOnSubmit the person's own prompt lowers the curtain; only a prompt the person sent counts, so a
  // background task or another plugin cannot lift it. The prompts tab notes a prompt the person sent, as one sent while
  // a turn runs is drawn under ids the engine never stores. With neither it passes the prompt on. 2.1.310 runs none of
  // this mod's prompt.submit for its own submit, so the send button's prompt is judged where register.tsx sends it.
  on('prompt.submit', async ($, e, next) => {
    if (live().restoresCurtain && isHumanOrigin(e.origin) && (await isCurtainOn($))) await changeCurtain($, () => false)
    if (live().isTocLive && isTocKind(e.origin.kind) && e.command === undefined && e.isMeta !== true) await notePromptSent($, e.text, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => (logHookFailure($, 'prompt.submit', next.error), next(e)))
}
