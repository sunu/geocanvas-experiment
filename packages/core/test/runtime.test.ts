import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import { BoardTx, corePlugin, Nav, defineOp, definePlugin, exportTools, Registry, Runtime, summarizeBoard, type Actor, type OplogEntry, type ViewController } from '../src/index'

/** A plugin as an app would write one: its own object type and ops, through the same API as core. */
const pinPlugin = definePlugin({
  id: 'pins',
  title: 'Pins',
  dependsOn: ['core'],
  objectTypes: [{ type: 'pin', title: 'Pin', description: 'A labeled pin.', fields: z.object({ label: z.string().default('') }), defaultSize: { w: 20, h: 20 }, layer: 'top' }],
  ops: [
    defineOp({
      id: 'pin.rename',
      title: 'Rename pin',
      description: 'Change the label of a pin.',
      target: { kind: 'objects', types: ['pin'] },
      args: z.object({ label: z.string() }),
      // Async, like an op that fetches data first.
      prepare: async (_ctx, args) => args,
      apply: (tx, { label }, target) => target.kind === 'objects' && tx.update(Object.fromEntries(target.ids.map((id) => [id, { label }]))),
    }),
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

const user = (id = 'a'): Actor => ({ kind: 'user', id })
const runtime = (doc = new Y.Doc(), actor = user()) => new Runtime({ doc, plugins: [corePlugin, pinPlugin], actor })
const canvas = { kind: 'canvas' } as const
const objects = (...ids: string[]) => ({ kind: 'objects' as const, ids })

/** Add a text at x; texts stack in the order they are added. */
function addText(rt: Runtime, x = 0) {
  const r = rt.dispatch('text.add', canvas, { x, y: 0, w: 10, h: 10 })
  expect(r.status).toBe('applied')
  return r.created![0]!
}
const order = (rt: Runtime) => rt.board.list().map((o) => o.x)
const invocations = (rt: Runtime) => (rt.oplog.toArray() as OplogEntry[]).filter((e) => e.kind === 'invocation')

/** A runtime with texts at x = 0, 1, 2, ... added in that order (so bottom to top). */
function runtimeWith(n: number) {
  const rt = runtime()
  return { rt, ids: Array.from({ length: n }, (_, i) => addText(rt, i)) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('layer order', () => {
  it('adds texts and plugin pins on top, and boxes at the bottom', () => {
    const { rt } = runtimeWith(2)
    rt.dispatch('box.add', canvas, { x: 10 })
    rt.dispatch('box.add', canvas, { x: 11 })
    addText(rt, 12)
    rt.dispatch('pin.add', canvas, { x: 13, label: 'HQ' })
    expect(order(rt)).toEqual([11, 10, 0, 1, 12, 13])
    expect(rt.board.list().at(-1)).toMatchObject({ type: 'pin', label: 'HQ', w: 20, h: 20 })
  })

  it('brings a selection to the front and sends it to the back, keeping its own order', () => {
    const { rt, ids } = runtimeWith(4)
    rt.dispatch('core.object.bringToFront', objects(ids[0]!, ids[1]!), {})
    expect(order(rt)).toEqual([2, 3, 0, 1])
    rt.dispatch('core.object.sendToBack', objects(ids[3]!, ids[1]!), {})
    expect(order(rt)).toEqual([3, 1, 2, 0])
  })

  it('steps one place forward and backward, past unselected neighbours only', () => {
    const { rt, ids } = runtimeWith(4)
    rt.dispatch('core.object.bringForward', objects(ids[0]!), {})
    expect(order(rt)).toEqual([1, 0, 2, 3])
    rt.dispatch('core.object.bringForward', objects(ids[0]!, ids[1]!), {})
    expect(order(rt)).toEqual([2, 1, 0, 3])
    rt.dispatch('core.object.bringForward', objects(ids[3]!), {}) // already on top
    expect(order(rt)).toEqual([2, 1, 0, 3])
    rt.dispatch('core.object.sendBackward', objects(ids[3]!), {})
    expect(order(rt)).toEqual([2, 1, 3, 0])
  })

  it('keeps stepping when floats between two neighbours run out', () => {
    const { rt, ids } = runtimeWith(3)
    const renumber = vi.spyOn(BoardTx.prototype as unknown as { normalizeZ(): void }, 'normalizeZ')
    for (let i = 0; i < 200; i++) rt.dispatch('core.object.sendBackward', objects(ids[i % 2 === 0 ? 2 : 1]!), {})
    expect(renumber).toHaveBeenCalled()
    expect(new Set(order(rt)).size).toBe(3)
    expect(rt.board.list().every((o) => Number.isFinite(o.z))).toBe(true)
    renumber.mockRestore()
  })
})

describe('dispatch', () => {
  it('fills defaults, checks fields against the type, and records what it added', () => {
    const rt = runtime()
    const r = rt.dispatch('text.add', canvas, { text: 'hi' })
    expect(r).toMatchObject({ status: 'applied', args: { text: 'hi', x: 0, y: 0 } })
    expect(rt.board.get(r.created![0]!)).toMatchObject({ type: 'text', text: 'hi', w: 240, h: 40 })
  })

  it('writes nothing and fails on bad args, a bad target, a wrong type or an unknown field', () => {
    const rt = runtime()
    const id = addText(rt)
    const box = rt.dispatch('box.add', canvas, {}).created![0]!
    const before = Y.encodeStateAsUpdate(rt.board.doc)
    const failures = [
      rt.dispatch('box.add', canvas, { color: 'mauve' }),
      rt.dispatch('core.object.setColor', objects(id), { color: 'mauve' }),
      rt.dispatch('core.object.setColor', canvas, { color: 'red' }),
      rt.dispatch('core.object.delete', objects('nope'), {}),
      rt.dispatch('text.setText', objects(box), { text: 'x' }),
      rt.dispatch('core.object.setRect', objects(id), { rects: { [id]: { w: -1 } } }),
      rt.dispatch('no.such.op', canvas, {}),
    ]
    for (const r of failures) expect(r).toMatchObject({ status: 'failed', error: expect.any(String) })
    expect(rt.board.get(id)).toMatchObject({ text: '', w: 10 })
    expect(rt.board.get(box)).not.toHaveProperty('color')
    expect(() =>
      rt.board.doc.transact(() => new BoardTx(rt.board, rt.registry).update({ [id]: { colour: 'red' } })),
    ).toThrow(/no field colour/)
    // An add with a given id (restoring a deleted object) must not replace an object.
    expect(() => rt.board.doc.transact(() => new BoardTx(rt.board, rt.registry).add('box', { x: 0, y: 0, w: 1, h: 1 }, box))).toThrow(
      /already exists/,
    )
    // Only the failed records' log entries differ; the objects did not change.
    rt.flush()
    expect(rt.board.list()).toEqual(runtimeFromUpdate(before).board.list())
  })

  it('refuses an op whose prepare is async; invoke runs it', async () => {
    const rt = runtime()
    const pin = rt.dispatch('pin.add', canvas, {}).created![0]!
    expect(rt.dispatch('pin.rename', objects(pin), { label: 'x' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/invoke/) })
    expect(await rt.invoke('pin.rename', objects(pin), { label: 'Depot' })).toMatchObject({ status: 'applied' })
    expect(rt.board.get(pin)).toMatchObject({ label: 'Depot' })
  })

  it('uses the target for defaults (the current color) and for prepare (move by an offset)', () => {
    const rt = runtime()
    const id = addText(rt, 5)
    rt.dispatch('core.object.setColor', objects(id), { color: 'red' })
    expect(rt.defaultsFor('core.object.setColor', objects(id))).toEqual({ color: 'red' })
    rt.dispatch('core.object.move', objects(id), { dx: 10, dy: -3 })
    expect(rt.board.get(id)).toMatchObject({ x: 15, y: -3 })
    rt.dispatch('text.larger', objects(id), {})
    expect(rt.board.get(id)).toMatchObject({ fontSize: 24 })
  })

  it('makes sticky notes: an empty yellow square on top, with text, color and text size like a text', () => {
    const rt = runtime()
    const box = rt.dispatch('box.add', canvas, {}).created![0]!
    const note = rt.dispatch('sticky.add', canvas, { x: 0, y: 0 }).created![0]!
    expect(rt.board.get(note)).toMatchObject({ type: 'sticky', text: '', w: 200, h: 200 })
    expect(rt.board.list().map((o) => o.id)).toEqual([box, note])
    expect(rt.defaultsFor('core.object.setColor', objects(note))).toEqual({ color: 'yellow' })
    expect(rt.dispatch('text.setText', objects(note), { text: 'Check hospitals' }).status).toBe('applied')
    rt.dispatch('core.object.setColor', objects(note), { color: 'green' })
    rt.dispatch('text.larger', objects(note), {})
    expect(rt.board.get(note)).toMatchObject({ text: 'Check hospitals', color: 'green', fontSize: 24, h: 200 })
    expect(rt.registry.objectTypes().filter((t) => t.defaultColor).map((t) => t.type)).toEqual(['box', 'text', 'sticky'])
    expect(rt.registry.objectTypes().filter((t) => t.textSize).map((t) => t.type)).toEqual(['text', 'sticky'])
  })

  it("colors and sizes only objects whose type has a color or text size, with the type's default color", () => {
    const rt = runtime()
    const text = addText(rt)
    const box = rt.dispatch('box.add', canvas, {}).created![0]!
    const pin = rt.dispatch('pin.add', canvas, {}).created![0]!
    expect(rt.defaultsFor('core.object.setColor', objects(box))).toEqual({ color: 'blue' })
    expect(rt.defaultsFor('core.object.setColor', objects(text))).toEqual({ color: 'ink' })
    const ids = (target: { kind: 'objects'; ids: string[] }) => rt.availableOps(target).map((op) => op.id)
    expect(ids(objects(text, box))).toContain('core.object.setColor')
    expect(ids(objects(text, box))).not.toContain('text.larger')
    expect(ids(objects(text))).toContain('text.larger')
    expect(ids(objects(text, pin))).not.toContain('core.object.setColor')
    expect(rt.dispatch('core.object.setColor', objects(text, pin), { color: 'red' })).toMatchObject({ status: 'failed' })
    expect(rt.dispatch('text.larger', objects(box), {})).toMatchObject({ status: 'failed' })
    expect(rt.board.get(text)).not.toHaveProperty('color')
  })

  it('duplicates objects with all their fields, next to the originals', () => {
    const rt = runtime()
    const id = rt.dispatch('text.add', canvas, { text: 'copy me', x: 1, y: 2, color: 'green' }).created![0]!
    const copy = rt.dispatch('core.object.duplicate', objects(id), {}).created![0]!
    expect(rt.board.get(copy)).toMatchObject({ type: 'text', text: 'copy me', color: 'green', x: 25, y: 26 })
  })
})

describe('sync, undo and the op log', () => {
  /** Two tabs on one room, connected directly. */
  function pair() {
    const a = runtime(new Y.Doc(), user('a'))
    const b = runtime(new Y.Doc(), user('b'))
    a.board.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b.board.doc, u, 'remote'))
    b.board.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a.board.doc, u, 'remote'))
    return { a, b }
  }

  it('shows a dispatch on one tab in the other, and merges edits to different fields', () => {
    const { a, b } = pair()
    const id = addText(a)
    expect(b.board.get(id)).toMatchObject({ type: 'text' })
    a.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x: 50 } } })
    b.dispatch('core.object.setRect', objects(id), { rects: { [id]: { w: 99 } } })
    expect(a.board.get(id)).toMatchObject({ x: 50, w: 99 })
    expect(b.board.get(id)).toEqual(a.board.get(id))
  })

  it('names the board for everyone, outside undo, and clears the name with an empty title', () => {
    const { a, b } = pair()
    expect(b.board.title).toBeUndefined()
    a.beginGesture()
    expect(a.dispatch('board.setTitle', canvas, { title: '  Nepal floods review ' }).status).toBe('applied')
    expect(b.board.title).toBe('Nepal floods review')
    a.undo()
    expect(b.board.title).toBe('Nepal floods review')
    expect(a.dispatch('board.setTitle', canvas, { title: 'x'.repeat(81) }).status).toBe('failed')
    a.dispatch('board.setTitle', canvas, { title: '' })
    expect(b.board.title).toBeUndefined()
  })

  it('undoes only your own edits, one gesture at a time', () => {
    const { a, b } = pair()
    const id = addText(a)
    a.beginGesture()
    a.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x: 10 } } })
    a.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x: 20 } } }) // same gesture (a drag)
    b.dispatch('core.object.setRect', objects(id), { rects: { [id]: { y: 5 } } }) // someone else

    a.undo()
    expect(a.board.get(id)).toMatchObject({ x: 0, y: 5 })
    a.undo()
    expect(a.board.get(id)).toBeUndefined()
    a.redo()
    expect(b.board.get(id)).toMatchObject({ x: 0 })
  })

  it('logs one entry per gesture op, with the final args, and logs undo against it', () => {
    vi.useFakeTimers()
    const rt = runtime()
    const id = addText(rt)
    rt.beginGesture()
    for (let x = 1; x <= 30; x++) {
      rt.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x } } })
      rt.dispatch('text.setText', objects(id), { text: 'a'.repeat(x) }) // interleaved, like typing with fits
    }
    // beginGesture() wrote the add; the drag and the typing wait until the gesture ends or goes idle.
    expect(invocations(rt).map((e) => e.opId)).toEqual(['text.add'])
    vi.advanceTimersByTime(1000)
    const log = invocations(rt)
    expect(log.map((e) => e.opId)).toEqual(['text.add', 'core.object.setRect', 'text.setText'])
    expect(log[1]).toMatchObject({ args: { rects: { [id]: { x: 30 } } }, actor: { id: 'a' } })

    rt.undo()
    expect(rt.board.get(id)).toMatchObject({ x: 0, text: '' })
    const undo = rt.oplog.toArray().at(-1) as OplogEntry
    expect(undo).toMatchObject({ kind: 'undo', invocationId: log[1]!.id })
  })

  it('makes each invoke its own undo step', async () => {
    const rt = runtime()
    const id = addText(rt)
    rt.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x: 5 } } })
    await rt.invoke('core.object.setColor', objects(id), { color: 'red' })
    rt.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x: 9 } } })
    rt.undo()
    expect(rt.board.get(id)).toMatchObject({ x: 5, color: 'red' })
    rt.undo()
    expect(rt.board.get(id)).toMatchObject({ x: 5 })
    expect(rt.board.get(id)).not.toHaveProperty('color')
  })

  it('reflects changes that arrived before anyone subscribed, and keeps one snapshot until the next change', () => {
    const a = runtime()
    addText(a, 1)
    const b = runtime()
    Y.applyUpdate(b.board.doc, Y.encodeStateAsUpdate(a.board.doc), 'remote') // e.g. the first sync from the server
    const first = b.board.snapshot()
    expect(first.map((o) => o.x)).toEqual([1])
    expect(b.board.snapshot()).toBe(first)

    let calls = 0
    b.board.subscribe(() => calls++)
    addText(b, 2)
    expect(calls).toBe(1)
    expect(b.board.snapshot()).not.toBe(first)
    expect(b.board.snapshot().map((o) => o.x)).toEqual([1, 2])
  })
})

