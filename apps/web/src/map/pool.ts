import { useSyncExternalStore } from 'react'
import { subscribeViewport, viewport } from '../canvas/viewport'
import { liveMaps } from './budget'

/**
 * The maps of this tab that have a live MapLibre map now (budget.ts), worked out again when the viewport changes.
 * A map's view listens only to its own flag, so a camera move re-renders a map only when it changes between live
 * and snapshot.
 */

let live = new Set<string>()
const listeners = new Set<() => void>()

subscribeViewport(() => {
  const next = liveMaps(viewport())
  if (next.size === live.size && [...next].every((id) => live.has(id))) return
  live = next
  for (const l of listeners) l()
})

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Whether the map `id` has a live map now. */
export const useLiveMap = (id: string) => useSyncExternalStore(subscribe, () => live.has(id))
