import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { ROUTE_PROFILES } from '@ttx/plugins'
import { OVERTURE_ATTRIBUTION } from '../data/overture'
import type { RouteOutcome } from './route'
import type { NearRoad, RouteQuery, RoutingAsk, RoutingRequest, RoutingResponse } from './routing.worker'

export type { RouteOutcome } from './route'
export type { NearRoad } from './routing.worker'

/** Finds routes. */
export interface RoutingSource {
  route(query: RouteQuery, signal?: AbortSignal): Promise<RouteOutcome>
}

/**
 * Routes found in a worker (routing.worker.ts), started on the first route, so the reader and the road networks stay
 * out of the main thread and bundle. An abort only stops waiting: the worker still finishes, and keeps the road
 * network for the next route.
 */
export class RoutingWorker implements RoutingSource {
  private worker?: Worker
  private nextId = 0
  private pending = new Map<number, (res: RoutingResponse) => void>()

  private start(): Worker {
    const w = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }: MessageEvent<RoutingResponse>) => {
      this.pending.get(data.id)?.(data)
      this.pending.delete(data.id)
    }
    return w
  }

  route(query: RouteQuery, signal?: AbortSignal): Promise<RouteOutcome> {
    return this.ask({ kind: 'route', query }, signal) as Promise<RouteOutcome>
  }

  /** The stretch of road nearest a place, within `maxMeters`, or null. */
  nearRoad(at: [number, number], maxMeters: number): Promise<NearRoad | null> {
    return this.ask({ kind: 'nearRoad', at, maxMeters }) as Promise<NearRoad | null>
  }

  private async ask(request: RoutingAsk, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const worker = (this.worker ??= this.start())
    const id = this.nextId++
    const res = await new Promise<RoutingResponse>((resolve, reject) => {
      this.pending.set(id, resolve)
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      worker.postMessage({ id, ...request } satisfies RoutingRequest)
    })
    if (!res.ok) throw new Error(res.error)
    return res.value
  }
}

/** The one routing worker of the tab: routes, and roads to close. */
export const routing = new RoutingWorker()

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

/** Any GeoJSON geometry but a collection; its coordinates are checked where they are used (closures.ts). */
const geometry = z.object({
  type: z.enum(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']),
  coordinates: z.array(z.unknown()),
})

/** Output kind of the route tool: a RouteOutcome. */
export const ROUTE_OUTPUT = 'routing.route'

/** The route tool, on top of a source (the worker in the app, a fake in tests). */
export function routeTool(source: RoutingSource) {
  return defineTool({
    id: 'routing.route',
    title: 'Route',
    description:
      "The fastest route by road between two places at most 40 km apart, on Overture's road network (from OpenStreetMap), " +
      'with the given road closures: a Point closes the roads within 25 m of it, a LineString the roads that run along it, ' +
      'a Polygon every road inside it. Gives the path, its length (meters), travel time (seconds), the named roads it uses ' +
      'most, and how far each place is from the road it starts on (offRoad, meters); or ok: false and why (e.g. the ' +
      'destination is cut off). Compare with and without closures to see the detour. The first route in an area reads its ' +
      'roads (up to about 30 s); later ones take milliseconds.',
    input: z.object({
      from: position.describe('Start, [longitude, latitude]'),
      to: position.describe('End, [longitude, latitude]'),
      profile: z.enum(ROUTE_PROFILES).default('car').describe('car, or truck: slower, and keeps off roads closed to heavy vehicles'),
      closures: z.array(geometry).default([]).describe('Road closures, GeoJSON geometries'),
    }),
    output: ROUTE_OUTPUT,
    async run(input, ctx) {
      const outcome = await source.route({ ...input, closures: input.closures as GeoJSON.Geometry[] }, ctx.signal)
      return { ...outcome, attribution: OVERTURE_ATTRIBUTION.segments }
    },
  })
}
