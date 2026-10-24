// Icons for the toolbelt buttons: the groups the pickers list, the three icon styles, and the small pure helpers that
// turn a pick into a label or a list of choices. Pure: no `$`.
import type { ToolIcons } from '../../types/index'
import type { TFn } from './i18n'

// Stored and picked as these words: "none" is kept, "default" is the key being absent.
export const ICON_NONE = 'none'
export const ICON_DEFAULT = 'default'
// A Select takes at most 64 choices (2.1.308): a group, plus "default", "none" and a pick from another group, stays under.
export const ICON_GROUP_MAX = 60

export type IconGroup = { id: string; icons: readonly string[] }

// Emoji groups hold characters with Emoji_Presentation=Yes written as one code point, which a terminal draws two cells
// wide. The symbols group holds text-drawn characters one cell wide whose East Asian Width is Neutral or Narrow: an
// Ambiguous one (a star, a filled circle) is two cells wide in Korean and Japanese terminals and would break every width.
// Spelled as strings, split into code points below.
const EMOJI_WORK = '💼📁📂📄📋📌📎📝💻🔧🔨🔍🔎🔗📊📈📉📅📆📧📨📤📥📦🧪🧰🧮🤖🧠💡🎯🚀✅❌🔒🔓🔑🐛🧹🧾📐📏🔬🔭📡💾💿📀'
const EMOJI_TIME = '⏰⏳⌛⌚🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛🔔🔕❗❓⚡🔥⭐🌟✨💯🔴🔵⚫⚪➕➖⏩⏪⏫⏬🚦🚩🏁🎉🎊💤🔄🔁🔃'
const EMOJI_OBJECTS = '🏠🏢🏫🏥🚗🚌🚲🚂📱📞📷📹🎥📺📻🎧🎤🎵🎶🎮🎲🧩🎨📚📖📕📗📘📙📓📒🎓🏆🏅🎁🛒💰💳💎⚽⚾🏀☕🍎🍕🍔🍜🍺🔋💊🎸🎹🔦🔮'
const EMOJI_NATURE = '🌱🌲🌳🌴🌵🌷🌸🌹🌻🍀🍁🍂🍃🌍🌙🌞⛅☔🌈🌊🐶🐱🐭🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐢🐍🐙🐟🐬🐳🦋🐝🦄🐞🌼🍄🌰'
const EMOJI_FACES = '😀😃😄😁😆😅😂🙂😉😊😇😍😘😋😎🤓🤔😐😴😮😢😭😡😱🥳🥺🤯🤗🙄😬👍👎👌👏🙏💪👋✋👀💙💚💛💜🧡🖤💔💕🤝👊🙌'
const SYMBOLS = '✓✗✘✎✐✑⌘⌥⌫⌦⏎⌃➜➤➔➙➝⇨⇦⇩↻↺⟳⟲⧗⏻⏼⏽⌂⌕⌖⎈⚑⚐☐☒✦✧✱✲✪✿❀❖✚✠❁❅❆❯❮☾☽♫▸◦◌▢'

const codePoints = (text: string): readonly string[] => Array.from(text)

// The group ids are the keys `icon.group.<id>` of the language files.
export const ICON_GROUPS: readonly IconGroup[] = [
  { id: 'work', icons: codePoints(EMOJI_WORK) },
  { id: 'time', icons: codePoints(EMOJI_TIME) },
  { id: 'objects', icons: codePoints(EMOJI_OBJECTS) },
  { id: 'nature', icons: codePoints(EMOJI_NATURE) },
  { id: 'faces', icons: codePoints(EMOJI_FACES) },
  { id: 'symbols', icons: codePoints(SYMBOLS) },
]
export const DEFAULT_ICON_GROUP = 'work'

const LISTED: ReadonlySet<string> = new Set(ICON_GROUPS.flatMap(group => group.icons))

// Whether a value is an icon of some group. A stored or typed value is checked with this before it is drawn.
export const isListedIcon = (value: unknown): value is string => typeof value === 'string' && LISTED.has(value)

