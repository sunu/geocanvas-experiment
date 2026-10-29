import { registerObjectUI } from '../canvas/registry'
import { InputObject } from './InputObject'

// No toolbar tool: templates add inputs, and input.add is in the palette and for the agent.
registerObjectUI('input', { View: InputObject, editable: true, editOnCreate: true })
