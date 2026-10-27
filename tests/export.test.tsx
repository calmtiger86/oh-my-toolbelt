// The export button and /toolbelt export: the conversation is read and written in the chosen format to the folder the
// setting names, never over a file that is there, in parts over 4 MiB; a failure toasts.
import { expect } from 'claude-code/testing'
import type { On, SessionMessage } from 'claude-code'
import { SURFACES, TEST_OPTIONS, boot, hostless, isSamePath, listOf, mountBand, mountPane, pick, runCommand, test } from './helpers'
import { utf8Bytes } from '../hooks/tools/notes'
import { browsersOf, fileUrl } from '../hooks/pdf-run'

const ID = 'abc12345-6789-4def-8000-000000000000'
// With TEST_OPTIONS (UTC) the helpers' clock reads 2026-10-22 05:32.
const NAME = 'claude-session-abc12345-20261022-0532'
const HUMAN_ONLY = 'This can only be changed by typing the command yourself.'
const MIB = 1024 * 1024
// Most tests save in the session folder, /work, to keep the paths short.
const SESSION = { ...TEST_OPTIONS, exportDirectory: 'session' } as const

const CONVERSATION: SessionMessage[] = [
  { role: 'user', text: 'Add a <b>title</b>', toolUses: [] },
  { role: 'assistant', text: 'Done: **title** added.', toolUses: [{ tool_use_id: 't1', tool: 'Edit', input: { file_path: 'index.html' } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] },
]

type Disk = { files: Map<string, string>; writes: string[] }
type ExportStub = { messages?: SessionMessage[]; present?: string[]; refuseWrite?: boolean }

// Stands for the transcript and the disk: a write lands in `files`, and the paths in `present` are there from the start.
// Paths are kept without the host's drive (helpers.ts `hostless`). Registered before boot, as every stub must be.
function stubExport(on: On, o: ExportStub = {}): Disk {
  const disk: Disk = { files: new Map((o.present ?? []).map(path => [hostless(path), 'old'])), writes: [] }
  on('session.messages', () => ({ value: o.messages ?? CONVERSATION }))
  on('session.id', () => ({ value: ID }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.exists', (_, e) => ({ value: [...disk.files.keys()].some(path => isSamePath(e.path, path)) }))
  on('fs.write', (_, e) => {
    if (o.refuseWrite) return { deny: 'EACCES: permission denied' }
    disk.writes.push(hostless(e.path))
    disk.files.set(hostless(e.path), e.text)
    return { value: undefined }
  })
  return disk
}

test('the button saves md in the session folder when chosen, toasts the path, and never writes over a file', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on)
  const { calls, store } = await boot($, on)
  for (const surface of SURFACES) {
    const band = await mountBand($, surface, 258)
    await band.press({ key: 'export' })
    await band.unmount()
  }
  expect(disk.writes).toEqual([`/work/${NAME}.md`, `/work/${NAME}-2.md`])
  expect(calls.toasts).toEqual([`Conversation saved to /work/${NAME}.md`, `Conversation saved to /work/${NAME}-2.md`])
  const text = disk.files.get(`/work/${NAME}.md`) ?? ''
  expect(text).toStartWith(`# Claude Code session ${ID}\n\nExported `)
  expect(text).toContain('## User\n\nAdd a <b>title</b>\n\n## Claude\n\nDone: **title** added.\n\n<details>\n<summary>Tools used (1)</summary>\n\n- `Edit(index.html)`\n\n</details>\n')
  // The row that only carries the tool's result is not a turn of its own.
  expect(text.match(/## User/g)).toHaveLength(1)
  expect(store.get('exportLast')).toEqual({ format: 'md' })
})

test('/toolbelt export html writes a safe html file and answers with its path; the button then keeps html', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on)
  const { calls, store } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'export html')).text).toBe(`Conversation saved to /work/${NAME}.html`)
  const doc = disk.files.get(`/work/${NAME}.html`) ?? ''
  expect(doc).toStartWith('<!doctype html>\n<html lang="en">')
  expect(doc).toContain('<p>Add a &lt;b&gt;title&lt;/b&gt;</p>')
  expect(doc).toContain('<p>Done: <strong>title</strong> added.</p>')
  expect(doc).toContain('<li><code>Edit(index.html)</code></li>')
  expect(doc).not.toContain('<b>')
  expect(store.get('exportLast')).toEqual({ format: 'html' })
  // The command answers in the transcript and toasts the same line, as its reply may be under the curtain.
  expect(calls.toasts).toEqual([`Conversation saved to /work/${NAME}.html`])
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect(disk.writes).toEqual([`/work/${NAME}.html`, `/work/${NAME}-2.html`])

  expect((await runCommand($, 'tb', 'export TXT')).text).toBe(`Conversation saved to /work/${NAME}.txt`)
  expect(disk.files.get(`/work/${NAME}.txt`)).toContain('[User]\nAdd a <b>title</b>\n\n[Claude]\nDone: **title** added.\n  · Edit(index.html)\n')
  // Without a format, the last one.
  expect((await runCommand($, 'toolbelt', 'export')).text).toBe(`Conversation saved to /work/${NAME}-2.txt`)
  expect(calls.toasts).toHaveLength(4)
})

