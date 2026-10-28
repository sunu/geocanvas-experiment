import { adminBoundariesTool, WorldBankBoundaries } from '../data/boundaries'
import { OvertureParquet, overtureTool } from '../data/buildings'
import { geocodeTools, OpenCageGeocoder } from '../data/geocode'
import { healthFacilitiesTool, LayercakeHealth } from '../data/health'
import { populationTool, SourceCoopPopulation } from '../data/population'
import { notebookFactory } from '../notebooks/api'
import { notebookArtifactTool } from '../notebooks/artifact'
import { ToolRunner } from './runner'

/** Every tool the app has, and the one runner for them, so all maps on the board share one cache. */
export const tools = new ToolRunner([
  ...geocodeTools(new OpenCageGeocoder()),
  populationTool(new SourceCoopPopulation()),
  adminBoundariesTool(new WorldBankBoundaries()),
  overtureTool(new OvertureParquet()),
  healthFacilitiesTool(new LayercakeHealth()),
  notebookArtifactTool(notebookFactory),
])
