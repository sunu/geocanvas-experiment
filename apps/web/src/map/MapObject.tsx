import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AttributionControl, Map as MapLibreMap, setWorkerUrl, type IControl, type MapMouseEvent } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { MapTrifoldIcon } from '@phosphor-icons/react'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { FocusButton } from '../canvas/OptionsPanel'
import type { ObjectViewProps } from '../canvas/registry'
import { stableJson, Views, type Runtime, type SavedView } from '@ttx/core'
import { MAP_HEADER_PX, SHAPE_COLORS, viewOfArea, type Basemap, type Bbox, type MapAnnotation, type MapBoardObject, type MapLayer, type PlaceFeatures, type ShapeColor } from '@ttx/plugins'
import { countryName } from '@ttx/plugins/monty/countries'
import { tools } from '../tools/registry'
import { codab, dataLayerOf, fillLayerIds, syncAdminLayers, type AdminAreas } from './adminAreas'
import { BASEMAP_CREDITS, basemapStyle } from './basemaps'
import { DrawingBox, type DrawTool } from './DrawingBox'
import { drawShape } from './draw'
import { attributionOf, boundsOf, deckLayers, shapeLayer, useLayerStates } from './layers'
import { registerLiveMap } from './live'
import { MapStickies } from './MapStickies'
import { useLiveMap } from './pool'
import { useSnapshot } from './snapshots'

// MapLibre 6 finds its worker relative to its own module at runtime, which a bundle breaks: let Vite
// build the worker (?worker&url) and point MapLibre at it. MapLibre 6 also draws right-to-left
// labels (Arabic, Hebrew) itself, so no RTL plugin is needed.
setWorkerUrl(workerUrl)

/** Where a map starts for a person who has no view of it and nobody else has one either. */
const WORLD = { center: [20, 10] as [number, number], zoom: 1, bearing: 0 }
/**
 * Still where a new map starts. The map saves its first view about a second after it appears (a resize ends a
 * move), so "no view yet" does not last; the zoom does.
 */
const atStart = (view: { zoom: number } | undefined) => !view || view.zoom <= WORLD.zoom + 0.01

/** A view is saved this long after the map stops moving, so a series of pans is one write. */
const SAVE_AFTER_MS = 1000
const NO_LAYERS: MapLayer[] = []
const NO_ANNOTATIONS: MapAnnotation[] = []

/** Closest zoom when fitting a view to data, so a single point does not zoom in to the street. */
const FIT_MAX_ZOOM = 14

/**
 * Fit this person's view of a map to a bbox, e.g. to a layer they just added. It is written as their view,
 * as their own pans are (no op log entry, no undo): the map starts there, or flies there if it is on screen.
 * Nobody else's view moves.
 */
export function fitMapTo(runtime: Runtime, mapId: string, [west, south, east, north]: Bbox) {
  const map = runtime.board.get(mapId)
  if (!map) return
  const { center, zoom } = viewOfArea({ west, south, east, north }, map.w, map.h - MAP_HEADER_PX)
  new Views(runtime.board.doc).set(runtime.actor.id, mapId, { center, zoom: Math.min(zoom, FIT_MAX_ZOOM), bearing: 0 })
}

/** Fit a map to a country, found by name with the geocoder. Without a geocoder (no key), the view stays. */
export function fitMapToCountry(runtime: Runtime, mapId: string, iso3: string) {
  tools.run<PlaceFeatures>('data.geocode', { query: countryName(iso3) ?? iso3, limit: 1 }).then(
    (fc) => {
      const bbox = fc.features[0]?.properties.bbox
      if (bbox) fitMapTo(runtime, mapId, bbox)
    },
    () => {},
  )
}

/** Fit a map to a layer's data once it has loaded (from the tool cache when the map already ran it). */
export function fitMapToLayer(runtime: Runtime, mapId: string, layer: MapLayer) {
  tools.run<GeoJSON.FeatureCollection>(layer.tool, layer.input).then(
    (fc) => {
      const b = boundsOf(fc)
      if (b) fitMapTo(runtime, mapId, b)
    },
    () => {}, // the layer list shows the error
  )
}

/**
 * A live MapLibre map on the canvas. Double-click to pan and zoom it (editing); Esc or a
 * click outside gives the pointer back to the canvas. The basemap is shared. The view is per
 * person, kept in the doc (Views in @ttx/core): nobody's pan moves another person's map, but the
 * agent can move a person's map, and a person who has no view starts at the latest one anyone saved.
 *
 * Only a few maps are live at a time (budget.ts): the others show a snapshot of this person's view (snapshots.ts),
 * and get a live map again when they are on screen and large enough, edited or focused.
 *
 * Its tools and its list of data layers are in its Options panel, in focus mode (MapOptions.tsx). The
 * map itself shows only the data; the layers' attributions, which their licenses require, join the
 * basemap's in MapLibre's attribution control.
 *
 * Annotations are drawn on the map itself, and added with the tools at its top right while it is edited.
 */
