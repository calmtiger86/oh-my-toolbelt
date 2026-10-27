// The attach button, its pure parts: the file pickers to try on each system, the paths a picker printed, and the @
// mentions they become in the prompt box. hooks/attach-run.ts runs the pickers.
import type { Effect } from '../lib/effects'
import type { TFn } from '../lib/i18n'
import { faceOf } from '../lib/icons'
import type { IconStyle } from '../lib/icons'
import { stripControls } from '../lib/schema'

// The picker waits for a person: the most the engine allows (d.ts process.run, ten minutes).
export const ATTACH_TIMEOUT_MS = 600_000

// Constant scripts: nothing a person typed goes into them.
// Where every Mac keeps osascript: its presence tells macOS from Linux, as no API names the system, and the picker runs
// by that path, not by a name PATH could point elsewhere.
export const MAC_PICKER_PATH = '/usr/bin/osascript'
export const MAC_PICKER: readonly string[] = [
  MAC_PICKER_PATH, '-e', 'set fs to choose file with multiple selections allowed', '-e', 'set out to ""',
  '-e', 'repeat with f in fs', '-e', 'set out to out & POSIX path of f & linefeed', '-e', 'end repeat', '-e', 'out',
]
// PowerShell's arguments; hooks/attach-run.ts runs it by its full path (lib/platform.ts powershellPath).
export const WINDOWS_PICKER_ARGS: readonly string[] = [
  '-NoProfile', '-NonInteractive', '-Command',
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; if($d.ShowDialog() -eq 'OK'){ $d.FileNames }",
]
export const LINUX_PICKERS: readonly (readonly string[])[] = [
  ['zenity', '--file-selection', '--multiple', '--separator=\n'],
  ['kdialog', '--getopenfilename', '.', '', '--multiple', '--separate-output'],
]

// One path a line; a picker's closing newline and Windows' carriage returns are not part of one. Only whole paths are
// kept (`/…`, `C:\…`, `\\…`), and none holding a double quote, which would end its quoted mention early.
const WHOLE_PATH = /^(\/|[A-Za-z]:\\|\\\\)/
export const pickedPaths = (stdout: string): string[] =>
  stdout.split('\n').map(line => stripControls(line.replace(/\r$/, ''))).filter(line => WHOLE_PATH.test(line) && !line.includes('"'))

// The rest of a path under a folder, or undefined; the root as a folder is no shorter.
const under = (path: string, dir: string | undefined): string | undefined => {
  const base = dir?.replace(/\/+$/, '')
  return base && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined
}

// The shortest path Claude Code reads a mention by (tried on 2.1.310): relative inside the session's folder, from ~
// under the home folder, else whole, so the prompt box shows no user name. Claude Code's own "Read" line under a sent
// prompt still shows a file outside the folder by its whole path.
// ponytail: plain prefix match, so a folder reached through a symlink (/tmp for /private/tmp) keeps whole paths;
// compare real paths if that comes up.
export const shortPath = (path: string, cwd: string, home: string | undefined): string => {
  const inCwd = under(path, cwd)
  const inHome = under(path, home)
  // A session folder above the home folder (`/Users`) would put the user name back in a relative path.
  const isHomeInside = home !== undefined && under(home, cwd) !== undefined
  if (inHome !== undefined && (inCwd === undefined || isHomeInside)) return `~/${inHome}`
  return inCwd ?? path
}

// A path with a space is read as one file only inside double quotes.
export const mentionText = (paths: readonly string[]): string => `${paths.map(path => (/\s/.test(path) ? `@"${path}"` : `@${path}`)).join(' ')} `

export const attachLabel = (size: 'long' | 'short', style: IconStyle, picked: string | undefined, t: TFn): string =>
  faceOf(style, size, picked ?? '📎', t('tool.attach'))

export const attachEffects = (): Effect[] => [{ kind: 'attach' }]
