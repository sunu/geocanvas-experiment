import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, setWorkerUrl, type IControl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { ObjectViewProps } from '../canvas/registry'
import { BASEMAPS, basemapStyle, type Basemap } from './basemaps'
import { loadView, saveView } from './localView'
import type { MapBoardObject } from './plugin'

// MapLibre 6 finds its worker relative to its own module at runtime, which a bundle breaks: let Vite
// build the worker (?worker&url) and point MapLibre at it. MapLibre 6 also draws right-to-left
// labels (Arabic, Hebrew) itself, so no RTL plugin is needed.
setWorkerUrl(workerUrl)

/**
 * A live MapLibre map on the canvas. Double-click to pan and zoom it (editing); Esc or a
 * click outside gives the pointer back to the canvas. The basemap is shared; the view is not.
 */
export function MapObject({ runtime, object: o, editing }: ObjectViewProps<MapBoardObject>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap>(null)
  const styleRef = useRef<Basemap>(o.basemap)

  useEffect(() => {
    const view = loadView(o.id)
    const map = new MapLibreMap({
      container: glRef.current!,
      style: basemapStyle(styleRef.current),
      center: view.center,
      zoom: view.zoom,
      bearing: view.bearing,
      attributionControl: { compact: true },
    })
    // deck.gl data layers go here. Overlay mode (its own canvas above the map), not interleaved:
    // deck.gl 9.4's interleaved mode throws on every frame with MapLibre 6. The cost is a second
    // WebGL context per map, and deck.gl layers draw above the map's labels.
    map.addControl(new MapboxOverlay({ interleaved: false, layers: [] }) as unknown as IControl)
    map.on('moveend', () => {
      const c = map.getCenter()
      saveView(o.id, { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() })
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [o.id])

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
