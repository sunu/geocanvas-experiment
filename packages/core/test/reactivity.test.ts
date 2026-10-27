import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { alice, bob, linkedDocs, runtime } from './helpers.js'

const canvas = { kind: 'canvas' } as const

async function pipeline(rt: ReturnType<typeof runtime>, value = 2) {
  const rec = await rt.dispatch('test.pipeline.create', canvas, { value })
  expect(rec.status, rec.error).toBe('applied')
  await rt.engine.idle()
  const byType = (t: string) => rt.reader.nodes().find((n) => n.type === t)!
  return { src: byType('test.source'), dbl: byType('test.double'), grp: byType('test.group') }
}

describe('links', () => {
  it('rejects a cycle and a port type mismatch', async () => {
    const rt = runtime(new Y.Doc())
    const { src, dbl } = await pipeline(rt)
    const cycle = await rt.dispatch('core.link.create', canvas, {
      from: { nodeId: dbl.id, port: 'value' },
      to: { nodeId: dbl.id, port: 'value' },
    })
    expect(cycle.status).toBe('failed')
    const badPort = await rt.dispatch('core.link.create', canvas, {
      from: { nodeId: src.id, port: 'nope' },
      to: { nodeId: dbl.id, port: 'value' },
    })
    expect(badPort.error).toMatch(/no output port/)
  })
})

describe('engine', () => {
  it('computes along links and reacts with child nodes', async () => {
    const rt = runtime(new Y.Doc())
    const { dbl, grp } = await pipeline(rt, 2)
    expect(rt.engine.get(dbl.id)?.result?.outputs?.value).toBe(4)
    expect(rt.reader.children(grp.id)).toHaveLength(4)
  })

  it('updates downstream when the source changes, and undo restores it', async () => {
    const rt = runtime(new Y.Doc())
    const { src, grp } = await pipeline(rt, 2)
    await rt.dispatch('core.node.updateProps', { kind: 'nodes', ids: [src.id] }, { props: { value: 3 } })
    await rt.engine.idle()
    expect(rt.reader.children(grp.id)).toHaveLength(6)
    rt.undo()
    await rt.engine.idle()
    expect(rt.reader.node(src.id)!.props.value).toBe(2)
    expect(rt.reader.children(grp.id)).toHaveLength(4)
  })

  it('undo of a template removes all nodes, also cascade children', async () => {
    const rt = runtime(new Y.Doc())
    await pipeline(rt, 2)
    expect(rt.reader.nodes().length).toBe(3 + 4)
    rt.undo()
    await rt.engine.idle()
    await new Promise((r) => setTimeout(r, 10))
    expect(rt.reader.nodes()).toHaveLength(0)
    expect(rt.reader.links()).toHaveLength(0)
  })

  it('runs the cascade only on the client that made the change', async () => {
    const [a, b] = linkedDocs()
    const ra = runtime(a, alice)
    const rb = runtime(b, bob)
    const { src, grp } = await pipeline(ra, 2)
    await rb.engine.idle()
    await ra.dispatch('core.node.updateProps', { kind: 'nodes', ids: [src.id] }, { props: { value: 1 } })
    await Promise.all([ra.engine.idle(), rb.engine.idle()])
    await ra.engine.idle()
    expect(rb.reader.children(grp.id)).toHaveLength(2)
    const regenerations = rb.oplog().filter((e) => e.kind === 'invocation' && e.opId === 'test.group.regenerate')
    expect(regenerations).toHaveLength(2) // one at creation, one after the change
    expect(regenerations.every((e) => e.kind === 'invocation' && e.actor.kind === 'system' && e.parentId)).toBe(true)
  })

  it('does not react when autoSync is off', async () => {
    const rt = runtime(new Y.Doc())
    const { src, grp } = await pipeline(rt, 2)
    await rt.dispatch('core.node.updateProps', { kind: 'nodes', ids: [grp.id] }, { props: { autoSync: false } })
    await rt.dispatch('core.node.updateProps', { kind: 'nodes', ids: [src.id] }, { props: { value: 5 } })
    await rt.engine.idle()
    expect(rt.reader.children(grp.id)).toHaveLength(4)
  })
})
