// Shared fixtures for the pure-function tests. Not a test file: the runner only loads *.test.ts.
import type { PluginOptions } from 'claude-code'
import type { ButtonConfig, ToolButton } from '../types/index'
import { translator } from '../hooks/lib/i18n'
import { idlePomodoro } from '../hooks/tools/pomodoro'
import { defaultLayout } from '../hooks/tools/registry'
import type { Ctx, Snapshot } from '../hooks/tools/registry'
import { defaultButtonConfig } from '../hooks/tools/user'

export const t = translator('en')

// A stand-in for cellsOf: East Asian letters and emoji take two cells, everything else one.
// Ranges are plain numbers: unicode escapes in source files get expanded into raw characters by some tools.
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xff00, 0xff60],
]
const EMOJI = /\p{Extended_Pictographic}/u
const isWide = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0
  return WIDE_RANGES.some(([lo, hi]) => code >= lo && code <= hi) || EMOJI.test(ch)
}
export const cells = (text: string): number => Array.from(text).reduce((sum, ch) => sum + (isWide(ch) ? 2 : 1), 0)

export const NOW = Date.UTC(2026, 9, 22, 5, 32, 0)

export function makeButtons(): ButtonConfig {
  return defaultButtonConfig(t)
}

export const promptButton = (id: string, over: Partial<ToolButton> = {}): ToolButton => ({
  id, kind: 'prompt', label: id, text: `text ${id}`, mode: 'fill', ...over,
})

export function makeState(over: Partial<Snapshot> = {}): Snapshot {
  const buttons = over.buttons ?? makeButtons()
  return {
    clockLabel: '2:32 PM',
    pomodoro: idlePomodoro(NOW),
    weather: { status: 'off', label: '', shortLabel: '', fetchedAt: null },
    curtain: false,
    voice: { isAvailable: false, requested: null },
    bandHidden: false,
    bandFolded: false,
    clipBoard: { clips: [], seen: null, changing: null },
    paneTab: 'tools',
    paneStarted: false,
    tocMoved: 0,
    guideSection: 'start',
    buttons,
    layout: defaultLayout(buttons),
    icons: {},
    iconGroup: 'work',
    openPicker: null,
    notes: [],
    exportFormat: 'md',
    themeRow: null,
    settings: [],
    soundPick: null,
    settingsSource: 'engine',
    editDraft: null,
    lastError: null,
    ...over,
  }
}

export function makeCtx(over: Partial<Omit<Ctx, 'state' | 'options'>> & { state?: Partial<Snapshot>; options?: PluginOptions } = {}): Ctx {
  const { state, options, ...rest } = over
  return {
    surface: 'terminal',
    options: { iconStyle: 'icon+label', hotkeysEnabled: true, ...options },
    state: makeState(state),
    t,
    now: NOW,
    locale: 'en',
    cells,
    ...rest,
  }
}
