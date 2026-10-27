// The export's pure parts: txt, md and html from the messages, the split under 4 MiB, the file names, the date and the
// folder for each setting and system.
import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'
import { MESSAGES_MAX, PART_BYTES_MAX, asExportFormat, exportBaseName, exportFileName, exportParts, storedExportFormat, cleanText, toolLine, turnsOf } from '../hooks/lib/export'
import type { ExportMeta } from '../hooks/lib/export'
import { fileStamp, formatDateTime } from '../hooks/lib/format'
import { exportFolder, joinPath } from '../hooks/lib/platform'
import { utf8Bytes } from '../hooks/tools/notes'
import { NOW, t } from './pure-helpers'

const meta = (over: Partial<ExportMeta> = {}): ExportMeta => ({ t, lang: 'en', sessionId: 'abc12345-6789', date: 'Oct 22, 2026, 05:32', isCapped: false, ...over })
const use = (tool: string, input: Record<string, unknown>) => ({ tool_use_id: tool, tool, input })
const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const claude = (text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({ role: 'assistant', text, toolUses })
// A user row that only answers a tool use, as most rows of a real transcript are.
const result = (): SessionMessage => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'Bash', text: 'a b', isError: false }] })

const CONVERSATION: SessionMessage[] = [
  user('List the files.\nThen **stop**.'),
  claude('Looking.', [use('Bash', { command: 'ls -la', description: 'list' })]),
  result(),
  claude('Two files: `a` and `b`.'),
]

test('txt: [User] and [Claude], one line per tool use, rows of one reply joined', () => {
  expect(exportParts(CONVERSATION, 'txt', meta())).toEqual([
    'Claude Code session abc12345-6789\nExported Oct 22, 2026, 05:32\n\n' +
      '[User]\nList the files.\nThen **stop**.\n\n' +
      '[Claude]\nLooking.\n  · Bash(ls -la)\nTwo files: `a` and `b`.\n',
  ])
})

test('md: ## User and ## Claude, the text as it was, tool uses in a details block', () => {
  expect(exportParts(CONVERSATION, 'md', meta())).toEqual([
    '# Claude Code session abc12345-6789\n\nExported Oct 22, 2026, 05:32\n\n' +
      '## User\n\nList the files.\nThen **stop**.\n\n' +
      '## Claude\n\nLooking.\n\n<details>\n<summary>Tools used (1)</summary>\n\n- `Bash(ls -la)`\n\n</details>\n\nTwo files: `a` and `b`.\n',
  ])
  // A tool line holding a backtick gets a longer code span.
  expect(exportParts([claude('', [use('Bash', { command: 'echo `date`' })])], 'md', meta())[0]).toContain('- ``Bash(echo `date`)``')
})

test('html: one standalone document, rendered markdown, each role in its own section, light and dark', () => {
  const [doc = ''] = exportParts(CONVERSATION, 'html', meta())
  expect(doc).toStartWith('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">')
  expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`)
  expect(doc).toContain('<title>Claude Code session abc12345-6789</title>')
  expect(doc).toContain('color-scheme:light dark')
  expect(doc).toContain('@media (prefers-color-scheme:dark)')
  expect(doc).toContain('<section class="turn user"><h2>User</h2>\n<div class="body">\n<p>List the files.<br>\nThen <strong>stop</strong>.</p>\n</div>\n</section>')
  expect(doc).toContain('<details class="tools"><summary>Tools used (1)</summary><ul><li><code>Bash(ls -la)</code></li></ul></details>')
  expect(doc).toContain('<section class="turn assistant"><h2>Claude</h2>')
  expect(doc).toContain('<p>Two files: <code>a</code> and <code>b</code>.</p>')
  expect(doc).toEndWith('</main>\n</body>\n</html>\n')
})

test('html: nothing the conversation brings becomes a tag, an attribute or a script', () => {
  const evil = '"><script>alert(1)</script><img src=x onerror=alert(1)>'
  const messages = [user(evil), claude(`${evil}\n[x](javascript:alert(1))`, [use(`<script>${evil}`, { command: evil })])]
  const [doc = ''] = exportParts(messages, 'html', meta({ sessionId: evil, lang: `en"><script>` }))
  // The one style element is the fixed one; with it set aside, every tag is the template's or the converter's.
  expect(doc.split('<style>')).toHaveLength(2)
  const tags = doc.replace(/<style>[\s\S]*?<\/style>/, '<style></style>').match(/<[^>]*>/g) ?? []
  const ALLOWED = /^<\/?(?:!doctype html|html|html lang="[^"<>]*"|head|meta [^<>]*|title|style|body|main|header|h[12]|p|p class="meta"|section|section class="turn (?:user|assistant)"|div class="body"|div|details class="tools"|details|summary|ul|li|code|br)>$/
  for (const tag of tags) expect(ALLOWED.test(tag), tag).toBe(true)
  expect(doc).not.toMatch(/<(?:script|img)\b/i)
  expect(doc).not.toContain('href=')
  expect(doc).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
})

