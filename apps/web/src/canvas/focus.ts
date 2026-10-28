import { MAX_ZOOM, MIN_ZOOM, type Camera, type Rect } from './camera'

/**
 * In-focus mode's geometry (agent-docs/tasks/in-focus-widgets.md). Entering, the camera zooms until the
 * object fills the area left of the Options panel; then the camera goes to 100% and the object gets
 * that area's size, locally, so it lays out once at native pixels (a sharp map, more table rows)
 * instead of being a scaled-up small box.
 */

/** Width of the Options panel (px), on the right; must match .ttx-options in styles.css. */
export const PANEL_W = 320
/** Margin around the focused object and the panel (px). */
const GAP = 16
const ANIMATION_MS = 250

/** The screen area the focused object fills, in a canvas of w × h. */
export function focusArea(w: number, h: number): Rect {
  return { x: GAP, y: GAP, w: Math.max(1, w - PANEL_W - 3 * GAP), h: Math.max(1, h - 2 * GAP) }
}

/** The camera that shows world rectangle r centered in screen area a, as large as fits. */
export function fillCamera(r: Rect, a: Rect): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(a.w / Math.max(r.w, 1), a.h / Math.max(r.h, 1))))
  return { x: a.x + a.w / 2 - (r.x + r.w / 2) * z, y: a.y + a.h / 2 - (r.y + r.h / 2) * z, z }
}

/** Once in focus: the object's local rectangle (its position, the area's size) and the camera at 100% that puts it on the area. */
export function focusedLayout(r: Rect, a: Rect): { rect: Rect; camera: Camera } {
  return { rect: { x: r.x, y: r.y, w: a.w, h: a.h }, camera: { x: a.x - r.x, y: a.y - r.y, z: 1 } }
}

/** Move the camera from `from` to `to`, easing in and out. Returns a function that stops it where it is. */
export function animateCamera(from: Camera, to: Camera, set: (c: Camera) => void, done?: () => void): () => void {
  const start = performance.now()
  let frame = 0
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ANIMATION_MS)
    const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    set({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k })
    if (t < 1) frame = requestAnimationFrame(step)
    else done?.()
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}
