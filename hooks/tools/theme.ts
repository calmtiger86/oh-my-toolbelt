// The light and dark theme button. It shows while Claude Code's theme is one of /config's own and has a pair: dark
// swaps for light in its name (dark-ansi and light-ansi), and auto goes dark. A custom theme hides it, as a press could
// never come back to it (/config refuses a custom theme by value).
import type { Effect } from '../lib/effects'
import type { TFn } from '../lib/i18n'
import { faceOf } from '../lib/icons'
import type { IconStyle } from '../lib/icons'

export type ThemeRow = { value: string; options: string[] }

// One cell wide in every terminal, East Asian ones too (◐ and ◑ are Ambiguous and take two there).
const ICON = { toLight: '☀', toDark: '☾' } as const

// The theme row of `$.config.list()`, kept only when its value is one of its options.
export function themeRowOf(row: { value: unknown; options?: readonly string[] } | undefined): ThemeRow | null {
  if (row === undefined || typeof row.value !== 'string') return null
  const options = [...(row.options ?? [])]
  return options.length >= 2 && options.includes(row.value) ? { value: row.value, options } : null
}

const isDark = (value: string): boolean => value.includes('dark')

// The theme a press moves to, or null when /config offers no pair for this one.
export function otherTheme(row: ThemeRow): string | null {
  const target = row.value === 'auto' ? 'dark' : isDark(row.value) ? row.value.replace('dark', 'light') : row.value.replace('light', 'dark')
  return target !== row.value && row.options.includes(target) ? target : null
}

// The label says what a press does: Light while the theme is dark, Dark otherwise.
export function themeLabel(row: ThemeRow, size: 'long' | 'short', style: IconStyle, picked: string | undefined, t: TFn): string {
  const toLight = isDark(row.value)
  return faceOf(style, size, picked ?? (toLight ? ICON.toLight : ICON.toDark), t(toLight ? 'theme.toLight' : 'theme.toDark'))
}

export function themeEffects(row: ThemeRow): Effect[] {
  const target = otherTheme(row)
  return target === null ? [] : [{ kind: 'config.set', key: 'theme', value: target }]
}
