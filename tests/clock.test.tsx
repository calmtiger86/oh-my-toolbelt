// The clock, the date and a note's time speak the language picked in the settings, not the computer's locale; with
// none picked (auto) they follow the computer. The time zone stays the one picked.
import { expect } from 'claude-code/testing'
import type { Note } from '../types/index'
import { NOW, TEST_OPTIONS, boot, mountBand, mountPane, runCommand, test } from './helpers'

// Newer ICU puts a narrow no-break space before AM/PM; compare with plain spaces.
const plain = (text: string | undefined): string | undefined => text?.replace(/\s/g, ' ')
const NOTE: Note = { id: 'a', text: 'Remember', createdAt: NOW }

// Regression: language en on a ko_KR computer drew `오전 5:32` and the status tab read "en (ko-KR)".
const CASES = [
  { language: 'en', LANG: 'ko_KR.UTF-8', clock: '◷ 5:32 AM', date: '▦ 10/22/2026 Thu', stamp: '10/22, 5:32 AM', status: 'Language: en' },
  { language: 'ko', LANG: 'en_US.UTF-8', clock: '◷ 오전 5:32', date: '▦ 2026. 10. 22. 목', stamp: '10. 22. 오전 5:32', status: '언어: ko' },
  { language: 'ja', LANG: 'en_US.UTF-8', clock: '◷ 5:32', date: '▦ 2026/10/22 木', stamp: '10/22 5:32', status: '言語: ja' },
  { language: 'auto', LANG: 'ko_KR.UTF-8', clock: '◷ 오전 5:32', date: '▦ 2026. 10. 22. 목', stamp: '10. 22. 오전 5:32', status: '언어: ko (ko-KR)' },
  { language: 'auto', LANG: 'en_GB.UTF-8', clock: '◷ 5:32', date: '▦ 22/10/2026 Thu', stamp: '22/10, 5:32', status: 'Language: en (en-GB)' },
] as const

for (const c of CASES) {
  test(`language ${c.language} on a ${c.LANG} computer: the clock, the date, a note's time and the status tab`, { options: { ...TEST_OPTIONS, clockFormat: 'auto', dateFormat: 'auto', language: c.language } }, async ($, on) => {
    await boot($, on, { env: { LANG: c.LANG }, store: { notes: [NOTE] } })
    const band = await mountBand($, 'terminal', 258)
    expect([plain((await band.find({ key: 'clock' }))?.text), plain((await band.find({ key: 'date' }))?.text)]).toEqual([c.clock, c.date])
    await band.unmount()
    await runCommand($, 'toolbelt', 'status')
    const pane = await mountPane($, 'terminal')
    // The whole line: a status that only starts with it (`Language: en (ko-KR)`) is the bug.
    expect(await pane.find({ type: 'Text', text: new RegExp(`^${c.status.replace(/[()]/g, '\\$&')}$`) })).toBeDefined()
    await pane.press({ key: 'tab-notes' })
    expect((await pane.findAll({ type: 'Text' })).map(t => plain(t.text))).toContain(c.stamp)
    await pane.unmount()
  })
}

test('the language picks the words, not the zone: English on a ko_KR computer keeps the Seoul time picked', { options: { ...TEST_OPTIONS, clockFormat: 'auto', timeZone: 'Asia/Seoul', language: 'en' } }, async ($, on) => {
  await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  const band = await mountBand($, 'terminal', 258)
  expect(plain((await band.find({ key: 'clock' }))?.text)).toBe('◷ 2:32 PM')
  await band.unmount()
})
