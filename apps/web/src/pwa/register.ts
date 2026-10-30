import { useSyncExternalStore } from 'react'

/**
 * The service worker (sw.js), in production builds only: in dev it would cache what Vite serves. A new version
 * installs in the background and waits; the app offers to reload (UpdateNotice.tsx), and only a reload the person asks
 * for switches, so a tab never runs a mix of two builds against the board.
 */

let waiting: ServiceWorker | undefined
const listeners = new Set<() => void>()

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // Only a switch the person asked for reloads: the first install also takes control (clients.claim), with nothing to reload.
  let switching = false
  navigator.serviceWorker.addEventListener('controllerchange', () => switching && location.reload())
  applyUpdate = () => {
    switching = true
    waiting?.postMessage('skipWaiting')
  }
  addEventListener('load', async () => {
    const registration = await navigator.serviceWorker.register('/sw.js')
    const offer = (worker: ServiceWorker | null) => {
      // With no controller this is the first install: there is no older version to replace.
      if (!worker || !navigator.serviceWorker.controller) return
      waiting = worker
      for (const l of listeners) l()
    }
    offer(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing
      worker?.addEventListener('statechange', () => worker.state === 'installed' && offer(worker))
    })
    // A board can stay open all day: look for a new version every hour.
    setInterval(() => void registration.update(), 60 * 60 * 1000)
  })
}

/** Switch to the waiting version and reload. */
export let applyUpdate = () => {}

/** A new version is ready. */
export const useUpdateReady = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => !!waiting,
  )
