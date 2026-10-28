import { z } from 'zod'
import { defineTool } from '../tools/tool'
import { areaSchema } from './area'
import type { Bbox } from './geocode'
import { bboxAreaDeg2, OVERTURE_ATTRIBUTION, OVERTURE_LIMITS, type OvertureType } from './overture'
import type { OvertureRequest, OvertureResponse } from './overture.worker'

/** Overture Maps data read by type. */
export interface OvertureSource {
  /** Features in the area's bbox, at most `limit`; `truncated` when more match. */
  query(type: OvertureType, area: Bbox, opts: { limit: number; signal?: AbortSignal }): Promise<GeoJSON.FeatureCollection & { truncated?: boolean }>
}

/**
 * Overture Maps data read in the browser. The reader (hyparquet) runs in a worker that is started
 * on the first query, so it adds nothing to the main bundle, and STAC and footers are kept per page.
 */
export class OvertureParquet implements OvertureSource {
  private worker?: Worker
  private nextId = 0
  private pending = new Map<number, (res: OvertureResponse) => void>()

  private start(): Worker {
    const w = new Worker(new URL('./overture.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<OvertureResponse>) => {
      this.pending.get(data.id)?.(data)
      this.pending.delete(data.id)
    }
    return w
  }

  async query(type: OvertureType, area: Bbox, opts: { limit: number; signal?: AbortSignal }) {
    opts.signal?.throwIfAborted()
    const worker = (this.worker ??= this.start())
    const id = this.nextId++
    const post = (msg: OvertureRequest) => worker.postMessage(msg)
    // An abort stops the worker's downloads for this query.
    const onAbort = () => post({ kind: 'abort', id })
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await new Promise<OvertureResponse>((resolve) => {
        this.pending.set(id, resolve)
        post({ kind: 'query', id, type, bbox: area, limit: opts.limit })
      })
      opts.signal?.throwIfAborted()
      if (!res.ok) throw new Error(res.error)
      return res.value
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }
}

/** The Overture tool, on top of a source (S3 through a worker in the app, a fake in tests). */
export function overtureTool(source: OvertureSource) {
  return defineTool({
    id: 'data.overture',
    title: 'Overture data',
    description:
      'Overture Maps data in an area, by type. Only type "buildings" for now: building footprints as polygons ' +
      '(mostly from OpenStreetMap, plus ML-derived footprints). Properties: id (Overture GERS id), name, ' +
      'subtype (e.g. residential, commercial, education), class (e.g. house, school), height (m), num_floors; ' +
      'most are null outside large cities. Buildings whose bbox intersects the area bbox are returned. ' +
      `Limits: the area must be at most ${OVERTURE_LIMITS.buildings.maxAreaDeg2} square degrees (about 11 × 11 km at ` +
      `the equator), and at most ${OVERTURE_LIMITS.buildings.maxFeatures.toLocaleString('en')} buildings are returned ` +
      '(then truncated is true). Use it for a town or a city district, not a region.',
    input: z.object({
      type: z.enum(['buildings']).default('buildings').describe('Overture data type (only buildings for now)'),
      area: areaSchema,
    }),
    output: 'geo.features',
    async run({ type, area }, ctx) {
      const { maxAreaDeg2, maxFeatures } = OVERTURE_LIMITS[type]
      // Fail before any download: an area from a zoomed-out view would read hundreds of MB.
      if (bboxAreaDeg2(area) > maxAreaDeg2) throw new Error(`Area too large for ${type}: zoom in, then use your view for this layer`)
      const fc = await source.query(type, area, { limit: maxFeatures, signal: ctx.signal })
      return { ...fc, attribution: OVERTURE_ATTRIBUTION[type] }
    },
  })
}
