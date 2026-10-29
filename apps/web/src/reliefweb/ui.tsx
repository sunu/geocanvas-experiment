import { registerObjectUI } from '../canvas/registry'
import { ReliefWebObject } from './ReliefWebObject'

// No key tool: a feed is made from an event's card ("ReliefWeb updates"), from the toolbar's Event context menu, or with reliefweb.add in the palette.
registerObjectUI('reliefweb', { View: ReliefWebObject, editable: true })
