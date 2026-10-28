import { corePlugin } from '@ttx/core'
import { eventsPlugin } from './events/plugin'
import { mapPlugin } from './map/plugin'
// Each plugin's UI registers its object views and tools (canvas/registry.ts). The order here is the toolbar's.
import './canvas/coreUI'
import './map/ui'
import './events/ui'

/** The plugins every board loads. A new object type or op comes in through a plugin here. */
export const plugins = [corePlugin, mapPlugin, eventsPlugin]
