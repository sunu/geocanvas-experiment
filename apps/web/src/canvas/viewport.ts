import type { BoardObject } from '../board/board'
import type { Camera } from './camera'

/**
 * What this person sees on the canvas, for object views that must ration something by what is on screen (map/pool.ts
 * gives a live WebGL map only to the maps that need one). Local, like the camera. The canvas publishes it after each
 * render; listeners are called only when it changed.
 */
export interface Viewport {
  camera: Camera
  /** Canvas size, px. */
  width: number
  height: number
  objects: BoardObject[]
  selected: ReadonlySet<string>
  editing: string | null
  focused: string | null
}

let current: Viewport = { camera: { x: 0, y: 0, z: 1 }, width: 0, height: 0, objects: [], selected: new Set(), editing: null, focused: null }
const listeners = new Set<() => void>()

export const viewport = () => current

export function subscribeViewport(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function publishViewport(next: Viewport) {
  const c = current
  if (
    c.camera === next.camera &&
    c.width === next.width &&
    c.height === next.height &&
    c.objects === next.objects &&
    c.selected === next.selected &&
    c.editing === next.editing &&
    c.focused === next.focused
  )
    return
  current = next
  for (const l of listeners) l()
}
