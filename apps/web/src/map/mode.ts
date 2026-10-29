import { useSyncExternalStore } from 'react'

/**
 * What a focused map is for in this tab: Map (its data, notes and drawings, with the drawing box, DrawingBox.tsx) or Scenario
 * (routes and road closures, routing/). The Options panel's tabs pick it, and the map shows the toolbar of that
 * mode, so the two sets of tools never mix. Local to the tab, never on the board; a map leaves Scenario mode when
 * it leaves focus.
 */
export type MapMode = 'map' | 'scenario'

const modes = new Map<string, MapMode>()
const listeners = new Set<() => void>()

export function setMapMode(id: string, mode: MapMode) {
  if ((modes.get(id) ?? 'map') === mode) return
  if (mode === 'map') modes.delete(id)
  else modes.set(id, mode)
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const useMapMode = (id: string): MapMode => useSyncExternalStore(subscribe, () => modes.get(id) ?? 'map')
