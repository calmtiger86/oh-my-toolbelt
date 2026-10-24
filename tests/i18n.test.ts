import { test, expect } from 'claude-code/testing'
import { LANGS, directionOf, resolveLanguage, t, translator, wordLocale } from '../hooks/lib/i18n'
import { en } from '../hooks/locales/en'
import { ja } from '../hooks/locales/ja'
import { ko } from '../hooks/locales/ko'

const tables = { en, ko, ja } as const
const keysOf = (table: object): string[] => Object.keys(table).sort()
const placeholders = (text: unknown): string[] => (typeof text === 'string' ? [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? '').sort() : [])

test('en, ko and ja have exactly the same keys', () => {
  expect(keysOf(ko)).toEqual(keysOf(en))
  expect(keysOf(ja)).toEqual(keysOf(en))
  expect([...LANGS].sort()).toEqual(['en', 'ja', 'ko'])
})

test('every language is left to right and has no empty text', () => {
  for (const [lang, table] of Object.entries(tables)) {
    expect(table.dir).toBe('ltr')
    for (const [key, value] of Object.entries(table)) {
      expect(typeof value, `${lang} ${key}`).toBe('string')
      expect(value.trim().length, `${lang} ${key}`).toBeGreaterThan(0)
    }
  }
})

test('every translation uses the same {placeholders} as the English text', () => {
  for (const [key, value] of Object.entries(en)) {
    expect(placeholders((ko as Record<string, unknown>)[key]), `ko ${key}`).toEqual(placeholders(value))
    expect(placeholders((ja as Record<string, unknown>)[key]), `ja ${key}`).toEqual(placeholders(value))
  }
})

// The product is Oh My Toolbelt in every language; 툴벨트 and ツールベルト name the row above the prompt.
test('the version line and the newer-store notice name the product, Oh My Toolbelt, in every language', () => {
  for (const lang of LANGS) {
    expect(t(lang, 'status.versions', { toolbelt: '0.1.0', claudeCode: '2.1.310' }), lang).toBe('Oh My Toolbelt 0.1.0 · Claude Code 2.1.310')
    expect(t(lang, 'status.storeNewer'), lang).toContain('Oh My Toolbelt')
  }
})

test('t fills {name} placeholders and reads the right language', () => {
  expect(t('en', 'user.error.label.tooLong', { max: 24 })).toBe('The label is too long (up to 24 cells wide).')
  expect(t('ko', 'pomodoro.start')).toBe('시작')
  expect(t('ja', 'pomodoro.start')).toBe('開始')
  expect(t('en', 'pane.hotkey', { key: 'k' })).toBe('Hotkey: k')
  expect(t('ko', 'toast.commandMissing', { command: 'usage' })).toBe('/usage 명령이 설치되어 있지 않습니다.')
})

test('a placeholder without an argument stays visible; extra arguments are ignored; numbers are written out', () => {
  expect(t('en', 'toast.commandMissing')).toBe('The /{command} command is not installed.')
  expect(t('en', 'toast.commandMissing', {})).toBe('The /{command} command is not installed.')
  expect(t('en', 'pomodoro.start', { unused: 1 })).toBe('Start')
  expect(t('en', 'user.error.label.tooLong', { max: 0 })).toBe('The label is too long (up to 0 cells wide).')
  expect(t('en', 'toast.commandMissing', { command: '{command}' })).toBe('The /{command} command is not installed.')
})

test('an unknown key comes back as the key itself', () => {
  expect(t('ko', 'no.such.key')).toBe('no.such.key')
  expect(t('en', 'constructor')).toBe('constructor')
})

test('translator gives the t function that Ctx carries', () => {
  const korean = translator('ko')
  expect(korean('edit.label')).toBe('편집')
  expect(korean('pane.hotkey', { key: 'x' })).toBe('단축키: x')
  expect(directionOf('ja')).toBe('ltr')
})

