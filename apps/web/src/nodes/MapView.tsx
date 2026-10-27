import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Map, useControl, type MapRef } from 'react-map-gl/maplibre'
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import type { Layer, PickingInfo } from '@deck.gl/core'
import type { NodeRecord } from '@geo-canvas/core'
import { useRegistry, useSession } from '../ui/context'
import type { NodeViewProps } from '../ui/registry'
import { getEditor } from '../canvas/editorRef'
import { shapeIdOf } from '../canvas/NodeShapeUtil'
import { layerFactories } from './mapLayers'
import { liveViews, useRenderScale, viewOf } from './mapCamera'

/** Basemaps that need no API key. */
const VECTOR_STYLES: Record<string, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  streets: 'https://tiles.openfreemap.org/styles/liberty',
}

function basemapStyle(name: string) {
  if (name !== 'satellite') return VECTOR_STYLES[name] ?? VECTOR_STYLES.light!
  return {
    version: 8 as const,
    sources: {
      base: {
        type: 'raster' as const,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: 'Esri, Maxar, Earthstar Geographics',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'base', type: 'raster' as const, source: 'base' }],
  }
}

// AOI drawing state, per map node. The header button and the map share it.
const drawing = new globalThis.Map<string, [number, number][]>()
const drawListeners = new Set<() => void>()
const drawStore = {
  get: (id: string) => drawing.get(id),
  set(id: string, pts: [number, number][] | undefined) {
    if (pts) drawing.set(id, pts)
    else drawing.delete(id)
    for (const l of drawListeners) l()
  },
}
function useDrawing(id: string) {
  return useSyncExternalStore(
    (fn) => {
      drawListeners.add(fn)
      return () => drawListeners.delete(fn)
    },
    () => drawing.get(id),
  )
}

function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ ...props, interleaved: true }))
  overlay.setProps(props)
  return null
}

