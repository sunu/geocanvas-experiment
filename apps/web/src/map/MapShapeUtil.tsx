import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { BaseBoxShapeTool, BaseBoxShapeUtil, HTMLContainer, useEditor, useValue } from 'tldraw'
import { BASEMAPS, MAP_SHAPE, mapShapeMigrations, mapShapeProps, type Basemap, type MapShape } from '@ttx/shapes'
import { basemapStyle } from './basemaps'
import { loadView, saveView } from './localView'

export class MapShapeUtil extends BaseBoxShapeUtil<MapShape> {
  static override type = MAP_SHAPE
  static override props = mapShapeProps
  static override migrations = mapShapeMigrations

  getDefaultProps(): MapShape['props'] {
    return { w: 520, h: 380, basemap: 'light' }
  }

  /** Double-click to "edit": the map takes pan and zoom until Esc or a click outside. */
  override canEdit() {
    return true
  }

  component(shape: MapShape) {
    return <MapComponent shape={shape} />
  }

  getIndicatorPath(shape: MapShape) {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
    return path
  }
}

export class MapShapeTool extends BaseBoxShapeTool {
  static override id = MAP_SHAPE
  static override initial = 'idle'
  override shapeType: typeof MAP_SHAPE = MAP_SHAPE
}

function MapComponent({ shape }: { shape: MapShape }) {
  const editor = useEditor()
  const editing = useValue('editing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map>(null)
  const styleRef = useRef<Basemap>(shape.props.basemap)

  useEffect(() => {
    const view = loadView(shape.id)
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
      saveView(shape.id, { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() })
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [shape.id])

  useEffect(() => {
    if (styleRef.current === shape.props.basemap) return
    styleRef.current = shape.props.basemap
    mapRef.current?.setStyle(basemapStyle(shape.props.basemap))
  }, [shape.props.basemap])

  useEffect(() => {
    mapRef.current?.resize()
  }, [shape.props.w, shape.props.h])

  // While editing, the wheel belongs to the map, not the canvas camera. tldraw listens natively
  // above us, so stop the native event here (a React handler would run too late).
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  return (
    <HTMLContainer className="ttx-map" style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="ttx-map__header">
        <span className="ttx-map__title">Map</span>
        <select
          aria-label="Basemap"
          value={shape.props.basemap}
          style={{ pointerEvents: 'all' }}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) =>
            editor.updateShape({ id: shape.id, type: MAP_SHAPE, props: { basemap: e.target.value as Basemap } })
          }
        >
          {BASEMAPS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={bodyRef}
        className="ttx-map__body"
        style={{ pointerEvents: editing ? 'all' : 'none' }}
        onPointerDown={(e) => editing && e.stopPropagation()}
      >
        <div ref={glRef} className="ttx-map__gl" />
        {!editing && <div className="ttx-map__hint">Double-click to pan and zoom</div>}
      </div>
    </HTMLContainer>
  )
}
