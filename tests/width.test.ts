import { test, expect } from 'claude-code/testing'
import { cellsOf, truncateCells } from '../hooks/lib/width'

// Invisible characters are built from code points so the source stays readable.
const ZWJ = String.fromCodePoint(0x200d)
const ZWSP = String.fromCodePoint(0x200b)
const WORD_JOINER = String.fromCodePoint(0x2060)
const VS16 = String.fromCodePoint(0xfe0f)
const KEYCAP = String.fromCodePoint(0x20e3)
const ACUTE = String.fromCodePoint(0x0301)
const FAMILY = ['👨', '👩', '👧'].join(ZWJ)
const E_ACUTE = `e${ACUTE}` // e + combining acute accent
const HANGUL_DECOMPOSED = String.fromCodePoint(0x1112, 0x1161, 0x11ab) // jamo for 한

test('ASCII is one cell per character', () => {
  expect(cellsOf('abc 123')).toBe(7)
})

test('empty string is zero cells', () => {
  expect(cellsOf('')).toBe(0)
})

test('Hangul syllables and Hanja are two cells', () => {
  expect(cellsOf('한글')).toBe(4)
  expect(cellsOf('漢字')).toBe(4)
})

test('Japanese kana are two cells, halfwidth katakana one', () => {
  expect(cellsOf('ひらがな')).toBe(8)
  expect(cellsOf('カタカナ')).toBe(8)
  expect(cellsOf('ｶﾀｶﾅ')).toBe(4)
})

test('emoji are two cells', () => {
  expect(cellsOf('🍅')).toBe(2)
  expect(cellsOf('⛅')).toBe(2)
  expect(cellsOf('⏳')).toBe(2)
  expect(cellsOf('🫠')).toBe(2)
})

test('text-default symbols are one cell until VS16 makes them emoji', () => {
  expect(cellsOf('☀')).toBe(1)
  expect(cellsOf(`☀${VS16}`)).toBe(2)
  expect(cellsOf('✔')).toBe(1)
  expect(cellsOf(`✔${VS16}`)).toBe(2)
  expect(cellsOf(`1${VS16}${KEYCAP}`)).toBe(2)
})

test('a ZWJ family emoji is one two-cell cluster', () => {
  expect(cellsOf(FAMILY)).toBe(2)
  expect(cellsOf(`${FAMILY}한글é`)).toBe(2 + 4 + 1)
})

test('ZWJ sequence that starts with a text-default symbol is two cells', () => {
  expect(cellsOf(`❤${ZWJ}🔥`)).toBe(2)
})

test('skin tone modifier joins its emoji', () => {
  expect(cellsOf('👍🏽')).toBe(2)
})

test('flags are two cells', () => {
  expect(cellsOf('🇰🇷')).toBe(2)
})

test('combining marks add no width', () => {
  expect(cellsOf(E_ACUTE)).toBe(1)
  expect(cellsOf('é')).toBe(1)
  expect(cellsOf(`caf${E_ACUTE}`)).toBe(4)
})

test('zero-width characters add no width', () => {
  expect(cellsOf(`a${ZWSP}b`)).toBe(2)
  expect(cellsOf(WORD_JOINER)).toBe(0)
})

test('decomposed Hangul syllable is one two-cell cluster', () => {
  expect(cellsOf(HANGUL_DECOMPOSED)).toBe(2)
})

test('fullwidth forms are two cells', () => {
  expect(cellsOf('ＡＢ')).toBe(4)
})

test('Emoji_Presentation symbols below U+2600 are two cells', () => {
  expect(cellsOf('⌚⭐')).toBe(4)
})

// Pins the table in width.ts to the engine's own Unicode data for the symbol blocks.
test('every Emoji_Presentation code point in U+2000-2FFF is two cells', () => {
  const emoji = /^\p{Emoji_Presentation}$/u
  for (let cp = 0x2000; cp <= 0x2fff; cp++) {
    const ch = String.fromCodePoint(cp)
    if (emoji.test(ch)) expect(cellsOf(ch), `U+${cp.toString(16)}`).toBe(2)
  }
})

test('truncateCells keeps text that already fits', () => {
  expect(truncateCells('hello', 5)).toBe('hello')
  expect(truncateCells('hello', 9)).toBe('hello')
  expect(truncateCells('', 3)).toBe('')
})

test('truncateCells ends a cut ASCII string with an ellipsis', () => {
  expect(truncateCells('hello world', 8)).toBe('hello w…')
  expect(cellsOf(truncateCells('hello world', 8))).toBe(8)
})

test('truncateCells never splits a wide character', () => {
  expect(truncateCells('한글한글', 5)).toBe('한글…')
  expect(truncateCells('한글한글', 6)).toBe('한글…')
  expect(cellsOf(truncateCells('한글한글', 6))).toBe(5)
  expect(truncateCells('한글', 2)).toBe('…')
})

test('truncateCells keeps a ZWJ emoji and a combining pair whole', () => {
  expect(truncateCells(`${FAMILY}abc`, 3)).toBe(`${FAMILY}…`)
  expect(truncateCells(E_ACUTE.repeat(4), 3)).toBe(`${E_ACUTE.repeat(2)}…`)
})

test('truncateCells with no room', () => {
  expect(truncateCells('hello', 0)).toBe('')
  expect(truncateCells('hello', -2)).toBe('')
  expect(truncateCells('hello', 1)).toBe('…')
})