export function MapView({ node, derived, editing, width, height }: NodeViewProps) {
  const registry = useRegistry()
  const { runtime } = useSession()
  const mapRef = useRef<MapRef>(null)
  const draft = useDrawing(node.id)
  const [hover, setHover] = useState<string>()
  const data = derived?.result?.data as { aoi?: GeoJSON.Feature; features?: GeoJSON.FeatureCollection } | undefined
  const dark = node.props.basemap === 'dark' || node.props.basemap === 'satellite'

  // The view to show (doc units) and the render scale (see mapCamera.ts).
  const view = viewOf(node, data?.aoi)
  const scale = useRenderScale(width, height)
  const dz = Math.log2(scale)
  const interacting = useRef(false)
  const viewKey = JSON.stringify(view)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __maps?: Record<string, unknown> }
    w.__maps ??= {}
    const t = setInterval(() => {
      const m = mapRef.current?.getMap()
      if (m) {
        w.__maps![node.id] = m
        clearInterval(t)
      }
    }, 100)
    return () => clearInterval(t)
  }, [node.id])

  // Doc view or render scale changed: move the camera, unless the local user is moving it.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || interacting.current) return
    const target = { center: view.center as [number, number], zoom: view.zoom + dz, bearing: view.bearing ?? 0 }
    const c = map.getCenter()
    const same = Math.abs(c.lng - target.center[0]) < 1e-6 && Math.abs(c.lat - target.center[1]) < 1e-6 && Math.abs(map.getZoom() - target.zoom) < 1e-3
    if (same) return
    map.easeTo({ ...target, duration: 350 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, dz])

  // Size of the GL canvas follows the shape and the render scale.
  useEffect(() => {
    mapRef.current?.resize()
    const map = mapRef.current?.getMap()
    if (map) map.jumpTo({ center: view.center, zoom: view.zoom + dz, bearing: view.bearing ?? 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, scale])

  // A user pan or zoom ends: commit the view as one op (quick repeats merge into one undo step).
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toDoc = () => {
    const map = mapRef.current!.getMap()
    const c = map.getCenter()
    return { center: [c.lng, c.lat] as [number, number], zoom: map.getZoom() - dz, bearing: map.getBearing() || undefined }
  }
  const onMoveStart = (e: { originalEvent?: unknown }) => {
    if (!editing || !isUser(e)) return
    interacting.current = true
    clearTimeout(commitTimer.current)
  }
  const onMove = (e: { originalEvent?: unknown }) => {
    if (interacting.current) liveViews.set(node.id, toDoc())
    void e
  }
  const onMoveEnd = (e: { originalEvent?: unknown }) => {
    if (!interacting.current) return
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      interacting.current = false
      const v = toDoc()
      liveViews.set(node.id, undefined)
      void runtime.dispatch('core.map.setView', { kind: 'nodes', ids: [node.id] }, { ...v, bearing: v.bearing ?? undefined })
    }, 300)
    void e
  }

  // While editing, wheel and pinch belong to the map, not to the canvas camera.
  // tldraw listens natively above us, so stop the native event here (React's handler runs too late).
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  // Time of the last user input on the map. MapLibre does not always set originalEvent
  // (e.g. scroll zoom), so this tells user moves from programmatic ones.
  const lastInput = useRef(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const mark = () => (lastInput.current = performance.now())
    const opts = { capture: true, passive: true }
    for (const t of ['wheel', 'pointerdown', 'pointermove', 'touchstart', 'keydown'] as const) el.addEventListener(t, mark, opts)
    return () => {
      for (const t of ['wheel', 'pointerdown', 'pointermove', 'touchstart', 'keydown'] as const) el.removeEventListener(t, mark, opts)
    }
  }, [])
  const isUser = (e: { originalEvent?: unknown }) => !!e.originalEvent || performance.now() - lastInput.current < 400

  const layers = useMemo(() => {
    const out: Layer[] = []
    const inputs = registry.inputsOf(node)
    const values: Record<string, unknown> = { ...(derived?.inputs ?? {}) }
    if (data?.aoi) values.aoi = data.aoi
    for (const [port, spec] of Object.entries(inputs)) {
      const v = values[port]
      const f = layerFactories.get(spec.type)
      if (v && f) out.push(...f(v, { id: `${node.id}-${port}`, dark }))
    }
    if (draft?.length) {
      out.push(
        new PathLayer({ id: `${node.id}-draft-line`, data: [{ path: [...draft, draft[0]!] }], positionFormat: 'XY', getPath: (d: { path: [number, number][] }) => d.path.flat(), getColor: [240, 140, 0, 255], getWidth: 2, widthUnits: 'pixels' }),
        new ScatterplotLayer({ id: `${node.id}-draft-pts`, data: draft, getPosition: (d: number[]) => d as [number, number], getRadius: 4, radiusUnits: 'pixels', getFillColor: [240, 140, 0, 255] }),
      )
    }
    return out
  }, [registry, node, derived, data, draft, dark])

  const onClick = (info: PickingInfo) => {
    if (!draft || !info.coordinate) return
    drawStore.set(node.id, [...draft, [info.coordinate[0]!, info.coordinate[1]!]])
  }

  return (
    <div ref={wrapRef} className="gc-map" onPointerDown={(e) => editing && e.stopPropagation()}>
      <div
        className="gc-map__scaled"
        style={{ width: `${scale * 100}%`, height: `${scale * 100}%`, transform: `scale(${1 / scale})` }}
      >
        <Map
          ref={mapRef}
          initialViewState={{ longitude: view.center[0], latitude: view.center[1], zoom: view.zoom + dz, bearing: view.bearing ?? 0 }}
          mapStyle={basemapStyle(String(node.props.basemap))}
          attributionControl={{ compact: true }}
          doubleClickZoom={!draft}
          onMoveStart={onMoveStart}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          style={{ width: '100%', height: '100%' }}
        >
          <DeckOverlay
            layers={layers}
            onClick={onClick}
            onHover={(info: PickingInfo) => setHover((info.object as GeoJSON.Feature | undefined)?.properties?.name as string | undefined)}
          />
        </Map>
      </div>
      {hover && <div className="gc-map__hover">{hover}</div>}
      {!editing && <div className="gc-map__hint">Double-click or press F to work in the map</div>}
      {data?.aoi && (derived?.result?.data as { overridden?: boolean })?.overridden && <div className="gc-map__badge">AOI set by user</div>}
      {draft && <div className="gc-map__draw">Click to add points ({draft.length}). Then press Finish in the header.</div>}
    </div>
  )
}

/** Header buttons: draw an AOI, then commit it as one op. */
export function MapActions({ node }: { node: NodeRecord }) {
  const { runtime } = useSession()
  const draft = useDrawing(node.id)
  if (draft) {
    return (
      <>
        <button
          className="gc-btn gc-btn--primary"
          disabled={draft.length < 3}
          onClick={async () => {
            const ring = [...draft, draft[0]!]
            drawStore.set(node.id, undefined)
            const aoi = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
            await runtime.dispatch('core.map.setAoi', { kind: 'nodes', ids: [node.id] }, { aoi })
          }}
        >
          Finish
        </button>
        <button className="gc-btn gc-btn--ghost" onClick={() => drawStore.set(node.id, undefined)}>
          Cancel
        </button>
      </>
    )
  }
  return (
    <button
      className="gc-btn gc-btn--ghost"
      title="Draw a new area of interest"
      onClick={() => {
        drawStore.set(node.id, [])
        getEditor()?.setEditingShape(shapeIdOf(node.id))
      }}
    >
      ✎ AOI
    </button>
  )
}
