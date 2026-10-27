import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { CanvasRuntime, PluginCatalog } from '@geo-canvas/core'
import { corePlugin } from '../src/index.js'

const canvas = { kind: 'canvas' } as const
const nodes = (ids: string[]) => ({ kind: 'nodes' as const, ids })

async function setup() {
  const rt = new CanvasRuntime({ ydoc: new Y.Doc(), catalog: new PluginCatalog([corePlugin]), actor: { kind: 'user', id: 'u' } })
  const map = (await rt.dispatch('core.map.add', canvas, { x: 0, y: 0 })).created![0]!
  await rt.dispatch('core.map.setView', nodes([map]), { center: [34.8, -19.8], zoom: 6 })
  const sticky = (await rt.dispatch('core.sticky.add', canvas, { x: 700, y: 0, text: 'shelter' })).created![0]!
  return { rt, map, sticky }
}

describe('pins', () => {
  it('pins a node to the map center, moves it, and unpins it', async () => {
    const { rt, map, sticky } = await setup()
    let r = await rt.dispatch('core.node.pinToMap', nodes([sticky]), {})
    expect(r.status, r.error).toBe('applied')
    expect(rt.reader.node(sticky)).toMatchObject({ parentId: map, anchor: { kind: 'geo', lngLat: [34.8, -19.8] } })

    r = await rt.dispatch('core.node.moveAnchor', nodes([sticky]), { lngLat: [35, -20] })
    expect(rt.reader.node(sticky)!.anchor!.lngLat).toEqual([35, -20])

    r = await rt.dispatch('core.node.unpin', nodes([sticky]), { x: 900, y: 50 })
    const n = rt.reader.node(sticky)!
    expect(n.anchor).toBeUndefined()
    expect(n.parentId).toBeUndefined()
    expect(n.layout).toMatchObject({ x: 900, y: 50 })

    rt.undo()
    rt.undo()
    expect(rt.reader.node(sticky)!.anchor!.lngLat).toEqual([34.8, -19.8])
    rt.undo()
    expect(rt.reader.node(sticky)!.anchor).toBeUndefined()
  })

  it('adds a node pinned in one op, and lists pins in the map data', async () => {
    const { rt, map } = await setup()
    const r = await rt.dispatch('core.text.add', canvas, { text: 'note', pinTo: { parentId: map, lngLat: [34.5, -19.5] } })
    expect(r.status, r.error).toBe('applied')
    expect(rt.reader.node(r.created![0]!)).toMatchObject({ parentId: map, anchor: { lngLat: [34.5, -19.5] } })
    await rt.engine.idle()
    const pins = (rt.engine.get(map)?.result?.data as { pins: { id: string }[] }).pins
    expect(pins.map((p) => p.id)).toEqual([r.created![0]])
  })

  it('refuses to pin a map, and deleting the map deletes its pins', async () => {
    const { rt, map, sticky } = await setup()
    const other = (await rt.dispatch('core.map.add', canvas, {})).created![0]!
    expect((await rt.dispatch('core.node.pinToMap', nodes([other]), { mapId: map })).status).toBe('failed')
    await rt.dispatch('core.node.pinToMap', nodes([sticky]), { mapId: map })
    await rt.dispatch('core.node.delete', nodes([map]), {})
    expect(rt.reader.node(sticky)).toBeUndefined()
  })
})