test('a tool use is its name and the most telling field of its input, on one line and cut at 80 characters', () => {
  expect(toolLine(use('Bash', { command: 'ls -la', description: 'list' }))).toBe('Bash(ls -la)')
  expect(toolLine(use('Read', { file_path: '/a/b.ts' }))).toBe('Read(/a/b.ts)')
  expect(toolLine(use('Edit', { old: 1 }))).toBe('Edit({"old":1})')
  expect(toolLine(use('TodoWrite', {}))).toBe('TodoWrite()')
  expect(toolLine(use('Bash', { command: 'echo a\n\n   b' }))).toBe('Bash(echo a b)')
  expect(toolLine(use('Bash', { command: 'x'.repeat(100) }))).toBe(`Bash(${'x'.repeat(80)}…)`)
  expect(toolLine(use('Bash', { command: '한'.repeat(81) }))).toBe(`Bash(${'한'.repeat(80)}…)`)
})

test('rows with no text and no tool use are left out, and rows of one role in a row join one turn', () => {
  const turns = turnsOf([result(), user('a'), user('b'), claude('', [use('Read', { path: 'x' })]), result(), claude('c'), user('  ')])
  expect(turns.map(turn => [turn.role, turn.parts.length])).toEqual([['user', 2], ['assistant', 2]])
  expect(exportParts([result(), user(' ')], 'md', meta())).toEqual([])
})

// Security: what the engine put into a person's row (CLAUDE.md or memory in a reminder) is not the person's to share; a
// reply that quotes such a tag is Claude's words and stays.
test('a person\'s row loses the engine\'s reminder ahead of it, and a reply that quotes the tag keeps it', () => {
  const reminder = '<system-reminder>\nContents of CLAUDE.md: keep the API key in .env\n</system-reminder>\n\n'
  const turns = turnsOf([user(`${reminder}Fix the bug.`), user(reminder), claude('<system-reminder> is a tag the engine uses.')])
  expect(turns).toEqual([
    { role: 'user', parts: [{ text: 'Fix the bug.', tools: [] }] },
    { role: 'assistant', parts: [{ text: '<system-reminder> is a tag the engine uses.', tools: [] }] },
  ])
  expect(exportParts([user(`${reminder}Fix the bug.`)], 'md', meta())[0]).not.toContain('CLAUDE.md')
})

const said = (turns: ReturnType<typeof turnsOf>) => turns.map(turn => [turn.role, turn.parts.map(part => part.text)])

// Regression: an export dropped a slash command the person typed with its words, and bash mode's input, whole.
test('a slash command and bash mode\'s input read as the person typed them; the engine\'s output rows go', () => {
  const messages = [
    user('<command-message>co</command-message>\n<command-name>/co</command-name>\n<command-args>Wrap up this session.</command-args>'),
    claude('Wrapped up.'),
    user('<command-name>/voice</command-name>\n            <command-message>voice</command-message>\n            <command-args>tap</command-args>'),
    user('<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>'),
    user('<local-command-stdout>Voice mode enabled</local-command-stdout>'),
    user('<command-name>/model</command-name>\n<command-message>model</command-message>'),
    user('<local-command-stderr>No such model</local-command-stderr>'),
    user('<bash-input> ls -la</bash-input>'),
    user('<bash-stdout>a b</bash-stdout><bash-stderr></bash-stderr>'),
    user('<user-prompt-submit-hook>Context from a hook</user-prompt-submit-hook>'),
  ]
  expect(said(turnsOf(messages))).toEqual([
    ['user', ['/co Wrap up this session.']],
    ['assistant', ['Wrapped up.']],
    ['user', ['/voice tap']],
    ['user', ['/model']],
    ['user', ['! ls -la']],
  ])
  const md = exportParts(messages, 'md', meta())[0] ?? ''
  for (const engine of ['command-', 'Voice mode enabled', 'No such model', 'a b', 'Caveat', 'Context from a hook']) expect(md).not.toContain(engine)
})

