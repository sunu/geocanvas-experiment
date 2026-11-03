import { registerObjectUI } from '../canvas/registry'
import { HdxObject } from './HdxObject'

// No key: the card is in the toolbar's Event context menu, as hdx.add in the palette, and for the agent.
registerObjectUI('hdx', { View: HdxObject, editable: true, editOnCreate: true, isEmpty: (o) => !o.url })
