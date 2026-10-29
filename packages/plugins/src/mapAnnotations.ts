import { z } from 'zod'

/**
 * Annotations people draw on a map, in the map's `annotations` field. Unlike data layers they are the data: a
 * place and what someone wrote there. Each has a `kind`, so other kinds (markers, shapes) can join stickies
 * without changing the stored format.
 */

/** A sticky note pinned to a place: it stays on that place as each person pans and zooms. */
export const mapSticky = z.object({
  id: z.string(),
  kind: z.literal('sticky'),
  /** [longitude, latitude] in degrees (WGS 84). */
  lngLat: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  text: z.string(),
})
export type MapSticky = z.infer<typeof mapSticky>

export const mapAnnotation = z.discriminatedUnion('kind', [mapSticky])
export type MapAnnotation = z.infer<typeof mapAnnotation>
