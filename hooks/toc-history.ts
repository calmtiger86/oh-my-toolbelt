// The prompts tab's earlier prompts: the session's transcript file, read on this computer and sent nowhere, fills the
// table with what was sent before this module loaded. The settings hooks' SessionStart names the file; the store keeps
// the newest sessions' paths, so a reloaded module, whose session.start names none, finds it. Module state, as
// toc-live's; a function that calls the engine takes `$` as its argument and keeps none of it.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import { errorText } from './runtime'
import { noteHistory, resetToc } from './toc-live'
import { READ_CAP, TAIL_PATH, feedLines, historyOf, isWindowsPath, lastRows, rowsOf, startFeed, streamRequest } from './tools/transcript'
import type { Row } from './tools/transcript'

// `transcript:<session id>` -> { path, at }: one key per session, so sessions starting together never rewrite each
// other's; the newest few stay.
const TRANSCRIPT_KEY_PREFIX = 'transcript:'
const KEPT_TRANSCRIPTS = 20

type Transcript = { sessionId: string; path: string }
// What a settings hook's SessionStart says of the conversation now on screen.
export type SessionStartNote = { session_id: string; transcript_path: string; source: string }

// The transcript the last SessionStart of this load named, the one of the conversation on screen, and the one read.
let named: Transcript | undefined
let shown: string | undefined
let readPath: string | undefined
// Counts the conversations put on screen: a read started for an earlier one stops at its next piece.
let generation = 0

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Only a file named after its session, as the engine names a session's transcript, the whole name after a folder's
// separator: a path another hook changed, or the store holds for the session, is read only then.
const isTranscriptOf = (path: string, sessionId: string): boolean =>
  sessionId !== '' && (path.endsWith(`/${sessionId}.jsonl`) || path.endsWith(`\\${sessionId}.jsonl`))

// A failed read leaves the table as the drawn rows fill it; one debug line says why.
function logFailure($: EngineInterface, what: string, err: unknown): void {
  $.ui.log(`oh-my-toolbelt: transcript ${what} failed: ${errorText(err)}`, { to: 'debug' })
}

// Remembers the session's transcript under its own key, then drops all but the newest few sessions' keys.
async function rememberTranscript($: EngineInterface, at: Transcript): Promise<void> {
  try {
    await $.store.set(`${TRANSCRIPT_KEY_PREFIX}${at.sessionId}`, { path: at.path, at: await $.clock.now() })
    const keys = (await $.store.keys()).filter(key => key.startsWith(TRANSCRIPT_KEY_PREFIX))
    if (keys.length <= KEPT_TRANSCRIPTS) return
    const dated = await Promise.all(keys.map(async key => {
      const value = await $.store.get(key)
      return { key, at: isRecord(value) && typeof value.at === 'number' ? value.at : 0 }
    }))
    const old = [...dated].sort((x, y) => y.at - x.at).slice(KEPT_TRANSCRIPTS)
    await Promise.all(old.map(({ key }) => $.store.delete(key)))
  } catch (err) {
    logFailure($, 'remember', err)
  }
}

// The transcript remembered for this session.
async function rememberedTranscript($: EngineInterface): Promise<Transcript | undefined> {
  const sessionId = await $.session.id()
  const value = await $.store.get(`${TRANSCRIPT_KEY_PREFIX}${sessionId}`)
  const path = isRecord(value) ? value.path : undefined
  return typeof path === 'string' && isTranscriptOf(path, sessionId) ? { sessionId, path } : undefined
}

// The file's rows: one `$.fs.read` up to READ_CAP, a command's output past it. The engine appends to the file, so a
// read refused because it grew past READ_CAP since `size` was taken streams it after all. A stream stops with an error
// once `isWanted` says no.
export async function readRows($: EngineInterface, path: string, size: number, isWanted: () => boolean = () => true): Promise<readonly Row[]> {
  if (size > READ_CAP) return streamRows($, path, isWanted)
  try {
    return rowsOf(await $.fs.read(path))
  } catch (err) {
    if ((await $.fs.stat(path)).size <= READ_CAP) throw err
    return streamRows($, path, isWanted)
  }
}

