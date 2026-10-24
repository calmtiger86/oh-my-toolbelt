// The toolbelt folded to one button by its ◂ mark. The engine's [-] puts a line of its own in the band's place, where a
// mod draws nothing, so this fold is the mod's. Kept in the store, as bandHidden is.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

// The store key, the same word as the state's key.
export const FOLDED_KEY = 'bandFolded'
const bandFoldedState = atom({ plugin: 'oh-my-toolbelt', key: 'bandFolded' } as const, false)

export function isBandFolded($: EngineInterface): Promise<boolean> {
  return read($, bandFoldedState)
}

// At start and after /clear, /resume and /branch: the store's.
export async function loadFold($: EngineInterface): Promise<void> {
  const stored = await $.store.get(FOLDED_KEY)
  await update($, bandFoldedState, () => stored === true)
}

// A press on the mark or on the folded button; register.tsx saves it under FOLDED_KEY.
export async function setBandFolded($: EngineInterface, isFolded: boolean): Promise<void> {
  await update($, bandFoldedState, () => isFolded)
}
