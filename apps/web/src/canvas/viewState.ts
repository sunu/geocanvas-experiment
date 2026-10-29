import { useSyncExternalStore } from 'react'

/** What the canvas tells the chrome around it: the zoom to show, and whether an object is open in focus mode. */
interface ViewState {
  zoom: number
  focused: boolean
}

let state: ViewState = { zoom: 1, focused: false }
const listeners = new Set<() => void>()

/** The canvas owns the camera; it publishes the parts the user menu shows. */
export function publishViewState(next: ViewState) {
  if (next.zoom === state.zoom && next.focused === state.focused) return
  state = next
  listeners.forEach((l) => l())
}

export const useViewState = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