// Regression: with a command's row left out, its reply was joined to the reply before it.
test('the reply to a command or a notification is a turn of its own, not joined to the reply before it', () => {
  expect(said(turnsOf([
    user('Start the agent.'),
    claude('Started.'),
    user('<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>'),
    claude('The agent is done.'),
    user('<command-message>co</command-message>\n<command-name>/co</command-name>'),
    claude('Saved.'),
  ]))).toEqual([['user', ['Start the agent.']], ['assistant', ['Started.']], ['assistant', ['The agent is done.']], ['user', ['/co']], ['assistant', ['Saved.']]])
})

// Regression: Esc left the engine's notice of it as a user row, which an export listed as something the person wrote.
test('the notice of an interruption is no one\'s words, and the replies around it stay apart', () => {
  const messages = [
    user('Write a long essay.'),
    claude('Once upon'),
    user('[Request interrupted by user]'),
    claude('A short one: done.'),
    user('Run the tests.'),
    claude('Running.', [use('Bash', { command: 'npm test' })]),
    user('[Request interrupted by user for tool use]\n'),
    claude('Stopped.'),
  ]
  expect(said(turnsOf(messages))).toEqual([
    ['user', ['Write a long essay.']],
    ['assistant', ['Once upon']],
    ['assistant', ['A short one: done.']],
    ['user', ['Run the tests.']],
    ['assistant', ['Running.']],
    ['assistant', ['Stopped.']],
  ])
  for (const format of ['txt', 'md', 'html'] as const) expect(exportParts(messages, format, meta())[0] ?? '', format).not.toContain('interrupted')
})

test('a command the person typed stays beside an interruption notice, and so do words that only start like the notice', () => {
  expect(said(turnsOf([
    claude('Done.'),
    user('[Request interrupted by user]'),
    user('<command-message>reload-plugins</command-message>\n<command-name>/reload-plugins</command-name>\n<command-args></command-args>'),
    claude('Reloaded.'),
  ]))).toEqual([['assistant', ['Done.']], ['user', ['/reload-plugins']], ['assistant', ['Reloaded.']]])
  for (const typed of ['[Request interrupted by user] please go on', '[Request interrupted by user for tool use] why?', '[Request interrupted by user', '[Request interrupted by users]', 'Note: [Request interrupted by user]']) {
    expect(said(turnsOf([user(typed)]))).toEqual([['user', [typed]]])
  }
})

// Security: a row that starts with one of the engine's tags may be output, so one that does not read as its tags goes.
test('a row that starts with the engine\'s tag but does not read as its tags goes; other text in tags stays as written', () => {
  for (const typed of ['<command-name> is a tag, what is it for?', '<command-name>/x</command-name> what does this do?', '<bash-input>ls', '<command-args>a</command-args><b>bold</b>', '<task-notification>']) {
    expect(said(turnsOf([user(typed)]))).toEqual([])
  }
  for (const typed of ['<div>hi</div>', '<script>alert(1)</script>', '<command', '<command-name is a tag', '<commands>list</commands>', 'See <bash-stdout>x</bash-stdout>']) {
    expect(said(turnsOf([user(typed)]))).toEqual([['user', [typed]]])
  }
  expect(said(turnsOf([user('<teammate-message teammate_id="researcher">\nFound it.\n</teammate-message>')]))).toEqual([['user', ['Found it.']]])
})