// Regression: an export made while Claude answered lacked the block being written, and nothing said so.
test('an export made while Claude answers says the answer being written is not in it', { options: SESSION }, async ($, on) => {
  stubExport(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await boot($, on)
  await $.turn.start({ text: 'write an essay', turnId: 't1' })
  expect((await runCommand($, 'toolbelt', 'export md')).text).toBe(`Conversation saved to /work/${NAME}.md The answer Claude is still writing is not in it; export again when it ends.`)
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await runCommand($, 'toolbelt', 'export md')).text).toBe(`Conversation saved to /work/${NAME}-2.md`)
})

test('by default the export goes to Downloads, not the project folder', { options: TEST_OPTIONS }, async ($, on) => {
  const disk = stubExport(on)
  await boot($, on, { env: { LANG: 'en_US.UTF-8', HOME: '/Users/alex' } })
  await runCommand($, 'toolbelt', 'export md')
  expect(disk.writes).toEqual([`/Users/alex/Downloads/${NAME}.md`])
})

for (const [setting, folder] of [['downloads', '/Users/alex/Downloads'], ['desktop', '/Users/alex/Desktop'], ['documents', '/Users/alex/Documents'], ['home', '/Users/alex']] as const) {
  test(`exportDirectory ${setting} saves under HOME`, { options: { ...TEST_OPTIONS, exportDirectory: setting } }, async ($, on) => {
    const disk = stubExport(on)
    await boot($, on, { env: { LANG: 'en_US.UTF-8', HOME: '/Users/alex/' } })
    await runCommand($, 'toolbelt', 'export md')
    expect(disk.writes).toEqual([`${folder}/${NAME}.md`])
  })
}

test('on Windows the folder is under USERPROFILE, joined with backslashes', { options: { ...TEST_OPTIONS, exportDirectory: 'desktop' } }, async ($, on) => {
  const sep = String.fromCharCode(92)
  const profile = ['C:', 'Users', 'alex'].join(sep)
  const disk = stubExport(on)
  await boot($, on, { env: { LANG: 'en_US.UTF-8', OS: 'Windows_NT', USERPROFILE: profile, HOME: '/c/Users/alex' } })
  await runCommand($, 'toolbelt', 'export txt')
  // On a host that is not Windows the kit resolves the path against its own folder, so only the end is compared.
  expect(disk.writes).toHaveLength(1)
  expect(disk.writes[0]).toEndWith(hostless([profile, 'Desktop', `${NAME}.txt`].join(sep)))
})

test('with no home folder known, a folder under home toasts and writes nothing', { options: { ...TEST_OPTIONS, exportDirectory: 'downloads' } }, async ($, on) => {
  const disk = stubExport(on)
  const { calls } = await boot($, on)
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect(disk.writes).toEqual([])
  expect(calls.toasts).toEqual(["Could not find your home folder. Set Export folder to Project folder in the Status tab's settings."])
})

test('a name that is taken moves the export on to -2, then -3', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on, { present: [`/work/${NAME}.md`, `/work/${NAME}-2.md`] })
  const { calls } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'export md')).text).toBe(`Conversation saved to /work/${NAME}-3.md`)
  expect(calls.toasts).toEqual([`Conversation saved to /work/${NAME}-3.md`])
  expect(disk.writes).toEqual([`/work/${NAME}-3.md`])
  expect(disk.files.get(`/work/${NAME}.md`)).toBe('old')
})

