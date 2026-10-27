import { geocodeTools, OpenCageGeocoder } from '../data/geocode'
import { ToolRunner } from './runner'

/** Every tool the app has, and the one runner for them, so all maps on the board share one cache. */
export const tools = new ToolRunner([...geocodeTools(new OpenCageGeocoder())])
