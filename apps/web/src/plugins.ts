// Each plugin's UI registers its object views and tools (canvas/registry.ts). The order here is the toolbar's.
import './canvas/coreUI'
import './map/ui'
import './events/ui'
import './notebooks/ui'
import './images/ui'

/** The plugins every board loads (@ttx/plugins). A new object type or op comes in through a plugin there. */
export { plugins } from '@ttx/plugins'
