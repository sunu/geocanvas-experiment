import { useSyncExternalStore } from 'react'
import { NEWS } from './entries'

/** The newest entry's date this browser has opened What's new on. Only in localStorage: it is a convenience, not board state. */
const KEY = 'ttx/whatsnew'

const listeners = new Set<() => void>()

function seen(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null // blocked storage: the dot shows until the dialog is opened in this page
  }
}

let session: string | null | undefined

/** Whether an entry dated `latest` is news to someone who last opened the dialog at `seenDate`. Dates are YYYY-MM-DD. */
export function isUnseen(seenDate: string | null, latest: string | undefined): boolean {
  return !!latest && (!seenDate || latest > seenDate)
}

/** Opening What's new marks every entry seen. */
export function markNewsSeen() {
  const latest = NEWS[0]?.date
  if (!latest) return
  session = latest
  try {
    localStorage.setItem(KEY, latest)
  } catch {
    // Blocked or full: the page's own memory (session) still hides the dot until a reload.
  }
  for (const l of listeners) l()
}

/** There is an entry this browser has not opened yet. */
export const useNewsUnseen = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => isUnseen(session ?? seen(), NEWS[0]?.date),
  )
