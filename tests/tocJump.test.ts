// What hooks/toc-live.ts makes of a jump's answer. The test host does not answer a mod's scroll to a transcript row, so
// the module is driven here with a stand-in for `$` that keeps timers and state to itself.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'
import { engineOf } from '../hooks/register'
import { noteJump, notePromptRow, tocTarget, tocView } from '../hooks/toc-live'
import { tick } from '../hooks/tools/toc'

const timer = { cancel: () => undefined }
const stand = engineOf({
  // engineOf reads the plugin's name and root once.
  plugin: { name: 'oh-my-toolbelt', root: '/' },
  clock: { after: () => timer },
  ui: { log: () => undefined, invalidate: () => undefined },
  state: { get: async () => ({ value: 0 }), set: async () => undefined },
} as unknown as EngineInterface)

const marks = () => tocView().rows.map(row => tick(row.isCurrent, row.isUnreachable))

test('a prompt with no row to scroll to is dotted and passed over, and a landing makes it reachable again', async () => {
  notePromptRow(stand, 'u1', 'first', undefined, 0)
  notePromptRow(stand, 'u2', 'second', undefined, 0)
  notePromptRow(stand, 'u3', 'third', undefined, 0)
  expect(marks()).toEqual(['─', '─', '─'])
  // The engine's own refusal strings, found in the 2.1.309 binary.
  expect(await noteJump(stand, 'u3', 'nothing drawn under that requestId')).toBe('toast.tocNotDrawn')
  expect(marks()).toEqual(['─', '─', '┄'])
  // From nowhere, prev starts at the newest and passes over the dotted one; last does not.
  expect(tocTarget({ kind: 'prev' })).toBe('u2')
  expect(tocTarget({ kind: 'last' })).toBe('u3')
  // A screen that cannot scroll is said once, and dots nothing; another refusal says it could not.
  expect(await noteJump(stand, 'u1', 'transcript not scrollable here')).toBe('toast.tocUnscrollable')
  expect(await noteJump(stand, 'u1', 'transcript not scrollable here')).toBeUndefined()
  expect(await noteJump(stand, 'u1', 'the window moved meanwhile')).toBe('toast.scrollRejected')
  expect(marks()).toEqual(['─', '─', '┄'])
  // A landing: reachable again, and the prompt jumped to is the one being read.
  expect(await noteJump(stand, 'u3', undefined)).toBeUndefined()
  expect(marks()).toEqual(['─', '─', '━'])
  expect(tocTarget({ kind: 'prev' })).toBe('u2')
  expect(tocTarget({ kind: 'next' })).toBeUndefined()
})
