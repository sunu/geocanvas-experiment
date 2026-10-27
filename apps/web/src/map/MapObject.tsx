import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Board, BoardObject } from '../board/board'
import { BASEMAPS, basemapStyle, type Basemap } from './basemaps'
import { loadView, saveView } from './localView'

type MapBoardObject = Extract<BoardObject, { type: 'map' }>

/**
 * A live MapLibre map on the canvas. Double-click to pan and zoom it (editing); Esc or a
 * click outside gives the pointer back to the canvas. The basemap is shared; the view is not.
 */
export function MapObject({ board, object: o, editing }: { board: Board; object: MapBoardObject; editing: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map>(null)
  const styleRef = useRef<Basemap>(o.basemap)

  useEffect(() => {
    const view = loadView(o.id)
    const map = new maplibregl.Map({
      container: glRef.current!,
      style: basemapStyle(styleRef.current),
      center: view.center,
      zoom: view.zoom,
      bearing: view.bearing,
      attributionControl: { compact: true },
    })
    // deck.gl draws data layers into the map's own WebGL context (interleaved), so a map costs one context.
    map.addControl(new MapboxOverlay({ interleaved: true, layers: [] }) as unknown as maplibregl.IControl)
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
            board.undo.stopCapturing()
            board.update({ [o.id]: { basemap: e.target.value as Basemap } })
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
