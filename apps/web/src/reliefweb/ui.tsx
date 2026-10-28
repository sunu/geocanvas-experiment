import { registerObjectUI } from '../canvas/registry'
import { ReliefWebObject } from './ReliefWebObject'

// No toolbar tool: a feed is made from an event's card ("ReliefWeb updates"), or with reliefweb.add in the palette.
registerObjectUI('reliefweb', { View: ReliefWebObject, editable: true })
