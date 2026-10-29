import { useEffect, useState } from 'react'
import { CaretRightIcon, XIcon } from '@phosphor-icons/react'
import { Views, type Runtime } from '@ttx/core'
import {
  ADMIN_LEVEL_NAME,
  ADMIN_LEVELS,
  BASEMAPS,
  DATA_LAYERS,
  FORECAST_VARIABLES,
  footprintParts,
  HORIZONS,
  INDICATORS,
  type AdminLevel,
  type DataLayerKey,
  type ForecastVariable,
  type Horizon,
  type Indicator,
  type MapBoardObject,
  type MapLayer,
  type MapAnnotation,
  type Place,
  type Shape,
  SHAPE_COLORS,
  URL_FORMATS,
} from '@ttx/plugins'
import { countryName } from '@ttx/plugins/monty/countries'
import type { EventFootprint } from '@ttx/plugins/monty/client'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import type { ObjectViewProps } from '../canvas/registry'
import { monty } from '../events/monty'
import { isGeoJson, notebookFactory, notebookResultTitle } from '../notebooks/api'
import { LayerList } from './LayerList'
import { boundsOf, useLayerStates } from './layers'
import { areaOf, goTo, liveMap } from './live'
import { LocationPicker } from './LocationPicker'
import { fitMapTo, fitMapToCountry, fitMapToLayer } from './MapObject'
import { PlaceSearch } from './PlaceSearch'
import { FileLayerButton } from './FileLayerButton'
import { UrlLayerForm, type UrlLayerArgs } from './UrlLayerForm'

/** A map op as its own undo step. In focus, `runtime` is the draft: others see it once shared. */
function mapOp(runtime: Runtime, id: string, op: string, args: Record<string, unknown>) {
  runtime.beginGesture()
  runtime.dispatch(op, { kind: 'objects', ids: [id] }, args)
}

const NO_LAYERS: MapLayer[] = []

/** A section of the panel that opens and closes, closed at first. */
function Accordion({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="ttx-options__section ttx-options__accordion">
      <summary>
        <CaretRightIcon size={12} aria-hidden />
        <h3>{title}</h3>
      </summary>
      {children}
    </details>
  )
}

/**
 * The map's contextual tools in focus mode: where everyone looks, go to a place, its data layers, add data for the area in view,
 * admin boundaries, and the events, country figures and notebook results on the board, basemap.
 */
