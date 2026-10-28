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

  it('says so when Montandon has no location for the event, or does not know it', async () => {
    const tools = runner({ 'gdacs-event-2': { type: 'FeatureCollection', features: [] } })
    await expect(tools.run('events.footprint', { eventId: 'gdacs-event-2' })).rejects.toThrow(/no location/)
    await expect(tools.run('events.footprint', { eventId: 'gdacs-event-3' })).rejects.toThrow(/Unknown event/)
  })
})