// Security: an engine tag with attributes (`<bash-stdout exit="1">`), or a local command's or bash mode's tag not
// listed yet, did not read as the engine's and went into the export whole as the person's words.
test('a row that starts with an engine tag carrying attributes, or a local command\'s or bash mode\'s tag not known yet, goes', () => {
  const messages = [
    claude('Started.'),
    user('<task-notification id="n1">\n<task-id>a1</task-id>\n<result>SECRET=1</result>\n</task-notification>'),
    claude('Done.'),
    user('<bash-stdout exit="1">TOKEN=a</bash-stdout><bash-stderr></bash-stderr>'),
    claude('Failed.'),
    user('<local-command-output>SECRET=2</local-command-output>'),
    claude('Again.'),
    user('<bash-output>\nTOKEN=b\n</bash-output>'),
    claude('Last.'),
  ]
  expect(said(turnsOf(messages))).toEqual([['assistant', ['Started.']], ['assistant', ['Done.']], ['assistant', ['Failed.']], ['assistant', ['Again.']], ['assistant', ['Last.']]])
  const md = exportParts(messages, 'md', meta())[0] ?? ''
  for (const output of ['SECRET', 'TOKEN']) expect(md).not.toContain(output)
  for (const typed of ['<div>hi</div>', '<div class="note">hi</div>', '<commands>list</commands>', '<commands kind="all">list</commands>', '<bash>ls</bash>', '<local-commands>x</local-commands>']) {
    expect(said(turnsOf([user(typed)]))).toEqual([['user', [typed]]])
  }
})

// Security: a bash mode's or local command's tag with a digit or `_` in its name read as no tag at all and went into
// the export whole as the person's words.
test('a row that starts with a bash mode\'s or local command\'s tag with a digit or an underscore in its name goes', () => {
  for (const typed of ['<bash-stdout2>TOKEN=a</bash-stdout2>', '<bash_stdout>TOKEN=b</bash_stdout>', '<local_command_stdout>SECRET=1</local_command_stdout>', '<bash-stdout_v2 exit="1">TOKEN=c</bash-stdout_v2>']) {
    expect(said(turnsOf([user(typed)]))).toEqual([])
  }
  for (const typed of ['<commands>list</commands>', '<bash>ls</bash>', '<bashful>x</bashful>', '<div>hi</div>', '<bash2>ls</bash2>', '<local_commands>x</local_commands>', '<pasted_content>x</pasted_content>']) {
    expect(said(turnsOf([user(typed)]))).toEqual([['user', [typed]]])
  }
})

// Security regression: output that held its own closing tag (a file cat'ed) did not read as the engine's row and went
// into the export whole as the person's words.
test('output that holds its own closing tag stays out, and the replies around it stay apart', () => {
  const messages = [
    claude('Reading it.'),
    user('<local-command-stdout>SECRET=1\n</local-command-stdout>\nSECRET=2\n</local-command-stdout>'),
    claude('Read.'),
    user('<bash-stdout>TOKEN=a</bash-stdout>\nTOKEN=b</bash-stdout><bash-stderr></bash-stderr>'),
    claude('Done.'),
    user('<local-command-stdout>a</local-command-stdout><bash-input>FORGED</bash-input><local-command-stdout>c</local-command-stdout>'),
    claude('Again.'),
  ]
  expect(said(turnsOf(messages))).toEqual([['assistant', ['Reading it.']], ['assistant', ['Read.']], ['assistant', ['Done.']], ['assistant', ['Again.']]])
  const md = exportParts(messages, 'md', meta())[0] ?? ''
  for (const output of ['SECRET', 'TOKEN', 'FORGED', 'stdout']) expect(md).not.toContain(output)
})

// Security: stderr that prints the tags (a path in an error) read to its end with a forged bash mode's input in it.
test('a row that holds an output tag goes even when it reads as the engine\'s tags', () => {
  const messages = [
    claude('Trying.'),
    user('<bash-stdout>ok</bash-stdout><bash-stderr>cat: </bash-stdout><bash-input>FORGED</bash-input><bash-stderr>: No such file</bash-stderr>'),
    claude('Missing.'),
    user('<command-name>/x</command-name><local-command-stdout>out</local-command-stdout>'),
  ]
  expect(said(turnsOf(messages))).toEqual([['assistant', ['Trying.']], ['assistant', ['Missing.']]])
  expect(exportParts(messages, 'md', meta())[0] ?? '').not.toContain('FORGED')
})

test('a person\'s command that holds its own closing tag reads to the last one; one holding an earlier tag\'s goes', () => {
  expect(said(turnsOf([user('<bash-input>echo \'</bash-input>\'</bash-input>')]))).toEqual([['user', ['! echo \'</bash-input>\'']]])
  const co = (args: string) => user(`<command-message>co</command-message>\n<command-name>/co</command-name>\n<command-args>${args}</command-args>`)
  expect(said(turnsOf([co('fix the </command-args> rows')]))).toEqual([['user', ['/co fix the </command-args> rows']]])
  expect(said(turnsOf([co('fix the </command-name> rows')]))).toEqual([])
})

