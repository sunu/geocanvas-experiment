import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { EVENT_FOOTPRINT_TOOL } from '@ttx/plugins'
import type { MontyClient } from '@ttx/plugins/monty/client'

const isPoint = (type: string) => type === 'Point' || type === 'MultiPoint'

/**
 * Where a Montandon event happened, as map features: each source's hazard area or track, and the event points. A
 * layer can show one part of it (footprintParts in @ttx/plugins): one item's area or track, or all the points. The
 * client asks Montandon once per event, so the layers of one footprint share one request.
 */
export function eventFootprintTool(client: Pick<MontyClient, 'getFootprint'>) {
  return defineTool({
    id: EVENT_FOOTPRINT_TOOL,
    title: 'Event footprint',
    description:
      "Where a Montandon event happened: the hazard items of every source that reports it (flood extent, cyclone track, earthquake area) and the event points. Input: the event id; with itemId only that item's area or track, with points only the points.",
    input: z.object({
      eventId: z.string().min(1).describe('Montandon event id, e.g. "gdacs-event-1104124-1"'),
      itemId: z.string().min(1).optional().describe('Only this item of the footprint, e.g. "cems-hazard-EMSR927-aoi03-flood"'),
      points: z.literal(true).optional().describe('Only the points of the footprint'),
    }),
    output: 'geo.features',
    async run({ eventId, itemId, points }) {
      const fc = await client.getFootprint(eventId)
      if (!fc.features.length) throw new Error('Montandon has no location for this event')
      const features = itemId
        ? fc.features.filter((f) => f.properties.id === itemId)
        : points
          ? fc.features.filter((f) => isPoint(f.geometry.type))
          : fc.features
      if (!features.length) throw new Error(itemId ? `Montandon no longer has ${itemId} in this event's footprint` : 'This footprint has no points')
      return { ...fc, features, attribution: 'IFRC Montandon' }
    },
  })
}
