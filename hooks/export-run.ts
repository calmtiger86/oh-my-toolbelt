// Export: the conversation into new files in the folder the setting names, in the format asked for or the last one used,
// which is remembered once the files are written. The store calls are register.tsx's (`StoreIo`), which note a
// failure.
import type { ExportFormat } from '../types/index'
import { MESSAGES_MAX, exportBaseName, exportFileName, exportParts, storedExportFormat } from './lib/export'
import { fileStamp, formatDateTime } from './lib/format'
import type { ClockOptions } from './lib/format'
import type { Lang, TFn } from './lib/i18n'
import { exportFolder, joinPath } from './lib/platform'
import { EXPORT_COPIES_MAX, EXPORT_TOAST_MS } from './runtime'
import type { Engine, StoreIo } from './runtime'
import { browserPlaces, findBrowsers, printPdf } from './pdf-run'

export type ExportEnv = { t: TFn; lang: Lang; clock: ClockOptions; exportDirectory: unknown; pdfBrowser: unknown }

export function readExportFormat(engine: Engine): Promise<ExportFormat> {
  return engine.cells.exportFormat.read()
}

// At each load of the store.
export async function loadExportFormat(engine: Engine, io: StoreIo): Promise<void> {
  const format = storedExportFormat((await io.get('exportLast')).value)
  await engine.cells.exportFormat.update(() => format)
}

export async function rememberFormat(engine: Engine, io: StoreIo, format: ExportFormat): Promise<void> {
  await io.set('exportLast', { format })
  await engine.cells.exportFormat.update(() => format)
}

// The line that says where the conversation, or the desktop app's opened prompt row's answer alone (`only`), was
// saved. A failure (a refused read or write) goes to the debug log and the status tab, and the line says to look there.
export async function exportOutcome(engine: Engine, io: StoreIo, env: ExportEnv, wanted?: ExportFormat, only?: AnswerOnly): Promise<string> {
  return (await io.attempt('export', () => exportSession(engine, io, env, wanted, only), null)) ?? env.t('toast.exportFailed')
}

// The engine adds an answer block once it is written, so one exported while Claude answers lacks the block being
// written: the line says so.
async function exportSession(engine: Engine, io: StoreIo, env: ExportEnv, wanted: ExportFormat | undefined, only: AnswerOnly | undefined): Promise<string> {
  const format = await formatToWrite(engine, wanted, storedExportFormat((await io.get('exportLast')).value), env.pdfBrowser)
  const done = await writeExport(engine, format, env, only)
  if (!done.isWritten || only !== undefined) return done.line
  await rememberFormat(engine, io, format)
  // Saved already: a refused read leaves the line as it is rather than saying the export failed.
  return (await engine.cells.turnRunning.read().catch(() => false)) ? `${done.line} ${env.t('toast.exportMidTurn')}` : done.line
}

async function exportFolderOf(engine: Engine, exportDirectory: unknown): Promise<{ folder: string | null; os: string | undefined }> {
  const place = { sessionDir: await engine.session.cwd(), home: await engine.env.get('HOME'), userProfile: await engine.env.get('USERPROFILE'), os: await engine.env.get('OS') }
  return { folder: exportFolder(exportDirectory, place), os: place.os }
}

// Nothing is written over: a name any part would take moves the whole set on to `-2`, `-3`, …
async function freePaths(engine: Engine, pathsOf: (copy: number) => string[]): Promise<string[] | null> {
  for (let copy = 1; copy <= EXPORT_COPIES_MAX; copy += 1) {
    const paths = pathsOf(copy)
    if (!(await Promise.all(paths.map(path => engine.fs.exists(path)))).includes(true)) return paths
  }
  return null
}

// One prompt's answer alone, from the desktop app's opened prompt row, named by its number.
export type AnswerOnly = { answer: string; number: number }

// The conversation, or one answer, as the files' texts, with what names them.
async function partsOf(engine: Engine, format: ExportFormat, env: ExportEnv, only?: AnswerOnly): Promise<{ parts: string[]; sessionId: string; now: number }> {
  const messages = only === undefined ? await engine.session.messages() : [{ role: 'assistant' as const, text: only.answer, toolUses: [] }]
  const [sessionId, now] = [await engine.session.id(), await engine.clock.now()]
  const meta = { t: env.t, lang: env.lang, sessionId, date: formatDateTime(now, env.clock), isCapped: messages.length >= MESSAGES_MAX }
  return { parts: exportParts(messages, format, meta), sessionId, now }
}