export function MapObject({ runtime, object: o, editing, focused, onFocus }: ObjectViewProps<MapBoardObject>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap>(null)
  const overlayRef = useRef<MapboxOverlay>(null)
  const styleRef = useRef<Basemap>(o.basemap)
  // The runtime changes on entering and leaving focus (the board, then a draft of it). The map must
  // not be rebuilt then, so it is made once per object and reads the runtime from here.
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  const layers = o.layers ?? NO_LAYERS
  const states = useLayerStates(layers)
  const credits = [...new Set(states.map((st) => attributionOf(st.value)).filter((a) => !!a))].join(' · ')
  /** The latest states, for map events. */
  const statesRef = useRef(states)
  /** MapLibre layers can be added: the style has loaded, and no basemap change is under way. */
  const styleReadyRef = useRef(false)
  /** The value under the pointer on a choropleth, while editing. */
  const [hover, setHover] = useState<{ text: string; x: number; y: number }>()
  /** The live map, for what is drawn on it with React (stickies). */
  const [liveMap, setLiveMap] = useState<MapLibreMap>()
  /** The drawing box's tool: the next click on the map adds a sticky there, or the next drag draws a shape. */
  const [tool, setTool] = useState<DrawTool>()
  const [shapeColor, setShapeColor] = useState<ShapeColor>('red')
  /** The sticky being written in. */
  const [writing, setWriting] = useState<string>()
  const annotations = o.annotations ?? NO_ANNOTATIONS
  // Shapes are drawn by deck.gl: a new layer only when they change, not on every camera move (as for data layers).
  const shapesKey = stableJson(annotations.filter((a) => a.kind === 'shape'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shapes = useMemo(() => annotations.filter((a) => a.kind === 'shape'), [shapesKey])
  const shapesRef = useRef(shapes)
  const views = useMemo(() => new Views(runtime.board.doc), [runtime])
  const subscribeViews = useCallback((listener: () => void) => views.subscribe(listener), [views])
  const latest = useSyncExternalStore(subscribeViews, () => views.latest(o.id)?.view)
  const mine = useSyncExternalStore(subscribeViews, () => views.get(runtime.actor.id, o.id))
  /** Nobody has moved this map from the whole world, and it has no data or notes yet: a new map, which asks for its location. */
  const unplaced = atStart(latest) && !layers.length && !annotations.length
  // The pool learns of editing and focus a render later, from the canvas; a map that has the pointer is live now.
  const live = useLiveMap(o.id) || editing || focused
  const view = mine ?? latest ?? WORLD
  const snapshot = useSnapshot(
    live ? undefined : { view: { center: view.center, zoom: view.zoom, bearing: view.bearing }, width: o.w, height: o.h - MAP_HEADER_PX, basemap: o.basemap, layers, shapes },
  )

  useEffect(() => {
    if (!live) return
    const views = new Views(runtimeRef.current.board.doc)
    const me = runtimeRef.current.actor.id
    const legacy = views.get(me, o.id) ? undefined : legacyView(o.id)
    if (legacy) views.set(me, o.id, legacy)
    const start = views.get(me, o.id) ?? views.latest(o.id)?.view ?? WORLD
    const map = new MapLibreMap({
      container: glRef.current!,
      style: basemapStyle(styleRef.current),
      center: start.center,
      zoom: start.zoom,
      bearing: start.bearing,
      // Added below with the data layers' attributions, which change as layers come and go.
      attributionControl: false,
    })
    // deck.gl data layers go here. Overlay mode (its own canvas above the map), not interleaved:
    // deck.gl 9.4's interleaved mode throws on every frame with MapLibre 6. The cost is a second
    // WebGL context per map, and deck.gl layers draw above the map's labels.
    const overlay = new MapboxOverlay({ interleaved: false, layers: [...deckLayers(statesRef.current), shapeLayer(shapesRef.current)] })
    map.addControl(overlay as unknown as IControl)
    // The box changes size when resized, and in focus mode (a local size that is never stored).
    const resize = new ResizeObserver(() => map.resize())
    resize.observe(glRef.current!)
    const forget = registerLiveMap(o.id, map)
    // COD-AB boundaries and choropleths are MapLibre layers (adminAreas.ts): a basemap change drops them.
    map.on('style.load', () => {
      styleReadyRef.current = true
      syncAdminLayers(map, statesRef.current)
    })
    map.on('mousemove', (e) => {
      const ids = fillLayerIds(map)
      const f = ids.length ? map.queryRenderedFeatures(e.point, { layers: ids })[0] : undefined
      const a = f && (statesRef.current.find((s) => s.id === dataLayerOf(f.layer.id))?.value as AdminAreas | undefined)
      if (!f || !a?.values) return setHover(undefined)
      const t = codab(a.level)
      const v = a.values[f.properties[t.pcode]]
      setHover({ text: `${f.properties[t.name]}: ${v === undefined ? 'no data' : `${v.toLocaleString('en-US')} ${a.unit ?? ''}`}`, x: e.point.x, y: e.point.y })
    })
    map.on('mouseout', () => setHover(undefined))
    mapRef.current = map
    overlayRef.current = overlay
    setLiveMap(map)
    return () => {
      forget()
      resize.disconnect()
      map.remove()
      mapRef.current = null
      overlayRef.current = null
      styleReadyRef.current = false
      setLiveMap(undefined)
    }
  }, [o.id, live])

  // Leaving edit mode ends writing; leaving focus puts the drawing box's tool away, since it is a focus tool.
  useEffect(() => {
    if (!focused) setTool(undefined)
    if (!editing) setWriting(undefined)
  }, [editing, focused])

  // Drawing a shape: the person draws it on the map, then it is added for everyone (in focus: on the draft).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !tool || tool === 'note') return
    return drawShape(map, tool, SHAPE_COLORS[shapeColor], (points) => {
      setTool(undefined)
      if (!points) return
      const rt = runtimeRef.current
      rt.beginGesture()
      rt.dispatch('map.addShape', { kind: 'objects', ids: [o.id] }, { shape: tool, points, color: shapeColor })
    })
  }, [tool, shapeColor, o.id])

  // Writing in a sticky ends with a press on the map outside it. Not on blur: a note's text box loses focus when
  // its marker is put in the page again (React mounts twice in development).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !writing) return
    const onDown = (e: MapMouseEvent) => {
      if (!(e.originalEvent.target as Element).closest('.ttx-mapsticky')) setWriting(undefined)
    }
    map.on('mousedown', onDown)
    return () => void map.off('mousedown', onDown)
  }, [writing])

  // Placing a sticky: the next click on the map, not on a note, adds one there, for everyone, and opens it to write.
  useEffect(() => {
    const map = mapRef.current
    if (!map || tool !== 'note') return
    const onClick = (e: MapMouseEvent) => {
      if ((e.originalEvent.target as Element).closest('.ttx-mapsticky')) return
      setTool(undefined)
      const rt = runtimeRef.current
      const before = new Set((rt.board.get(o.id) as MapBoardObject | undefined)?.annotations?.map((a) => a.id))
      const p = e.lngLat.wrap()
      rt.beginGesture()
      rt.dispatch('map.addSticky', { kind: 'objects', ids: [o.id] }, { lng: p.lng, lat: p.lat })
      const added = (rt.board.get(o.id) as MapBoardObject | undefined)?.annotations?.find((a) => !before.has(a.id))
      if (added) {
        rt.beginGesture()
        setWriting(added.id)
      }
    }
    map.getCanvas().style.cursor = 'crosshair'
    map.on('click', onClick)
    return () => {
      map.getCanvas().style.cursor = ''
      map.off('click', onClick)
    }
  }, [tool, o.id])

  // Save this person's pans as their view, in the doc the runtime has (a draft in focus mode), and follow
  // changes to their view from elsewhere (the agent, another tab).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const me = runtime.actor.id
    /** `at` of my view as this map last wrote or showed it: a change with another `at` came from elsewhere. */
    let shownAt = views.get(me, o.id)?.at
    /** The map is moving to a view from elsewhere: do not save that move back. */
    let moving = false
    let pending: SavedView | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      clearTimeout(timer)
      if (!pending) return
      shownAt = pending.at
      views.set(me, o.id, pending)
      pending = undefined
    }
    // Show this doc's view first. After leaving focus with Discard, the map still shows the draft's view, and the
    // resize that ends focus would otherwise save it to the board as a pan.
    const saved = views.get(me, o.id)
    if (saved) {
      const c = map.getCenter()
      if (Math.abs(c.lng - saved.center[0]) > 1e-7 || Math.abs(c.lat - saved.center[1]) > 1e-7 || Math.abs(map.getZoom() - saved.zoom) > 1e-7)
        map.jumpTo({ center: saved.center, zoom: saved.zoom, bearing: saved.bearing })
    }
    const onMoveStart = () => clearTimeout(timer)
    const onMoveEnd = () => {
      if (moving) return void (moving = false)
      const c = map.getCenter()
      pending = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), at: Date.now() }
      timer = setTimeout(save, SAVE_AFTER_MS)
    }
    map.on('movestart', onMoveStart)
    map.on('moveend', onMoveEnd)
    const unsubscribe = views.subscribe(() => {
      const view = views.get(me, o.id)
      if (!view || view.at === shownAt) return
      shownAt = view.at
      clearTimeout(timer)
      pending = undefined
      moving = true
      map.flyTo({ center: view.center, zoom: view.zoom, bearing: view.bearing, duration: 800 })
    })
    return () => {
      unsubscribe()
      map.off('movestart', onMoveStart)
      map.off('moveend', onMoveEnd)
      // A pan that has not been saved yet goes to the doc it was made in.
      save()
    }
  }, [views, runtime, o.id, live])

  // The basemap's attribution and the data layers' in one control. MapLibre takes custom attributions
  // only when a control is made, so a new set of credits replaces the control.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const control = new AttributionControl({ compact: true, ...(credits && { customAttribution: credits }) })
    map.addControl(control)
    const keepClosed = startClosed(map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib'))
    return () => {
      keepClosed()
      // On unmount the map is already gone, with its controls.
      if (mapRef.current === map) map.removeControl(control)
    }
  }, [credits, live])

  // Only when a layer or its result changed: new deck.gl layers make deck.gl redraw all their data, and the canvas
  // re-renders the map on every camera move.
  useEffect(() => {
    overlayRef.current?.setProps({ layers: [...deckLayers(states), shapeLayer(shapes)] })
    statesRef.current = states
    shapesRef.current = shapes
    if (mapRef.current && styleReadyRef.current) syncAdminLayers(mapRef.current, states)
  }, [states, shapes])

  useEffect(() => {
    if (styleRef.current === o.basemap) return
    styleRef.current = o.basemap
    // A full reload, so 'style.load' fires and the COD-AB layers are added again.
    styleReadyRef.current = false
    mapRef.current?.setStyle(basemapStyle(o.basemap), { diff: false })
  }, [o.basemap])

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
      <ObjectHeader icon={<MapTrifoldIcon size={14} aria-hidden />} title="Map">
        {!focused && onFocus && <FocusButton onFocus={onFocus} />}
      </ObjectHeader>
      <div ref={bodyRef} className="ttx-map__body" style={{ pointerEvents: editing ? 'auto' : 'none' }}>
        <div ref={glRef} className="ttx-map__gl" />
        {liveMap && (
          <MapStickies
            runtime={runtime}
            map={liveMap}
            mapId={o.id}
            stickies={annotations.filter((a) => a.kind === 'sticky')}
            editable={editing}
            writing={writing}
            onWrite={setWriting}
          />
        )}
        {/* Notes and shapes are added in focus only; a double-click on the canvas lets the map pan, nothing more. */}
        {focused && <DrawingBox tool={tool} color={shapeColor} onTool={setTool} onColor={setShapeColor} />}
        {!live && snapshot && (
          <>
            <img className="ttx-map__snapshot" src={snapshot} alt="" draggable={false} />
            <div className="ttx-map__credits" tabIndex={0} aria-label="Map credits">
              <span>{[BASEMAP_CREDITS[o.basemap], credits].filter(Boolean).join(' · ')}</span>
            </div>
          </>
        )}
        {!editing && !focused && unplaced && onFocus ? (
          <button type="button" className="ttx-map__place" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onClick={onFocus}>
            Choose a location
          </button>
        ) : (
          !editing && <div className="ttx-map__hint">Double-click to pan and zoom</div>
        )}
        {editing && hover && (
          <div className="ttx-map__hover" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.text}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A compact attribution starts as the ⓘ button, opened with a click. MapLibre opens it the first time it has text to
 * show and closes it only on the first drag, which covers small maps with credits. Returns the function that stops
 * watching.
 */
function startClosed(attribution: HTMLElement | null): () => void {
  if (!attribution) return () => {}
  const close = () => {
    if (!attribution.classList.contains('maplibregl-compact-show')) return
    attribution.classList.remove('maplibregl-compact-show')
    // MapLibre opens a compact attribution only once; from here the button toggles it.
    observer.disconnect()
  }
  const observer = new MutationObserver(close)
  observer.observe(attribution, { attributeFilter: ['class'] })
  close()
  return () => observer.disconnect()
}

/** Views from before they were in the doc, kept in this browser's localStorage. Read once, to move them to the doc. */
function legacyView(mapId: string): { center: [number, number]; zoom: number; bearing: number } | undefined {
  try {
    const key = `ttx:map-view:${mapId}`
    const saved = localStorage.getItem(key)
    localStorage.removeItem(key)
    return saved ? { ...WORLD, ...(JSON.parse(saved) as object) } : undefined
  } catch {
    return undefined
  }
}
