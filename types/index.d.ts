export type PomodoroPhase = 'idle' | 'focus' | 'break' | 'paused'
export type Pomodoro = {
  phase: PomodoroPhase
  endsAt: number | null
  remainingMs: number | null
  remainingSec: number | null
  pausedFrom?: 'focus' | 'break'
  round: number
  updatedAt: number
}
export type WeatherState = {
  status: 'off' | 'loading' | 'ok' | 'error'
  // The long form `☀ 18°C Seoul` and the short form `☀ 18°`.
  label: string
  shortLabel: string
  fetchedAt: number | null
}
export type VoiceState = { isAvailable: boolean; requested: 'off' | 'tap' | 'hold' | null }
export type ToolButton = {
  id: string
  kind: 'prompt' | 'command' | 'skill'
  label: string
  hotkey?: string
  text?: string
  command?: string
  args?: string
  mode: 'fill' | 'send' | 'run'
  // An icon of the icon groups (hooks/lib/icons.ts); absent for none.
  icon?: string
}
export type ButtonConfig = { version: 1; sets: Record<string, ToolButton[]>; activeSet: string }
// The fixed tools' picked icons by tool id: an icon, or "none". A tool that is not listed has its own icon.
export type ToolIcons = Record<string, string>
export type Layout = { left: string[]; right: string[]; hidden: string[] }
export type Note = { id: string; text: string; createdAt: number }
// The clipboard tab (hooks/clips.ts): the selections copied by dragging, newest first; the selection read last; and
// the newest clip while its drag still changes it.
export type Clip = { id: string; text: string }
export type ClipBoard = { clips: Clip[]; seen: string | null; changing: string | null }
export type PaneTab = 'tools' | 'toc' | 'notes' | 'clips' | 'status' | 'guide'
// The part of the guide tab shown: first steps, daily tools, your own toolbelt, commands, help.
export type GuideSection = 'start' | 'daily' | 'custom' | 'commands' | 'help' | 'desktop'
export type ExportFormat = 'md' | 'txt' | 'html' | 'pdf'

declare module 'claude-code' {
  interface PluginState {
    'oh-my-toolbelt': {
      clockLabel: string
      pomodoro: Pomodoro
      weather: WeatherState
      curtain: boolean
      voice: VoiceState
      bandHidden: boolean
      // Folded to one button by its ◂ mark (hooks/fold.ts), kept in the store.
      bandFolded: boolean
      paneTab: PaneTab
      // paneOpenOnStart opened the panel in this run, so a reload does not open it again.
      paneStarted: boolean
      // Bumped when the prompts tab should draw again: where the person reads or a turn changed.
      tocMoved: number
      guideSection: GuideSection
      buttons: ButtonConfig
      layout: Layout
      icons: ToolIcons
      // The icon group the pickers list (the layout rows and the form); this session only.
      iconGroup: string
      // The panel's pick list that is open (hooks/picker.tsx), by its key; one at a time.
      openPicker: string | null
      notes: Note[]
      // The clipboard tab's selections; this session only (hooks/clips.ts).
      clipBoard: ClipBoard
      // The store's exportLast, mirrored for the status tab's format choice.
      exportFormat: ExportFormat
      themeRow: { value: string; options: string[] } | null
      // The mod's own /config rows, drawn and changed in the status tab (hooks/settings.ts).
      settings: ConfigRow[]
      // Whose rows those are: the engine's, or the mod's own from plugin.json where it lists none (hooks/own-settings.ts).
      settingsSource: 'engine' | 'own'
      // An alert sound picked in the status tab, waiting for the load its setting change starts (hooks/settings.ts).
      soundPick: { name: string; at: number } | null
      editDraft: Partial<ToolButton> | null
      lastError: string | null
    }
  }
}
