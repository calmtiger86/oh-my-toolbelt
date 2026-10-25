// The toolbelt folded to one button by its ◂ mark. The engine's [-] puts a line of its own in the band's place, where a
// mod draws nothing, so this fold is the mod's. Kept in the store, as bandHidden is.
import type { Engine } from './runtime'

// The store key, the same word as the state's key (register.tsx's bandFoldedState).
export const FOLDED_KEY = 'bandFolded'

export function isBandFolded(engine: Engine): Promise<boolean> {
  return engine.cells.bandFolded.read()
}

// At start and after /clear, /resume and /branch: the store's.
export async function loadFold(engine: Engine): Promise<void> {
  const stored = await engine.store.get(FOLDED_KEY)
  await engine.cells.bandFolded.update(() => stored === true)
}

// A press on the mark or on the folded button; register.tsx saves it under FOLDED_KEY.
export async function setBandFolded(engine: Engine, isFolded: boolean): Promise<void> {
  await engine.cells.bandFolded.update(() => isFolded)
}
