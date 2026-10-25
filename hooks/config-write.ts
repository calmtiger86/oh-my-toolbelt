// The only place the mod writes /config: one plain call per row it may change, the key written out, so a reader (the
// plugin directory's check among them) sees that it changes its own rows and the theme and nothing else.
import type { ConfigSetResult, ConfigValue, EngineInterface } from 'claude-code'

export async function writeConfig($: EngineInterface, key: string, value: ConfigValue): Promise<ConfigSetResult> {
  switch (key) {
    case 'oh-my-toolbelt.language': return $.config.set({ key: 'oh-my-toolbelt.language', value: value })
    case 'oh-my-toolbelt.clockFormat': return $.config.set({ key: 'oh-my-toolbelt.clockFormat', value: value })
    case 'oh-my-toolbelt.clockSeconds': return $.config.set({ key: 'oh-my-toolbelt.clockSeconds', value: value })
    case 'oh-my-toolbelt.dateFormat': return $.config.set({ key: 'oh-my-toolbelt.dateFormat', value: value })
    case 'oh-my-toolbelt.timeZone': return $.config.set({ key: 'oh-my-toolbelt.timeZone', value: value })
    case 'oh-my-toolbelt.iconStyle': return $.config.set({ key: 'oh-my-toolbelt.iconStyle', value: value })
    case 'oh-my-toolbelt.weatherPlace': return $.config.set({ key: 'oh-my-toolbelt.weatherPlace', value: value })
    case 'oh-my-toolbelt.temperatureUnit': return $.config.set({ key: 'oh-my-toolbelt.temperatureUnit', value: value })
    case 'oh-my-toolbelt.weatherRefreshMinutes': return $.config.set({ key: 'oh-my-toolbelt.weatherRefreshMinutes', value: value })
    case 'oh-my-toolbelt.pomodoroFocusMinutes': return $.config.set({ key: 'oh-my-toolbelt.pomodoroFocusMinutes', value: value })
    case 'oh-my-toolbelt.pomodoroBreakMinutes': return $.config.set({ key: 'oh-my-toolbelt.pomodoroBreakMinutes', value: value })
    case 'oh-my-toolbelt.pomodoroAutoBreak': return $.config.set({ key: 'oh-my-toolbelt.pomodoroAutoBreak', value: value })
    case 'oh-my-toolbelt.pomodoroNotify': return $.config.set({ key: 'oh-my-toolbelt.pomodoroNotify', value: value })
    case 'oh-my-toolbelt.pomodoroSound': return $.config.set({ key: 'oh-my-toolbelt.pomodoroSound', value: value })
    case 'oh-my-toolbelt.pomodoroSoundName': return $.config.set({ key: 'oh-my-toolbelt.pomodoroSoundName', value: value })
    case 'oh-my-toolbelt.exportDirectory': return $.config.set({ key: 'oh-my-toolbelt.exportDirectory', value: value })
    case 'oh-my-toolbelt.attachEnabled': return $.config.set({ key: 'oh-my-toolbelt.attachEnabled', value: value })
    case 'oh-my-toolbelt.voiceMode': return $.config.set({ key: 'oh-my-toolbelt.voiceMode', value: value })
    case 'oh-my-toolbelt.pdfBrowser': return $.config.set({ key: 'oh-my-toolbelt.pdfBrowser', value: value })
    case 'oh-my-toolbelt.curtainRestoreOnSubmit': return $.config.set({ key: 'oh-my-toolbelt.curtainRestoreOnSubmit', value: value })
    case 'oh-my-toolbelt.hotkeysEnabled': return $.config.set({ key: 'oh-my-toolbelt.hotkeysEnabled', value: value })
    case 'oh-my-toolbelt.tocTab': return $.config.set({ key: 'oh-my-toolbelt.tocTab', value: value })
    case 'oh-my-toolbelt.clipboardTab': return $.config.set({ key: 'oh-my-toolbelt.clipboardTab', value: value })
    case 'oh-my-toolbelt.paneOpenOnStart': return $.config.set({ key: 'oh-my-toolbelt.paneOpenOnStart', value: value })
    case 'theme': return $.config.set({ key: 'theme', value: value })
    default: throw new Error(`not a setting this mod writes: ${key}`)
  }
}
