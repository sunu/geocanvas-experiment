import { corePlugin } from '@ttx/core'
import { agentPlugin } from './agent.js'
import { eventsPlugin } from './events.js'
import { hapiPlugin } from './hapi.js'
import { mapPlugin } from './map.js'
import { notebooksPlugin } from './notebooks.js'
import { reliefwebPlugin } from './reliefweb.js'

/**
 * The headless plugins: object types and ops, with no UI. The web app adds their UI
 * (apps/web/src/plugins.ts); the room Durable Object runs the agent on them.
 */
export const plugins = [corePlugin, mapPlugin, eventsPlugin, notebooksPlugin, reliefwebPlugin, hapiPlugin, agentPlugin]

export { agentPlugin } from './agent.js'
export { boardGet, eventsSearch } from './agentTools.js'
export { eventsPlugin, eventLayer, EVENT_FOOTPRINT_TOOL, type EventBoardObject } from './events.js'
export { mapPlugin, BASEMAPS, type Basemap, type MapArea, type MapBoardObject } from './map.js'
export { notebooksPlugin, notebookResultLayer, NOTEBOOK_ARTIFACT_TOOL, type NotebookBoardObject } from './notebooks.js'
export { hapiPlugin, type CountryBoardObject } from './hapi.js'
export { reliefwebPlugin, feedFor, glidesOf, GLIDE, type ReliefWebBoardObject } from './reliefweb.js'
export { geocodeTools, OpenCageGeocoder, OPENCAGE_URL, parseOpenCage, type Geocoder, type Place, type PlaceFeatures } from './geocode.js'
export { bboxOf, DATA_LAYERS, hasArea, mapLayer, newLayerId, type Bbox, type DataLayerKey, type MapLayer } from './mapLayers.js'
export { areaOfView, viewOfArea, MAP_HEADER_PX, type Area, type CenterZoom } from './mapView.js'