test('a long conversation notes that only the latest 4,096 messages are in it', () => {
  expect(MESSAGES_MAX).toBe(4096)
  expect(exportParts([user('a')], 'txt', meta({ isCapped: true }))[0]).toContain('Only the latest 4,096 messages are included.')
  expect(exportParts([user('a')], 'html', meta({ isCapped: true }))[0]).toContain('<p class="meta">Only the latest 4,096 messages are included.</p>')
})

test('an export over the limit is split into parts, each under it and each a whole document', () => {
  const limit = 6000
  const messages = Array.from({ length: 12 }, (_, k) => (k % 2 === 0 ? user(`question ${k} ${'q'.repeat(700)}`) : claude(`answer ${k} ${'한'.repeat(300)}`)))
  for (const format of ['txt', 'md', 'html'] as const) {
    const parts = exportParts(messages, format, meta(), limit)
    expect(parts.length, format).toBeGreaterThan(1)
    for (const part of parts) expect(utf8Bytes(part), format).toBeLessThanOrEqual(limit)
    // Nothing is lost, and the parts keep the order.
    const all = parts.join('')
    const at = messages.map((_, k) => all.indexOf(k % 2 === 0 ? `question ${k}` : `answer ${k}`))
    expect(at.every((index, k) => index >= 0 && (k === 0 || index > (at[k - 1] ?? 0))), format).toBe(true)
    expect(parts[1], format).toContain('Part 2')
  }
  const html = exportParts(messages, 'html', meta(), limit)
  for (const part of html) expect(part).toStartWith('<!doctype html>')
  expect(html[1]).toContain('<title>Claude Code session abc12345-6789 (Part 2)</title>')
  expect(PART_BYTES_MAX).toBe(4 * 1024 * 1024)
})

test('one message bigger than the limit is cut into pieces that fit, at line breaks when it has them', () => {
  const lines = Array.from({ length: 400 }, (_, k) => `line ${k} <tag> & more`)
  for (const format of ['txt', 'md', 'html'] as const) {
    const parts = exportParts([claude(lines.join('\n'))], format, meta(), 5000)
    for (const part of parts) expect(utf8Bytes(part), format).toBeLessThanOrEqual(5000)
    const all = parts.join('\n')
    for (const k of [0, 199, 399]) expect(all, `${format} ${k}`).toContain(format === 'html' ? `line ${k} &lt;tag&gt; &amp; more` : `line ${k} <tag> & more`)
  }
  // No line break at all: cut by length, never inside a character.
  const parts = exportParts([user('😀'.repeat(3000))], 'txt', meta(), 3000)
  expect(parts.join('').split('😀').length - 1).toBe(3000)
  expect(parts.join('')).not.toContain(String.fromCharCode(0xfffd))
})

test('file names: the first 8 safe characters of the id and the minute, then a copy number and a part number', () => {
  const base = exportBaseName('abc12345-6789-0000', '20261022-0532')
  expect(base).toBe('claude-session-abc12345-20261022-0532')
  expect(exportFileName(base, 'md', 1, 1)).toBe('claude-session-abc12345-20261022-0532.md')
  expect(exportFileName(base, 'html', 2, 1)).toBe('claude-session-abc12345-20261022-0532-2.html')
  expect(exportFileName(base, 'txt', 1, 3)).toBe('claude-session-abc12345-20261022-0532-part3.txt')
  expect(exportFileName(base, 'txt', 2, 2)).toBe('claude-session-abc12345-20261022-0532-2-part2.txt')
  // An id cannot lead the file out of its folder.
  expect(exportBaseName('../../etc/passwd', '20261022-0532')).toBe('claude-session-etcpassw-20261022-0532')
  expect(exportBaseName('/:*?', '20261022-0532')).toBe('claude-session-unknown-20261022-0532')
})

