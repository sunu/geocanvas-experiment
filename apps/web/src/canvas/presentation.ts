import { useSyncExternalStore } from 'react'
import { fieldSender, type Awareness, type PresentedMap, type Presenting } from '../board/presence'

/**
 * Presentation mode in this tab: whether this person presents, whom they follow, and whose prompt they put away.
 * Local, never synced; the chrome (chrome/PresentingBar.tsx, the user menu's Present button) changes it. While this person
 * presents, what they see goes out in presence (board/presence.ts `presenting`): the canvas gives its view and the
 * object in focus (presentView), each live map its view when it moves (presentMap), all in one throttled field. While
 * they follow, the canvas hands the presenter's state back (setFollowed) for the maps to follow (useFollowedMap).
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

let send: ((value: Presenting | null) => void) | undefined
/** What this person presents, as the canvas and the maps last gave it. */
let shared: { view?: Presenting['view']; focus?: string; map?: PresentedMap } = {}

/** Where the presenter's state goes: this board's presence. The canvas binds it. */
export function bindPresence(awareness: Pick<Awareness, 'setLocalStateField'>) {
  const mine = fieldSender<Presenting>(awareness, 'presenting')
  send = mine
  return () => {
    if (send === mine) send = undefined
  }
}

function flush() {
  const { view, focus, map } = shared
  if (state.presenting === null || !view) return
  send?.({ view, since: state.presenting, ...(focus && { focus }), ...(map && { map }) })
}

/** Stop sharing: others' prompts go away. */
function unshare() {
  if (state.presenting !== null) send?.(null)
  shared = {}
}

/** The canvas's view in world coordinates, and the object in focus. */
export function presentView(view: Presenting['view'], focus?: string) {
  shared = { ...shared, view, focus }
  flush()
}

/** A live map moved: what it shows now. */
export function presentMap(map: PresentedMap) {
  shared = { ...shared, map }
  flush()
}

export function startPresenting() {
  shared = {}
  set({ presenting: Date.now(), following: null })
}
export function stopPresenting() {
  unshare()
  set({ presenting: null })
}
export function follow(clientId: number) {
  unshare()
  set({ following: clientId, presenting: null })
}
export const unfollow = () => state.following !== null && set({ following: null })
export const dismiss = (clientId: number) => set({ dismissed: clientId })

let followed: Presenting | undefined
const followedListeners = new Set<() => void>()

/** The state of the presenter this person follows, or undefined. */
export function setFollowed(next: Presenting | undefined) {
  if (next === followed) return
  followed = next
  followedListeners.forEach((l) => l())
}

/** The presenter's view of map `id` while this person follows them, or undefined. */
export const followedMap = (id: string) => (followed?.map?.id === id ? followed.map : undefined)

export const useFollowedMap = (id: string) =>
  useSyncExternalStore(
    (l) => (followedListeners.add(l), () => followedListeners.delete(l)),
    () => followedMap(id),
  )

export const usePresentation = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
