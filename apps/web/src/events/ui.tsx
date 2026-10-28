import { WarningIcon } from '@phosphor-icons/react'
import { registerObjectUI, registerWidget } from '../canvas/registry'
import { EventObject, EventPicker } from './EventObject'

registerObjectUI('event', { View: EventObject, tool: { key: 'E', label: 'Event', Icon: WarningIcon }, editable: true, editOnCreate: true })

/** Pick an event in a form, e.g. for 'event.setEvent' in the palette: the same search as the event object. */
registerWidget('event', ({ value, onChange }) => (
  <div className="ttx-field__event">
    <EventPicker selected={typeof value === 'string' ? value : undefined} onPick={onChange} />
  </div>
))
