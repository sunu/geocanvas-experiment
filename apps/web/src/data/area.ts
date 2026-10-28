import { z } from 'zod'
import type { Bbox } from './geocode'

/**
 * The place an area-based tool works on: a bbox [west, south, east, north]. A map layer stores it
 * when it is added, from the view of the person who adds it. (The old branch also took a polygon,
 * a map's AOI; main's maps have no AOI.)
 */
export const areaSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe('Area: a bbox [west, south, east, north] in degrees')

/** Center of a bbox, [lng, lat]. */
export function areaCenter([w, s, e, n]: Bbox): [number, number] {
  return [(w + e) / 2, (s + n) / 2]
}
