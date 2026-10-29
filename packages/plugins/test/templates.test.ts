import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor, type AnyObject } from '@ttx/core'
import { BOUNDARIES_TOOL, callOp, EVENT_FOOTPRINT_TOOL, plugins, TurnLog, type MapBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const
const nepal = { eventId: 'gdacs-event-1102171', eventName: 'Nepal floods', country: 'NPL', glides: ['FF-2026-000162-NPL'] }

const setup = () => new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
const types = (rt: Runtime) => rt.board.list().map((o) => o.type).sort()
const one = <O extends AnyObject>(rt: Runtime, type: string) => rt.board.list().find((o) => o.type === type) as O
const bounds = (os: AnyObject[]) => ({
  left: Math.min(...os.map((o) => o.x)),
  right: Math.max(...os.map((o) => o.x + o.w)),
  top: Math.min(...os.map((o) => o.y)),
  bottom: Math.max(...os.map((o) => o.y + o.h)),
})

describe('SitRep template', () => {
  it('sets up a board for an event in one undo step, and names it', async () => {
    const rt = setup()
    const r = await rt.invoke('board.applyTemplate', canvas, { template: 'sitrep', title: 'Nepal floods review', ...nepal })
    expect(r.status).toBe('applied')
    expect(types(rt)).toEqual(['conflict', 'country', 'event', 'map', 'presence', 'reliefweb', 'sticky', 'sticky', 'sticky', 'sticky', 'sticky', 'text'])
    expect(rt.board.title).toBe('Nepal floods review')
    expect(one(rt, 'event')).toMatchObject({ eventId: nepal.eventId })
    expect(one(rt, 'reliefweb')).toMatchObject({ glides: nepal.glides, title: 'Nepal floods' })
    for (const t of ['country', 'presence', 'conflict']) expect(one(rt, t)).toMatchObject({ country: 'NPL' })
    expect(one<MapBoardObject>(rt, 'map').layers!.map((l) => [l.tool, l.input])).toEqual([
      [BOUNDARIES_TOOL, { level: 1 }],
      [EVENT_FOOTPRINT_TOOL, { eventId: nepal.eventId }],
    ])
    expect(one(rt, 'text')).toMatchObject({ text: 'Nepal floods review: situation report' })

    rt.undo()
    expect(rt.board.list()).toEqual([])
  })

  it('lays the widgets out without overlaps, centered on x and y', async () => {
    const rt = setup()
    await rt.invoke('board.applyTemplate', canvas, { template: 'sitrep', ...nepal, x: 1000, y: -500 })
    const os = rt.board.list()
    for (const a of os)
      for (const b of os)
        if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.type} and ${b.type} overlap`).toBe(true)
    const { left, right, top, bottom } = bounds(os)
    expect(Math.abs((left + right) / 2 - 1000)).toBeLessThanOrEqual(1)
    expect(Math.abs((top + bottom) / 2 + 500)).toBeLessThanOrEqual(1)
  })

  it('without an event, adds the widgets empty, with no feed, to be picked on the board', async () => {
    const rt = setup()
    expect((await rt.invoke('board.applyTemplate', canvas, { template: 'sitrep' })).status).toBe('applied')
    expect(types(rt)).not.toContain('reliefweb')
    expect(one(rt, 'event')).not.toHaveProperty('eventId')
    for (const t of ['country', 'presence', 'conflict']) expect(one(rt, t)).not.toHaveProperty('country')
    expect(one<MapBoardObject>(rt, 'map').layers!.map((l) => l.tool)).toEqual([BOUNDARIES_TOOL])
    expect(one(rt, 'text')).toMatchObject({ text: 'Situation report' })
    expect(rt.board.title).toBeUndefined()
  })

  it('checks its input before writing anything', async () => {
    const rt = setup()
    expect((await rt.invoke('board.applyTemplate', canvas, { template: 'sitrep', country: 'Nepal' })).status).toBe('failed')
    expect((await rt.invoke('board.applyTemplate', canvas, { template: 'sitrep', glides: ['not a glide'] })).status).toBe('failed')
    expect((await rt.invoke('board.applyTemplate', canvas, { template: 'nope' })).status).toBe('failed')
    expect(rt.board.list()).toEqual([])
  })

  it("is a tool for the agent, which puts it in the middle of the asker's view and can undo it", async () => {
    const rt = setup()
    expect(exportTools(rt.availableOps(canvas)).map((t) => t.name)).toContain('board__applyTemplate')
    const turn = new TurnLog()
    const agent: Actor = { kind: 'agent', id: 'agent', onBehalfOf: 'ada' }
    const r = await callOp(rt, 'board__applyTemplate', { args: { template: 'sitrep', eventId: nepal.eventId } }, { actor: agent, turn, center: { x: 400, y: 300 } })
    expect(r.status).toBe('applied')
    const { left, right, top, bottom } = bounds(rt.board.list())
    expect(Math.abs((left + right) / 2 - 400)).toBeLessThanOrEqual(1)
    expect(Math.abs((top + bottom) / 2 - 300)).toBeLessThanOrEqual(1)
    expect(turn.created).toHaveLength(rt.board.list().length)
  })
})
