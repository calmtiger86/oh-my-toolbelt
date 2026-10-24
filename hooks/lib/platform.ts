// Where an export goes (the `exportDirectory` setting), and where Windows keeps PowerShell. Pure: the callers read the
// session folder and the environment (`HOME`, `USERPROFILE`, `OS`, `SystemRoot`) and pass them in.

export type ExportPlace = {
  // The session's working folder, absolute.
  sessionDir: string
  home: string | undefined
  userProfile: string | undefined
  // The `OS` variable: `Windows_NT` on Windows, unset elsewhere.
  os: string | undefined
}

// The folders under home, by setting. Their English names are the folders' real names on macOS and Windows.
// ponytail: Linux may name them in its own language (XDG user dirs) and Windows may move them to OneDrive; read
// `xdg-user-dir` or the shell folder registry if that matters. `$.fs.write` creates a missing folder.
const UNDER_HOME = { downloads: 'Downloads', desktop: 'Desktop', documents: 'Documents', home: '' } as const

export const isWindows = (os: string | undefined): boolean => os === 'Windows_NT'

// Windows PowerShell by its full path: a program named alone may be looked for in the session's folder before PATH.
// `SystemRoot` is the Windows folder; `C:\Windows` stands in where it is unset or does not start at a drive (a relative
// path would be looked for in the session's folder again).
export const powershellPath = (systemRoot: string | undefined): string =>
  `${systemRoot !== undefined && /^[A-Za-z]:[\\/]/.test(systemRoot) ? systemRoot.replace(/[\\/]+$/, '') : 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`

// The folder joined to a name with the system's separator. The folder is kept as given and only its trailing
// separators go, so a root (`/`, `C:\`) keeps one.
export function joinPath(dir: string, name: string, os: string | undefined): string {
  const windows = isWindows(os)
  return `${dir.replace(windows ? /[\\/]+$/ : /\/+$/, '')}${windows ? '\\' : '/'}${name}`
}

// The folder of the exportDirectory setting: the session's folder, or home (USERPROFILE first on Windows) or a
// folder under it. Null when home is unknown. A value outside the list counts as `downloads`, the default: the
// session's folder is usually a project, where a conversation file could be committed.
export function exportFolder(setting: unknown, place: ExportPlace): string | null {
  if (setting === 'session') return place.sessionDir
  const key = typeof setting === 'string' && Object.hasOwn(UNDER_HOME, setting) ? setting : 'downloads'
  const home = isWindows(place.os) ? (place.userProfile ?? place.home) : (place.home ?? place.userProfile)
  if (home === undefined || home.trim() === '') return null
  const sub = UNDER_HOME[key as keyof typeof UNDER_HOME]
  return sub === '' ? home : joinPath(home, sub, place.os)
}
