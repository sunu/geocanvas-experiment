import { useEffect, useState } from 'react'
import { Map as MapLibreMap, type IControl } from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { stableJson } from '@ttx/core'
import type { Basemap, MapAnnotation, MapLayer, ScenarioClosure } from '@ttx/plugins'
import { routingLayers, type RouteState } from '../routing/useRoutes'
import { syncAdminLayers } from './adminAreas'
import { basemapStyle } from './basemaps'
import { deckLayers, loadLayerStates, shapeLayer } from './layers'
import { exposureLayers, floodedLayers, type ExposureState } from '../exposure/useExposure'

/**
 * Pictures of the maps that are not live (budget.ts), all drawn by one hidden map: one MapLibre map and its deck.gl
 * overlay for every snapshot in the tab, instead of two WebGL contexts per map. Snapshots are drawn one at a time
 * and kept by what they show (view, size, basemap, layers), so a map that comes back to a view it had reuses its
 * picture. Each person's snapshot shows their own view, as their live map would.
 */

export interface SnapshotRequest {
  view: { center: [number, number]; zoom: number; bearing: number }
  /** The map's area on the board, px (without its header). */
  width: number
  height: number
  basemap: Basemap
  layers: MapLayer[]
  /** The shapes drawn on the map. Sticky notes are DOM markers on a live map, and are not in snapshots. */
  shapes: MapAnnotation[]
  /** The scenario's routes as found so far, and its closures (routing/). The ends' markers are DOM, and not drawn. */
  routes: RouteState[]
  closures: ScenarioClosure[]
  /** A flood exposure map's counts (exposure/): the flooded buildings and the facilities are drawn as on the live map. */
  exposure?: ExposureState
  /** Pixels per CSS px: more than the screen's for print (reports/print.ts), the same area, sharper. */
  pixelRatio?: number
}

/** Snapshots kept, as object URLs (each a few hundred KB of PNG). */
const MAX_SNAPSHOTS = 50
/** Drawn at up to this pixel ratio, unless a request asks for more: snapshots are shown at canvas zooms up to about 100%. */
const MAX_PIXEL_RATIO = 2
const screenRatio = () => Math.min(MAX_PIXEL_RATIO, devicePixelRatio)
/** Data layers are done drawing when deck.gl has not drawn for this long after the map's last tile. */
const SETTLE_MS = 300
/** A snapshot is taken after this long even if tiles are still loading (a slow or failing tile server). */
const TIMEOUT_MS = 8000

const snapshots = new Map<string, Promise<string>>()

/**
 * A request's cache key. An exposure count can carry 200,000 flooded buildings: it is keyed by what it found (counts
 * and the flood), which changes whenever those points do.
 */
function keyOf(req: SnapshotRequest): string {
  const r = req.exposure?.result
  const exposure = r && [r.buildings, r.facilities.length, r.inundation?.returnPeriod, r.inundation?.flooded]
  return stableJson({ ...req, exposure, view: { ...req.view, center: req.view.center.map((c) => Math.round(c * 1e5) / 1e5) } })
}

/** The snapshot of a map as `req` shows it, from the cache or drawn next. */
function snapshot(req: SnapshotRequest): Promise<string> {
  const key = keyOf(req)
  let p = snapshots.get(key)
  if (p) {
    // Most recently used last.
    snapshots.delete(key)
    snapshots.set(key, p)
    return p
  }
  p = queue = queue.then(() => draw(req), () => draw(req))
  snapshots.set(key, p)
  p.catch(() => snapshots.delete(key))
  while (snapshots.size > MAX_SNAPSHOTS) {
    const [oldest, url] = snapshots.entries().next().value!
    snapshots.delete(oldest)
    url.then(URL.revokeObjectURL, () => {})
  }
  return p
}

let queue: Promise<unknown> = Promise.resolve()

