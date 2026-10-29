import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, type Actor } from '@ttx/core'
import { plugins, type ReportBoardObject } from '@ttx/plugins'
import type { Board } from '../src/board/board'
import { addToReport, boardReports } from '../src/reports/reports'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const
const setup = () => new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
const add = (rt: Runtime, type: string, fields: Record<string, unknown> = {}) => rt.dispatch(`${type}.add`, canvas, { x: 0, y: 0, ...fields }).created![0]!

describe('the reports the menus offer', () => {
  it('list the board by title: a name, a frame it was made from, or Untitled report', async () => {
    const rt = setup()
    const board = rt.board as Board
    const frame = add(rt, 'frame', { w: 400, h: 400, title: 'Situation report: Flood in Nepal' })
    add(rt, 'sticky', { x: 10, y: 10 })
    const fromFrame = (await addToReport(rt, [frame])).created![0]!
    const named = add(rt, 'report', { x: 2000 })
    rt.dispatch('core.object.rename', { kind: 'objects', ids: [named] }, { name: 'Briefing' })
    const untitled = add(rt, 'report', { x: 3000 })
    expect(boardReports(board)).toEqual([
      { id: named, title: 'Briefing' },
      { id: fromFrame, title: 'Situation report: Flood in Nepal' },
      { id: untitled, title: 'Untitled report' },
    ])
  })
})

describe('Add to report', () => {
  it('adds to a report in one undo step, says what it did, and why it did nothing', async () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 2000 })
    const note = add(rt, 'sticky')
    const done = await addToReport(rt, [note], r)
    expect(done).toMatchObject({ status: 'applied', summary: 'Added 1 item to the report' })
    expect(await addToReport(rt, [note], r)).toMatchObject({ status: 'failed', error: expect.stringMatching(/already in the report/) })
    rt.undo()
    expect((rt.board.get(r) as ReportBoardObject).blocks).toEqual([])
  })

  it('makes a new report without one, and gives its id to select', async () => {
    const rt = setup()
    const note = add(rt, 'sticky')
    const done = await addToReport(rt, [note])
    expect(done.created).toHaveLength(1)
    expect(rt.board.get(done.created![0]!)).toMatchObject({ type: 'report' })
  })
})
