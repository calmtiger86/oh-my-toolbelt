// Effects: what a pure tool function asks the host to do. Only register.tsx's runEffect turns them into `$` calls, so
// tool logic stays testable without `$`.
import type { PluginState } from 'claude-code'
import type { PaneTab } from '../../types/index'
import type { ExportFormat } from './export'

export type StateKey = keyof PluginState['oh-my-toolbelt']

export type Effect =
  | { kind: 'prompt.fill'; text: string; mode: 'replace' | 'append' | 'insert' }
  | { kind: 'prompt.submit'; text: string; asUser?: true }
  | { kind: 'command.run'; command: string; args?: string }
  | { kind: 'config.set'; key: string; value: string | boolean | number }
  | { kind: 'ui.open'; tab: PaneTab }
  // Open the panel, or close it when it is already showing (the band's edit button).
  | { kind: 'ui.toggle'; tab: PaneTab }
  | { kind: 'ui.close' }
  | { kind: 'ui.toast'; text: string; timeoutMs?: number }
  // Goes through the do-not-disturb and surface guards.
  | { kind: 'notify'; text: string; title?: string }
  // Goes through the do-not-disturb and settings guards.
  | { kind: 'audio.play'; asset: string }
  | { kind: 'state.update'; key: StateKey; fn: (value: unknown) => unknown }
  | { kind: 'store.set'; key: string; value: unknown }
  // Save the conversation to files: in this format, or the last one chosen.
  | { kind: 'export'; format?: ExportFormat }
  // Open the system's file picker and put the picked paths in the prompt box.
  | { kind: 'attach' }
  // Run /voice with this argument; the voice state follows only a run that went through.
  | { kind: 'voice'; next: 'tap' | 'hold' | 'off' }
  | { kind: 'log'; text: string }
