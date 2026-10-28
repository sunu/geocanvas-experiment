import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { EVENT_FOOTPRINT_TOOL } from '@ttx/plugins'
import type { MontyClient } from '@ttx/plugins/monty/client'

/** Where a Montandon event happened, as map features: each source's hazard area or track, and the event points. */
export function eventFootprintTool(client: Pick<MontyClient, 'getFootprint'>) {
  return defineTool({
    id: EVENT_FOOTPRINT_TOOL,
    title: 'Event footprint',
    description:
      "Where a Montandon event happened: the hazard items of every source that reports it (flood extent, cyclone track, earthquake area) and the event points. Input: the event id.",
    input: z.object({ eventId: z.string().min(1).describe('Montandon event id, e.g. "gdacs-event-1104124-1"') }),
    output: 'geo.features',
    async run({ eventId }) {
      const fc = await client.getFootprint(eventId)
      if (!fc.features.length) throw new Error('Montandon has no location for this event')
      return { ...fc, attribution: 'IFRC Montandon' }
    },
  })
}
