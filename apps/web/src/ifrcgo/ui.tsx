import { registerObjectUI } from '../canvas/registry'
import { IfrcGoObject } from './IfrcGoObject'

// No key: the card is in the toolbar's Event context menu, as ifrcgo.add in the palette, and for the agent.
registerObjectUI('ifrcgo', { View: IfrcGoObject, editable: true, editOnCreate: true, isEmpty: (o) => !o.url })
