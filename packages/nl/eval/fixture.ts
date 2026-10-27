import * as Y from 'yjs'
import { CanvasRuntime, PluginCatalog, type TargetRef } from '@geo-canvas/core'
import { corePlugin } from '@geo-canvas/plugin-core'
import { createDisastersPlugin, MockDisasterProvider } from '@geo-canvas/plugin-disasters'

/** A headless canvas with the situation report for a fixed seed event. */
export async function sitrepFixture() {
  const provider = new MockDisasterProvider(0)
  const catalog = new PluginCatalog([corePlugin, createDisastersPlugin(provider)])
  const runtime = new CanvasRuntime({ ydoc: new Y.Doc(), catalog, actor: { kind: 'user', id: 'eval' } })
  await runtime.dispatch('core.plugin.enable', { kind: 'canvas' }, { pluginId: 'disasters' })
  const events = await provider.listEvents()
  // Seed: the latest Sofala cyclone (events are sorted by year, newest first).
  const seedId = events.find((e) => e.id.startsWith('sof-') && e.type === 'cyclone')!.id
  const rec = await runtime.dispatch('disasters.sitrep.create', { kind: 'canvas' }, { eventId: seedId })
  if (rec.status !== 'applied') throw new Error(rec.error)
  for (let i = 0; i < 5; i++) {
    await runtime.engine.idle()
    await new Promise((r) => setTimeout(r, 5))
  }
  const nodes = runtime.reader.nodes()
  const top = (type: string, pick?: (n: (typeof nodes)[number]) => boolean) =>
    nodes.find((n) => n.type === type && !n.parentId && (!pick || pick(n)))!
  const group = top('disasters.relatedEvents')
  /** Selection by a short name, as written in eval cases. */
  const select = (name: string): TargetRef => {
    const id = (() => {
      switch (name) {
        case 'none': return undefined
        case 'seed': return top('disasters.event').id
        case 'map': return top('core.map').id
        case 'peopleChart': return top('core.chart', (n) => n.props.source === 'disasters.peopleAffected').id
        case 'damageChart': return top('core.chart', (n) => n.props.source === 'disasters.estimatedDamage').id
        case 'summary': return top('core.text').id
        case 'group': return group.id
        case 'groupChild': return runtime.reader.children(group.id)[0]!.id
        default: throw new Error(`Unknown selection ${name}`)
      }
    })()
    return id ? { kind: 'nodes', ids: [id] } : { kind: 'canvas' }
  }
  /** Short name of a target, for comparing with expected values. */
  const nameOf = (t: TargetRef): string => {
    if (t.kind === 'canvas') return 'canvas'
    for (const n of ['seed', 'map', 'peopleChart', 'damageChart', 'summary', 'group', 'groupChild']) {
      const s = select(n)
      if (s.kind === 'nodes' && s.ids[0] === t.ids[0]) return n
    }
    return t.ids.join(',')
  }
  return { runtime, provider, events, select, nameOf }
}
