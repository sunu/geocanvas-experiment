// Each plugin's UI registers its object views and tools (canvas/registry.ts). The order here is the toolbar's.
import './canvas/coreUI'
import './map/ui'
import './events/ui'
import './notebooks/ui'
import './reliefweb/ui'
import './hapi/ui'
import './history/ui'
import './images/ui'
import './openeo/ui'
import './pdfs/ui'
import './inputs/ui'
import './templates/ui'
import './reports/ui'

/** The plugins every board loads (@ttx/plugins). A new object type or op comes in through a plugin there. */
export { plugins } from '@ttx/plugins'
