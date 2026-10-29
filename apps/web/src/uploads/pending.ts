import { useSyncExternalStore } from 'react'

/**
 * Files being uploaded from this tab, each drawn on the board as a box where its object will go
 * (PendingUploads.tsx). Local to the tab: others see the object once it is placed.
 */
export interface Pending {
  key: string
  name: string
  /** Where the object will go, in world units. */
  rect: { x: number; y: number; w: number; h: number }
  /** Share of the file sent, 0 to 1; 1 while the object is being placed. */
  progress: number
  /** Why it could not be added; the box stays until dismissed. */
  error?: string
}

let pending: Pending[] = []
const listeners = new Set<() => void>()

function set(next: Pending[]) {
  pending = next
  for (const listener of listeners) listener()
}

export function addPending(p: Omit<Pending, 'key' | 'progress'>): string {
  const key = crypto.randomUUID()
  set([...pending, { ...p, key, progress: 0 }])
  return key
}

export const updatePending = (key: string, patch: Partial<Pending>) => set(pending.map((p) => (p.key === key ? { ...p, ...patch } : p)))

export const removePending = (key: string) => set(pending.filter((p) => p.key !== key))

export function usePending(): Pending[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    () => pending,
  )
}
