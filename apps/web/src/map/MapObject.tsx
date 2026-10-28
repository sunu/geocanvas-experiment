import { useEffect, useRef, useState } from 'react'
import { Map as MapLibreMap, setWorkerUrl, type IControl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { CrosshairSimpleIcon, StackPlusIcon, XIcon } from '@phosphor-icons/react'
import type { ObjectViewProps } from '../canvas/registry'
import { Views, type Runtime } from '@ttx/core'
import {
  ADMIN_LEVEL_NAME,
  ADMIN_LEVELS,
  BASEMAPS,
  DATA_LAYERS,
  hasArea,
  INDICATORS,
  MAP_HEADER_PX,
  viewOfArea,
  type AdminLevel,
  type Basemap,
  type Bbox,
  type DataLayerKey,
  type Indicator,
  type MapBoardObject,
  type MapLayer,
  type PlaceFeatures,
} from '@ttx/plugins'
import type { Place } from '@ttx/plugins'
import { countryName } from '@ttx/plugins/monty/countries'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import { isGeoJson, notebookFactory, notebookResultTitle } from '../notebooks/api'
import { monty } from '../events/monty'
import { tools } from '../tools/registry'
import { ADMIN_AREAS, classify, codab, dataLayerOf, fillLayerIds, syncAdminLayers, type AdminAreas } from './adminAreas'
import { basemapStyle } from './basemaps'
import { attributionOf, boundsOf, deckLayers, truncationOf, useLayerStates, viewArea, type LayerState } from './layers'
import { PlaceSearch } from './PlaceSearch'

// MapLibre 6 finds its worker relative to its own module at runtime, which a bundle breaks: let Vite
// build the worker (?worker&url) and point MapLibre at it. MapLibre 6 also draws right-to-left
// labels (Arabic, Hebrew) itself, so no RTL plugin is needed.
setWorkerUrl(workerUrl)

/** Where a map starts for a person who has no view of it and nobody else has one either. */
const WORLD = { center: [20, 10] as [number, number], zoom: 1, bearing: 0 }
/** A view is saved this long after the map stops moving, so a series of pans is one write. */
const SAVE_AFTER_MS = 1000
/** Zoom for a place without a bbox. */
const POINT_ZOOM = 10
const NO_LAYERS: MapLayer[] = []

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
function fitMapToCountry(runtime: Runtime, mapId: string, iso3: string) {
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
 */
export function MapObject({ runtime, object: o, editing }: ObjectViewProps<MapBoardObject>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap>(null)
  const overlayRef = useRef<MapboxOverlay>(null)
  const styleRef = useRef<Basemap>(o.basemap)
  const layers = o.layers ?? NO_LAYERS
  const states = useLayerStates(layers)
  /** The latest states, for map events. */
  const statesRef = useRef(states)
  /** MapLibre layers can be added: the style has loaded, and no basemap change is under way. */
  const styleReadyRef = useRef(false)
  /** The value under the pointer on a choropleth, while editing. */
  const [hover, setHover] = useState<{ text: string; x: number; y: number }>()

  useEffect(() => {
    const views = new Views(runtime.board.doc)
    const me = runtime.actor.id
    const legacy = views.get(me, o.id) ? undefined : legacyView(o.id)
    if (legacy) views.set(me, o.id, legacy)
    const start = views.get(me, o.id) ?? views.latest(o.id)?.view ?? WORLD
    const map = new MapLibreMap({
      container: glRef.current!,
      style: basemapStyle(styleRef.current),
      center: start.center,
      zoom: start.zoom,
      bearing: start.bearing,
      attributionControl: { compact: true },
    })
    // deck.gl data layers go here. Overlay mode (its own canvas above the map), not interleaved:
    // deck.gl 9.4's interleaved mode throws on every frame with MapLibre 6. The cost is a second
    // WebGL context per map, and deck.gl layers draw above the map's labels.
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay as unknown as IControl)
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

    /** `at` of my view as this map last wrote or showed it: a change with another `at` came from elsewhere. */
    let shownAt = views.get(me, o.id)?.at
    /** The map is moving to a view from elsewhere: do not save that move back. */
    let moving = false
    let pending: ReturnType<typeof setTimeout> | undefined
    const save = () => {
      pending = undefined
      const c = map.getCenter()
      const view = { center: [c.lng, c.lat] as [number, number], zoom: map.getZoom(), bearing: map.getBearing(), at: Date.now() }
      shownAt = view.at
      views.set(me, o.id, view)
    }
    map.on('movestart', () => clearTimeout(pending))
    map.on('moveend', () => {
      if (moving) moving = false
      else pending = setTimeout(save, SAVE_AFTER_MS)
    })
    // My view changed elsewhere: the agent moved it, or another tab of mine.
    const unsubscribe = views.subscribe(() => {
      const view = views.get(me, o.id)
      if (!view || view.at === shownAt) return
      shownAt = view.at
      clearTimeout(pending)
      moving = true
      map.flyTo({ center: view.center, zoom: view.zoom, bearing: view.bearing, duration: 800 })
    })
    mapRef.current = map
    overlayRef.current = overlay
    return () => {
      unsubscribe()
      // A pan that has not been saved yet.
      if (pending) save()
      map.remove()
      mapRef.current = null
      overlayRef.current = null
      styleReadyRef.current = false
    }
  }, [runtime, o.id])

  // Layers whose result arrived or changed. deck.gl diffs by layer id and data, so unchanged layers are cheap.
  useEffect(() => {
    overlayRef.current?.setProps({ layers: deckLayers(states) })
    statesRef.current = states
    if (mapRef.current && styleReadyRef.current) syncAdminLayers(mapRef.current, states)
  })

  useEffect(() => {
    if (styleRef.current === o.basemap) return
    styleRef.current = o.basemap
    // A full reload, so 'style.load' fires and the COD-AB layers are added again.
    styleReadyRef.current = false
    mapRef.current?.setStyle(basemapStyle(o.basemap), { diff: false })
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

  /** Move this person's view to a place (saved as their view like any pan). Other people's views stay where they are. */
  const goTo = (place: Place) => {
    const map = mapRef.current
    if (!map) return
    if (place.bbox) map.fitBounds(place.bbox, { padding: 24, maxZoom: 16 })
    else map.flyTo({ center: place.lngLat, zoom: POINT_ZOOM })
  }

  /** A layer op on this map, as its own undo step. */
  const layerOp = (op: string, args: Record<string, unknown>) => {
    runtime.beginGesture()
    runtime.dispatch(op, { kind: 'objects', ids: [o.id] }, args)
  }

  /** This person's view as an area, from the live map: the view in the doc is saved only after a pause. */
  const myArea = () => {
    const b = mapRef.current?.getBounds()
    if (!b) return undefined
    const [west, south, east, north] = viewArea(b.toArray() as [[number, number], [number, number]])
    return { west, south, east, north }
  }

  /** Mark a place for everyone: a layer that geocodes the place's name again, so it stays a tool recipe. */
  const pin = (place: Place) => {
    goTo(place)
    layerOp('map.pinPlace', { place: place.name })
  }

  const addDataLayer = (layer: DataLayerKey) => {
    const area = myArea()
    if (area) layerOp('map.addLayer', { layer, area })
  }

  /** A layer for everyone; this person's view fits it once it loads. */
  const addAndFit = (op: string, args: Record<string, unknown>) => {
    const before = new Set(layers.map((l) => l.id))
    layerOp(op, args)
    const added = (runtime.board.get(o.id) as MapBoardObject | undefined)?.layers?.find((l) => !before.has(l.id))
    if (added) fitMapToLayer(runtime, o.id, added)
  }

  /** A HAPI figure by province or district, for everyone; this person's view fits the country. */
  const addChoropleth = (country: string, indicator: Indicator, level: AdminLevel, sector?: string) => {
    layerOp('map.addChoropleth', { country, indicator, level, ...(sector && { sector }) })
    fitMapToCountry(runtime, o.id, country)
  }

  const useMyView = (layerId: string) => {
    const area = myArea()
    if (area) layerOp('map.setLayerArea', { layerId, area })
  }

  return (
    <div className="ttx-map">
      <div className="ttx-map__header">
        <span className="ttx-map__title">Map</span>
        <PlaceSearch onGo={goTo} onPin={pin} />
        <AddLayerMenu
          board={runtime.board as Board}
          onAdd={addDataLayer}
          onAddBoundaries={(level) => layerOp('map.addBoundaries', { level })}
          onAddEvent={(eventId, title) => addAndFit('map.addEventLayer', { eventId, title })}
          onAddChoropleth={addChoropleth}
          onAddNotebookResult={(runId, name, title) => addAndFit('map.addNotebookResult', { runId, name, title })}
        />
        <select
          aria-label="Basemap"
          value={o.basemap}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            runtime.beginGesture()
            runtime.dispatch('map.setBasemap', { kind: 'objects', ids: [o.id] }, { basemap: e.target.value })
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
        {editing && hover && (
          <div className="ttx-map__hover" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.text}
          </div>
        )}
        <LayerList layers={layers} states={states} onUseMyView={useMyView} onRemove={(layerId) => layerOp('map.removeLayer', { layerId })} />
      </div>
    </div>
  )
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

interface AddLayerMenuProps {
  board: Board
  onAdd(layer: DataLayerKey): void
  onAddBoundaries(level: AdminLevel): void
  onAddEvent(eventId: string, title: string): void
  onAddChoropleth(country: string, indicator: Indicator, level: AdminLevel, sector?: string): void
  onAddNotebookResult(runId: string, name: string, title: string): void
}

/**
 * "Add layer": data for the area this person is looking at, admin boundaries, the events on the board, the HDX HAPI
 * figures of the country widgets on the board by area, and the GeoJSON results of notebooks on the board.
 */
function AddLayerMenu({ board, onAdd, onAddBoundaries, onAddEvent, onAddChoropleth, onAddNotebookResult }: AddLayerMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="ttx-addlayer" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" title="Add a data layer" aria-label="Add layer" aria-expanded={open} onClick={() => setOpen(!open)}>
        <StackPlusIcon size={16} />
      </button>
      {open && (
        <div className="ttx-addlayer__menu" role="menu">
          <div className="ttx-addlayer__label">For your current view</div>
          {(Object.keys(DATA_LAYERS) as DataLayerKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              onClick={() => {
                onAdd(k)
                setOpen(false)
              }}
            >
              {DATA_LAYERS[k].label}
            </button>
          ))}
          <div className="ttx-addlayer__label">Boundaries</div>
          {ADMIN_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitem"
              onClick={() => {
                onAddBoundaries(level)
                setOpen(false)
              }}
            >
              {ADMIN_LEVEL_NAME[level].many} (COD-AB)
            </button>
          ))}
          <BoardEvents
            board={board}
            onPick={(eventId, title) => {
              onAddEvent(eventId, title)
              setOpen(false)
            }}
          />
          <CountryData
            board={board}
            onPick={(...args) => {
              onAddChoropleth(...args)
              setOpen(false)
            }}
          />
          <NotebookResults
            board={board}
            onPick={(runId, name, title) => {
              onAddNotebookResult(runId, name, title)
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

/** The events picked on this board, by name, to show where they happened. Names come from the event cache the event cards fill. */
function BoardEvents({ board, onPick }: { board: Board; onPick(eventId: string, title: string): void }) {
  const objects = useObjects(board)
  const eventIds = [...new Set(objects.flatMap((o) => (o.type === 'event' && o.eventId ? [o.eventId] : [])))]
  const key = eventIds.join(',')
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let current = true
    for (const id of eventIds)
      monty.getEvent(id).then(
        (e) => current && setNames((n) => ({ ...n, [id]: e.name })),
        () => {}, // listed by id
      )
    return () => {
      current = false
    }
    // `key` stands for eventIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <>
      <div className="ttx-addlayer__label">Events on this board</div>
      {!eventIds.length ? (
        <div className="ttx-addlayer__note">Pick an event on the board to show where it happened</div>
      ) : (
        eventIds.map((id) => (
          <button key={id} type="button" role="menuitem" title={id} onClick={() => onPick(id, names[id] ?? id)}>
            {names[id] ?? id} <span className="ttx-addlayer__sub">· footprint</span>
          </button>
        ))
      )}
    </>
  )
}


/**
 * The HDX HAPI figures of the who's where and conflict widgets on this board, as choropleths by province or district.
 * Who's where gives its sector filter to the layer.
 */
function CountryData({ board, onPick }: { board: Board; onPick(country: string, indicator: Indicator, level: AdminLevel, sector?: string): void }) {
  const objects = useObjects(board)
  const items = new Map<string, { country: string; indicator: Indicator; sector?: string }>()
  for (const o of objects) {
    if (o.type === 'presence' && o.country) items.set(`${o.country}:organizations:${o.sector}`, { country: o.country, indicator: 'organizations', sector: o.sector || undefined })
    if (o.type === 'conflict' && o.country) items.set(`${o.country}:conflictEvents`, { country: o.country, indicator: 'conflictEvents' })
  }
  return (
    <>
      <div className="ttx-addlayer__label">Country data on this board</div>
      {!items.size ? (
        <div className="ttx-addlayer__note">Add a who's where or conflict widget to color a country's areas by its data</div>
      ) : (
        [...items].flatMap(([key, { country, indicator, sector }]) =>
          ADMIN_LEVELS.map((level) => (
            <button key={`${key}:${level}`} type="button" role="menuitem" onClick={() => onPick(country, indicator, level, sector)}>
              {INDICATORS[indicator].name}
              {sector ? ` (${sector})` : ''} by {ADMIN_LEVEL_NAME[level].one} <span className="ttx-addlayer__sub">· {countryName(country) ?? country}</span>
            </button>
          )),
        )
      )}
    </>
  )
}

/** The GeoJSON files of the notebook runs on this board. Asked for only while the menu is open. */
function NotebookResults({ board, onPick }: { board: Board; onPick(runId: string, name: string, title: string): void }) {
  const objects = useObjects(board)
  const runIds = [...new Set(objects.flatMap((o) => (o.type === 'notebook' && o.runId ? [o.runId] : [])))]
  const key = runIds.join(',')
  const [files, setFiles] = useState<{ runId: string; runTitle: string; name: string }[]>()

  useEffect(() => {
    let current = true
    Promise.all(runIds.map((id) => notebookFactory.getRun(id).catch(() => undefined))).then((runs) => {
      if (!current) return
      setFiles(runs.flatMap((r) => (r ? Object.keys(r.artifacts ?? {}).filter(isGeoJson).map((name) => ({ runId: r.id, runTitle: r.title, name })) : [])))
    })
    return () => {
      current = false
    }
    // `key` stands for runIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <>
      <div className="ttx-addlayer__label">Notebook results</div>
      {!runIds.length ? (
        <div className="ttx-addlayer__note">Add a notebook to the board to show its results here</div>
      ) : !files ? (
        <div className="ttx-addlayer__note">Loading…</div>
      ) : !files.length ? (
        <div className="ttx-addlayer__note">The notebooks on this board have no GeoJSON results</div>
      ) : (
        files.map((f) => (
          <button
            key={`${f.runId}/${f.name}`}
            type="button"
            role="menuitem"
            title={f.runTitle}
            onClick={() => onPick(f.runId, f.name, notebookResultTitle(f.name, f.runTitle))}
          >
            {f.name} <span className="ttx-addlayer__sub">· {f.runTitle}</span>
          </button>
        ))
      )}
    </>
  )
}

interface LayerListProps {
  /** The recipes, in the same order as `states`. */
  layers: MapLayer[]
  states: LayerState[]
  onUseMyView(id: string): void
  onRemove(id: string): void
}

/** The map's data layers: title, status or attribution, and actions. Clickable whether or not the map is being edited. */
function LayerList({ layers, states, onUseMyView, onRemove }: LayerListProps) {
  if (!states.length) return null
  return (
    <div className="ttx-layers" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {states.map((s, i) => {
        const note = s.error ?? (s.loading ? 'Loading…' : [truncationOf(s.value), attributionOf(s.value)].filter(Boolean).join(' · '))
        return (
          <div key={s.id} className={`ttx-layers__item ${s.error ? 'is-error' : ''}`}>
            <div className="ttx-layers__text">
              <div className="ttx-layers__title">{s.title}</div>
              {s.output === ADMIN_AREAS && s.value !== undefined && <AdminLegend areas={s.value as AdminAreas} />}
              {note && <div className="ttx-layers__note">{note}</div>}
            </div>
            {layers[i] && hasArea(layers[i]) && (
              <button type="button" title="Show this layer for your current view, for everyone" aria-label={`Use my view for ${s.title}`} onClick={() => onUseMyView(s.id)}>
                <CrosshairSimpleIcon size={12} />
              </button>
            )}
            <button type="button" title="Remove layer" aria-label={`Remove layer ${s.title}`} onClick={() => onRemove(s.id)}>
              <XIcon size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** A choropleth's classes, and the areas left out because HAPI could not place them. */
function AdminLegend({ areas }: { areas: AdminAreas }) {
  if (!areas.values) return null
  const { legend } = classify(areas.values)
  return (
    <div className="ttx-layers__legend">
      {legend.classes.map((c) => (
        <span key={c.label}>
          <i style={{ background: c.color }} />
          {c.label}
        </span>
      ))}
      {areas.unit && <span className="ttx-layers__note">{areas.unit}</span>}
      {!!areas.unmatched && (
        <div className="ttx-layers__note">
          Left out: {areas.unmatched.toLocaleString('en-US')} {areas.unit} in areas HDX HAPI could not place
        </div>
      )}
    </div>
  )
}
