import { useEffect, useState, useSyncExternalStore } from 'react'
import { useEditor } from 'tldraw'
import { bboxOf, fitBounds, mapViewport, type MapView } from '@geo-canvas/plugin-core'
import type { NodeRecord } from '@geo-canvas/core'

/**
 * Render scale of maps: the canvas zoom, snapped to half steps of 2^0.5 and applied only after
 * the camera stops. A map renders at (doc zoom + log2 s) in an element s× larger, scaled by 1/s.
 * Result: same geographic extent, normal label size, sharp at any canvas zoom, cheaper when small.
 */
export function useRenderScale(width: number, height: number): number {
  const editor = useEditor()
  const snap = (z: number) => {
    const s = 2 ** (Math.round(Math.log2(z) * 2) / 2)
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    const max = Math.min(4, 4096 / (Math.max(width, height) * dpr))
    return Math.max(0.25, Math.min(max, s))
  }
  const [scale, setScale] = useState(() => snap(editor.getZoomLevel()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setScale(snap(editor.getZoomLevel())), 180)
    }
    update()
    const stop = editor.store.listen(update, { scope: 'session' })
    return () => {
      clearTimeout(timer)
      stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, width, height])
  return scale
}

/** The view a map should show: the shared doc view, else a local fit to the AOI (no write), else the world. */
export function viewOf(node: NodeRecord, aoi: GeoJSON.Feature | undefined): MapView {
  const v = node.props.view as MapView | undefined
  if (v) return v
  if (aoi) return fitBounds(bboxOf(aoi), mapViewport(node.layout))
  return { center: [20, 10], zoom: 1 }
}

// Live camera of maps that a local user is moving now, in doc units (before setView is committed).
// Pinned nodes read it to follow a pan frame by frame.
const live = new Map<string, MapView>()
const listeners = new Set<() => void>()
export const liveViews = {
  get: (id: string) => live.get(id),
  set(id: string, v: MapView | undefined) {
    if (v) live.set(id, v)
    else live.delete(id)
    for (const l of listeners) l()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

export function useLiveView(id: string) {
  return useSyncExternalStore(liveViews.subscribe, () => live.get(id))
}
