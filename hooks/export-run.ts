// Export: the conversation into new files in the folder the setting names, in the format asked for or the last one used,
// which is remembered once the files are written. Out of register.tsx for its 800-line cap; the store calls are
// register.tsx's (`StoreIo`), which note a failure.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { ExportFormat } from '../types/index'
import { MESSAGES_MAX, exportBaseName, exportFileName, exportParts, storedExportFormat } from './lib/export'
import { fileStamp, formatDateTime } from './lib/format'
import type { ClockOptions } from './lib/format'
import type { Lang, TFn } from './lib/i18n'
import { exportFolder, joinPath } from './lib/platform'
import { EXPORT_COPIES_MAX, EXPORT_TOAST_MS } from './runtime'
import type { StoreIo } from './runtime'
import { browserPlaces, findBrowsers, printPdf } from './pdf-run'

export type ExportEnv = { t: TFn; lang: Lang; clock: ClockOptions; exportDirectory: unknown; pdfBrowser: unknown }

// The status tab's choice; the store's `exportLast` is the one the band's button uses next, in every session.
const exportFormatState = atom({ plugin: 'oh-my-toolbelt', key: 'exportFormat' } as const, 'md')

export function readExportFormat($: EngineInterface): Promise<ExportFormat> {
  return read($, exportFormatState)
}

// At each load of the store.
export async function loadExportFormat($: EngineInterface, io: StoreIo): Promise<void> {
  const format = storedExportFormat((await io.get('exportLast')).value)
  await update($, exportFormatState, () => format)
}

export async function rememberFormat($: EngineInterface, io: StoreIo, format: ExportFormat): Promise<void> {
  await io.set('exportLast', { format })
  await update($, exportFormatState, () => format)
}

// The line that says where the conversation, or the desktop app's opened prompt row's answer alone (`only`), was
// saved. A failure (a refused read or write) goes to the debug log and the status tab, and the line says to look there.
export async function exportOutcome($: EngineInterface, io: StoreIo, env: ExportEnv, wanted?: ExportFormat, only?: AnswerOnly): Promise<string> {
  return (await io.attempt('export', () => exportSession($, io, env, wanted, only), null)) ?? env.t('toast.exportFailed')
}

async function exportSession($: EngineInterface, io: StoreIo, env: ExportEnv, wanted: ExportFormat | undefined, only: AnswerOnly | undefined): Promise<string> {
  const format = await formatToWrite($, wanted, storedExportFormat((await io.get('exportLast')).value), env.pdfBrowser)
  const done = await writeExport($, format, env, only)
  if (done.isWritten && only === undefined) await rememberFormat($, io, format)
  return done.line
}

async function exportFolderOf($: EngineInterface, exportDirectory: unknown): Promise<{ folder: string | null; os: string | undefined }> {
  const place = { sessionDir: await $.session.cwd(), home: await $.env.get('HOME'), userProfile: await $.env.get('USERPROFILE'), os: await $.env.get('OS') }
  return { folder: exportFolder(exportDirectory, place), os: place.os }
}

// Nothing is written over: a name any part would take moves the whole set on to `-2`, `-3`, …
async function freePaths($: EngineInterface, pathsOf: (copy: number) => string[]): Promise<string[] | null> {
  for (let copy = 1; copy <= EXPORT_COPIES_MAX; copy += 1) {
    const paths = pathsOf(copy)
    if (!(await Promise.all(paths.map(path => $.fs.exists(path)))).includes(true)) return paths
  }
  return null
}

// One prompt's answer alone, from the desktop app's opened prompt row, named by its number.
export type AnswerOnly = { answer: string; number: number }

// The conversation, or one answer, as the files' texts, with what names them.
async function partsOf($: EngineInterface, format: ExportFormat, env: ExportEnv, only?: AnswerOnly): Promise<{ parts: string[]; sessionId: string; now: number }> {
  const messages = only === undefined ? await $.session.messages() : [{ role: 'assistant' as const, text: only.answer, toolUses: [] }]
  const [sessionId, now] = [await $.session.id(), await $.clock.now()]
  const meta = { t: env.t, lang: env.lang, sessionId, date: formatDateTime(now, env.clock), isCapped: messages.length >= MESSAGES_MAX }
  return { parts: exportParts(messages, format, meta), sessionId, now }
}