interface Renderer {
  container: HTMLDivElement
  map: MapLibreMap
  overlay: MapboxOverlay
  basemap?: Basemap
  /** When deck.gl last drew. */
  deckDrawnAt: number
}

let renderer: Renderer | undefined

function start(): Renderer {
  const container = document.createElement('div')
  // Laid out (MapLibre needs a size) but out of sight, and never in the way of the pointer.
  Object.assign(container.style, { position: 'fixed', left: '-100000px', top: '0', width: '1px', height: '1px', pointerEvents: 'none' })
  document.body.append(container)
  const map = new MapLibreMap({
    container,
    style: { version: 8, sources: {}, layers: [] },
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: screenRatio(),
    // So the frame can be read after it is drawn. deck.gl keeps its buffer by default.
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })
  const r: Renderer = { container, map, overlay: undefined as unknown as MapboxOverlay, deckDrawnAt: 0 }
  r.overlay = new MapboxOverlay({ interleaved: false, layers: [], onAfterRender: () => void (r.deckDrawnAt = performance.now()) })
  map.addControl(r.overlay as unknown as IControl)
  return r
}

const once = (map: MapLibreMap, event: 'idle' | 'style.load') => new Promise<void>((resolve) => map.once(event, () => resolve()))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function draw(req: SnapshotRequest): Promise<string> {
  const r = (renderer ??= start())
  const { map, overlay } = r
  r.container.style.width = `${Math.max(1, Math.round(req.width))}px`
  r.container.style.height = `${Math.max(1, Math.round(req.height))}px`
  const ratio = req.pixelRatio ?? screenRatio()
  if (map.getPixelRatio() !== ratio) map.setPixelRatio(ratio)
  overlay.setProps({ useDevicePixels: ratio })
  map.resize()
  if (r.basemap !== req.basemap) {
    const loaded = once(map, 'style.load')
    map.setStyle(basemapStyle(req.basemap), { diff: false })
    await loaded
    r.basemap = req.basemap
  }
  map.jumpTo(req.view)
  const states = await loadLayerStates(req.layers)
  overlay.setProps({
    layers: [...deckLayers(states), shapeLayer(req.shapes), ...floodedLayers(req.exposure), ...routingLayers(req.routes, req.closures), ...exposureLayers(req.exposure)],
  })
  syncAdminLayers(map, states)
  const deadline = performance.now() + TIMEOUT_MS
  await Promise.race([once(map, 'idle'), sleep(TIMEOUT_MS)])
  r.deckDrawnAt = performance.now()
  while (performance.now() - r.deckDrawnAt < SETTLE_MS && performance.now() < deadline) await sleep(SETTLE_MS / 3)
  return capture(r.container)
}

/** The map's canvas and the deck.gl overlay's, in the order they are stacked, as one PNG. */
async function capture(container: HTMLElement): Promise<string> {
  const layers = [...container.querySelectorAll('canvas')]
  const first = layers[0]
  if (!first) throw new Error('The snapshot map has no canvas')
  const out = document.createElement('canvas')
  out.width = first.width
  out.height = first.height
  const ctx = out.getContext('2d')!
  for (const c of layers) if (c.width && c.height) ctx.drawImage(c, 0, 0, out.width, out.height)
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not take a snapshot of the map')
  return URL.createObjectURL(blob)
}

/** The snapshot of a map, once drawn; undefined until then and while `req` is undefined (the map is live). */
export function useSnapshot(req: SnapshotRequest | undefined): string | undefined {
  const key = req && keyOf(req)
  const [shown, setShown] = useState<{ key: string; url: string }>()
  useEffect(() => {
    if (!req || !key) return
    let current = true
    snapshot(req).then(
      (url) => current && setShown({ key, url }),
      () => {}, // the map shows its placeholder
    )
    return () => {
      current = false
    }
    // `key` stands for req.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // The last picture stays up while the next one is drawn, so a change does not flash the placeholder.
  return shown?.url
}