test('over 4 MiB the export is split into parts under 4 MiB; a taken part name moves the whole set', { options: SESSION, timeoutMs: 20_000 }, async ($, on) => {
  const big = (role: SessionMessage['role'], letter: string): SessionMessage => ({ role, text: letter.repeat(1.5 * MIB), toolUses: [] })
  const disk = stubExport(on, { messages: [big('user', 'a'), big('assistant', 'b'), big('user', 'c')], present: [`/work/${NAME}-part2.md`] })
  const { calls } = await boot($, on)
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect(disk.writes).toEqual([`/work/${NAME}-2.md`, `/work/${NAME}-2-part2.md`])
  for (const path of disk.writes) expect(utf8Bytes(disk.files.get(path) ?? ''), path).toBeLessThanOrEqual(4 * MIB)
  expect(disk.files.get(`/work/${NAME}-2-part2.md`)).toStartWith('Part 2\n\n## User\n\nccc')
  expect(calls.toasts).toEqual([`Conversation saved in 2 files. The first is /work/${NAME}-2.md`])
})

test('a refused write toasts, names the reason in the status tab and remembers no format', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on, { refuseWrite: true })
  const { calls, store } = await boot($, on)
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect(disk.writes).toEqual([])
  expect(calls.toasts).toEqual(['Could not save the conversation. The Status tab says why.'])
  expect(store.has('exportLast')).toBe(false)
  await runCommand($, 'toolbelt', 'status')
  const pane = await mountPane($, 'terminal')
  expect(await pane.find({ type: 'Text', text: 'Last error: export failed' })).toBeDefined()
  await pane.unmount()
  expect(calls.logged.join('\n')).toContain('export failed')
})

test('a conversation with nothing said yet toasts and writes nothing', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on, { messages: [] })
  const { calls } = await boot($, on)
  const band = await mountBand($, 'desktop', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect([disk.writes, calls.toasts]).toEqual([[], ['Nothing to export yet.']])
})

test('only the person may export; an unknown format or word is named with the usage line', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on)
  const { store } = await boot($, on)
  expect((await runCommand($, 'toolbelt', 'export md', 'plugin')).text).toContain(HUMAN_ONLY)
  expect((await runCommand($, 'toolbelt', 'export doc')).text).toContain('Unknown argument: doc Usage: /toolbelt')
  // pdf is a format, but with no browser picked it says how to pick one.
  expect((await runCommand($, 'toolbelt', 'export pdf')).text).toBe('To save a PDF, pick a browser in the PDF browser setting.')
  expect((await runCommand($, 'toolbelt', 'export md now')).text).toContain('Unknown argument: now Usage: /toolbelt')
  expect(disk.writes).toEqual([])
  expect(store.has('exportLast')).toBe(false)
})

test('the status tab picks the format the button saves in, and shows the one another session chose', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on)
  const { store } = await boot($, on, { store: { exportLast: { format: 'html' } } })
  await runCommand($, 'toolbelt', 'status')
  for (const surface of SURFACES) {
    const pane = await mountPane($, surface)
    expect((await listOf(pane, 'export-format')).current).toBe(surface === 'terminal' ? 'html' : 'txt')
    await pick(pane, 'export-format', 'txt')
    expect(store.get('exportLast')).toEqual({ format: 'txt' })
    expect((await listOf(pane, 'export-format')).current).toBe('txt')
    await pane.unmount()
  }
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect(disk.writes).toEqual([`/work/${NAME}.txt`])
})

test('the file and the toast speak the person\'s language; a long conversation says only the latest are in it', { options: SESSION }, async ($, on) => {
  const many = Array.from({ length: 4096 }, (_, k): SessionMessage => ({ role: k % 2 === 0 ? 'user' : 'assistant', text: `m${k}`, toolUses: [] }))
  const disk = stubExport(on, { messages: many })
  const { calls } = await boot($, on, { env: { LANG: 'ko_KR.UTF-8' } })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  await band.unmount()
  expect(calls.toasts).toEqual([`대화를 저장했습니다: /work/${NAME}.md`])
  const text = disk.files.get(`/work/${NAME}.md`) ?? ''
  expect(text).toStartWith(`# Claude Code 세션 ${ID}\n\n내보낸 때: `)
  expect(text).toContain('최근 메시지 4,096개만 들어 있습니다.')
  expect(text).toContain('## 사용자\n\nm0\n\n## Claude\n\nm1')
})

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

