import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, setWorkerUrl, type IControl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { XIcon } from '@phosphor-icons/react'
import type { Board, BoardObject } from '../board/board'
import type { Place } from '../data/geocode'
import { BASEMAPS, basemapStyle, type Basemap } from './basemaps'
import { attributionOf, deckLayers, newLayerId, useLayerStates, type LayerState, type MapLayer } from './layers'
import { loadView, saveView } from './localView'
import { PlaceSearch } from './PlaceSearch'

type MapBoardObject = Extract<BoardObject, { type: 'map' }>

/** Zoom for a place without a bbox. */
const POINT_ZOOM = 10
const NO_LAYERS: MapLayer[] = []

// MapLibre 6 finds its worker relative to its own module at runtime, which a bundle breaks: let Vite
// build the worker (?worker&url) and point MapLibre at it. MapLibre 6 also draws right-to-left
// labels (Arabic, Hebrew) itself, so no RTL plugin is needed.
setWorkerUrl(workerUrl)

/**
 * A live MapLibre map on the canvas. Double-click to pan and zoom it (editing); Esc or a
 * click outside gives the pointer back to the canvas. The basemap is shared; the view is not.
 */
export function MapObject({ board, object: o, editing }: { board: Board; object: MapBoardObject; editing: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap>(null)
  const overlayRef = useRef<MapboxOverlay>(null)
  const styleRef = useRef<Basemap>(o.basemap)
  const layers = o.layers ?? NO_LAYERS
  const states = useLayerStates(layers)

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
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay as unknown as IControl)
    map.on('moveend', () => {
      const c = map.getCenter()
      saveView(o.id, { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() })
    })
    mapRef.current = map
    overlayRef.current = overlay
    return () => {
      map.remove()
      mapRef.current = null
      overlayRef.current = null
    }
  }, [o.id])

  // Layers whose result arrived or changed. deck.gl diffs by layer id and data, so unchanged layers are cheap.
  useEffect(() => {
    overlayRef.current?.setProps({ layers: deckLayers(states) })
  })

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

  /** Move this person's view to a place. Other people's views stay where they are. */
  const goTo = (place: Place) => {
    const map = mapRef.current
    if (!map) return
    if (place.bbox) map.fitBounds(place.bbox, { padding: 24, maxZoom: 16 })
    else map.flyTo({ center: place.lngLat, zoom: POINT_ZOOM })
  }

  const setLayers = (next: MapLayer[]) => {
    board.undo.stopCapturing()
    board.update({ [o.id]: { layers: next } })
  }

  /** Mark a place for everyone: a layer that geocodes the place's name again, so it stays a tool recipe. */
  const pin = (place: Place) => {
    goTo(place)
    setLayers([...layers, { id: newLayerId(), tool: 'data.geocode', input: { query: place.name, limit: 1 }, title: place.name }])
  }

  return (
    <div className="ttx-map">
      <div className="ttx-map__header">
        <span className="ttx-map__title">Map</span>
        <PlaceSearch onGo={goTo} onPin={pin} />
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
        <LayerList states={states} onRemove={(id) => setLayers(layers.filter((l) => l.id !== id))} />
      </div>
    </div>
  )
}

/** The map's data layers: title, status or attribution, and remove. Clickable whether or not the map is being edited. */
function LayerList({ states, onRemove }: { states: LayerState[]; onRemove(id: string): void }) {
  if (!states.length) return null
  return (
    <div className="ttx-layers" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {states.map((s) => {
        const note = s.error ?? (s.loading ? 'Loading…' : attributionOf(s.value))
        return (
          <div key={s.id} className={`ttx-layers__item ${s.error ? 'is-error' : ''}`}>
            <div className="ttx-layers__text">
              <div className="ttx-layers__title">{s.title}</div>
              {note && <div className="ttx-layers__note">{note}</div>}
            </div>
            <button type="button" title="Remove layer" aria-label={`Remove layer ${s.title}`} onClick={() => onRemove(s.id)}>
              <XIcon size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
