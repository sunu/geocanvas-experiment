import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { exportTools } from '../src/index.js'
import { alice, bob, linkedDocs, runtime, tick } from './helpers.js'

const canvas = { kind: 'canvas' } as const

describe('dispatch', () => {
  it('creates a node and logs the invocation', async () => {
    const rt = runtime(new Y.Doc())
    const rec = await rt.dispatch('core.node.create', canvas, { type: 'test.note', props: { text: 'hi' }, x: 5 })
    expect(rec.status).toBe('applied')
    const nodes = rt.reader.nodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.props).toEqual({ text: 'hi' })
    expect(nodes[0]!.layout.x).toBe(5)
    expect(rt.oplog().map((e) => e.kind)).toEqual(['invocation'])
  })

  it('adds a node through the generated <type>.add op and returns its id', async () => {
    const rt = runtime(new Y.Doc())
    const rec = await rt.dispatch('test.note.add', canvas, { text: 'quick', x: 10, y: 20 })
    expect(rec.status, rec.error).toBe('applied')
    expect(rec.created).toHaveLength(1)
    const node = rt.reader.node(rec.created![0]!)!
    expect(node).toMatchObject({ type: 'test.note', props: { text: 'quick' }, layout: { x: 10, y: 20, w: 100, h: 100 } })
    expect(rt.availableOps(canvas).map((o) => o.id)).toContain('test.note.add')
    expect(rt.availableOps(canvas).map((o) => o.id)).not.toContain('core.node.create')
  })

  it('fails on bad args, unknown op, and wrong target', async () => {
    const rt = runtime(new Y.Doc())
    expect((await rt.dispatch('core.node.create', canvas, { type: 'nope' })).status).toBe('failed')
    expect((await rt.dispatch('no.such.op', canvas, {})).status).toBe('failed')
    expect((await rt.dispatch('core.node.delete', canvas, {})).status).toBe('failed')
    expect(rt.reader.nodes()).toHaveLength(0)
    expect(rt.oplog().every((e) => e.kind === 'invocation' && e.status === 'failed')).toBe(true)
  })

  it('syncs ops to a second client', async () => {
    const [a, b] = linkedDocs()
    const ra = runtime(a, alice)
    const rb = runtime(b, bob)
    await ra.dispatch('core.node.create', canvas, { type: 'test.note' })
    expect(rb.reader.nodes()).toHaveLength(1)
    expect(rb.oplog()).toHaveLength(1)
  })
})

describe('undo', () => {
  it('undoes one invocation per step', async () => {
    const rt = runtime(new Y.Doc())
    await rt.dispatch('core.node.create', canvas, { type: 'test.note' })
    const id = rt.reader.nodes()[0]!.id
    await rt.dispatch('core.node.move', { kind: 'nodes', ids: [id] }, { dx: 10 })
    await rt.dispatch('core.node.move', { kind: 'nodes', ids: [id] }, { dx: 10 })
    expect(rt.reader.node(id)!.layout.x).toBe(20)
    rt.undo()
    expect(rt.reader.node(id)!.layout.x).toBe(10)
    rt.undo()
    expect(rt.reader.node(id)!.layout.x).toBe(0)
    rt.redo()
    expect(rt.reader.node(id)!.layout.x).toBe(10)
    expect(rt.oplog().filter((e) => e.kind !== 'invocation').map((e) => e.kind)).toEqual(['undo', 'undo', 'redo'])
  })

  it('merges quick repeats of an op with a mergeKey into one undo step', async () => {
    const rt = runtime(new Y.Doc())
    await rt.dispatch('core.node.create', canvas, { type: 'test.note', props: { text: 'start' } })
    const id = rt.reader.nodes()[0]!.id
    const t = { kind: 'nodes' as const, ids: [id] }
    for (const text of ['a', 'ab', 'abc', 'abcd', 'abcde']) await rt.dispatch('test.note.setText', t, { text })
    await rt.dispatch('core.node.move', t, { dx: 5 })
    rt.undo() // the move
    expect(rt.reader.node(id)!.props.text).toBe('abcde')
    rt.undo() // all five text changes at once
    expect(rt.reader.node(id)!.props.text).toBe('start')
    rt.undo() // the create
    expect(rt.reader.nodes()).toHaveLength(0)
  })

  it('does not merge after the merge window', async () => {
    const rt = runtime(new Y.Doc())
    await rt.dispatch('core.node.create', canvas, { type: 'test.note', props: { text: 'start' } })
    const t = { kind: 'nodes' as const, ids: [rt.reader.nodes()[0]!.id] }
    const realNow = Date.now
    try {
      let now = realNow()
      Date.now = () => now
      await rt.dispatch('test.note.setText', t, { text: 'one' })
      now += 3000
      await rt.dispatch('test.note.setText', t, { text: 'two' })
    } finally {
      Date.now = realNow
    }
    rt.undo()
    expect(rt.reader.node(t.ids[0]!)!.props.text).toBe('one')
  })

  it('undoes only my own ops', async () => {
    const [a, b] = linkedDocs()
    const ra = runtime(a, alice)
    const rb = runtime(b, bob)
    await ra.dispatch('core.node.create', canvas, { type: 'test.note', props: { text: 'a' } })
    await rb.dispatch('core.node.create', canvas, { type: 'test.note', props: { text: 'b' } })
    ra.undo()
    expect(rb.reader.nodes().map((n) => n.props.text)).toEqual(['b'])
    expect(rb.undo()).toBe(true)
    expect(ra.reader.nodes()).toHaveLength(0)
  })
})

