import { adminBoundariesTool, WorldBankBoundaries } from '../data/boundaries'
import { OvertureParquet, overtureTool } from '../data/buildings'
import { uploadFeaturesTool, UrlFeatures, urlFeaturesTool, urlRasterTool, urlTilesTool } from '../data/fromUrl'
import { geocodeTools, OpenCageGeocoder } from '@ttx/plugins'
import { healthFacilitiesTool, LayercakeHealth } from '../data/health'
import { populationTool, SourceCoopPopulation } from '../data/population'
import { eventFootprintTool } from '../events/footprint'
import { ExposureWorker, exposureTool } from '../exposure/exposure'
import { monty } from '../events/monty'
import { choroplethTool } from '../hapi/choropleth'
import { boundariesTool } from '../map/adminAreas'
import { notebookFactory } from '../notebooks/api'
import { notebookArtifactTool } from '../notebooks/artifact'
import { notebookRunsTool } from '../notebooks/runs'
import { routeTool, routing } from '../routing/routing'
import { ToolRunner } from '@ttx/core'

/** Reads GeoJSON, GeoParquet and shapefiles from URLs and uploads, in one worker. */
const urlFeatures = new UrlFeatures()
/** OpenStreetMap POIs from Layercake, in one worker, so its footer (~5 MB) is read once per page. */
const layercake = new LayercakeHealth()

/** Every tool the app has, and the one runner for them, so all maps on the board share one cache. */
export const tools = new ToolRunner([
  ...geocodeTools(new OpenCageGeocoder({ url: '/tools/geocode' })),
  populationTool(new SourceCoopPopulation()),
  adminBoundariesTool(new WorldBankBoundaries()),
  overtureTool(new OvertureParquet()),
  healthFacilitiesTool(layercake),
  urlFeaturesTool(urlFeatures),
  uploadFeaturesTool(urlFeatures),
  urlRasterTool(),
  urlTilesTool,
  notebookArtifactTool(notebookFactory),
  notebookRunsTool(notebookFactory),
  eventFootprintTool(monty),
  boundariesTool,
  choroplethTool,
  routeTool(routing),
  exposureTool(new ExposureWorker(), layercake),
])
