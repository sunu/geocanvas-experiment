import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import { defineOp, definePlugin, defineTool, Runtime, Views, type Actor, type OplogEntry, type ViewController } from '@ttx/core'
import { plugins } from '@ttx/plugins'
import { bounded, EXTERNAL_AGENT, Executor, MAX_RESULT_CHARS } from '../src/mcp/executor'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

/** A plugin and a read tool the MCP code has never heard of. */
const pins = definePlugin({
  id: 'pins',
  title: 'Pins',
  dependsOn: ['core'],
  objectTypes: [{ type: 'pin', title: 'Pin', description: 'A labeled pin.', fields: z.object({ label: z.string().default('') }), defaultSize: { w: 20, h: 20 }, layer: 'top' }],
  ops: [
    defineOp({
      id: 'pin.clearAll',
      title: 'Delete all pins',
      description: 'Delete every pin on the board.',
      target: { kind: 'canvas' },
      args: z.object({}),
      risk: 'high',
      apply: (tx) => tx.remove(tx.list().filter((o) => o.type === 'pin').map((o) => o.id)),
    }),
  ],
})
const echo = defineTool({ id: 'test.echo', title: 'Echo', description: 'Echo the text.', input: z.object({ text: z.string() }), output: 'text', run: ({ text }) => text })

/** A board with Ada's runtime and an executor on her tab, her view centered at (1000, 500). */
function setup() {
  const doc = new Y.Doc()
  const all = [...plugins, pins]
  const person = new Runtime({ doc, plugins: all, actor: ada })
  const view: ViewController = { fitAll() {}, zoomTo() {}, resetZoom() {}, center: () => ({ x: 1000, y: 500 }) }
  let selection: string[] = []
  const executor = new Executor({ doc, plugins: all, person: ada, view: () => view, selection: () => selection, tools: [echo] })
  return { doc, person, executor, select: (ids: string[]) => (selection = ids) }
}

describe('the MCP executor', () => {
  it('offers every op an agent may run and every read tool, new ones included', () => {
    const { tools } = setup().executor.manifest()
    const names = tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['box__add', 'core__object__move', 'pin__add', 'test__echo']))
    // Hidden ops and ops only people may run are not offered.
    expect(names).not.toContain('agent__undoTurn')
    expect(names).not.toContain('agent__revert')
    expect(names).not.toContain('pin__clearAll')
    expect(tools.find((t) => t.name === 'test__echo')!.annotations).toEqual({ readOnlyHint: true })
    expect(tools.find((t) => t.name === 'box__add')!.annotations).toBeUndefined()
  })

  it("adds in the middle of the person's view, then side by side, as the agent for the person", async () => {
    const { person, executor } = setup()
    type Added = { created: string[]; revision: number }
    const first = (await executor.call('box__add', { args: {} }, 'claude-code')) as Added
    const second = (await executor.call('box__add', { args: {} }, 'claude-code')) as Added
    expect(first).toMatchObject({ status: 'applied', created: [expect.any(String)] })
    const a = person.board.get(first.created![0]!)
    const b = person.board.get(second.created![0]!)
    expect(a).toMatchObject({ x: 1000 - a!.w / 2, y: 500 - a!.h / 2 })
    expect(b!.x).toBe(a!.x + a!.w + 24)
    const entry = (person.oplog.toArray() as OplogEntry[]).find((e) => e.kind === 'invocation')
    expect(entry).toMatchObject({ actor: { ...EXTERNAL_AGENT, name: 'claude-code', onBehalfOf: 'ada' } })
    expect(second.revision).toBeGreaterThan(first.revision)
  })

  it('refuses ops only people may run, and junk sizes', async () => {
    const { executor } = setup()
    expect(await executor.call('pin__clearAll', { args: {} })).toMatchObject({ status: 'failed', error: 'Only a user may run pin.clearAll' })
    expect(await executor.call('box__add', { args: { w: 100_000 } })).toMatchObject({ status: 'failed', error: expect.stringMatching(/too large/) })
  })

  it("reads the board as data: objects, selection, and the person's view of each map", async () => {
    const { doc, person, executor, select } = setup()
    const box = person.dispatch('box.add', canvas, { x: 0, y: 0 }).created![0]!
    const map = person.dispatch('map.add', canvas, { x: 300, y: 0 }).created![0]!
    new Views(doc).set('ada', map, { center: [35, -19.8], zoom: 8, bearing: 0 })
    select([box])

    const snap = executor.snapshot()
    expect(snap).toMatchObject({ person: { id: 'ada' }, view: { center: { x: 1000, y: 500 } }, selection: [box], total: 2 })
    // Bottom to top: maps go on the bottom layer.
    expect(snap.objects.map((o) => o.id)).toEqual([map, box])
    expect(snap.maps).toEqual([{ id: map, view: expect.objectContaining({ zoom: 8 }), area: expect.objectContaining({ west: expect.any(Number) }) }])

    expect(executor.snapshot({ ids: [map, 'gone'] })).toMatchObject({ total: 1, missing: ['gone'] })
    expect(executor.snapshot({ limit: 1 })).toMatchObject({ total: 2, truncated: true, objects: [{ id: map }] })
  })

  it("undoes its own last change, leaves the person's ⌘Z alone, and refuses when someone changed it since", async () => {
    const { person, executor } = setup()
    const box = person.dispatch('box.add', canvas, { x: 0, y: 0 }).created![0]!
    await executor.call('core__object__move', { ids: [box], args: { dx: 100 } })
    expect(person.board.get(box)!.x).toBe(100)
    // Ada's ⌘Z holds only her own add.
    expect(person.undoManager.undoStack).toHaveLength(1)
    expect(await executor.undo()).toMatchObject({ status: 'applied' })
    expect(person.board.get(box)!.x).toBe(0)
    expect(await executor.undo()).toMatchObject({ status: 'failed', error: expect.stringMatching(/Nothing to undo/) })

    const other = person.dispatch('box.add', canvas, { x: 0, y: 0 }).created![0]!
    await executor.call('core__object__move', { ids: [other], args: { dx: 100 } })
    person.beginGesture()
    person.dispatch('core.object.move', { kind: 'objects', ids: [other] }, { dx: 5 })
    expect(await executor.undo()).toMatchObject({ status: 'failed', error: expect.stringContaining(`box ${other}`) })
    expect(person.board.get(other)!.x).toBe(105)
  })

  it('runs read tools, and cuts results too large for a model', async () => {
    const { executor } = setup()
    expect(await executor.call('test__echo', { text: 'hi' })).toBe('hi')
    const features = Array.from({ length: 5000 }, (_, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [i, i] } }))
    expect(bounded({ type: 'FeatureCollection', features })).toMatchObject({ truncated: true, count: 5000, sample: [{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }] })
    expect(bounded('x'.repeat(MAX_RESULT_CHARS + 10))).toMatchObject({ truncated: true })
  })
})
