import { WarningIcon } from '@phosphor-icons/react'
import { EventObject } from '../events/EventObject'
import type { ObjectTypeDef } from './types'

declare module '../board/board' {
  interface ObjectFields {
    /** Only the Montandon id; each browser fetches the details. Absent until someone picks an event. */
    event: { eventId?: string }
  }
}

export const event: ObjectTypeDef<'event'> = {
  type: 'event',
  label: 'Event',
  key: 'e',
  Icon: WarningIcon,
  size: { w: 380, h: 320 },
  layer: 'top',
  create: (r) => ({ type: 'event', ...r }),
  View: EventObject,
  editable: true,
  editOnCreate: true,
}
