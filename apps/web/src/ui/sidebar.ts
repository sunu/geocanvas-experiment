import { useSyncExternalStore } from 'react'

/** Open state of the right sidebar. Kept per browser in localStorage. */
const KEY = 'gc-sidebar-open'
let open = (() => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
})()
const listeners = new Set<() => void>()

export const sidebar = {
  get: () => open,
  toggle() {
    open = !open
    try {
      localStorage.setItem(KEY, open ? '1' : '0')
    } catch {}
    for (const l of listeners) l()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

export function useSidebarOpen() {
  return useSyncExternalStore(sidebar.subscribe, sidebar.get)
}
