import { registerObjectUI } from '../canvas/registry'
import { HistoryObject } from './HistoryObject'

// No key tool: it is in the toolbar's Event context menu (canvas/Toolbar.tsx), and in the palette (history.add) and for the agent.
registerObjectUI('history', { View: HistoryObject, editable: true, editOnCreate: true })
