// The attach button: the pure parts, then the picker each system gets and the @ mentions it leaves.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { ATTACH_TIMEOUT_MS, mentionText, pickedPaths } from '../hooks/tools/attach'
import { TEST_OPTIONS, boot, isSamePath, mountBand } from './helpers'

const OPTIONS = { ...TEST_OPTIONS, attachEnabled: true } as const

test('a picker prints a path a line; a path with a space is quoted as one mention', () => {
  expect(pickedPaths('/a/x.png\r\n/b/my file.txt\n\n')).toEqual(['/a/x.png', '/b/my file.txt'])
  // Only whole paths, none with a double quote: a name broken by a line feed leaves no stray relative mention.
  expect(pickedPaths('/a/x\n.env\nC:\\b.txt\n\\\\srv\\s.txt\n/c/say "hi".txt\n')).toEqual(['/a/x', 'C:\\b.txt', '\\\\srv\\s.txt'])
  expect(pickedPaths('/a/\u001b[2Jx.png\n')).toEqual(['/a/[2Jx.png'])
  expect(mentionText(['/a/x.png', '/b/my file.txt'])).toBe('@/a/x.png @"/b/my file.txt" ')
})

// Pickers by their program: an answer, or undefined for one that cannot start.
type Pickers = Record<string, { exitCode: number; stdout: string } | undefined>

// The disk: osascript where a Mac keeps it, and the files a picker printed, when they are there. The kit makes every
// path absolute on its own host (helpers.ts `hostless`), so the end is compared.
function stubDisk(on: On, present: readonly string[]): void {
  on('fs.exists', (_, e) => ({ value: present.some(path => isSamePath(e.path, path)) }))
}

function stubPickers(on: On, pickers: Pickers): { argv: string[][]; timeouts: (number | undefined)[] } {
  const seen = { argv: [] as string[][], timeouts: [] as (number | undefined)[] }
  on('process.run', (_, e) => {
    seen.argv.push([...e.argv])
    seen.timeouts.push(e.init?.timeoutMs)
    const answer = pickers[e.argv[0] ?? '']
    return answer === undefined ? { deny: 'ENOENT: not found' } : { value: { ...answer, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return seen
}

test('in a terminal the button opens macOS\'s picker and puts the files in the prompt box; a cancel puts nothing', { options: OPTIONS }, async ($, on) => {
  const answer = { exitCode: 0, stdout: '/Users/me/x.png\n/Users/me/my file.txt\n/Users/me/gone.txt\n.env\n' }
  const seen = stubPickers(on, { '/usr/bin/osascript': answer })
  // gone.txt is printed but not there, and .env is no whole path: neither is mentioned.
  stubDisk(on, ['/usr/bin/osascript', '/Users/me/x.png', '/Users/me/my file.txt'])
  const { calls } = await boot($, on)
  const band = await mountBand($, 'terminal', 258)
  expect((await band.find({ key: 'attach' }))?.props).toMatchObject({ label: '📎 Attach', hotkey: 'a' })
  await band.press({ key: 'attach' })
  // By the path the check found, not by a name PATH could point elsewhere.
  expect(seen.argv[0]?.[0]).toBe('/usr/bin/osascript')
  expect(seen.timeouts[0]).toBe(ATTACH_TIMEOUT_MS)
  expect(calls.filled.at(-1)).toBe('@/Users/me/x.png @"/Users/me/my file.txt" ')
  expect(calls.fillModes.at(-1)).toBe('insert')
  answer.exitCode = 1
  const filled = calls.filled.length
  await band.press({ key: 'attach' })
  expect(calls.filled).toHaveLength(filled)
  await band.unmount()
  const desktop = await mountBand($, 'desktop', 258)
  expect(await desktop.find({ key: 'attach' })).toBeUndefined()
  await desktop.unmount()
})

test('with no osascript it is Linux: zenity, then kdialog', { options: OPTIONS }, async ($, on) => {
  const seen = stubPickers(on, { kdialog: { exitCode: 0, stdout: '/home/me/a.md\n' } })
  stubDisk(on, ['/home/me/a.md'])
  const { calls } = await boot($, on, { env: { LANG: 'en_US.UTF-8', DISPLAY: ':0' } })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'attach' })
  expect(seen.argv.map(argv => argv[0])).toEqual(['zenity', 'kdialog'])
  expect(calls.filled.at(-1)).toBe('@/home/me/a.md ')
  await band.unmount()
})

test('Linux with no screen says so', { options: OPTIONS }, async ($, on) => {
  stubPickers(on, {})
  stubDisk(on, [])
  const { calls } = await boot($, on)
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'attach' })
  expect(calls.toasts.at(-1)).toBe('There is no screen to open a file picker on.')
  await band.unmount()
})

test('Linux with a screen but no picker says what to install', { options: OPTIONS }, async ($, on) => {
  stubPickers(on, {})
  stubDisk(on, [])
  const { calls } = await boot($, on, { env: { LANG: 'en_US.UTF-8', WAYLAND_DISPLAY: 'wayland-0' } })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'attach' })
  expect(calls.toasts.at(-1)).toBe('To pick files, install zenity or kdialog.')
  await band.unmount()
})

// Security: PowerShell runs by its full path under SystemRoot, never by a name the session's folder could answer.
test('Windows opens its own picker through PowerShell by its full path, with no script of the person\'s', { options: OPTIONS }, async ($, on) => {
  const powershell = 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  const seen = stubPickers(on, { [powershell]: { exitCode: 0, stdout: 'C:\\Users\\me\\a.txt\r\n' } })
  stubDisk(on, ['C:\\Users\\me\\a.txt'])
  const { calls } = await boot($, on, { env: { LANG: 'en_US.UTF-8', OS: 'Windows_NT', SystemRoot: 'D:\\Win\\' } })
  const band = await mountBand($, 'terminal', 258)
  await band.press({ key: 'attach' })
  expect(seen.argv[0]?.slice(0, 4)).toEqual([powershell, '-NoProfile', '-NonInteractive', '-Command'])
  expect(calls.filled.at(-1)).toBe('@C:\\Users\\me\\a.txt ')
  await band.unmount()
})

test('a picker left open past the timeout is taken as closed: no Linux pickers, no toast', { options: OPTIONS }, async ($, on) => {
  const tried: string[] = []
  stubDisk(on, ['/usr/bin/osascript'])
  let advance: ((ms: number) => Promise<unknown>) | undefined
  on('process.run', async (_, e) => {
    tried.push(e.argv[0] ?? '')
    await advance?.(ATTACH_TIMEOUT_MS)
    return { deny: 'timed out' }
  })
  const { calls, clock } = await boot($, on)
  advance = ms => clock.advance(ms)
  const band = await mountBand($, 'terminal', 258)
  const toasts = calls.toasts.length
  await band.press({ key: 'attach' })
  expect(tried).toEqual(['/usr/bin/osascript'])
  expect(calls.toasts).toHaveLength(toasts)
  await band.unmount()
})