export function MapOptions({ runtime, object: o }: ObjectViewProps<MapBoardObject>) {
  const map = () => liveMap(o.id)
  const layers = o.layers ?? NO_LAYERS
  // The map runs the same tools; the tool runner shares the runs and caches the results.
  const states = useLayerStates(layers)
  const [forecast, setForecast] = useState<{ busy?: boolean; error?: string }>({})
  const [hours, setHours] = useState<Horizon>(72)

  /** Mark a place for everyone: a layer that geocodes the place's name again, so it stays a tool recipe. */
  const pin = (place: Place) => {
    const m = map()
    if (m) goTo(m, place)
    mapOp(runtime, o.id, 'map.pinPlace', { place: place.name })
  }

  const addDataLayer = (layer: DataLayerKey) => {
    const m = map()
    if (m) mapOp(runtime, o.id, 'map.addLayer', { layer, area: areaOf(m) })
  }

  /**
   * A forecast for the area in view. The op looks up the latest complete run over the network (a few seconds) and
   * stores it in the layer, so it is async; a failure (no complete run, area too large, provider down) is shown here.
   */
  const addForecast = async (variable: ForecastVariable, hours: Horizon) => {
    const m = map()
    if (!m) return
    setForecast({ busy: true })
    const r = await runtime.invoke('map.addForecast', { kind: 'objects', ids: [o.id] }, { variable, hours, area: areaOf(m) })
    setForecast(r.status === 'failed' ? { error: r.error ?? 'Could not add the forecast' } : {})
  }

  /** A layer for everyone; this person's view fits it once it loads. */
  const addAndFit = (op: string, args: Record<string, unknown>) => {
    const before = new Set(layers.map((l) => l.id))
    mapOp(runtime, o.id, op, args)
    const added = (runtime.board.get(o.id) as MapBoardObject | undefined)?.layers?.find((l) => !before.has(l.id))
    if (added) fitMapToLayer(runtime, o.id, added)
  }

  /**
   * An event's footprint, for everyone, as a layer per source's area or track and one for its points, named, so each
   * can be styled, filtered or removed on its own. This person's view fits the hazard areas (not the areas that only
   * locate the event, often a whole country). Without a footprint, one layer, which says why in the list.
   */
  const addFootprint = (eventId: string, title: string) =>
    monty.getFootprint(eventId).then(
      (fc) => {
        mapOp(runtime, o.id, 'map.addEventLayers', { eventId, parts: footprintParts(fc, title) })
        const hazards = fc.features.filter((f) => f.properties.kind === 'hazard')
        const bounds = boundsOf({ type: 'FeatureCollection', features: (hazards.length ? hazards : fc.features) as GeoJSON.Feature[] })
        if (bounds) fitMapTo(runtime, o.id, bounds)
      },
      () => addAndFit('map.addEventLayer', { eventId, title }),
    )

  /** A whole footprint already on the map (the agent's, a template's, an older board's), split in its place. */
  const splitFootprint = (layerId: string) => {
    const s = states.find((st) => st.id === layerId)
    if (s?.value) mapOp(runtime, o.id, 'map.splitEventLayer', { layerId, parts: footprintParts(s.value as EventFootprint, s.title) })
  }

  /** A layer from a URL, for everyone; features also fit this person's view once read. */
  const addUrlLayer = (args: UrlLayerArgs) => {
    if (URL_FORMATS[args.format].tool === 'data.urlFeatures') addAndFit('map.addUrlLayer', { ...args })
    else mapOp(runtime, o.id, 'map.addUrlLayer', { ...args })
  }

  /** A HAPI figure by province or district, for everyone; this person's view fits the country. */
  const addChoropleth = (country: string, indicator: Indicator, level: AdminLevel, sector?: string) => {
    mapOp(runtime, o.id, 'map.addChoropleth', { country, indicator, level, ...(sector && { sector }) })
    fitMapToCountry(runtime, o.id, country)
  }

  /** Fetch a layer's data again, for the area this person sees. */
  const useMyView = (layerId: string) => {
    const m = map()
    if (m) mapOp(runtime, o.id, 'map.setLayerArea', { layerId, area: areaOf(m) })
  }

  return (
    <>
      <LocationPicker runtime={runtime} mapId={o.id} />
      <section className="ttx-options__section">
        <h3>openEO prototype</h3>
        <p className="ttx-options__empty">Propose a Sentinel-1 VV before/after change layer for the area shown. It will not run until approved.</p>
        <button
          type="button"
          onClick={() => {
            const m = map()
            if (m) void runtime.invoke('openeo.proposeSarChange', { kind: 'objects', ids: [o.id] }, { area: areaOf(m) })
          }}
        >
          Propose SAR change layer
        </button>
      </section>
      <section className="ttx-options__section">
        <h3>Go to place</h3>
        <PlaceSearch
          onGo={(place) => {
            const m = map()
            if (m) goTo(m, place)
          }}
          onPin={pin}
        />
      </section>
      <section className="ttx-options__section">
        <h3>Layers</h3>
        <LayerList
          layers={layers}
          states={states}
          onUseMyView={useMyView}
          onRemove={(layerId) => mapOp(runtime, o.id, 'map.removeLayer', { layerId })}
          onFilter={(layerId, filter) => mapOp(runtime, o.id, 'map.setLayerFilter', { layerId, ...(filter && { filter }) })}
          onStyle={(layerId, style) => mapOp(runtime, o.id, 'map.setLayerStyle', { layerId, style })}
          onSplit={splitFootprint}
        />
      </section>
      <Drawings annotations={o.annotations ?? []} onRemove={(annotationId) => mapOp(runtime, o.id, 'map.removeAnnotation', { annotationId })} />
      <Accordion title="Add data for this area">
        <div className="ttx-options__list">
          {(Object.keys(DATA_LAYERS) as DataLayerKey[]).map((k) => (
            <button key={k} type="button" onClick={() => addDataLayer(k)}>
              {DATA_LAYERS[k].label}
            </button>
          ))}
        </div>
      </Accordion>
      <Accordion title="Weather forecast">
        <div className="ttx-options__list">
          {(Object.keys(FORECAST_VARIABLES) as ForecastVariable[]).map((v) => (
            <button key={v} type="button" disabled={forecast.busy} onClick={() => void addForecast(v, hours)}>
              {FORECAST_VARIABLES[v].label} <span className="ttx-options__sub">· NOAA GFS</span>
            </button>
          ))}
        </div>
        <select aria-label="Hours ahead" value={hours} onChange={(e) => setHours(Number(e.target.value) as Horizon)}>
          {HORIZONS.map((h) => (
            <option key={h} value={h}>
              next {h} h
            </option>
          ))}
        </select>
        {forecast.busy && <p className="ttx-options__empty">Finding the latest forecast run…</p>}
        {forecast.error && (
          <p className="ttx-options__error" role="alert">
            {forecast.error}
          </p>
        )}
        <p className="ttx-options__empty">For the area in view, at most 30° wide. Forecast context, not an official warning.</p>
      </Accordion>
      <Accordion title="Add from a URL or a file">
        <UrlLayerForm onAdd={addUrlLayer} />
        <FileLayerButton person={runtime.actor.id} onAdd={addUrlLayer} />
      </Accordion>
      <Accordion title="Boundaries">
        <div className="ttx-options__list">
          {ADMIN_LEVELS.map((level) => (
            <button key={level} type="button" onClick={() => mapOp(runtime, o.id, 'map.addBoundaries', { level })}>
              {ADMIN_LEVEL_NAME[level].many} <span className="ttx-options__sub">· COD-AB</span>
            </button>
          ))}
        </div>
      </Accordion>
      <BoardEvents board={runtime.board as Board} onPick={addFootprint} />
      <CountryData board={runtime.board as Board} onPick={addChoropleth} />
      <NotebookResults board={runtime.board as Board} onPick={(runId, name, title) => addAndFit('map.addNotebookResult', { runId, name, title })} />
      <section className="ttx-options__section">
        <h3>Basemap</h3>
        <select aria-label="Basemap" value={o.basemap} onChange={(e) => mapOp(runtime, o.id, 'map.setBasemap', { basemap: e.target.value })}>
          {BASEMAPS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </section>
    </>
  )
}

const SHAPE_NAMES: Record<Shape, string> = { arrow: 'Arrow', line: 'Line', rectangle: 'Rectangle', circle: 'Circle', polygon: 'Polygon', freehand: 'Drawing' }

/** The notes and shapes on the map, drawn with its drawing box (or by the agent), each removable. */
function Drawings({ annotations, onRemove }: { annotations: MapAnnotation[]; onRemove(id: string): void }) {
  return (
    <section className="ttx-options__section">
      <h3>Notes and drawings</h3>
      {!annotations.length ? (
        <p className="ttx-options__empty">Draw with the box at the top right of the map.</p>
      ) : (
        <div className="ttx-layers">
          {annotations.map((a) => {
            const label = a.kind === 'sticky' ? `Note: ${a.text.trim() || '(empty)'}` : SHAPE_NAMES[a.shape]
            return (
              <div key={a.id} className="ttx-layers__entry">
                <div className="ttx-layers__item">
                  <i className="ttx-drawings__swatch" style={{ background: a.kind === 'shape' ? SHAPE_COLORS[a.color] : '#fde68a' }} />
                  <div className="ttx-layers__text">
                    <div className="ttx-layers__title">{label}</div>
                  </div>
                  <button type="button" title="Remove" aria-label={`Remove ${label}`} onClick={() => onRemove(a.id)}>
                    <XIcon size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

/** The events picked on this board, by name, to show where they happened. Names come from the event cache the event cards fill. */
function BoardEvents({ board, onPick }: { board: Board; onPick(eventId: string, title: string): Promise<void> }) {
  const objects = useObjects(board)
  const eventIds = [...new Set(objects.flatMap((o) => (o.type === 'event' && o.eventId ? [o.eventId] : [])))]
  const key = eventIds.join(',')
  const [names, setNames] = useState<Record<string, string>>({})
  /** The events whose footprint is being read, to add it. */
  const [adding, setAdding] = useState<Set<string>>(new Set())
  const pick = (id: string) => {
    setAdding((a) => new Set(a).add(id))
    void onPick(id, names[id] ?? id).finally(() =>
      setAdding((a) => {
        const next = new Set(a)
        next.delete(id)
        return next
      }),
    )
  }

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
    <section className="ttx-options__section">
      <h3>Events on this board</h3>
      {!eventIds.length ? (
        <p className="ttx-options__empty">Pick an event on the board to show where it happened</p>
      ) : (
        <div className="ttx-options__list">
          {eventIds.map((id) => (
            <button key={id} type="button" title={id} disabled={adding.has(id)} onClick={() => pick(id)}>
              {names[id] ?? id} <span className="ttx-options__sub">· {adding.has(id) ? 'reading the footprint…' : 'footprint by source'}</span>
            </button>
          ))}
        </div>
      )}
    </section>
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
    <section className="ttx-options__section">
      <h3>Country data on this board</h3>
      {!items.size ? (
        <p className="ttx-options__empty">Add a who's where or conflict widget to color a country's areas by its data</p>
      ) : (
        <div className="ttx-options__list">
          {[...items].flatMap(([key, { country, indicator, sector }]) =>
            ADMIN_LEVELS.map((level) => (
              <button key={`${key}:${level}`} type="button" onClick={() => onPick(country, indicator, level, sector)}>
                {INDICATORS[indicator].name}
                {sector ? ` (${sector})` : ''} by {ADMIN_LEVEL_NAME[level].one} <span className="ttx-options__sub">· {countryName(country) ?? country}</span>
              </button>
            )),
          )}
        </div>
      )}
    </section>
  )
}

/** The GeoJSON files of the notebook runs on this board. */
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
    <section className="ttx-options__section">
      <h3>Notebook results</h3>
      {!runIds.length ? (
        <p className="ttx-options__empty">Add a notebook to the board to show its results here</p>
      ) : !files ? (
        <p className="ttx-options__empty">Loading…</p>
      ) : !files.length ? (
        <p className="ttx-options__empty">The notebooks on this board have no GeoJSON results</p>
      ) : (
        <div className="ttx-options__list">
          {files.map((f) => (
            <button key={`${f.runId}/${f.name}`} type="button" title={f.runTitle} onClick={() => onPick(f.runId, f.name, notebookResultTitle(f.name, f.runTitle))}>
              {f.name} <span className="ttx-options__sub">· {f.runTitle}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Sharing a map also shares the view: everyone else's view of it moves to the area this person sees.
 * Their maps keep their own size, so they get the same area, not the same zoom. This person's view is
 * left as it is (it is already in the draft).
 */
export function shareMapView(runtime: Runtime, o: MapBoardObject) {
  const m = liveMap(o.id)
  if (!m) return
  const others = new Views(runtime.board.doc)
    .of(o.id)
    .map((v) => v.person)
    .filter((person) => person !== runtime.actor.id)
  if (others.length) mapOp(runtime, o.id, 'map.showArea', { ...areaOf(m), for: others })
}