describe('view ops', () => {
  it('move only this person camera and stay out of the shared log', () => {
    const rt = runtime()
    const view: ViewController = { fitAll: vi.fn(), zoomTo: vi.fn(), resetZoom: vi.fn(), focus: vi.fn(), center: () => ({ x: 0, y: 0 }) }
    expect(rt.availableOps(canvas).map((o) => o.id)).not.toContain('core.view.fitAll')
    rt.view = view
    expect(rt.availableOps(canvas).map((o) => o.id)).toContain('core.view.fitAll')
    const id = addText(rt)
    rt.dispatch('core.view.zoomToSelection', objects(id), {})
    expect(view.zoomTo).toHaveBeenCalledWith([id])
    rt.dispatch('core.view.focus', objects(id), {})
    expect(view.focus).toHaveBeenCalledWith(id)
    rt.flush()
    expect(invocations(rt).map((e) => e.opId)).toEqual(['text.add'])
  })
})

describe('registry', () => {
  it('makes an add op for each object type, and rejects duplicate ids across plugins', () => {
    const reg = new Registry([corePlugin, pinPlugin])
    expect(['box.add', 'text.add', 'pin.add'].every((id) => reg.op(id))).toBe(true)
    const clash = definePlugin({ id: 'clash', title: 'Clash', ops: [{ ...pinPlugin.ops![0]! }] })
    expect(() => new Registry([corePlugin, pinPlugin, clash])).toThrow(/duplicate id pin.rename/)
    expect(() => new Registry([pinPlugin])).toThrow(/needs plugin core/)
  })
})

