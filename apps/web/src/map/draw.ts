import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'

/**
 * Drawing a shape on a live map, in focus mode: an area to show (LocationPicker.tsx). The shape in progress is
 * drawn in a MapLibre source of its own, which goes away when drawing ends; what is drawn is written by the
 * caller, through an op. Esc cancels (before the canvas sees it, which would leave focus).
 */

const SOURCE = 'ttx-draw'
const ACCENT = '#2563eb'

const ring = (a: [number, number], b: [number, number]): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[a, [b[0], a[1]], b, [a[0], b[1]], a]],
})

/** The bbox a drawn box covers. */
export function boxArea(p: GeoJSON.Polygon) {
  const xs = p.coordinates[0]!.map((c) => c[0]!)
  const ys = p.coordinates[0]!.map((c) => c[1]!)
  return { west: Math.min(...xs), south: Math.min(...ys), east: Math.max(...xs), north: Math.max(...ys) }
}

function show(map: MapLibreMap, shape: GeoJSON.Geometry | null) {
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: shape ? [{ type: 'Feature', geometry: shape, properties: {} }] : [] }
  const source = map.getSource<GeoJSONSource>(SOURCE)
  if (source) return void source.setData(data)
  if (!map.isStyleLoaded()) return
  map.addSource(SOURCE, { type: 'geojson', data })
  map.addLayer({ id: `${SOURCE}-fill`, type: 'fill', source: SOURCE, paint: { 'fill-color': ACCENT, 'fill-opacity': 0.12 } })
  map.addLayer({ id: `${SOURCE}-line`, type: 'line', source: SOURCE, paint: { 'line-color': ACCENT, 'line-width': 2, 'line-dasharray': [2, 1] } })
}

function clear(map: MapLibreMap) {
  for (const id of [`${SOURCE}-line`, `${SOURCE}-fill`]) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

/**
 * Let the person drag a box on `map`. `onEnd` gets it, or undefined when drawing was cancelled.
 * Returns the function that cancels it.
 */
export function drawBox(map: MapLibreMap, onEnd: (shape: GeoJSON.Polygon | undefined) => void): () => void {
  const canvas = map.getCanvas()
  const cursor = canvas.style.cursor
  canvas.style.cursor = 'crosshair'
  const panned = map.dragPan.isEnabled()
  const boxZoomed = map.boxZoom.isEnabled()
  map.dragPan.disable()
  map.boxZoom.disable()
  let start: [number, number] | undefined
  let shape: GeoJSON.Polygon | undefined

  const onDown = (e: MapMouseEvent) => {
    if (e.originalEvent.button !== 0) return
    start = [e.lngLat.lng, e.lngLat.lat]
  }
  const onMove = (e: MapMouseEvent) => {
    if (!start) return
    shape = ring(start, [e.lngLat.lng, e.lngLat.lat])
    show(map, shape)
  }
  const onUp = () => {
    if (!start) return
    // A click is not a box.
    end(shape)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopImmediatePropagation()
    end(undefined)
  }

  let ended = false
  function end(result: GeoJSON.Polygon | undefined) {
    if (ended) return
    ended = true
    map.off('mousedown', onDown)
    map.off('mousemove', onMove)
    map.off('mouseup', onUp)
    window.removeEventListener('keydown', onKey, true)
    canvas.style.cursor = cursor
    if (panned) map.dragPan.enable()
    if (boxZoomed) map.boxZoom.enable()
    clear(map)
    onEnd(result)
  }

  map.on('mousedown', onDown)
  map.on('mousemove', onMove)
  map.on('mouseup', onUp)
  window.addEventListener('keydown', onKey, true)
  return () => end(undefined)
}