test('pdf: the page is written, then printed beside it by the browser the setting finds; a failed print says where the page is', { options: { ...SESSION, pdfBrowser: 'auto' } }, async ($, on) => {
  const disk = stubExport(on, { present: [CHROME] })
  const printed: string[][] = []
  let exitCode = 0
  on('process.run', (_, e) => {
    printed.push([...e.argv])
    const target = e.argv.find(arg => arg.startsWith('--print-to-pdf='))?.slice('--print-to-pdf='.length)
    if (exitCode === 0 && target !== undefined) disk.files.set(hostless(target), '%PDF')
    return { value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await boot($, on)
  const done = await runCommand($, 'toolbelt', 'export pdf')
  expect(disk.writes).toEqual([`/work/${NAME}.html`])
  expect(printed[0]).toEqual([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=/work/${NAME}.pdf`, `file:///work/${NAME}.html`])
  expect(done.text).toBe(`Saved /work/${NAME}.pdf (and the page it was printed from, /work/${NAME}.html)`)
  exitCode = 1
  expect((await runCommand($, 'toolbelt', 'export pdf')).text).toBe(`The PDF could not be made. The page is saved: /work/${NAME}-2.html`)
})

test('pdf: the file address escapes what a URL reads as its own, and Windows paths turn their slashes', () => {
  expect(fileUrl('/Users/me/my notes #1.html', undefined)).toBe('file:///Users/me/my%20notes%20%231.html')
  expect(fileUrl('C:\\Users\\me\\a.html', 'Windows_NT')).toBe('file:///C:/Users/me/a.html')
  expect([browsersOf('auto'), browsersOf('edge'), browsersOf('off'), browsersOf('netscape')]).toEqual([['chrome', 'edge', 'brave', 'chromium'], ['edge'], [], []])
})

test('pdf on Linux tries each browser name until one starts', { options: { ...SESSION, pdfBrowser: 'auto' } }, async ($, on) => {
  const disk = stubExport(on)
  const tried: string[] = []
  on('process.run', (_, e) => {
    tried.push(e.argv[0] ?? '')
    if (e.argv[0] !== 'chromium-browser') return { deny: 'ENOENT' }
    const target = e.argv.find(arg => arg.startsWith('--print-to-pdf='))?.slice('--print-to-pdf='.length)
    if (target !== undefined) disk.files.set(hostless(target), '%PDF')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await boot($, on)
  expect((await runCommand($, 'toolbelt', 'export pdf')).text).toBe(`Saved /work/${NAME}.pdf (and the page it was printed from, /work/${NAME}.html)`)
  expect(tried).toEqual(['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chromium', 'chromium-browser'])
})

// The desktop's format list has no pdf (it runs no programs), so its band saves a pdf remembered in a terminal as html.
test('the desktop band saves a remembered pdf as html', { options: { ...SESSION, pdfBrowser: 'auto' } }, async ($, on) => {
  const disk = stubExport(on)
  const { store } = await boot($, on, { isInteractive: false, store: { schemaVersion: 1, exportLast: { format: 'pdf' } } })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  const band = await mountBand($, 'desktop', 258)
  await band.press({ key: 'export' })
  expect(disk.writes).toEqual([`/work/${NAME}.html`])
  // Saved as html, not a pdf whose print failed.
  expect(store.get('exportLast')).toEqual({ format: 'html' })
  await band.unmount()
})

test('a failed pdf is not remembered, and the band saves html while a remembered pdf has no browser', { options: SESSION }, async ($, on) => {
  const disk = stubExport(on)
  const { store } = await boot($, on, { store: { schemaVersion: 1, exportLast: { format: 'pdf' } } })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'export' })
  expect(disk.writes).toEqual([`/work/${NAME}.html`])
  expect(store.get('exportLast')).toEqual({ format: 'html' })
  await band.unmount()
})
