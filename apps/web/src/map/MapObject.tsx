import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, setWorkerUrl, type IControl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { ObjectViewProps } from '../canvas/registry'
import { Views } from '@ttx/core'
import { BASEMAPS, type Basemap, type MapBoardObject } from '@ttx/plugins'
import { basemapStyle } from './basemaps'

// MapLibre 6 finds its worker relative to its own module at runtime, which a bundle breaks: let Vite
// build the worker (?worker&url) and point MapLibre at it. MapLibre 6 also draws right-to-left
// labels (Arabic, Hebrew) itself, so no RTL plugin is needed.
setWorkerUrl(workerUrl)

/** Where a map starts for a person who has no view of it and nobody else has one either. */
const WORLD = { center: [20, 10] as [number, number], zoom: 1, bearing: 0 }
/** A view is saved this long after the map stops moving, so a series of pans is one write. */
const SAVE_AFTER_MS = 1000

/**
 * A live MapLibre map on the canvas. Double-click to pan and zoom it (editing); Esc or a
 * click outside gives the pointer back to the canvas. The basemap is shared. The view is per
 * person, kept in the doc (Views in @ttx/core): nobody's pan moves another person's map, but the
 * agent can move a person's map, and a person who has no view starts at the latest one anyone saved.
 */
export function MapObject({ runtime, object: o, editing }: ObjectViewProps<MapBoardObject>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap>(null)
  const styleRef = useRef<Basemap>(o.basemap)

  useEffect(() => {
    const views = new Views(runtime.board.doc)
    const me = runtime.actor.id
    const legacy = views.get(me, o.id) ? undefined : legacyView(o.id)
    if (legacy) views.set(me, o.id, legacy)
    const start = views.get(me, o.id) ?? views.latest(o.id)?.view ?? WORLD
    const map = new MapLibreMap({
      container: glRef.current!,
      style: basemapStyle(styleRef.current),
      center: start.center,
      zoom: start.zoom,
      bearing: start.bearing,
      attributionControl: { compact: true },
    })
    // deck.gl data layers go here. Overlay mode (its own canvas above the map), not interleaved:
    // deck.gl 9.4's interleaved mode throws on every frame with MapLibre 6. The cost is a second
    // WebGL context per map, and deck.gl layers draw above the map's labels.
    map.addControl(new MapboxOverlay({ interleaved: false, layers: [] }) as unknown as IControl)

    /** `at` of my view as this map last wrote or showed it: a change with another `at` came from elsewhere. */
    let shownAt = views.get(me, o.id)?.at
    /** The map is moving to a view from elsewhere: do not save that move back. */
    let moving = false
    let pending: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      pending = undefined
      const c = map.getCenter()
      const view = { center: [c.lng, c.lat] as [number, number], zoom: map.getZoom(), bearing: map.getBearing(), at: Date.now() }
      shownAt = view.at
      views.set(me, o.id, view)
    }
    map.on('movestart', () => clearTimeout(pending))
    map.on('moveend', () => {
      if (moving) moving = false
      else pending = setTimeout(save, SAVE_AFTER_MS)
    })
    // My view changed elsewhere: the agent moved it, or another tab of mine.
    const unsubscribe = views.subscribe(() => {
      const view = views.get(me, o.id)
      if (!view || view.at === shownAt) return
      shownAt = view.at
      clearTimeout(pending)
      moving = true
      map.flyTo({ center: view.center, zoom: view.zoom, bearing: view.bearing, duration: 800 })
    })
    mapRef.current = map
    return () => {
      unsubscribe()
      // A pan that has not been saved yet.
      if (pending) save()
      map.remove()
      mapRef.current = null
    }
  }, [runtime, o.id])

  useEffect(() => {
    if (styleRef.current === o.basemap) return
    styleRef.current = o.basemap
    mapRef.current?.setStyle(basemapStyle(o.basemap))
  }, [o.basemap])

  useEffect(() => {
    mapRef.current?.resize()
  }, [o.w, o.h])

  // While editing, the wheel belongs to the map, not the canvas camera. The canvas listens
  // natively, so stop the native event here.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  return (
    <div className="ttx-map">
      <div className="ttx-map__header">
        <span className="ttx-map__title">Map</span>
        <select
          aria-label="Basemap"
          value={o.basemap}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            runtime.beginGesture()
            runtime.dispatch('map.setBasemap', { kind: 'objects', ids: [o.id] }, { basemap: e.target.value })
          }}
        >
          {BASEMAPS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <div ref={bodyRef} className="ttx-map__body" style={{ pointerEvents: editing ? 'auto' : 'none' }}>
        <div ref={glRef} className="ttx-map__gl" />
        {!editing && <div className="ttx-map__hint">Double-click to pan and zoom</div>}
      </div>
    </div>
  )
}

/** Views from before they were in the doc, kept in this browser's localStorage. Read once, to move them to the doc. */
function legacyView(mapId: string): { center: [number, number]; zoom: number; bearing: number } | undefined {
  try {
    const key = `ttx:map-view:${mapId}`
    const saved = localStorage.getItem(key)
    localStorage.removeItem(key)
    return saved ? { ...WORLD, ...(JSON.parse(saved) as object) } : undefined
  } catch {
    return undefined
  }
}
