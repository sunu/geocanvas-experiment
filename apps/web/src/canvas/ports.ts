import { useSyncExternalStore } from 'react'

export const HEADER_H = 34
const PORT_TOP = 52
const PORT_GAP = 24

/** Position of a port dot, relative to the node's top-left corner. */
export function portOffset(side: 'in' | 'out', index: number, width: number) {
  return { x: side === 'in' ? 0 : width, y: PORT_TOP + index * PORT_GAP }
}

export interface PendingLink {
  nodeId: string
  port: string
  type: string
}

let pending: PendingLink | null = null
const listeners = new Set<() => void>()

export const linking = {
  get: () => pending,
  set(p: PendingLink | null) {
    pending = p
    for (const l of listeners) l()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

export function usePendingLink() {
  return useSyncExternalStore(linking.subscribe, linking.get)
}
