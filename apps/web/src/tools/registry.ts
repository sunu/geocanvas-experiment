import { adminBoundariesTool, WorldBankBoundaries } from '../data/boundaries'
import { OvertureParquet, overtureTool } from '../data/buildings'
import { geocodeTools, OpenCageGeocoder } from '@ttx/plugins'
import { populationTool, SourceCoopPopulation } from '../data/population'
import { ToolRunner } from '@ttx/core'

/** Every tool the app has, and the one runner for them, so all maps on the board share one cache. */
export const tools = new ToolRunner([
  ...geocodeTools(new OpenCageGeocoder({ url: '/tools/geocode' })),
  populationTool(new SourceCoopPopulation()),
  adminBoundariesTool(new WorldBankBoundaries()),
  overtureTool(new OvertureParquet()),
])
