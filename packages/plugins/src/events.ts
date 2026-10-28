import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'

/**
 * The event object type and its ops. No React here: the view is registered in apps/web/src/events/ui.ts.
 * The board stores only the Montandon event id; each browser fetches the details (apps/web/src/events/monty.ts).
 */

/** eventId is absent until someone picks an event. */
export type EventBoardObject = AnyObject & { type: 'event'; eventId?: string }

export const eventsPlugin = definePlugin({
  id: 'events',
  title: 'Events',
  dependsOn: ['core'],
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
      args: z.object({ eventId: z.string().min(1).meta({ widget: 'event' }).describe('Event') }),
      nl: { aliases: ['change event', 'select event'] },
      apply: (tx, { eventId }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { eventId } }),
    }),
  ],
})
