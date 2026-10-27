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
  const mapRef = useRef<MapRef>(null)
  const draft = useDrawing(node.id)
  const [hover, setHover] = useState<string>()
  const data = derived?.result?.data as { aoi?: GeoJSON.Feature; features?: GeoJSON.FeatureCollection } | undefined
  const dark = node.props.basemap === 'dark' || node.props.basemap === 'satellite'

  // Fit to the AOI when it changes.
  const aoiKey = useMemo(() => (data?.aoi ? JSON.stringify(bboxOf(data.aoi)) : ''), [data?.aoi])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !data?.aoi) return
    const [minX, minY, maxX, maxY] = bboxOf(data.aoi)
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 30, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoiKey])

  // Resize the GL canvas with the shape.
  useEffect(() => {
    mapRef.current?.resize()
  }, [width, height])

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
    <div className="gc-map" onPointerDown={(e) => editing && e.stopPropagation()}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 40, latitude: 10, zoom: 1.5 }}
        mapStyle={basemapStyle(String(node.props.basemap))}
        attributionControl={{ compact: true }}
        interactive={editing}
        doubleClickZoom={!draft}
        style={{ width: '100%', height: '100%' }}
      >
        <DeckOverlay
          layers={layers}
          onClick={onClick}
          onHover={(info: PickingInfo) => setHover((info.object as GeoJSON.Feature | undefined)?.properties?.name as string | undefined)}
        />
      </Map>
      {hover && <div className="gc-map__hover">{hover}</div>}
      {!editing && <div className="gc-map__hint">Double-click to pan and zoom</div>}
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

function bboxOf(f: GeoJSON.Feature): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1] as number)
      maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1] as number)
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  visit((f.geometry as GeoJSON.Polygon).coordinates)
  return [minX, minY, maxX, maxY]
}
