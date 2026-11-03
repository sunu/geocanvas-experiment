import { useSyncExternalStore } from 'react'

/**
 * What a focused map shows in this tab: Map (its data, notes and drawings, with the drawing box, DrawingBox.tsx) or, on
 * a route map or a flood exposure map (plans/plan-030.md), its analysis (routes, closures, affected areas, exposure:
 * routing/, exposure/). The Options panel's tabs pick it, and the map shows the toolbar of that mode, so the two sets
 * of tools never mix. Local to the tab, never on the board; forgotten when the map leaves focus, so an analysis map
 * opens on its analysis and a plain map on Map.
 */
export type MapMode = 'map' | 'scenario'

const modes = new Map<string, MapMode>()
const listeners = new Set<() => void>()

/** Pick a mode, or forget the pick (undefined): the map shows its default again. */
export function setMapMode(id: string, mode: MapMode | undefined) {
  if (modes.get(id) === mode) return
  if (mode) modes.set(id, mode)
  else modes.delete(id)
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** The map's mode: what was picked, else `fallback` (its analysis for an analysis map, Map for a plain one). */
export const useMapMode = (id: string, fallback: MapMode): MapMode => useSyncExternalStore(subscribe, () => modes.get(id) ?? fallback)
