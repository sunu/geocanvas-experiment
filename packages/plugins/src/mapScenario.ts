import { z } from 'zod'

/**
 * A map's scenario, in its optional `scenario` field: what people plan on the map in its Scenario mode. Routes are
 * recipes, like data layers: each browser finds the path itself, on Overture's road network, going around the
 * closures that are on and the features of the map's layers marked `blocks` (apps/web/src/routing/). Closures are
 * places people say are impassable, what-ifs or reports; a closure can be switched off to compare without it.
 * The whole scenario is written at once, like `layers`. Later analyses (facilities, access to them) join as fields.
 */

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

export const ROUTE_PROFILES = ['car', 'truck'] as const
export type RouteProfile = (typeof ROUTE_PROFILES)[number]

/**
 * Colors a route can have, by name. Not red (closures), not the data layers' blue, and not cyan or violet, which
 * mark yourself and the agent on the board (plans/plan-011.md).
 */
export const ROUTE_COLORS = { orange: '#ea580c', emerald: '#059669', pink: '#db2777', indigo: '#4f46e5', amber: '#b45309', slate: '#475569' } as const
export type RouteColor = keyof typeof ROUTE_COLORS

/** Routing reads the roads of an area around a route; this caps the distance between its ends. */
export const MAX_ROUTE_KM = 40

export const scenarioRoute = z.object({
  id: z.string(),
  title: z.string(),
  /** [longitude, latitude] in degrees (WGS 84). */
  from: position,
  to: position,
  profile: z.enum(ROUTE_PROFILES),
  color: z.enum(Object.keys(ROUTE_COLORS) as [RouteColor, ...RouteColor[]]),
})
export type ScenarioRoute = z.infer<typeof scenarioRoute>

/**
 * The shape of a closure: a point closes the roads within 25 m of it (a collapsed bridge, a landslide), a line the
 * roads that run along it (not those that cross it), a polygon every road inside it (apps/web/src/routing/closures.ts).
 */
export const closureGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position).min(4)).min(1) }),
])
export type ClosureGeometry = z.infer<typeof closureGeometry>

export const scenarioClosure = z.object({
  id: z.string(),
  geometry: closureGeometry,
  /** Why, e.g. "bridge down". */
  note: z.string().optional(),
  /** Switched off: drawn faded, and routes ignore it. */
  off: z.literal(true).optional(),
})
export type ScenarioClosure = z.infer<typeof scenarioClosure>

/** The return periods (years) of the GloFAS river flood hazard maps, which give flood depth (plans/plan-016.md). */
export const RETURN_PERIODS = [10, 20, 50, 75, 100, 200, 500] as const
export type ReturnPeriod = (typeof RETURN_PERIODS)[number]

/**
 * Which exposure counts the scenario shows: `buildings`, the buildings in its flood areas (the polygons of the closures
 * that are on and of the layers that block roads), with the health facilities and schools among them; with
 * `returnPeriod`, also the depth of a flood of that return period at each, from the GloFAS maps, and the damage it
 * would do. Each browser counts them (apps/web/src/exposure/, apps/web/src/inundation/); the board stores only what
 * to count. Optional: scenarios made before it have none.
 */
export const scenarioExposure = z.object({
  buildings: z.boolean(),
  returnPeriod: z.union(RETURN_PERIODS.map((r) => z.literal(r))).optional(),
})
export type ScenarioExposure = z.infer<typeof scenarioExposure>

export const mapScenario = z.object({ routes: z.array(scenarioRoute), closures: z.array(scenarioClosure), exposure: scenarioExposure.optional() })
export type MapScenario = z.infer<typeof mapScenario>

/** The first color no route uses yet, or the least used one. */
export function nextRouteColor(routes: ScenarioRoute[]): RouteColor {
  const colors = Object.keys(ROUTE_COLORS) as RouteColor[]
  const uses = (c: RouteColor) => routes.filter((r) => r.color === c).length
  return colors.reduce((best, c) => (uses(c) < uses(best) ? c : best), colors[0]!)
}