// Writes every part and returns the line that says where, and whether files were written; a failure throws.
// The band's button saves in the last format; a pdf with no browser picked any more, or away from a terminal (the
// desktop app runs no programs, d.ts `$.process`, so its list has no pdf), is saved as its html page.
async function formatToWrite($: EngineInterface, wanted: ExportFormat | undefined, stored: ExportFormat, pdfBrowser: unknown): Promise<ExportFormat> {
  if (wanted !== undefined) return wanted
  const canPdf = (pdfBrowser ?? 'off') !== 'off' && (await $.session.surfaces()).includes('terminal')
  return stored === 'pdf' && !canPdf ? 'html' : stored
}

// The command's reply row may sit under the curtain, so the line is a toast as well.
export function toastAndAnswer($: EngineInterface, line: string): { text: string } {
  $.ui.toast(line, { timeoutMs: EXPORT_TOAST_MS })
  return { text: line }
}

// An answer alone is never a pdf: it is asked for where no program runs (the desktop app).
async function writeExport($: EngineInterface, format: ExportFormat, env: ExportEnv, only?: AnswerOnly): Promise<{ line: string; isWritten: boolean }> {
  const { t, clock } = env
  if (format === 'pdf' && only === undefined) return writePdf($, env)
  const asWritten = format === 'pdf' ? 'html' : format
  const { parts, sessionId, now } = await partsOf($, asWritten, env, only)
  const { folder, os } = await exportFolderOf($, env.exportDirectory)
  if (parts.length === 0 || folder === null) return { line: t(parts.length === 0 ? 'toast.exportEmpty' : 'toast.exportNoHome'), isWritten: false }
  const base = `${exportBaseName(sessionId, fileStamp(now, clock.timeZone))}${only === undefined ? '' : `-answer-${only.number}`}`
  const paths = await freePaths($, copy => parts.map((_, k) => joinPath(folder, exportFileName(base, asWritten, copy, k + 1), os)))
  if (paths === null) throw new Error(`every name up to -${EXPORT_COPIES_MAX} is taken`)
  for (const [k, path] of paths.entries()) await $.fs.write(path, parts[k] ?? '')
  return { line: t(paths.length === 1 ? 'toast.exported' : 'toast.exportedParts', { path: paths[0], n: paths.length }), isWritten: true }
}

// PDF: the html parts written first, each printed beside it by the browser `pdfBrowser` names. `$.fs` cannot delete, so
// the html stays and the line says where both are.
async function writePdf($: EngineInterface, env: ExportEnv): Promise<{ line: string; isWritten: boolean }> {
  const { t, clock } = env
  const places = await browserPlaces($)
  const { os } = places
  const browsers = await findBrowsers($, env.pdfBrowser, places)
  if (browsers.length === 0) return { line: t(env.pdfBrowser === 'off' || env.pdfBrowser === undefined ? 'toast.pdfOff' : 'toast.pdfNoBrowser'), isWritten: false }
  const { parts, sessionId, now } = await partsOf($, 'pdf', env)
  const { folder } = await exportFolderOf($, env.exportDirectory)
  if (parts.length === 0 || folder === null) return { line: t(parts.length === 0 ? 'toast.exportEmpty' : 'toast.exportNoHome'), isWritten: false }
  const base = exportBaseName(sessionId, fileStamp(now, clock.timeZone))
  const named = (format: 'html' | 'pdf', copy: number) => parts.map((_, k) => joinPath(folder, exportFileName(base, format, copy, k + 1), os))
  const paths = await freePaths($, copy => [...named('html', copy), ...named('pdf', copy)])
  if (paths === null) throw new Error(`every name up to -${EXPORT_COPIES_MAX} is taken`)
  const [pages, pdfs] = [paths.slice(0, parts.length), paths.slice(parts.length)]
  for (const [k, path] of pages.entries()) await $.fs.write(path, parts[k] ?? '')
  for (const [k, page] of pages.entries()) {
    const printed = await printPdf($, browsers, page, pdfs[k] ?? '', os)
    // The page is there either way; the format is remembered only once a pdf is.
    if (printed !== 'printed') return { line: t(printed === 'absent' ? 'toast.pdfNoBrowserPage' : 'toast.pdfFailed', { html: pages[0] }), isWritten: false }
  }
  // ponytail: a pdf in parts names its first file; say the count as toast.exportedParts does if such long ones turn up
  return { line: t('toast.exportedPdf', { path: pdfs[0], html: pages[0] }), isWritten: true }
}