test('the minute in the name and the date in the header follow the clock\'s zone and language', () => {
  expect(fileStamp(NOW, 'UTC')).toBe('20261022-0532')
  expect(fileStamp(NOW, 'Asia/Seoul')).toBe('20261022-1432')
  expect(fileStamp(Date.UTC(2026, 0, 1, 0, 5), 'UTC')).toBe('20260101-0005')
  // A zone Intl does not know falls back to the local one, in the same shape.
  expect(fileStamp(NOW, 'Mars/Base')).toMatch(/^\d{8}-\d{4}$/)
  expect(formatDateTime(NOW, { locale: 'en', timeZone: 'UTC', hour12: false, seconds: false })).toContain('05:32')
  expect(formatDateTime(NOW, { locale: 'en', timeZone: 'UTC', seconds: false })).toContain('Oct 22, 2026')
  expect(formatDateTime(NOW, { locale: 'ko-KR', timeZone: 'Asia/Seoul', seconds: false })).toContain('2026. 10. 22.')
  expect(formatDateTime(NOW, { locale: 'en', timeZone: 'Mars/Base', seconds: false })).toMatch(/^2026-10-2\d \d\d:\d\d$/)
})

test('the stored format: md unless the store holds another known one', () => {
  expect([storedExportFormat(undefined), storedExportFormat({ format: 'html' }), storedExportFormat({ format: 'pdf' }), storedExportFormat({ format: 'doc' }), storedExportFormat('txt')]).toEqual(['md', 'html', 'pdf', 'md', 'md'])
  expect([asExportFormat('txt'), asExportFormat('PDF'), asExportFormat(undefined)]).toEqual(['txt', null, null])
})

test('message text loses terminal escapes, control characters and bidi overrides, and keeps newlines and tabs', () => {
  const esc = String.fromCharCode(27)
  const bel = String.fromCharCode(7)
  const rlo = String.fromCharCode(0x202e)
  const lri = String.fromCharCode(0x2066)
  const raw = `${esc}[31mred${esc}[0m ${esc}]8;;https://x.test${bel}link${esc}]8;;${bel}\ta${String.fromCharCode(0)}b${String.fromCharCode(0x9b)}\n${rlo}gnp.exe${lri}x 한글 é`
  expect(cleanText(raw)).toBe('red link\tab\ngnp.exex 한글 é')
  expect(turnsOf([user(`${esc}[2Jhi`)])[0]?.parts[0]?.text).toBe('hi')
  expect(toolLine(use('Bash', { command: `${esc}[2Jls ${rlo}x` }))).toBe('Bash(ls x)')
})

test('the folder for each setting, on macOS and Linux', () => {
  const place = { sessionDir: '/work/project', home: '/Users/alex', userProfile: undefined, os: undefined }
  expect(exportFolder('session', place)).toBe('/work/project')
  expect(exportFolder('downloads', place)).toBe('/Users/alex/Downloads')
  expect(exportFolder('desktop', place)).toBe('/Users/alex/Desktop')
  expect(exportFolder('documents', { ...place, home: '/home/alex/' })).toBe('/home/alex/Documents')
  expect(exportFolder('home', place)).toBe('/Users/alex')
  // A value outside the list is the default, Downloads; no home is no folder.
  expect([exportFolder('elsewhere', place), exportFolder(undefined, place), exportFolder('toString', place)]).toEqual(['/Users/alex/Downloads', '/Users/alex/Downloads', '/Users/alex/Downloads'])
  expect(exportFolder('downloads', { ...place, home: undefined })).toBeNull()
  expect(joinPath('/work/project/', 'a.md', undefined)).toBe('/work/project/a.md')
  expect(joinPath('/', 'a.md', 'Darwin')).toBe('/a.md')
})

test('the folder for each setting, on Windows: USERPROFILE and backslashes', () => {
  const sep = String.fromCharCode(92)
  const profile = ['C:', 'Users', 'alex'].join(sep)
  const place = { sessionDir: ['D:', 'code', 'app'].join(sep), home: '/c/Users/alex', userProfile: profile, os: 'Windows_NT' }
  expect(exportFolder('session', place)).toBe(place.sessionDir)
  expect(exportFolder('desktop', place)).toBe([profile, 'Desktop'].join(sep))
  expect(exportFolder('home', place)).toBe(profile)
  // Without USERPROFILE, HOME stands in.
  expect(exportFolder('documents', { ...place, userProfile: undefined })).toBe(['/c/Users/alex', 'Documents'].join(sep))
  expect(joinPath(`${profile}${sep}`, 'a.md', 'Windows_NT')).toBe([profile, 'a.md'].join(sep))
  expect(joinPath(`C:${sep}`, 'a.md', 'Windows_NT')).toBe(['C:', 'a.md'].join(sep))
})
