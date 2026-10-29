import { z } from 'zod'
import { defineTool } from '@ttx/core'
import type { Bbox } from '@ttx/plugins'
import { LAYERCAKE_ATTRIBUTION, type FacilityProps } from '../data/layercake'
import { OVERTURE_ATTRIBUTION } from '../data/overture'
import { Flood, floodPolygons, type BuildingCounts } from './areas'
import type { ExposureRequest, ExposureResponse } from './exposure.worker'

/** Counts buildings in flood areas. */
export interface BuildingSource {
  count(areas: GeoJSON.Geometry[], signal?: AbortSignal): Promise<BuildingCounts>
}

/** Health facilities and places of education in an area, as points. */
export interface FacilitySource {
  facilities(area: Bbox, opts?: { signal?: AbortSignal }): Promise<GeoJSON.FeatureCollection<GeoJSON.Point, FacilityProps>>
}

/** Buildings counted in a worker (exposure.worker.ts), started on the first count. */
export class ExposureWorker implements BuildingSource {
  private worker?: Worker
  private nextId = 0
  private pending = new Map<number, (res: ExposureResponse) => void>()

  private start(): Worker {
    const w = new Worker(new URL('./exposure.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<ExposureResponse>) => {
      this.pending.get(data.id)?.(data)
      this.pending.delete(data.id)
    }
    return w
  }

  async count(areas: GeoJSON.Geometry[], signal?: AbortSignal): Promise<BuildingCounts> {
    signal?.throwIfAborted()
    const worker = (this.worker ??= this.start())
    const id = this.nextId++
    const post = (msg: ExposureRequest) => worker.postMessage(msg)
    // An abort stops the worker's downloads for this count.
    const onAbort = () => post({ kind: 'abort', id })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await new Promise<ExposureResponse>((resolve) => {
        this.pending.set(id, resolve)
        post({ kind: 'count', id, areas })
      })
      signal?.throwIfAborted()
      if (!res.ok) throw new Error(res.error)
      return res.value
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** Output kind of the exposure tool: an Exposure. */
export const EXPOSURE_OUTPUT = 'exposure.counts'

export interface Exposure extends BuildingCounts {
  /** The health facilities and places of education in the flood areas, from OpenStreetMap. */
  facilities: GeoJSON.Feature<GeoJSON.Point, FacilityProps>[]
  /** Why the facilities could not be read (e.g. the area is too large for them); the building count stands. */
  facilitiesError?: string
  attribution: string
}

/** Any GeoJSON geometry but a collection; only polygons count. */
const geometry = z.object({
  type: z.enum(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']),
  coordinates: z.array(z.unknown()),
})

/** The exposure tool, on top of its sources (workers in the app, fakes in tests). */
export function exposureTool(buildings: BuildingSource, facilities: FacilitySource) {
  return defineTool({
    id: 'exposure.buildings',
    title: 'Buildings in flood areas',
    description:
      'Counts the buildings in flood areas (GeoJSON polygons; points and lines are left out): Overture buildings whose ' +
      'bbox center is inside a polygon, with how many Overture gives each subtype (mostly none outside cities), and the ' +
      "OpenStreetMap health facilities and places of education (schools, colleges) inside, with their names. Exposure, not " +
      'damage. Areas up to about half a square degree; a country-wide area fails as too large. Takes 5–30 s the first time.',
    input: z.object({ areas: z.array(geometry).describe('Flood areas, GeoJSON geometries') }),
    output: EXPOSURE_OUTPUT,
    async run({ areas }, ctx): Promise<Exposure> {
      const geometries = areas as GeoJSON.Geometry[]
      const flood = new Flood(floodPolygons(geometries))
      if (!flood.bounds) throw new Error('No flood areas: only polygons count')
      const [counts, pois] = await Promise.all([
        buildings.count(geometries, ctx.signal),
        facilities.facilities(flood.bounds, { signal: ctx.signal }).then(
          (fc) => ({ features: fc.features.filter((f) => flood.contains(f.geometry.coordinates[0]!, f.geometry.coordinates[1]!)) }),
          (err: Error) => ({ error: err.message }),
        ),
      ])
      return {
        ...counts,
        facilities: 'features' in pois ? pois.features : [],
        ...('error' in pois && { facilitiesError: pois.error }),
        attribution: `${OVERTURE_ATTRIBUTION.buildings}; ${LAYERCAKE_ATTRIBUTION}`,
      }
    },
  })
}
