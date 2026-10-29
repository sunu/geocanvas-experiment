import { describe, expect, it } from 'vitest'
import { ToolRunner } from '@ttx/core'
import type { EventFootprint } from '@ttx/plugins/monty/client'
import { eventFootprintTool } from '../src/events/footprint'

const extent: EventFootprint = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[85.6, 28.2], [85.7, 28.4], [85.4, 28.6], [85.6, 28.2]]] },
      properties: { id: 'gdacs-hazard-1', kind: 'hazard', source: 'gdacs', title: 'Flood in Nepal' },
    },
  ],
}

const runner = (footprints: Record<string, EventFootprint>) =>
  new ToolRunner([eventFootprintTool({ getFootprint: async (id) => footprints[id] ?? Promise.reject(new Error(`Unknown event: ${id}`)) })])

describe('events.footprint', () => {
  it("is the event's footprint from Montandon, with the attribution", async () => {
    const fc = await runner({ 'gdacs-event-1': extent }).run<EventFootprint & { attribution?: string }>('events.footprint', { eventId: 'gdacs-event-1' })
    expect(fc.features).toEqual(extent.features)
    expect(fc.attribution).toBe('IFRC Montandon')
  })

  it('gives one part: an item, or the points', async () => {
    const point = { type: 'Feature' as const, geometry: { type: 'Point', coordinates: [85.3, 28.1] }, properties: { id: 'gdacs-event-1', kind: 'event' as const, source: 'gdacs' } }
    const tools = runner({ 'gdacs-event-1': { ...extent, features: [...extent.features, point] } })
    const item = await tools.run<EventFootprint>('events.footprint', { eventId: 'gdacs-event-1', itemId: 'gdacs-hazard-1' })
    expect(item.features).toEqual(extent.features)
    const points = await tools.run<EventFootprint>('events.footprint', { eventId: 'gdacs-event-1', points: true })
    expect(points.features).toEqual([point])
    await expect(tools.run('events.footprint', { eventId: 'gdacs-event-1', itemId: 'cems-hazard-gone' })).rejects.toThrow(/no longer has cems-hazard-gone/)
  })

  it('says so when Montandon has no location for the event, or does not know it', async () => {
    const tools = runner({ 'gdacs-event-2': { type: 'FeatureCollection', features: [] } })
    await expect(tools.run('events.footprint', { eventId: 'gdacs-event-2' })).rejects.toThrow(/no location/)
    await expect(tools.run('events.footprint', { eventId: 'gdacs-event-3' })).rejects.toThrow(/Unknown event/)
  })
})
