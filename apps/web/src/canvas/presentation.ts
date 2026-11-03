import { useSyncExternalStore } from 'react'

/**
 * Presentation mode in this tab: whether this person presents, whom they follow, and whose prompt they put away.
 * Local, never synced: the canvas shares the presenter's view in presence (board/presence.ts `presenting`) and moves a
 * follower's camera; the chrome (chrome/PresentingBar.tsx, the user menu's Present button) changes this.
 */
export interface Presentation {
  /** When this person started presenting (ms), or null. */
  presenting: number | null
  /** The presence client id of the presenter this person follows, or null. */
  following: number | null
  /** The presenter whose prompt this person shrank with "Not now". */
  dismissed: number | null
}

let state: Presentation = { presenting: null, following: null, dismissed: null }
const listeners = new Set<() => void>()

function set(next: Partial<Presentation>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export const presentation = () => state

export const startPresenting = () => set({ presenting: Date.now(), following: null })
export const stopPresenting = () => set({ presenting: null })
export const follow = (clientId: number) => set({ following: clientId, presenting: null })
export const unfollow = () => state.following !== null && set({ following: null })
export const dismiss = (clientId: number) => set({ dismissed: clientId })

export const usePresentation = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