// Writes every part and returns the line that says where, and whether files were written; a failure throws.
// The band's button saves in the last format; a pdf with no browser picked any more, or away from a terminal (the
// desktop app runs no programs, d.ts `$.process`, so its list has no pdf), is saved as its html page.
async function formatToWrite(engine: Engine, wanted: ExportFormat | undefined, stored: ExportFormat, pdfBrowser: unknown): Promise<ExportFormat> {
  if (wanted !== undefined) return wanted
  const canPdf = (pdfBrowser ?? 'off') !== 'off' && (await engine.session.surfaces()).includes('terminal')
  return stored === 'pdf' && !canPdf ? 'html' : stored
}

// The command's reply row may sit under the curtain, so the line is a toast as well.
export function toastAndAnswer(engine: Engine, line: string): { text: string } {
  engine.ui.toast(line, { timeoutMs: EXPORT_TOAST_MS })
  return { text: line }
}

// An answer alone is never a pdf: it is asked for where no program runs (the desktop app).
async function writeExport(engine: Engine, format: ExportFormat, env: ExportEnv, only?: AnswerOnly): Promise<{ line: string; isWritten: boolean }> {
  const { t, clock } = env
  if (format === 'pdf' && only === undefined) return writePdf(engine, env)
  const asWritten = format === 'pdf' ? 'html' : format
  const { parts, sessionId, now } = await partsOf(engine, asWritten, env, only)
  const { folder, os } = await exportFolderOf(engine, env.exportDirectory)
  if (parts.length === 0 || folder === null) return { line: t(parts.length === 0 ? 'toast.exportEmpty' : 'toast.exportNoHome'), isWritten: false }
  const base = `${exportBaseName(sessionId, fileStamp(now, clock.timeZone))}${only === undefined ? '' : `-answer-${only.number}`}`
  const paths = await freePaths(engine, copy => parts.map((_, k) => joinPath(folder, exportFileName(base, asWritten, copy, k + 1), os)))
  if (paths === null) throw new Error(`every name up to -${EXPORT_COPIES_MAX} is taken`)
  for (const [k, path] of paths.entries()) await engine.fs.write(path, parts[k] ?? '')
  return { line: t(paths.length === 1 ? 'toast.exported' : 'toast.exportedParts', { path: paths[0], n: paths.length }), isWritten: true }
}

// PDF: the html parts written first, each printed beside it by the browser `pdfBrowser` names. `$.fs` cannot delete, so
// the html stays and the line says where both are.
async function writePdf(engine: Engine, env: ExportEnv): Promise<{ line: string; isWritten: boolean }> {
  const { t, clock } = env
  const places = await browserPlaces(engine)
  const { os } = places
  const browsers = await findBrowsers(engine, env.pdfBrowser, places)
  if (browsers.length === 0) return { line: t(env.pdfBrowser === 'off' || env.pdfBrowser === undefined ? 'toast.pdfOff' : 'toast.pdfNoBrowser'), isWritten: false }
  const { parts, sessionId, now } = await partsOf(engine, 'pdf', env)
  const { folder } = await exportFolderOf(engine, env.exportDirectory)
  if (parts.length === 0 || folder === null) return { line: t(parts.length === 0 ? 'toast.exportEmpty' : 'toast.exportNoHome'), isWritten: false }
  const base = exportBaseName(sessionId, fileStamp(now, clock.timeZone))
  const named = (format: 'html' | 'pdf', copy: number) => parts.map((_, k) => joinPath(folder, exportFileName(base, format, copy, k + 1), os))
  const paths = await freePaths(engine, copy => [...named('html', copy), ...named('pdf', copy)])
  if (paths === null) throw new Error(`every name up to -${EXPORT_COPIES_MAX} is taken`)
  const [pages, pdfs] = [paths.slice(0, parts.length), paths.slice(parts.length)]
  for (const [k, path] of pages.entries()) await engine.fs.write(path, parts[k] ?? '')
  for (const [k, page] of pages.entries()) {
    const printed = await printPdf(engine, browsers, page, pdfs[k] ?? '', os)
    // The page is there either way; the format is remembered only once a pdf is.
    if (printed !== 'printed') return { line: t(printed === 'absent' ? 'toast.pdfNoBrowserPage' : 'toast.pdfFailed', { html: pages[0] }), isWritten: false }
  }
  // ponytail: a pdf in parts names its first file; say the count as toast.exportedParts does if such long ones turn up
  return { line: t('toast.exportedPdf', { path: pdfs[0], html: pages[0] }), isWritten: true }
}
