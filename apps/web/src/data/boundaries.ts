import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { areaSchema } from './area'
import type { Bbox } from '@ttx/plugins'
import { WORLD_BANK_ATTRIBUTION } from './worldBank'
import type { Admin0Request, Admin0Response } from './worldBankAdmin0.worker'

/** Admin boundaries, World Bank level 0 (country) only for now. */
export interface BoundarySource {
  query(level: 0, area: Bbox, opts?: { signal?: AbortSignal }): Promise<GeoJSON.FeatureCollection & { truncated?: boolean }>
}

/**
 * World Bank admin 0 boundaries read in the browser. The reader (hyparquet) runs in a worker that
 * is started on the first query, so it adds nothing to the main bundle and one table is kept per page.
 */
export class WorldBankBoundaries implements BoundarySource {
  private worker?: Worker
  private nextId = 0
  private pending = new Map<number, (res: Admin0Response) => void>()

  private start(): Worker {
    const w = new Worker(new URL('./worldBankAdmin0.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<Admin0Response>) => {
      this.pending.get(data.id)?.(data)
      this.pending.delete(data.id)
    }
    return w
  }

  async query(level: 0, area: Bbox, opts?: { signal?: AbortSignal }): Promise<GeoJSON.FeatureCollection> {
    if (level !== 0) throw new Error('Only admin level 0 (countries) is available')
    this.worker ??= this.start()
    const id = this.nextId++
    const res = await new Promise<Admin0Response>((resolve) => {
      this.pending.set(id, resolve)
      this.worker!.postMessage({ id, bbox: area } satisfies Admin0Request)
    })
    opts?.signal?.throwIfAborted()
    if (!res.ok) throw new Error(res.error)
    return res.value
  }
}

/** The admin boundaries tool, on top of a source (World Bank in the app, a fake in tests). */
export function adminBoundariesTool(source: BoundarySource) {
  return defineTool({
    id: 'data.adminBoundaries',
    title: 'Admin boundaries',
    description:
      'World Bank official country boundaries (admin 0) that intersect an area, as polygons. ' +
      'Only level 0 (countries) for now. Properties: iso3, name, region (World Bank region code), status, level. ' +
      'A country is included when the bbox of one of its polygons intersects the area bbox, so large neighbours can appear.',
    input: z.object({
      level: z.number().int().min(0).max(0).default(0).describe('Admin level: 0 country (the only level for now)'),
      area: areaSchema,
    }),
    output: 'geo.features',
    async run({ level, area }, ctx) {
      const fc = await source.query(level as 0, area, { signal: ctx.signal })
      return { ...fc, attribution: WORLD_BANK_ATTRIBUTION }
    },
  })
}
