import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime } from '@ttx/core'
import { docText, plugins, reportTitle, textDoc, type Block, type ReportBoardObject } from '../src/index'
import { ada, agent, canvas } from './fakes'

const setup = () => new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
const add = (rt: Runtime, type: string, fields: Record<string, unknown> = {}) => rt.dispatch(`${type}.add`, canvas, { x: 0, y: 0, ...fields }).created![0]!
const report = (rt: Runtime, id: string) => rt.board.get(id) as ReportBoardObject
const one = (id: string) => ({ kind: 'objects' as const, ids: [id] })
const items = (rt: Runtime, id: string) => report(rt, id).blocks.flatMap((b) => (b.kind === 'item' ? [b.sourceId] : []))

describe('reports', () => {
  it('start empty on A4, portrait, and tell the agent their page and blocks', () => {
    const rt = setup()
    const r = add(rt, 'report')
    expect(report(rt, r)).toMatchObject({ paper: 'a4', orientation: 'portrait', blocks: [] })
    const summarize = rt.registry.objectType('report')!.summarize!
    expect(summarize(report(rt, r))).toBe('A4 portrait; empty')
    rt.dispatch('report.setPage', one(r), { paper: 'letter', orientation: 'landscape' })
    expect(report(rt, r)).toMatchObject({ paper: 'letter', orientation: 'landscape' })
  })

  it('add objects as live items, leave the objects as they were, and skip ones already in it', async () => {
    const rt = setup()
    const r = add(rt, 'report')
    const map = add(rt, 'map', { x: 0, y: 500 })
    const note = add(rt, 'sticky', { text: 'Needs', x: 0, y: 0 })
    const before = rt.board.get(map)
    const res = await rt.invoke('report.addItems', { kind: 'objects', ids: [map, note] }, { reportId: r })
    expect(res.status, res.error).toBe('applied')
    expect(res.summary).toBe('Added 2 items to the report')
    // Reading order: the note is above the map. A map takes the full width.
    expect(report(rt, r).blocks).toMatchObject([
      { kind: 'item', sourceId: note, mode: 'live', span: 1 },
      { kind: 'item', sourceId: map, mode: 'live', span: 2 },
    ])
    expect(rt.board.get(map)).toEqual(before)
    expect((await rt.invoke('report.addItems', one(map), { reportId: r })).status).toBe('failed')
    rt.undo()
    expect(report(rt, r).blocks).toEqual([])
  })

  it('make an empty report from one frame: the frame titles the report, and what is in it is the report', async () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 5000 })
    const frame = add(rt, 'frame', { x: 0, y: 0, w: 1000, h: 1000, title: 'Situation report: Flood in Nepal' })
    const inner = add(rt, 'frame', { x: 500, y: 500, w: 400, h: 400 })
    const nested = add(rt, 'text', { x: 600, y: 600, text: 'Gaps' })
    const map = add(rt, 'map', { x: 10, y: 100 })
    const note = add(rt, 'sticky', { x: 10, y: 10 })
    add(rt, 'sticky', { x: 3000, y: 0 }) // outside every frame
    const res = await rt.invoke('report.addItems', one(frame), { reportId: r })
    expect(res.summary).toBe('Added 4 items to the report, titled after the frame')
    // No heading for the frame itself; a frame inside it still heads its own objects.
    expect(items(rt, r)).toEqual([note, map, inner, nested])
    expect(report(rt, r).titleFrom).toBe(frame)
    // The title follows the frame (a template frame's title follows its event), until the report is renamed.
    expect(reportTitle(report(rt, r), rt.board.get(frame))).toBe('Situation report: Flood in Nepal')
    rt.dispatch('core.object.rename', one(r), { name: 'Nepal SitRep' })
    expect(reportTitle(report(rt, r), rt.board.get(frame))).toBe('Nepal SitRep')
    rt.undo()
    rt.undo()
    expect(report(rt, r)).toMatchObject({ blocks: [] })
    expect(report(rt, r).titleFrom).toBeUndefined()
  })

  it('add a frame to a report with content as a heading, then the objects in it', async () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 5000 })
    await rt.invoke('report.addBlock', one(r), { block: { kind: 'heading', text: 'Overview' } })
    const frame = add(rt, 'frame', { x: 0, y: 0, w: 1000, h: 1000, title: 'Conflict: Cabo Delgado' })
    const map = add(rt, 'map', { x: 10, y: 100 })
    await rt.invoke('report.addItems', one(frame), { reportId: r })
    expect(items(rt, r)).toEqual([frame, map])
    expect(report(rt, r).blocks[1]).toMatchObject({ sourceId: frame, span: 2 })
    expect(report(rt, r).titleFrom).toBeUndefined()
  })

  it('keep the heading when a frame comes with objects from outside it', async () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 5000 })
    const frame = add(rt, 'frame', { x: 0, y: 0, w: 500, h: 500 })
    const outside = add(rt, 'sticky', { x: 0, y: 2000 })
    await rt.invoke('report.addItems', { kind: 'objects', ids: [frame, outside] }, { reportId: r })
    expect(items(rt, r)).toEqual([frame, outside])
    expect(report(rt, r).titleFrom).toBeUndefined()
  })

  it('never put a report in a report', async () => {
    const rt = setup()
    const r = add(rt, 'report')
    const other = add(rt, 'report')
    expect((await rt.invoke('report.addItems', { kind: 'objects', ids: [r, other] }, { reportId: r })).status).toBe('failed')
  })

  it('add, move, widen and remove blocks, each one undo step', async () => {
    const rt = setup()
    const r = add(rt, 'report')
    await rt.invoke('report.addBlock', one(r), { block: { kind: 'heading', text: 'Overview' } })
    await rt.invoke('report.addBlock', one(r), { block: { kind: 'text', text: 'First.\n\nSecond.' } })
    await rt.invoke('report.addBlock', one(r), { block: { kind: 'divider' } })
    const [heading, text, divider] = report(rt, r).blocks as Block[]
    expect(heading).toMatchObject({ kind: 'heading', text: 'Overview', level: 1, span: 2 })
    expect(text).toMatchObject({ kind: 'text', span: 1 })
    expect(docText((text as Extract<Block, { kind: 'text' }>).doc)).toBe('First. Second.')

    await rt.invoke('report.moveBlock', one(r), { blockId: divider!.id, index: 0 })
    expect(report(rt, r).blocks.map((b) => b.kind)).toEqual(['divider', 'heading', 'text'])
    await rt.invoke('report.setSpan', one(r), { blockId: text!.id, span: 2 })
    expect(report(rt, r).blocks[2]).toMatchObject({ span: 2 })
    await rt.invoke('report.removeBlock', one(r), { blockId: heading!.id })
    expect(report(rt, r).blocks.map((b) => b.kind)).toEqual(['divider', 'text'])

    rt.undo()
    expect(report(rt, r).blocks.map((b) => b.kind)).toEqual(['divider', 'heading', 'text'])
    expect((await rt.invoke('report.removeBlock', one(r), { blockId: 'nope' })).status).toBe('failed')
  })

  it('edit the text of headings and text blocks only', () => {
    const rt = setup()
    const r = add(rt, 'report', { blocks: [{ id: 'h', kind: 'heading', text: 'A', level: 1, span: 2 }, { id: 't', kind: 'text', doc: textDoc('a'), span: 1 }, { id: 'd', kind: 'divider', span: 2 }] })
    expect(rt.dispatch('report.setText', one(r), { blockId: 'h', text: 'Key figures' }).status).toBe('applied')
    expect(rt.dispatch('report.setText', one(r), { blockId: 't', doc: textDoc('Needs') }).status).toBe('applied')
    expect(rt.dispatch('report.setText', one(r), { blockId: 'd', text: 'x' }).status).toBe('failed')
    expect(report(rt, r).blocks).toMatchObject([{ text: 'Key figures' }, { doc: textDoc('Needs') }, {}])
  })

  it('freeze texts, frames and areas here, and ask the browser for maps', async () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 5000 })
    const note = add(rt, 'sticky', { text: 'Bridge out', y: 0 })
    const map = add(rt, 'map', { y: 500 })
    await rt.invoke('report.addItems', { kind: 'objects', ids: [note, map] }, { reportId: r })
    const [noteItem, mapItem] = report(rt, r).blocks
    expect((await rt.invoke('report.setItemMode', one(r), { blockId: noteItem!.id, mode: 'frozen' })).status).toBe('applied')
    expect(report(rt, r).blocks[0]).toMatchObject({ mode: 'frozen', frozen: { text: 'Bridge out' } })
    // The note changes; the frozen item keeps what it showed.
    rt.dispatch('text.setText', one(note), { text: 'Bridge repaired' })
    expect(report(rt, r).blocks[0]).toMatchObject({ frozen: { text: 'Bridge out' } })

    const map1 = await rt.invoke('report.setItemMode', one(r), { blockId: mapItem!.id, mode: 'frozen' })
    expect(map1).toMatchObject({ status: 'failed', error: expect.stringMatching(/browser/) })
    const picture = { at: 1, imageId: '0b6f8c2e-2d4f-4c1a-9e3b-6a7d5c4b3a21', credits: '© OpenStreetMap' }
    expect((await rt.invoke('report.setItemMode', one(r), { blockId: mapItem!.id, mode: 'frozen', frozen: picture })).status).toBe('applied')
    await rt.invoke('report.setItemMode', one(r), { blockId: noteItem!.id, mode: 'live' })
    expect(report(rt, r).blocks).toMatchObject([{ mode: 'live' }, { mode: 'frozen', frozen: picture }])
  })

  it('are tools for the agent, which can build one', async () => {
    const rt = setup()
    const names = exportTools([...rt.availableOps(canvas), ...rt.availableOps({ kind: 'objects', ids: [add(rt, 'report')] })]).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['report__add', 'report__addBlock', 'report__setItemMode', 'report__moveBlock']))
    expect(names).not.toContain('report__setText')
    const r = report(rt, rt.board.list().find((o) => o.type === 'report')!.id).id
    const note = add(rt, 'sticky', { text: 'Needs', x: 3000 })
    expect((await rt.callTool('report__addItems', { ids: [note], args: { reportId: r } }, agent)).status).toBe('applied')
    expect((await rt.callTool('report__addBlock', { ids: [r], args: { block: { kind: 'heading', text: 'Needs' }, index: 0 } }, agent)).status).toBe('applied')
    expect(rt.registry.objectType('report')!.summarize!(report(rt, r))).toMatch(/^A4 portrait; 2 blocks: \w+ heading "Needs", full width; \w+ item: object .+, live$/)
  })
})
