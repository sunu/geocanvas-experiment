import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { SHAPE_POINTS, shapeFeatures, type MapArea, type Shape } from '@ttx/plugins'

/**
 * Drawing a shape on a live map, in focus mode: an area to show (LocationPicker.tsx), or an annotation from the
 * drawing box (DrawingBox.tsx). The shape in progress is drawn in a MapLibre source of its own, as the finished one
 * will be (shapeFeatures), and goes away when drawing ends; what is drawn is written by the caller, through an op.
 * Esc cancels (before the canvas sees it, which would leave focus).
 *
 * Arrows, lines, rectangles and circles are dragged from the first point to the second; freehand follows the
 * pointer while it is down; a polygon takes a click or tap per corner and ends with a double-click or double-tap on
 * the last corner, Enter, or its Done button.
 */

const SOURCE = 'ttx-draw'
const ACCENT = '#2563eb'
/** Freehand keeps a point only this far (px) from the last one, so a stroke is not thousands of points. */
const FREEHAND_STEP_PX = 3
/** A drag shorter than this (px) is a click, not a shape. */
const MIN_DRAG_PX = 4
/** A second tap this soon (ms) and this near (px) the last corner ends a polygon, as a double-click does. */
const DOUBLE_TAP_MS = 400
const DOUBLE_TAP_PX = 12

type Point = [number, number]
type ScreenPoint = { x: number; y: number }

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
 *
 * Pointer events, so a mouse, a pen and a finger draw alike (MapLibre's own mouse events never come from a finger).
 * A second finger is a pinch, not a stroke: it drops the stroke in progress and the map zooms. Our listeners are on
 * the canvas container and pointer events come before the mouse and touch events MapLibre handles.
 */
export function drawShape(map: MapLibreMap, shape: Shape, color: string, onEnd: (points: Point[] | undefined) => void): () => void {
  const container = map.getCanvasContainer()
  const canvas = map.getCanvas()
  const cursor = canvas.style.cursor
  const touchAction = container.style.touchAction
  canvas.style.cursor = 'crosshair'
  // A finger draws instead of scrolling or zooming the page.
  container.style.touchAction = 'none'
  // The pointer draws: the map must not pan, box-zoom or zoom on the double-click that ends a polygon.
  const handlers = [map.dragPan, map.boxZoom, map.doubleClickZoom].filter((h) => h.isEnabled())
  for (const h of handlers) h.disable()
  const polygon = shape === 'polygon'
  let points: Point[] = []
  /** The pointers on the map now. More than one is a pinch, and nothing is drawn until they are all up. */
  const pointers = new Set<number>()
  let pinching = false
  /** Where the pointer went down, on screen, while a stroke or a tap is in progress. */
  let down: ScreenPoint | undefined
  /** The last kept point of a freehand stroke, on screen. */
  let last: ScreenPoint | undefined
  /** The polygon's last corner: a second tap on it soon after ends the polygon, as a double-click does. */
  let lastCorner: { at: ScreenPoint; time: number } | undefined

  /** The pointer on the map in its own pixels: the map can be drawn scaled (the canvas zooms), as MapLibre allows for. */
  const screen = (e: PointerEvent): ScreenPoint => {
    const r = canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * canvas.clientWidth) / r.width, y: ((e.clientY - r.top) * canvas.clientHeight) / r.height }
  }
  const at = (p: ScreenPoint): Point => {
    const l = map.unproject([p.x, p.y]).wrap()
    return [l.lng, l.lat]
  }
  const far = (a: ScreenPoint, b: ScreenPoint, px: number) => Math.hypot(a.x - b.x, a.y - b.y) >= px

  const done = doneButton(map, () => finishPolygon())
  const showPolygon = (extra: Point[] = []) => {
    show(map, shape, [...points, ...extra], color)
    done.hidden = points.length < 3
  }

  const onDown = (e: PointerEvent) => {
    // A note, a control or the Done button keeps its own press.
    if ((e.target as Element).closest('.maplibregl-marker, .ttx-map__done') || (e.pointerType === 'mouse' && e.button !== 0)) return
    pointers.add(e.pointerId)
    if (pointers.size > 1) {
      // A pinch: drop the stroke in progress, keep the polygon's corners.
      pinching = true
      down = undefined
      if (!polygon) points = []
      return polygon ? showPolygon() : show(map, shape, [], color)
    }
    container.setPointerCapture(e.pointerId)
    down = last = screen(e)
    if (!polygon) points = [at(down)]
  }
  const onMove = (e: PointerEvent) => {
    const p = screen(e)
    if (polygon) return points.length && !pinching && showPolygon([at(p)])
    if (!down || pinching || !pointers.has(e.pointerId)) return
    if (shape === 'freehand') {
      if (!far(p, last!, FREEHAND_STEP_PX)) return
      last = p
      points.push(at(p))
    } else points = [points[0]!, at(p)]
    show(map, shape, points, color)
  }
  const onUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return
    if (pinching) {
      if (!pointers.size) pinching = false
      return
    }
    if (!down) return
    const p = screen(e)
    const moved = far(p, down, MIN_DRAG_PX)
    down = undefined
    if (polygon) {
      if (moved) return
      // A second tap on the last corner, soon after: the polygon ends there.
      if (lastCorner && e.timeStamp - lastCorner.time < DOUBLE_TAP_MS && !far(p, lastCorner.at, DOUBLE_TAP_PX)) return finishPolygon()
      lastCorner = { at: p, time: e.timeStamp }
      points.push(at(p))
      return showPolygon()
    }
    if (shape !== 'freehand') points = [points[0]!, at(p)]
    end(moved && points.length >= SHAPE_POINTS[shape][0] ? points : undefined)
  }
  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (!pointers.size) pinching = false
    down = undefined
  }
  function finishPolygon() {
    end(points.length >= 3 ? points : undefined)
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
    container.removeEventListener('pointerdown', onDown)
    container.removeEventListener('pointermove', onMove)
    container.removeEventListener('pointerup', onUp)
    container.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    done.remove()
    canvas.style.cursor = cursor
    container.style.touchAction = touchAction
    for (const h of handlers) h.enable()
    clear(map)
    onEnd(result && result.slice(0, SHAPE_POINTS[shape][1]))
  }

  container.addEventListener('pointerdown', onDown)
  container.addEventListener('pointermove', onMove)
  container.addEventListener('pointerup', onUp)
  container.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
  return () => end(undefined)
}

/**
 * The button that ends a polygon, on the map while one is drawn: a phone has no Enter, and no double-click it sends
 * reliably. Hidden until the polygon has three corners.
 */
function doneButton(map: MapLibreMap, onDone: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ttx-map__done'
  button.textContent = 'Done'
  button.hidden = true
  button.addEventListener('click', onDone)
  map.getContainer().append(button)
  return button
}

/** Let the person drag a box on `map`: `onEnd` gets its area, or undefined when cancelled. */
export const drawBox = (map: MapLibreMap, onEnd: (area: MapArea | undefined) => void) => drawShape(map, 'rectangle', ACCENT, (points) => onEnd(points && boxArea(points)))
