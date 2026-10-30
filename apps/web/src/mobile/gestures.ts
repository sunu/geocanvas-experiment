import { MAX_ZOOM, MIN_ZOOM, toWorld, type Camera } from '../canvas/camera'

/** A touch point on the screen, relative to the canvas element. */
export interface Point {
  x: number
  y: number
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** One finger: the camera moved by the finger's travel since the gesture started. */
export function pan(start: Camera, from: Point, to: Point): Camera {
  return { ...start, x: start.x + to.x - from.x, y: start.y + to.y - from.y }
}

/**
 * Two fingers: zoom by how far apart they moved, keeping the world point that was between them between them, so
 * moving both fingers also pans, as in a map.
 */
export function pinch(start: Camera, from: [Point, Point], to: [Point, Point]): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (start.z * dist(...to)) / Math.max(1, dist(...from))))
  const held = toWorld(start, mid(...from).x, mid(...from).y)
  const now = mid(...to)
  return { x: now.x - held.x * z, y: now.y - held.y * z, z }
}