test('language: a supported setting wins over everything', () => {
  expect(resolveLanguage('ja', ['ko_KR.UTF-8'], 'en-US')).toEqual({ lang: 'ja', locale: 'ko-KR' })
  expect(resolveLanguage('en', [undefined, undefined, 'ko_KR.UTF-8'], 'ko-KR').lang).toBe('en')
})

test('language: auto reads LC_ALL, then LC_MESSAGES, then LANG (the order the caller passes)', () => {
  expect(resolveLanguage('auto', ['ja_JP.UTF-8', 'ko_KR.UTF-8', 'en_US.UTF-8'], 'en-US').lang).toBe('ja')
  expect(resolveLanguage('auto', [undefined, 'ko_KR.UTF-8', 'en_US.UTF-8']).lang).toBe('ko')
  expect(resolveLanguage('auto', [undefined, undefined, 'ko_KR.UTF-8'])).toEqual({ lang: 'ko', locale: 'ko-KR' })
})

test('language: empty, C and POSIX values are skipped', () => {
  expect(resolveLanguage('auto', ['', 'C', 'ko_KR.UTF-8']).lang).toBe('ko')
  expect(resolveLanguage('auto', ['POSIX', 'C.UTF-8', 'ja_JP']).lang).toBe('ja')
  expect(resolveLanguage('auto', ['C', 'POSIX', ''], 'ja-JP')).toEqual({ lang: 'ja', locale: 'ja-JP' })
})

test('language: an unsupported setting is ignored; an unsupported environment language falls through', () => {
  expect(resolveLanguage('xx', [undefined], 'ko-KR').lang).toBe('ko')
  const german = resolveLanguage('auto', ['de_DE.UTF-8'], 'ja-JP')
  expect(german).toEqual({ lang: 'ja', locale: 'de-DE' })
  expect(resolveLanguage('auto', ['de_DE.UTF-8'], 'fr-FR')).toEqual({ lang: 'en', locale: 'de-DE' })
})

test('language: the Intl default locale comes next, and English is the last resort', () => {
  expect(resolveLanguage('auto', [undefined, undefined, undefined], 'ko-KR')).toEqual({ lang: 'ko', locale: 'ko-KR' })
  expect(resolveLanguage('auto', [], 'en-US')).toEqual({ lang: 'en', locale: 'en-US' })
  expect(resolveLanguage('auto', [])).toEqual({ lang: 'en', locale: 'en' })
  expect(resolveLanguage('auto', ['@@@', '   '], '')).toEqual({ lang: 'en', locale: 'en' })
})

test('language: tags are cleaned of encoding and modifier, and keep scripts and regions', () => {
  expect(resolveLanguage('auto', ['ko_KR.eucKR@euro']).locale).toBe('ko-KR')
  expect(resolveLanguage('auto', ['sr_RS@latin']).locale).toBe('sr-RS')
  expect(resolveLanguage('auto', [], 'zh-Hans-CN').locale).toBe('zh-Hans-CN')
  expect(resolveLanguage('auto', ['JA_jp']).lang).toBe('ja')
})

// The band's weather chip splits its label at spaces (hooks/tools/weather.ts weatherParts): the word for an icon is one word.
test('every weather icon word is one word, in every language', () => {
  for (const table of [en, ko, ja]) {
    for (const [key, word] of Object.entries(table)) if (key.startsWith('weather.icon.')) expect(String(word)).not.toContain(' ')
  }
})

// The weekday's language: the picked language over a computer's other one; with none picked, the computer's own locale,
// even one the toolbelt has no words for.
test('words take the picked language only when it differs from the computer\'s', () => {
  expect(wordLocale({ lang: 'ko', locale: 'en-US' }, 'ko')).toBe('ko')
  expect(wordLocale({ lang: 'en', locale: 'en-GB' }, 'en')).toBe('en-GB')
  expect(wordLocale({ lang: 'en', locale: 'de-DE' }, 'auto')).toBe('de-DE')
  expect(wordLocale({ lang: 'ja', locale: 'ja-JP' }, 'auto')).toBe('ja-JP')
  expect(wordLocale({ lang: 'en', locale: 'de-DE' }, 'fr')).toBe('de-DE')
})