describe('plugins', () => {
  it('adds and removes ops when a plugin is enabled or disabled', async () => {
    const [a, b] = linkedDocs()
    const ra = runtime(a, alice)
    const rb = runtime(b, bob)
    expect(rb.registry.op('extra.thing.poke')).toBeUndefined()
    await ra.dispatch('core.plugin.enable', canvas, { pluginId: 'extra' })
    expect(rb.registry.op('extra.thing.poke')).toBeDefined()
    await rb.dispatch('core.node.create', canvas, { type: 'extra.thing' })
    const id = rb.reader.nodes()[0]!.id
    expect(rb.availableOps({ kind: 'nodes', ids: [id] }).map((o) => o.id)).toContain('extra.thing.poke')
    await ra.dispatch('core.plugin.disable', canvas, { pluginId: 'extra' })
    expect(rb.registry.op('extra.thing.poke')).toBeUndefined()
  })

  it('filters palette ops by target', async () => {
    const rt = runtime(new Y.Doc())
    await rt.dispatch('core.node.create', canvas, { type: 'test.note' })
    await rt.dispatch('core.node.create', canvas, { type: 'test.note' })
    const [n1, n2] = rt.reader.nodes().map((n) => n.id)
    const one = rt.availableOps({ kind: 'nodes', ids: [n1!] }).map((o) => o.id)
    const two = rt.availableOps({ kind: 'nodes', ids: [n1!, n2!] }).map((o) => o.id)
    expect(one).toContain('core.node.delete')
    expect(one).not.toContain('core.node.connect')
    expect(two).toContain('core.node.connect')
    expect(one).not.toContain('test.group.regenerate')
  })

  it('offers the ops of the parent group when a child is selected', async () => {
    const rt = runtime(new Y.Doc())
    await rt.dispatch('test.pipeline.create', canvas, { value: 1 })
    await rt.engine.idle()
    const group = rt.reader.nodes().find((n) => n.type === 'test.group')!
    const child = rt.reader.children(group.id)[0]!
    const scopes = rt.scopes({ kind: 'nodes', ids: [child.id] })
    expect(scopes.map((s) => s.kind)).toEqual(['selection', 'group', 'canvas'])
    expect(scopes[1]!.target).toEqual({ kind: 'nodes', ids: [group.id] })
    expect(scopes[1]!.ops.map((o) => o.id)).toContain('test.group.regenerate')
    expect(scopes[0]!.ops.map((o) => o.id)).not.toContain('test.group.regenerate')
    expect(scopes[2]!.ops.every((o) => o.target.kind === 'canvas')).toBe(true)
  })

  it('exports ops as tool definitions', () => {
    const rt = runtime(new Y.Doc())
    const tools = exportTools(rt.registry.ops())
    const t = tools.find((x) => x.name === 'test__group__regenerate')!
    expect(t.input_schema).toMatchObject({ type: 'object', properties: { count: { type: 'integer' } } })
  })
})

describe('proposals', () => {
  it('runs a proposal only after approval', async () => {
    const [a, b] = linkedDocs()
    const agent = runtime(a, { kind: 'agent', id: 'agent-1' })
    const user = runtime(b, bob)
    const p = agent.propose('core.node.create', canvas, { type: 'test.note' })
    await tick()
    expect(user.reader.nodes()).toHaveLength(0)
    expect(user.doc.proposals.size).toBe(1)
    const rec = await user.approve(p.id)
    expect(rec.status).toBe('applied')
    expect(rec.parentId).toBe(p.id)
    expect(agent.reader.nodes()).toHaveLength(1)
    expect(user.doc.proposals.size).toBe(0)
  })
})
