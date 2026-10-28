import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import type { MapBoardObject } from './map.js'
import { newLayerId, type MapLayer } from './mapLayers.js'

/**
 * The event object type and its ops. No React here: the view is registered in apps/web/src/events/ui.ts.
 * The board stores only the Montandon event id; each browser fetches the details (apps/web/src/events/monty.ts).
 */

/** eventId is absent until someone picks an event. */
export type EventBoardObject = AnyObject & { type: 'event'; eventId?: string }

/** The tool that reads an event's footprint from Montandon in the browser (apps/web/src/events/footprint.ts). */
export const EVENT_FOOTPRINT_TOOL = 'events.footprint'

/** A map layer for where an event happened: the recipe names the event, and each browser asks Montandon. */
export function eventLayer(eventId: string, title?: string): MapLayer {
  return { id: newLayerId(), tool: EVENT_FOOTPRINT_TOOL, input: { eventId }, title: title ?? `Event ${eventId}` }
}

const eventId = z.string().min(1)

export const eventsPlugin = definePlugin({
  id: 'events',
  title: 'Events',
  dependsOn: ['core', 'map'],
  objectTypes: [
    {
      type: 'event',
      title: 'Event',
      description: 'A disaster event from Montandon, with its impacts and the sources that report it.',
      fields: z.object({ eventId: z.string().min(1).optional() }),
      defaultSize: { w: 380, h: 320 },
      layer: 'top',
      summarize: (o) => ((o as EventBoardObject).eventId ? `Montandon event ${(o as EventBoardObject).eventId}` : 'no event picked yet'),
    },
  ],
  ops: [
    defineOp({
      id: 'event.setEvent',
      title: 'Pick event',
      description: 'Show a Montandon event in the selected event object.',
      target: { kind: 'objects', types: ['event'], max: 1 },
      args: z.object({ eventId: eventId.meta({ widget: 'event' }).describe('Event') }),
      nl: { aliases: ['change event', 'select event'] },
      apply: (tx, { eventId }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { eventId } }),
    }),
    defineOp({
      id: 'map.addEventLayer',
      title: 'Add event footprint',
      description:
        "Add where a Montandon event happened to a map, as a data layer for everyone: each source's hazard area or track " +
        '(flood extent, cyclone track, earthquake area) and the event points.',
      target: { kind: 'objects', types: ['map'], min: 1, max: 1 },
      args: z.object({
        eventId: eventId.meta({ widget: 'event' }).describe('Montandon event id, e.g. from an event object on the board'),
        title: z.string().min(1).optional().describe("The layer's title in the map's list. Default: the event id"),
      }),
      prepare(ctx, { eventId, title }) {
        const map = ctx.board.get(ctx.target.kind === 'objects' ? (ctx.target.ids[0] ?? '') : '') as MapBoardObject
        return { id: map.id, layers: [...(map.layers ?? []), eventLayer(eventId, title)] }
      },
      apply: (tx, { id, layers }) => tx.update({ [id]: { layers } }),
    }),
  ],
})
