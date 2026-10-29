import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { SHAPE_POINTS, shapeFeatures, type MapArea, type Shape } from '@ttx/plugins'

/**
 * Drawing a shape on a live map, in focus mode: an area to show (LocationPicker.tsx), or an annotation from the
 * drawing box (DrawingBox.tsx). The shape in progress is drawn in a MapLibre source of its own, as the finished one
 * will be (shapeFeatures), and goes away when drawing ends; what is drawn is written by the caller, through an op.
 * Esc cancels (before the canvas sees it, which would leave focus).
 *
 * Arrows, lines, rectangles and circles are dragged from the first point to the second; freehand follows the
 * pointer while the button is down; a polygon takes a click per corner and ends with a double-click or Enter.
 */

const SOURCE = 'ttx-draw'
const ACCENT = '#2563eb'
/** Freehand keeps a point only this far (px) from the last one, so a stroke is not thousands of points. */
const FREEHAND_STEP_PX = 3
/** A drag shorter than this (px) is a click, not a shape. */
const MIN_DRAG_PX = 4

type Point = [number, number]

/** The bbox two corners span. */
export function boxArea([a, b]: Point[]): MapArea {
  return { west: Math.min(a![0], b![0]), south: Math.min(a![1], b![1]), east: Math.max(a![0], b![0]), north: Math.max(a![1], b![1]) }
}

function show(map: MapLibreMap, shape: Shape, points: Point[], color: string) {
  const data = { type: 'FeatureCollection' as const, features: points.length >= 2 ? shapeFeatures(shape, points, color) : [] }
  const source = map.getSource<GeoJSONSource>(SOURCE)
  if (source) return void source.setData(data as GeoJSON.FeatureCollection)
  if (!map.isStyleLoaded()) return
  map.addSource(SOURCE, { type: 'geojson', data: data as GeoJSON.FeatureCollection })
  map.addLayer({
    id: `${SOURCE}-fill`,
    type: 'fill',
    source: SOURCE,
    filter: ['!=', ['get', 'fill'], 'none'],
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['match', ['get', 'fill'], 'solid', 0.9, 0.12] },
  })
  map.addLayer({
    id: `${SOURCE}-line`,
    type: 'line',
    source: SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1] },
  })
}

function clear(map: MapLibreMap) {
  for (const id of [`${SOURCE}-line`, `${SOURCE}-fill`]) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource(SOURCE)) map.removeSource(SOURCE)
}

/**
 * Let the person draw one `shape` on `map` in `color`. `onEnd` gets its points [lng, lat], or undefined when
 * drawing was cancelled. Returns the function that cancels it.
 */
export function drawShape(map: MapLibreMap, shape: Shape, color: string, onEnd: (points: Point[] | undefined) => void): () => void {
  const canvas = map.getCanvas()
  const cursor = canvas.style.cursor
  canvas.style.cursor = 'crosshair'
  // The pointer draws: the map must not pan, box-zoom or zoom on the double-click that ends a polygon.
  const handlers = [map.dragPan, map.boxZoom, map.doubleClickZoom].filter((h) => h.isEnabled())
  for (const h of handlers) h.disable()
  const polygon = shape === 'polygon'
  let points: Point[] = []
  let down: { x: number; y: number } | undefined
  /** The last kept point of a freehand stroke, on screen. */
  let last: { x: number; y: number } | undefined
  const at = (e: MapMouseEvent): Point => {
    const p = e.lngLat.wrap()
    return [p.lng, p.lat]
  }

  const onDown = (e: MapMouseEvent) => {
    if (e.originalEvent.button !== 0 || polygon) return
    down = last = e.point
    points = [at(e)]
  }
  const onMove = (e: MapMouseEvent) => {
    if (polygon) return points.length && show(map, shape, [...points, at(e)], color)
    if (!down) return
    if (shape === 'freehand') {
      if (Math.hypot(e.point.x - last!.x, e.point.y - last!.y) < FREEHAND_STEP_PX) return
      last = e.point
      points.push(at(e))
    } else points = [points[0]!, at(e)]
    show(map, shape, points, color)
  }
  const onUp = (e: MapMouseEvent) => {
    if (polygon || !down) return
    const moved = Math.hypot(e.point.x - down.x, e.point.y - down.y) >= MIN_DRAG_PX
    if (shape !== 'freehand') points = [points[0]!, at(e)]
    end(moved && points.length >= SHAPE_POINTS[shape][0] ? points : undefined)
  }
  const onClick = (e: MapMouseEvent) => {
    if (!polygon) return
    points.push(at(e))
    show(map, shape, points, color)
  }
  // The double-click's two clicks added two corners at its place: drop the second.
  const finishPolygon = () => end(points.length >= 3 ? points : undefined)
  const onDoubleClick = () => {
    if (!polygon) return
    points.pop()
    finishPolygon()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation()
      end(undefined)
    } else if (e.key === 'Enter' && polygon) {
      e.stopImmediatePropagation()
      finishPolygon()
    }
  }

  let ended = false
  function end(result: Point[] | undefined) {
    if (ended) return
    ended = true
    map.off('mousedown', onDown)
    map.off('mousemove', onMove)
    map.off('mouseup', onUp)
    map.off('click', onClick)
    map.off('dblclick', onDoubleClick)
    window.removeEventListener('keydown', onKey, true)
    canvas.style.cursor = cursor
    for (const h of handlers) h.enable()
    clear(map)
    onEnd(result && result.slice(0, SHAPE_POINTS[shape][1]))
  }

  map.on('mousedown', onDown)
  map.on('mousemove', onMove)
  map.on('mouseup', onUp)
  map.on('click', onClick)
  map.on('dblclick', onDoubleClick)
  window.addEventListener('keydown', onKey, true)
  return () => end(undefined)
}

/** Let the person drag a box on `map`: `onEnd` gets its area, or undefined when cancelled. */
export const drawBox = (map: MapLibreMap, onEnd: (area: MapArea | undefined) => void) => drawShape(map, 'rectangle', ACCENT, (points) => onEnd(points && boxArea(points)))