// The file through a command (see streamRequest): the engine rejects a stream's first pull when its command cannot
// start, as where there is no `tail`, and that failure is the caller's. A look for TAIL_PATH that fails names tail alone.
// ponytail: no cap on the whole file (rows held ~0.5 KB each, 300,000 rows ~157 MB); read only its last N MiB
// (`tail -c N`, PowerShell's Seek) if sessions that long matter, as liveBranch already counts every row above a parent
// the file lacks.
async function streamRows($: EngineInterface, path: string, isWanted: () => boolean): Promise<readonly Row[]> {
  const isWindows = isWindowsPath(path)
  const tail = !isWindows && (await $.fs.exists(TAIL_PATH).catch(() => false)) ? TAIL_PATH : 'tail'
  const request = streamRequest(path, isWindows ? await $.env.get('SystemRoot') : undefined, tail)
  const child = $.process.spawn(request)
  return drainRows(child, await child.next(), request.argv[0] ?? '', isWanted)
}

// The rows of a child's standard output, piece by piece, line by line; a child that does not end well fails the read.
// However the loop is left, the child is ended: leaving it early (a stop, a throw) would otherwise keep it running.
async function drainRows(child: HookStream<ProcessSpawnChunk, ProcessSpawnResult>, first: IteratorResult<ProcessSpawnChunk, ProcessSpawnResult>, name: string, isWanted: () => boolean): Promise<Row[]> {
  try {
    const rows: Row[] = []
    let feed = startFeed()
    let pull = first
    while (pull.done !== true) {
      if (!isWanted()) throw new Error(`${name} stopped: another conversation is on screen`)
      if (pull.value.stream === 'stdout') {
        const fed = feedLines(feed, pull.value.text)
        feed = fed.feed
        for (const row of fed.rows) rows.push(row)
      }
      pull = await child.next()
    }
    if (pull.value.code !== 0) throw new Error(`${name} ended with ${pull.value.code ?? pull.value.signal}`)
    return [...rows, ...lastRows(feed)]
  } finally {
    await child.return({ code: null, signal: null })
  }
}

// Reads the file and fills the table, unless the person moved to another conversation meanwhile; a read stopped for
// that is no failure.
async function fillWith($: EngineInterface, path: string, size: number, at: number): Promise<void> {
  const isWanted = () => at === generation
  try {
    const rows = await readRows($, path, size, isWanted)
    if (isWanted()) await noteHistory($, historyOf(rows, $.plugin.name))
  } catch (err) {
    if (isWanted()) logFailure($, 'read', err)
  }
}

// Fills the table from the conversation's file, once while it stays on screen. Another conversation's file empties
// the table first (/resume, /branch). A file not there yet (a new session) fills nothing; one past READ_CAP is
// streamed without holding the hook.
async function fillFrom($: EngineInterface, path: string): Promise<void> {
  if (readPath === path) return
  if (shown !== undefined && shown !== path) resetToc($)
  shown = path
  readPath = path
  generation += 1
  const at = generation
  try {
    if (!(await $.fs.exists(path))) return
    const { size } = await $.fs.stat(path)
    const filling = fillWith($, path, size, at)
    if (size <= READ_CAP) await filling
  } catch (err) {
    logFailure($, 'stat', err)
  }
}

// A settings hook's SessionStart (startup, resume, clear, compact, fork): the path the engine gives is the only one
// read, and neither read nor kept unless named after the session; one that is not forgets the file named before, which
// was another conversation's. The first of a launch may come before session.start, which then fills from it; /clear
// opens an empty file. A store a newer version wrote is not written (`canWrite`).
export async function noteTranscript($: EngineInterface, e: SessionStartNote, isActive: boolean, canWrite: boolean): Promise<void> {
  if (!isTranscriptOf(e.transcript_path, e.session_id)) {
    named = undefined
    return
  }
  named = { sessionId: e.session_id, path: e.transcript_path }
  if (!isActive) return
  if (canWrite) await rememberTranscript($, named)
  if (e.source !== 'clear') return fillFrom($, named.path)
  // The hook before this one emptied the table; the new conversation's rows are noted as they come.
  shown = named.path
  readPath = named.path
  generation += 1
}

// The prompts tab turned on again without a reload (a change to the mod's own settings): the file is read anew.
export async function refillTranscript($: EngineInterface, canWrite: boolean): Promise<void> {
  readPath = undefined
  await fillTranscript($, canWrite)
}

// session.start: at a launch the SessionStart before it named the file; after a reload the store does.
export async function fillTranscript($: EngineInterface, canWrite: boolean): Promise<void> {
  try {
    const at = named ?? (await rememberedTranscript($))
    if (at === undefined) return
    if (named !== undefined && canWrite) await rememberTranscript($, named)
    await fillFrom($, at.path)
  } catch (err) {
    logFailure($, 'lookup', err)
  }
}
