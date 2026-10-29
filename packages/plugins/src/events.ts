import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import type { MapBoardObject } from './map.js'
import { applyLinks, planLinks } from './links/propagate.js'
import { eventLayer } from './mapLayers.js'

/**
 * The event object type and its ops. No React here: the view is registered in apps/web/src/events/ui.ts.
 * The board stores only the Montandon event id; each browser fetches the details (apps/web/src/events/monty.ts).
 */

/** eventId is absent until someone picks an event. */
export type EventBoardObject = AnyObject & { type: 'event'; eventId?: string }

// In mapLayers.ts, so that the link recipes (links/) can use it without importing this plugin.
export { EVENT_FOOTPRINT_TOOL, eventLayer } from './mapLayers.js'

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
      description: 'Show a Montandon event in the selected event object. Objects that follow it (a map, a feed, a country card) show the new event too.',
      target: { kind: 'objects', types: ['event'], max: 1 },
      args: z.object({ eventId: eventId.meta({ widget: 'event' }).describe('Event') }),
      nl: { aliases: ['change event', 'select event'] },
      // The followers re-render in the same transaction: picking an event and its effects are one undo step.
      async prepare(ctx, { eventId }) {
        const id = ctx.target.kind === 'objects' ? ctx.target.ids[0]! : ''
        return { id, eventId, links: await planLinks(ctx, { ...ctx.board.get(id)!, eventId } as EventBoardObject) }
      },
      apply(tx, { id, eventId, links }) {
        tx.update({ [id]: { eventId } })
        applyLinks(tx, links)
      },
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
