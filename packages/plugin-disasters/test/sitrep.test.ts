import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { CanvasRuntime, PluginCatalog, exportTools, summarizeCanvas, type Actor } from '@geo-canvas/core'
import { corePlugin } from '@geo-canvas/plugin-core'
import { createDisastersPlugin, MockDisasterProvider } from '../src/index.js'

const provider = new MockDisasterProvider(0)
const catalog = new PluginCatalog([corePlugin, createDisastersPlugin(provider)])
const canvas = { kind: 'canvas' } as const
const alice: Actor = { kind: 'user', id: 'alice' }

async function setup() {
  const rt = new CanvasRuntime({ ydoc: new Y.Doc(), catalog, actor: alice })
  expect((await rt.dispatch('core.plugin.enable', canvas, { pluginId: 'disasters' })).status).toBe('applied')
  const events = await provider.listEvents()
  return { rt, events }
}

/** A recent event in a region that has related events of the same type in the last 10 years. */
async function seedWithRelated(region: string) {
  for (const s of await provider.listEvents()) {
    if (!s.id.startsWith(region)) continue
    const e = await provider.getEvent(s.id)
    const r = await provider.searchEvents({ near: e.center, radiusKm: 400, types: [e.type], fromYear: e.year - 10, toYear: e.year, excludeId: e.id })
    if (r.length >= 2) return e
  }
  throw new Error('no seed with related events')
}

const settle = async (rt: CanvasRuntime) => {
  for (let i = 0; i < 5; i++) {
    await rt.engine.idle()
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('mock provider', () => {
  it('makes the same data each time', async () => {
    const a = await new MockDisasterProvider(0).listEvents()
    const b = await new MockDisasterProvider(0).listEvents()
    expect(a.length).toBeGreaterThan(40)
    expect(a).toEqual(b)
  })
})

describe('situation report', () => {
  it('fills the canvas from the template and computes all nodes', async () => {
    const { rt, events } = await setup()
    const seed = await seedWithRelated('sof-')
    const rec = await rt.dispatch('disasters.sitrep.create', canvas, { eventId: seed.id })
    expect(rec.status, rec.error).toBe('applied')
    await settle(rt)

    const nodes = rt.reader.nodes()
    const one = (type: string) => nodes.find((n) => n.type === type && !n.parentId)!
    const people = nodes.find((n) => n.props.source === 'disasters.peopleAffected')!
    const table = rt.engine.get(people.id)?.result?.outputs?.table as { total: number; rows: unknown[] }
    expect(table.total).toBeGreaterThan(0)
    expect(table.rows.length).toBeGreaterThan(0)

    const summary = rt.engine.get(one('core.text').id)?.result?.data as { rendered: string }
    expect(summary.rendered).toContain(seed.name)
    expect(summary.rendered).not.toMatch(/\{\{/)

    const group = one('disasters.relatedEvents')
    const children = rt.reader.children(group.id)
    expect(children.length).toBeGreaterThan(0)
    expect(children.every((c) => c.type === 'disasters.event')).toBe(true)
    const map = rt.engine.get(one('core.map').id)?.result?.data as { features: GeoJSON.FeatureCollection }
    expect(map.features.features.length).toBe(children.length)
  })

  it('updates everything when the seed event changes, and undo restores it', async () => {
    const { rt, events } = await setup()
    const first = await seedWithRelated('sof-')
    const second = await seedWithRelated('khu-')
    await rt.dispatch('disasters.sitrep.create', canvas, { eventId: first.id })
    await settle(rt)
    const seed = rt.reader.nodes().find((n) => n.type === 'disasters.event' && !n.parentId)!
    const group = rt.reader.nodes().find((n) => n.type === 'disasters.relatedEvents')!
    const summaryId = rt.reader.nodes().find((n) => n.type === 'core.text')!.id
    const childrenBefore = rt.reader.children(group.id).map((c) => c.props.eventId)

    const rec = await rt.dispatch('disasters.event.change', { kind: 'nodes', ids: [seed.id] }, { eventId: second.id })
    expect(rec.status, rec.error).toBe('applied')
    await settle(rt)
    const summary = rt.engine.get(summaryId)?.result?.data as { rendered: string }
    expect(summary.rendered).toContain(second.name)
    const childrenAfter = rt.reader.children(group.id).map((c) => c.props.eventId as string)
    expect(childrenAfter.every((id) => id.startsWith('khu-'))).toBe(true)
    expect(rt.reader.node(group.id)!.props.seedEventId).toBe(second.id)

    rt.undo()
    await settle(rt)
    expect(rt.reader.node(seed.id)!.props.eventId).toBe(first.id)
    expect(rt.reader.children(group.id).map((c) => c.props.eventId)).toEqual(childrenBefore)
  })

  it('charts follow a new AOI on the map', async () => {
    const { rt, events } = await setup()
    await rt.dispatch('disasters.sitrep.create', canvas, { eventId: events.find((e) => e.id.startsWith('snd-'))!.id })
    await settle(rt)
    const map = rt.reader.nodes().find((n) => n.type === 'core.map')!
    const people = rt.reader.nodes().find((n) => n.props.source === 'disasters.peopleAffected')!
    const before = (rt.engine.get(people.id)?.result?.outputs?.total as number)
    const rec = await rt.dispatch('core.map.bufferAoi', { kind: 'nodes', ids: [map.id] }, { factor: 0.5 })
    expect(rec.status, rec.error).toBe('applied')
    await settle(rt)
    const after = rt.engine.get(people.id)?.result?.outputs?.total as number
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
  })

  it('regenerates related disasters with a wider year range from the palette op', async () => {
    const { rt, events } = await setup()
    const recent = events.find((e) => e.id.startsWith('ley-') && e.year >= 2018)!
    await rt.dispatch('disasters.sitrep.create', canvas, { eventId: recent.id })
    await settle(rt)
    const group = rt.reader.nodes().find((n) => n.type === 'disasters.relatedEvents')!
    const target = { kind: 'nodes' as const, ids: [group.id] }
    expect(rt.availableOps(target).map((o) => o.id)).toContain('disasters.relatedEvents.regenerate')
    expect(rt.defaultsFor('disasters.relatedEvents.regenerate', target)).toMatchObject({ yearRange: 10 })

    const preview = await rt.preview('disasters.relatedEvents.regenerate', target, { yearRange: 30, sameType: false })
    expect(preview.summary).toMatch(/events replace/)
    const rec = await rt.dispatch('disasters.relatedEvents.regenerate', target, { yearRange: 30, sameType: false })
    expect(rec.status, rec.error).toBe('applied')
    const years = rt.reader.children(group.id).map((c) => Number(String(c.props.eventId).split('-')[1]))
    expect(Math.min(...years)).toBeLessThan(recent.year - 10)
    expect(rt.reader.node(group.id)!.props.yearRange).toBe(30)
  })

  it('exports tools and a canvas summary for an LLM', async () => {
    const { rt, events } = await setup()
    await rt.dispatch('disasters.sitrep.create', canvas, { eventId: events[0]!.id })
    await settle(rt)
    const tools = exportTools(rt.registry.ops().filter((o) => !o.hidden))
    expect(tools.map((t) => t.name)).toContain('disasters__relatedEvents__regenerate')
    const text = summarizeCanvas(rt.reader, (id) => {
      const n = rt.reader.node(id)!
      return rt.registry.nodeType(n.type)?.summarize?.(n, rt.engine.get(id)?.result?.data)
    })
    expect(text).toContain('related disasters group')
  })
})
