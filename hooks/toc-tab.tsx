// The prompts tab: one plain button per prompt, the one being read heavy and undimmed; a pointer on a row reveals its
// card on the band. Pure: register.tsx hands in what hooks/toc-live.ts saw. In the desktop app, where the engine moves
// no transcript, a press opens the row in place instead.
// Parts ported from oikon48/prompt-rail (MIT): see THIRD_PARTY_NOTICES.md.
import type { Elements, RenderElement, RenderSurface } from 'claude-code'
import type { Act } from './pane'
import { truncateCells } from './lib/width'
import type { Ctx } from './tools/registry'
import { TOC_ROWS_MAX, answerLines, cardLines, tick, tocScope, turnLine } from './tools/toc'
import type { Opened, TocRowView, TocView } from './tools/toc'

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
export type TocTabModel = { view: TocView; columns: number }

// A row's text is cut to the panel's width less the room a focus mark may take.
export const TOC_MARGIN = 2
export const TOC_CELLS_MIN = 8
// A wide panel's rows stop at this width. The card a row's hover reveals is drawn on the band (hooks/band.tsx): one
// over the list held the pointer, so the rows beneath it could not be reached.
const ROW_CELLS_MAX = 80

// Rows are dimmed only once a row is known to be read: the desktop app reports no place, so none is dimmed there.
export function drawTocTab(kit: Kit, model: TocTabModel, ctx: Ctx, act: Act): RenderElement {
  const { Box, Button, Text } = kit
  const { view } = model
  if (view.isElsewhere) return <Box key="toc"><Text dimColor wrap="truncate-end">{ctx.t('toc.mainOnly')}</Text></Box>
  if (view.rows.length === 0) return <Box key="toc"><Text dimColor>{ctx.t('toc.empty')}</Text></Box>
  const width = Math.min(ROW_CELLS_MAX, Math.max(TOC_CELLS_MIN, model.columns - TOC_MARGIN))
  const opened = ctx.surface === 'desktop' ? (view.opened ?? null) : null
  const openedRow = view.rows.find(row => row.key === opened?.key)
  if (opened?.isFull === true && openedRow !== undefined) return drawAnswer(kit, openedRow, opened, ctx, act, width)
  const hasCurrent = view.rows.some(row => row.isCurrent)
  const press = (row: TocRowView) => (on: { surface: RenderSurface }) =>
    void act(ctx.surface === 'desktop' ? { kind: 'toc.view', op: 'open', key: row.key } : { kind: 'toc.go', requestId: row.requestId }, on.surface)
  return (
    <Box key="toc" flexDirection="column">
      {view.hidden > 0 ? <Text dimColor>{ctx.t('toc.capped', { n: TOC_ROWS_MAX })}</Text> : null}
      <Box key="toc-list" flexDirection="column">
        {view.rows.flatMap(row => [
          <Button
            key={`toc-${row.requestId}`}
            label={truncateCells(`${row === openedRow ? '▾' : tick(row.isCurrent, row.isUnreachable)} ${row.number}. ${row.line}`, width)}
            plain
            {...(hasCurrent && !row.isCurrent ? { dimColor: true } : {})}
            hover={{ scope: tocScope(row.number), inverse: true, dimColor: false }}
            onPress={press(row)}
          />,
          ...(row === openedRow && opened !== null ? [drawOpened(kit, row, opened, ctx, act, width)] : []),
        ])}
      </Box>
    </Box>
  )
}

// What the answer view and the opened row offer: put the prompt in the prompt box, save its answer alone.
function answerButtons(kit: Kit, row: TocRowView, opened: Opened, ctx: Ctx, act: Act): RenderElement[] {
  const { Button } = kit
  const on = (op: 'full' | 'fill' | 'export') => (press: { surface: RenderSurface }) => void act({ kind: 'toc.view', op, key: row.key }, press.surface)
  return [
    ...(opened.isFull || opened.found == null ? [] : [<Button key="toc-full" label={ctx.t('toc.answer.full')} onPress={on('full')} />]),
    <Button key="toc-fill" label={ctx.t('toc.answer.fill')} onPress={on('fill')} />,
    ...(opened.found == null ? [] : [<Button key="toc-export" label={ctx.t('toc.answer.export')} onPress={on('export')} />]),
  ]
}

// Under the opened row: the prompt whole (a few lines), its turn, the answer's first lines and what to do with it.
const PROMPT_LINES = 6
const PREVIEW_LINES = 3
function drawOpened(kit: Kit, row: TocRowView, opened: Opened, ctx: Ctx, act: Act, width: number): RenderElement {
  const { Box, Text } = kit
  const inner = Math.max(TOC_CELLS_MIN, width - 2)
  const turn = turnLine(row.turn, ctx.t)
  const answer = opened.found === undefined ? ctx.t('toc.answer.reading') : opened.found === null ? ctx.t('toc.answer.none') : null
  const preview = opened.found == null ? [] : cardLines(opened.found.answer, inner, PREVIEW_LINES)
  return (
    <Box key={`toc-open-${row.requestId}`} flexDirection="column" paddingLeft={2} marginBottom={1}>
      {cardLines(opened.found?.prompt ?? row.text, inner, PROMPT_LINES).map(line => <Text>{line}</Text>)}
      {turn === '' ? null : <Text dimColor>{turn}</Text>}
      <Text weight="semibold">{ctx.t('toc.answer.title')}</Text>
      {answer === null ? preview.map(line => <Text dimColor>{line}</Text>) : <Text dimColor>{answer}</Text>}
      <Box key="toc-open-actions" flexDirection="row" flexWrap="wrap" columnGap={1}>{answerButtons(kit, row, opened, ctx, act)}</Box>
    </Box>
  )
}

// The whole answer in the panel, which scrolls; past ANSWER_CHARS_MAX the rest is only in an export.
function drawAnswer(kit: Kit, row: TocRowView, opened: Opened, ctx: Ctx, act: Act, width: number): RenderElement {
  const { Box, Button, Text } = kit
  const shown = answerLines(opened.found?.answer ?? '')
  const back = (press: { surface: RenderSurface }) => void act({ kind: 'toc.view', op: 'back', key: row.key }, press.surface)
  return (
    <Box key="toc" flexDirection="column" rowGap={1}>
      <Button key="toc-back" label={ctx.t('toc.answer.back')} onPress={back} />
      <Text weight="semibold">{truncateCells(`${row.number}. ${row.line}`, width)}</Text>
      <Box key="toc-answer" flexDirection="column">{shown.lines.map(line => <Text>{line === '' ? ' ' : line}</Text>)}</Box>
      {shown.isCut ? <Text dimColor>{ctx.t('toc.answer.cut')}</Text> : null}
      <Box key="toc-answer-actions" flexDirection="row" flexWrap="wrap" columnGap={1}>{answerButtons(kit, row, opened, ctx, act)}</Box>
    </Box>
  )
}
