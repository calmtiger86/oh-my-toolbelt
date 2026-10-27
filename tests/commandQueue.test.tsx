// A command button pressed while Claude answers: the engine runs a plugin's command once the turn has ended, and the
// call stays unresolved until then.
import { expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { TEST_OPTIONS, boot, mountBand, seedButtons, test } from './helpers'

const QUEUED = '/usage will run when Claude finishes answering.'
const USAGE = { command: 'usage', args: '' }

// The turn events end at the test's own hooks, as in tests/tocHistory.test.tsx.
function stubTurns(on: On): void {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}
const startTurn = ($: Engine, n: number, agentId?: string) => $.turn.start({ text: `prompt ${n}`, turnId: `t${n}`, ...(agentId === undefined ? {} : { agentId }) })
const endTurn = ($: Engine, n: number, agentId?: string) =>
  $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: `t${n}`, reason: 'answer', ...(agentId === undefined ? {} : { agentId }) })

// Regression: pressed while Claude answered, a command button seemed to do nothing until the answer ended. The turn is
// followed with the prompts tab off too, which turns off the tab's own record of it.
for (const tocTab of [true, false]) {
  test(`a command button pressed during a turn says it waits for the answer, prompts tab ${tocTab ? 'on' : 'off'}`, { options: { ...TEST_OPTIONS, tocTab } }, async ($, on) => {
    stubTurns(on)
    const { calls } = await boot($, on, { store: { buttons: seedButtons() } })
    const ui = await mountBand($, 'terminal', 258)
    await startTurn($, 1)
    await ui.press({ key: 'btn:ex-usage' })
    expect(calls.toasts).toEqual([QUEUED])
    expect(calls.ran).toEqual([USAGE])
    await endTurn($, 1)
    // Idle, the command runs at once and nothing is said.
    await ui.press({ key: 'btn:ex-usage' })
    expect(calls.toasts).toEqual([QUEUED])
    expect(calls.ran).toEqual([USAGE, USAGE])
    // An agent's turn does not hold the main loop's commands back.
    await startTurn($, 2, 'a1')
    await ui.press({ key: 'btn:ex-usage' })
    expect(calls.toasts).toEqual([QUEUED])
    await endTurn($, 2, 'a1')
    await ui.unmount()
  })
}

test('pressed again while its command waits for the turn, a button is not queued twice', { options: TEST_OPTIONS }, async ($, on) => {
  // Above boot's own `command.run` stub: holds /usage as the engine holds a command until the turn has ended.
  let release = (): void => undefined
  const held = new Promise<void>(resolve => (release = resolve))
  let enter = (): void => undefined
  const entered = new Promise<void>(resolve => (enter = resolve))
  on('command.run', { command: 'usage' }, async (_, e, next) => (enter(), await held, next(e)))
  stubTurns(on)
  const { calls } = await boot($, on, { store: { buttons: seedButtons() } })
  const ui = await mountBand($, 'terminal', 258)
  await startTurn($, 1)
  const first = ui.press({ key: 'btn:ex-usage' })
  await entered
  await ui.press({ key: 'btn:ex-usage' })
  // The second press says the same and adds nothing to the queue.
  expect(calls.toasts).toEqual([QUEUED, QUEUED])
  await endTurn($, 1)
  release()
  await first
  expect(calls.ran).toEqual([USAGE])
  await ui.unmount()
})

// A command whose run the engine never lets go (a refused queue, a host limit) holds its button back for that turn
// only: the turn's end empties the wait.
test('a turn\'s end lets go of a button whose command has not run, so the next turn queues it again', { options: TEST_OPTIONS }, async ($, on) => {
  let release = (): void => undefined
  const held = new Promise<void>(resolve => (release = resolve))
  const entered: (() => void)[] = []
  const runs = [new Promise<void>(resolve => entered.push(resolve)), new Promise<void>(resolve => entered.push(resolve))]
  let count = 0
  on('command.run', { command: 'usage' }, async (_, e, next) => (entered[count++]?.(), await held, next(e)))
  stubTurns(on)
  await boot($, on, { store: { buttons: seedButtons() } })
  const ui = await mountBand($, 'terminal', 258)
  await startTurn($, 1)
  const first = ui.press({ key: 'btn:ex-usage' })
  await runs[0]
  await endTurn($, 1)
  await startTurn($, 2)
  const second = ui.press({ key: 'btn:ex-usage' })
  await runs[1]
  expect(count).toBe(2)
  release()
  await Promise.all([first, second])
  await endTurn($, 2)
  await ui.unmount()
})

// Regression: a button whose command is not installed said it would run after the answer, then that it is missing.
test('a button whose command is not installed says so alone, during a turn too', { options: TEST_OPTIONS }, async ($, on) => {
  stubTurns(on)
  // The engine refuses a name it does not know (d.ts `$.command.run`).
  const { calls } = await boot($, on, { store: { buttons: seedButtons() }, commands: [{ name: 'deslop', description: '', source: 'plugin', plugin: 'other' }], failRun: ['usage'] })
  const ui = await mountBand($, 'terminal', 258)
  await startTurn($, 1)
  await ui.press({ key: 'btn:ex-usage' })
  expect(calls.toasts).toEqual(['The /usage command is not installed.'])
  await endTurn($, 1)
  await ui.unmount()
})
