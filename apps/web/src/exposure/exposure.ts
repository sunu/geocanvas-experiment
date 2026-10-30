import { z } from 'zod'
import { defineTool } from '@ttx/core'
import type { Bbox } from '@ttx/plugins'
import { LAYERCAKE_ATTRIBUTION, type FacilityProps } from '../data/layercake'
import { OVERTURE_ATTRIBUTION } from '../data/overture'
import { RETURN_PERIODS } from '@ttx/plugins'
import { DAMAGE_ATTRIBUTION } from '../inundation/damage'
import { GLOFAS_ATTRIBUTION } from '../inundation/glofas'
import { Flood, floodPolygons } from './areas'
import type { ExposureRequest, ExposureResponse, ExposureResult } from './exposure.worker'

/** Counts buildings in flood areas, with a flood's depth and damage when given a return period; and depth at places. */
export interface BuildingSource {
  count(areas: GeoJSON.Geometry[], returnPeriod: number | undefined, signal?: AbortSignal): Promise<ExposureResult>
  depths(points: number[], returnPeriod: number, signal?: AbortSignal): Promise<Float32Array>
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

  count(areas: GeoJSON.Geometry[], returnPeriod: number | undefined, signal?: AbortSignal) {
    return this.ask({ kind: 'count', areas, returnPeriod }, signal) as Promise<ExposureResult>
  }

  depths(points: number[], returnPeriod: number, signal?: AbortSignal) {
    return this.ask({ kind: 'depths', points, returnPeriod }, signal) as Promise<Float32Array>
  }

  private async ask(request: { kind: 'count'; areas: GeoJSON.Geometry[]; returnPeriod?: number } | { kind: 'depths'; points: number[]; returnPeriod: number }, signal?: AbortSignal) {
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
        post({ ...request, id } as ExposureRequest)
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

export interface Exposure extends ExposureResult {
  /** The health facilities and places of education in the flood areas, from OpenStreetMap; with a return period, the depth (m) at each. */
  facilities: GeoJSON.Feature<GeoJSON.Point, FacilityProps & { depth?: number }>[]
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
      'OpenStreetMap health facilities and places of education (schools, colleges) inside, with their names. With a return ' +
      'period, also the water depth at each building and facility in a river flood of that size (GloFAS hazard maps, 90 m: ' +
      'a model, not a given event) and the damage it would do (JRC depth-damage functions): flooded buildings by depth ' +
      'class and damage band, and the damage shares summed. Areas up to about half a square degree; a country-wide area ' +
      'fails as too large. Takes 5–30 s the first time.',
    input: z.object({
      areas: z.array(geometry).describe('Flood areas, GeoJSON geometries'),
      returnPeriod: z
        .union(RETURN_PERIODS.map((r) => z.literal(r)))
        .optional()
        .describe('Return period (years) of a river flood, for depth and damage'),
    }),
    output: EXPOSURE_OUTPUT,
    async run({ areas, returnPeriod }, ctx): Promise<Exposure> {
      const geometries = areas as GeoJSON.Geometry[]
      const flood = new Flood(floodPolygons(geometries))
      if (!flood.bounds) throw new Error('No flood areas: only polygons count')
      const [counts, pois] = await Promise.all([
        buildings.count(geometries, returnPeriod, ctx.signal),
        facilities.facilities(flood.bounds, { signal: ctx.signal }).then(
          (fc) => ({ features: fc.features.filter((f) => flood.contains(f.geometry.coordinates[0]!, f.geometry.coordinates[1]!)) }),
          (err: Error) => ({ error: err.message }),
        ),
      ])
      let found: Exposure['facilities'] = 'features' in pois ? pois.features : []
      if (returnPeriod && found.length) {
        const depths = await buildings.depths(found.flatMap((f) => f.geometry.coordinates.slice(0, 2)), returnPeriod, ctx.signal)
        found = found.map((f, i) => ({ ...f, properties: { ...f.properties, depth: depths[i]! } }))
      }
      return {
        ...counts,
        facilities: found,
        ...('error' in pois && { facilitiesError: pois.error }),
        attribution: [OVERTURE_ATTRIBUTION.buildings, LAYERCAKE_ATTRIBUTION, ...(returnPeriod ? [GLOFAS_ATTRIBUTION, DAMAGE_ATTRIBUTION] : [])].join('; '),
      }
    },
  })
}