// A group id from outside (a pick, the session state); anything else is the first group.
export const asIconGroup = (value: unknown): string => ICON_GROUPS.find(group => group.id === value)?.id ?? DEFAULT_ICON_GROUP

// ---- Icon style (the `iconStyle` setting) ----

export type IconStyle = 'icon+label' | 'icon' | 'label'

// The older values `emoji` and `text` are not in the list; the engine reads them as the default, and so does this.
export const iconStyleOf = (value: unknown): IconStyle => (value === 'icon' || value === 'label' ? value : 'icon+label')

// What a button draws: its icon and its word, by the style and the room the band gives it. A button with no icon
// ('') shows its word whatever the style says. `shortWord` is the word when the band is tight.
export function faceOf(style: IconStyle, size: 'long' | 'short', icon: string, word: string, shortWord: string = word): string {
  if (style === 'label' || icon === '') return size === 'long' ? word : shortWord
  if (style === 'icon') return icon
  return size === 'long' ? `${icon} ${word}` : icon
}

// ---- The fixed tools' icons (store key `icons`) ----

// The buttons of the toolbelt that take a picked icon: not `…`, and not the clock, date and weather cells.
export const ICON_TOOLS: readonly string[] = ['pomodoro', 'curtain', 'export', 'notes', 'edit', 'theme', 'voice', 'attach']

// The stored icons, cleaned: only the tools above, each with "none" or an icon of a group.
export function asIcons(value: unknown): ToolIcons {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const picks = ICON_TOOLS.flatMap(id => {
    const pick = Object.hasOwn(raw, id) ? raw[id] : undefined
    return pick === ICON_NONE || isListedIcon(pick) ? [[id, pick] as const] : []
  })
  return Object.fromEntries(picks)
}

// The pick for a tool: undefined for its own icon, '' for none, else the icon.
export function pickedIcon(icons: ToolIcons, id: string): string | undefined {
  const pick = Object.hasOwn(icons, id) ? icons[id] : undefined
  return pick === ICON_NONE ? '' : pick
}

// The icons after a pick, or null when the tool takes no icon or the value is not a choice.
export function withToolIcon(icons: ToolIcons, id: string, value: string): ToolIcons | null {
  if (!ICON_TOOLS.includes(id)) return null
  const rest = Object.fromEntries(Object.entries(icons).filter(([key]) => key !== id))
  if (value === ICON_DEFAULT) return rest
  return value === ICON_NONE || isListedIcon(value) ? { ...rest, [id]: value } : null
}

// ---- The pickers ----

export type Choice = { value: string; label: string }

export const groupChoices = (t: TFn): Choice[] => ICON_GROUPS.map(group => ({ value: group.id, label: t(`icon.group.${group.id}`) }))

// Each fixed tool's own icon (the curtain's as it shows while off). A tool's "default" choice is drawn as this icon, so
// a closed list shows the icon the band shows rather than a word. Kept beside the tools' own constants in hooks/tools;
// tests/icons.test.ts checks every tool that takes an icon has one.
export const OWN_ICONS: Readonly<Record<string, string>> = { pomodoro: '🍅', curtain: '▢', export: '⇩', notes: '📝', edit: '⚙', theme: '☾', voice: '🎤', attach: '📎' }

// The choices of one icon Select: "default" (a fixed tool only, drawn as `own`, its own icon), "none", the current pick
// when it belongs to another group, then the group's icons. `current` is a value of the Select: an icon, ICON_NONE or
// ICON_DEFAULT.
export function iconChoices(t: TFn, group: string, current: string, own: string | null): Choice[] {
  // The tool's own icon is the Default row: listed again it would be a second, identical row that stores the icon
  // itself (the curtain's ▢ would then no longer change to ▣ when on).
  const listed = (ICON_GROUPS.find(g => g.id === group)?.icons ?? []).filter(icon => icon !== own)
  const elsewhere = isListedIcon(current) && !listed.includes(current) ? [{ value: current, label: current }] : []
  return [
    ...(own === null ? [] : [{ value: ICON_DEFAULT, label: own }]),
    { value: ICON_NONE, label: t('icon.none') },
    ...elsewhere,
    ...listed.map(icon => ({ value: icon, label: icon })),
  ]
}
