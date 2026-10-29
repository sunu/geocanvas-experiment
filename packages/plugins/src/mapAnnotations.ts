import { z } from 'zod'

/**
 * Annotations people draw on a map, in the map's `annotations` field. Unlike data layers they are the data: a
 * place and what someone wrote there, or a shape someone drew. Each has a `kind`, so further kinds can join
 * without changing the stored format.
 */

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

/** A sticky note pinned to a place: it stays on that place as each person pans and zooms. */
export const mapSticky = z.object({
  id: z.string(),
  kind: z.literal('sticky'),
  /** [longitude, latitude] in degrees (WGS 84). */
  lngLat,
  text: z.string(),
})
export type MapSticky = z.infer<typeof mapSticky>

/** Shapes the drawing box offers. */
export const SHAPES = ['arrow', 'line', 'rectangle', 'circle', 'polygon', 'freehand'] as const
export type Shape = (typeof SHAPES)[number]

/** Colors a shape can have, by name as the canvas stores colors; red first, apart from the data layers' blue. */
export const SHAPE_COLORS = { red: '#dc2626', orange: '#ea580c', yellow: '#ca8a04', green: '#16a34a', blue: '#2563eb', black: '#18181b' } as const
export type ShapeColor = keyof typeof SHAPE_COLORS

/** How many points each shape takes: [min, max]. A circle is its center and a point on its edge. */
export const SHAPE_POINTS: Record<Shape, [number, number]> = {
  arrow: [2, 2],
  line: [2, 2],
  rectangle: [2, 2],
  circle: [2, 2],
  polygon: [3, 500],
  freehand: [2, 2000],
}

/** A shape drawn on the map, by its points in degrees: arrows point from the first to the last. */
export const mapShape = z.object({
  id: z.string(),
  kind: z.literal('shape'),
  shape: z.enum(SHAPES),
  points: z.array(lngLat).min(2).max(2000),
  color: z.enum(Object.keys(SHAPE_COLORS) as [ShapeColor, ...ShapeColor[]]),
})
export type MapShape = z.infer<typeof mapShape>

export const mapAnnotation = z.discriminatedUnion('kind', [mapSticky, mapShape])
export type MapAnnotation = z.infer<typeof mapAnnotation>

// ---------- Geometry ----------

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI
/** Web mercator, as the map draws: an arrowhead keeps its shape on screen. */
const toMerc = ([lng, lat]: number[]) => [rad(lng!), Math.log(Math.tan(Math.PI / 4 + rad(lat!) / 2))]
const fromMerc = ([x, y]: number[]): [number, number] => [deg(x!), deg(2 * Math.atan(Math.exp(y!)) - Math.PI / 2)]

/** Distance in meters between two points (haversine). */
export function distanceM([lng1, lat1]: number[], [lng2, lat2]: number[]): number {
  const a = Math.sin(rad(lat2! - lat1!) / 2) ** 2 + Math.cos(rad(lat1!)) * Math.cos(rad(lat2!)) * Math.sin(rad(lng2! - lng1!) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

const CIRCLE_STEPS = 64

/** The ring of a circle on the ground around `center`, through `edge`. */
function circleRing(center: number[], edge: number[]): [number, number][] {
  const d = distanceM(center, edge) / R
  const [lng, lat] = [rad(center[0]!), rad(center[1]!)]
  const ring: [number, number][] = []
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const b = (2 * Math.PI * (i % CIRCLE_STEPS)) / CIRCLE_STEPS
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b))
    const lng2 = lng + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2))
    ring.push([deg(lng2), deg(lat2)])
  }
  return ring
}

/** An arrowhead at the end of the segment a→b: a triangle a quarter of the segment long, 30° each side. */
function arrowhead(a: number[], b: number[]): [number, number][] {
  const [ax, ay] = toMerc(a) as [number, number]
  const [bx, by] = toMerc(b) as [number, number]
  const len = Math.hypot(bx - ax, by - ay)
  const head = len / 4
  const angle = Math.atan2(by - ay, bx - ax)
  const side = (s: number) => fromMerc([bx - head * Math.cos(angle + s), by - head * Math.sin(angle + s)])
  return [fromMerc([bx, by]), side(Math.PI / 6), side(-Math.PI / 6), fromMerc([bx, by])]
}

/**
 * What a shape is drawn as: lines, and areas with a light fill, or a solid one for an arrowhead. GeoJSON features,
 * written out: this package does not load the GeoJSON types.
 */
export interface ShapePart {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] }
  properties: { color: string; fill: 'none' | 'light' | 'solid' }
}

/** The features that draw a shape: the map, the drawing preview and snapshots all use these. */
export function shapeFeatures(shape: Shape, points: [number, number][], color: string): ShapePart[] {
  const line = (coordinates: [number, number][]): ShapePart => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { color, fill: 'none' } })
  const area = (ring: [number, number][], fill: 'light' | 'solid' = 'light'): ShapePart => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { color, fill } })
  const [a, b] = [points[0]!, points.at(-1)!]
  switch (shape) {
    case 'line':
    case 'freehand':
      return [line(points)]
    case 'arrow':
      return a[0] === b[0] && a[1] === b[1] ? [] : [line([a, b]), area(arrowhead(a, b), 'solid')]
    case 'rectangle':
      return [area([a, [b[0], a[1]], b, [a[0], b[1]], a])]
    case 'circle':
      return [area(circleRing(a, b))]
    case 'polygon':
      return points.length < 3 ? [line(points)] : [area([...points, a])]
  }
}
