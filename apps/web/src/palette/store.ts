import { useSyncExternalStore } from 'react'
import type { TargetRef } from '@geo-canvas/core'
import type { Proposal } from '@geo-canvas/nl'

export interface PaletteState {
  open: boolean
  /** When set, the palette opens on the args form of this op. */
  opId?: string
  target?: TargetRef
  args?: Record<string, unknown>
  /** Text from NL mode or a proposal, shown above the form. */
  note?: string
  /** Proposal id: run approves it instead of a new dispatch. */
  proposalId?: string
  /** Text to start the search with, e.g. 'Add'. */
  query?: string
  /** Page point for new nodes (e.g. where the user double-clicked). */
  at?: { x: number; y: number }
  /** NL request to run (the Ask step). */
  ask?: string
  /** NL proposal that prefilled the form. */
  nl?: Proposal
}

let state: PaletteState = { open: false }
const listeners = new Set<() => void>()

export const palette = {
  get: () => state,
  set(next: PaletteState) {
    state = next
    for (const l of listeners) l()
  },
  open(preset: Omit<PaletteState, 'open'> = {}) {
    palette.set({ open: true, ...preset })
  },
  close() {
    palette.set({ open: false })
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

export function usePalette(): PaletteState {
  return useSyncExternalStore(palette.subscribe, palette.get)
}
