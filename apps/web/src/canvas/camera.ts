/**
 * The canvas camera: screen = world × z + (x, y). It is local to each person and never synced.
 * Screen points are relative to the canvas element.
 */
export interface Camera {
  x: number
  y: number
  z: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function toWorld(cam: Camera, sx: number, sy: number) {
  return { x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z }
}

export function toScreen(cam: Camera, r: Rect): Rect {
  return { x: r.x * cam.z + cam.x, y: r.y * cam.z + cam.y, w: r.w * cam.z, h: r.h * cam.z }
}

/** Zoom by `factor`, keeping the world point under the screen point (sx, sy) in place. */
export function zoomAt(cam: Camera, factor: number, sx: number, sy: number): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.z * factor))
  const w = toWorld(cam, sx, sy)
  return { x: sx - w.x * z, y: sy - w.y * z, z }
}

/** The rectangle spanned by two corner points, whichever way round they are. */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