describe('tools', () => {
  it('exports ops as JSON Schema tools, with a target only for ops on objects', () => {
    const rt = runtime()
    const id = addText(rt)
    const tools = exportTools([...rt.availableOps(canvas), ...rt.availableOps(objects(id))])
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.has('core__object__setRect')).toBe(false) // hidden
    expect(byName.get('text__add')!.input_schema).toMatchObject({
      required: ['args'],
      properties: { args: { type: 'object', properties: { text: { type: 'string' }, x: { type: 'number' } } } },
    })
    expect(byName.get('text__add')!.input_schema.properties).not.toHaveProperty('ids')
    expect(byName.get('core__object__setColor')!.input_schema).toMatchObject({
      required: ['ids', 'args'],
      properties: { ids: { type: 'array', minItems: 1 }, args: { properties: { color: { enum: expect.arrayContaining(['red']), widget: 'color' } } } },
    })
    for (const t of tools) expect(JSON.parse(JSON.stringify(t))).toEqual(t)
  })

  it("shows an object to the person an agent acts for, with no camera of its own", async () => {
    const rt = runtime()
    const pin = (await rt.callTool('pin__add', { args: { label: 'Clinic' } })).created![0]!
    const nav = new Nav(rt.board.doc)
    const asker: Actor = { kind: 'agent', id: 'helper', onBehalfOf: 'p1' }
    expect(rt.availableOps({ kind: 'objects', ids: [pin] }).map((op) => op.id)).toContain('core.view.show')
    expect(await rt.callTool('core__view__show', { ids: [pin], args: {} }, asker)).toMatchObject({ status: 'applied' })
    expect(nav.get('p1')?.id).toBe(pin)
    expect(nav.get('helper')).toBeUndefined()
    expect(await rt.callTool('core__view__show', { ids: [pin], args: {} }, { kind: 'agent', id: 'helper' })).toMatchObject({ status: 'failed' })
  })

  it('lets an agent name the board, and gives the name first in the summary', async () => {
    const rt = runtime()
    await rt.callTool('pin__add', { args: { label: 'Clinic' } })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/^- pin /)
    expect(await rt.callTool('board__setTitle', { args: { title: 'Clinics' } }, { kind: 'agent', id: 'helper' })).toMatchObject({ status: 'applied' })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/^Board: "Clinics"\n- pin /)
  })

  it('refuses fields outside args, and adds nothing', async () => {
    const rt = runtime()
    const agent: Actor = { kind: 'agent', id: 'helper' }
    expect(await rt.callTool('pin__add', { label: 'Clinic', x: 4 }, agent)).toMatchObject({ status: 'failed', error: expect.stringMatching(/under "args".*label, x/) })
    expect(await rt.callTool('pin__add', [{ label: 'Clinic' }], agent)).toMatchObject({ status: 'failed', error: expect.stringMatching(/not an object/) })
    expect(rt.board.list()).toEqual([])
    expect(await rt.callTool('pin__add', { args: { label: 'Clinic' } }, agent)).toMatchObject({ status: 'applied' })
    // No input at all is an op with no args.
    expect(await rt.callTool('pin__clearAll', undefined)).toMatchObject({ status: 'applied' })
  })

  it('runs a tool call, and refuses hidden ops and high-risk ops from an agent', async () => {
    const rt = runtime()
    const agent: Actor = { kind: 'agent', id: 'helper' }
    const added = await rt.callTool('pin__add', { args: { label: 'Clinic', x: 4 } }, agent)
    expect(added).toMatchObject({ status: 'applied', actor: agent })
    const pin = added.created![0]!
    expect(await rt.callTool('pin__rename', { ids: [pin], args: { label: 'Hospital' } }, agent)).toMatchObject({ status: 'applied' })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(new RegExp(`- pin ${pin} at \\(4, 0\\)`))

    expect(await rt.callTool('core__object__setRect', { ids: [pin], args: { rects: {} } }, agent)).toMatchObject({ status: 'failed', error: expect.stringMatching(/not a tool/) })
    expect(await rt.callTool('pin__clearAll', { args: {} }, agent)).toMatchObject({ status: 'failed', error: expect.stringMatching(/Only a user/) })
    expect(rt.board.get(pin)).toMatchObject({ label: 'Hospital' })
    expect(await rt.callTool('pin__clearAll', { args: {} })).toMatchObject({ status: 'applied' })
    expect(rt.board.get(pin)).toBeUndefined()
    expect(invocations(rt).map((e) => [e.opId, e.status])).toEqual([
      ['pin.add', 'applied'],
      ['pin.rename', 'applied'],
      ['core.object.setRect', 'failed'],
      ['pin.clearAll', 'failed'],
      ['pin.clearAll', 'applied'],
    ])
  })
})

function runtimeFromUpdate(update: Uint8Array) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return runtime(doc)
}
