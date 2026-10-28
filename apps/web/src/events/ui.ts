import { WarningIcon } from '@phosphor-icons/react'
import { registerObjectUI } from '../canvas/registry'
import { EventObject } from './EventObject'

registerObjectUI('event', { View: EventObject, tool: { key: 'E', label: 'Event', Icon: WarningIcon }, editable: true, editOnCreate: true })
