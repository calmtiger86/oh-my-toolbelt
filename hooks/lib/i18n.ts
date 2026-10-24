// Language tables, `t` and the language decision order. Pure: environment variables and the Intl locale are read by the
// caller and passed in.
import { en } from '../locales/en'
import { ja } from '../locales/ja'
import { ko } from '../locales/ko'
import type { Messages } from '../locales/en'

export const LANGS = ['en', 'ko', 'ja'] as const
export type Lang = (typeof LANGS)[number]
export type TFn = (key: string, args?: Record<string, unknown>) => string
export type ResolvedLanguage = { lang: Lang; locale: string }

const TABLE: Record<Lang, Messages> = { en, ko, ja }
const isLang = (value: string): value is Lang => (LANGS as readonly string[]).includes(value)
const lookup = (messages: Messages, key: string): string | undefined => {
  const value = (messages as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

// Replaces {name} with args.name. A placeholder with no matching argument stays as written.
function interpolate(text: string, args?: Record<string, unknown>): string {
  if (!args) return text
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(args, name) ? String(args[name]) : placeholder))
}

// Looks the key up in `lang`, then in English. An unknown key comes back as itself, so a typo shows.
export function t(lang: Lang, key: string, args?: Record<string, unknown>): string {
  return interpolate(lookup(TABLE[lang], key) ?? lookup(en, key) ?? key, args)
}

// One function per language, so a cache can tell a language change by the function alone.
const translators = new Map<Lang, TFn>()
export function translator(lang: Lang): TFn {
  const known = translators.get(lang)
  if (known !== undefined) return known
  const made: TFn = (key, args) => t(lang, key, args)
  translators.set(lang, made)
  return made
}
export const directionOf = (lang: Lang): 'ltr' | 'rtl' => TABLE[lang].dir

// "ko_KR.UTF-8" becomes "ko-KR". "C", "C.UTF-8", "POSIX" and an empty value are not language tags
// (the pattern wants a 2-3 letter language), so they are skipped.
function toTag(raw: string | undefined): string | null {
  if (!raw) return null
  const tag = (raw.split(/[.@]/)[0] ?? '').replace(/_/g, '-')
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : null
}

// The language is the setting when it names a supported language; otherwise the first supported
// language among the environment values (given in order: LC_ALL, LC_MESSAGES, LANG) and then the
// Intl default locale; otherwise English. The locale for time formats is separate: the first valid
// full tag from the same list (e.g. "de-DE" even though the interface falls back to English).
export function resolveLanguage(
  setting: string,
  envValues: readonly (string | undefined)[],
  intlLocale?: string,
): ResolvedLanguage {
  const tags = [...envValues, intlLocale].map(toTag).filter((tag): tag is string => tag !== null)
  const fromTags = tags.map(tag => (tag.split('-')[0] ?? '').toLowerCase()).find(isLang)
  return { lang: (isLang(setting) ? setting : undefined) ?? fromTags ?? 'en', locale: tags[0] ?? 'en' }
}

// The locale for words such as a weekday: the language picked in the setting when the time locale speaks another one,
// so Korean on an en_US computer writes `금`; otherwise the time locale, so a German computer with no language picked
// keeps `23.10.2026 Fr`.
export const wordLocale = (resolved: ResolvedLanguage, setting: unknown): string =>
  isLang(String(setting)) && (resolved.locale.split('-')[0] ?? '').toLowerCase() !== resolved.lang ? resolved.lang : resolved.locale

// The runtime's default locale (step 3 of the language decision order), or undefined where Intl cannot say.
export function systemLocale(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}
