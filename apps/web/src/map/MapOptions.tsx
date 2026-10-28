import { useEffect, useState } from 'react'
import { Views, type Runtime } from '@ttx/core'
import {
  ADMIN_LEVEL_NAME,
  ADMIN_LEVELS,
  BASEMAPS,
  DATA_LAYERS,
  INDICATORS,
  type AdminLevel,
  type DataLayerKey,
  type Indicator,
  type MapBoardObject,
  type MapLayer,
  type Place,
} from '@ttx/plugins'
import { countryName } from '@ttx/plugins/monty/countries'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import type { ObjectViewProps } from '../canvas/registry'
import { monty } from '../events/monty'
import { isGeoJson, notebookFactory, notebookResultTitle } from '../notebooks/api'
import { LayerList } from './LayerList'
import { useLayerStates } from './layers'
import { areaOf, goTo, liveMap } from './live'
import { fitMapToCountry, fitMapToLayer } from './MapObject'
import { PlaceSearch } from './PlaceSearch'

/** A map op as its own undo step. In focus, `runtime` is the draft: others see it once shared. */
function mapOp(runtime: Runtime, id: string, op: string, args: Record<string, unknown>) {
  runtime.beginGesture()
  runtime.dispatch(op, { kind: 'objects', ids: [id] }, args)
}

const NO_LAYERS: MapLayer[] = []

/**
 * The map's contextual tools in focus mode: go to a place, its data layers, add data for the area in view,
 * admin boundaries, and the events, country figures and notebook results on the board, basemap.
 */
export function MapOptions({ runtime, object: o }: ObjectViewProps<MapBoardObject>) {
  const map = () => liveMap(o.id)
  const layers = o.layers ?? NO_LAYERS
  // The map runs the same tools; the tool runner shares the runs and caches the results.
  const states = useLayerStates(layers)

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

  /** A layer for everyone; this person's view fits it once it loads. */
  const addAndFit = (op: string, args: Record<string, unknown>) => {
    const before = new Set(layers.map((l) => l.id))
    mapOp(runtime, o.id, op, args)
    const added = (runtime.board.get(o.id) as MapBoardObject | undefined)?.layers?.find((l) => !before.has(l.id))
    if (added) fitMapToLayer(runtime, o.id, added)
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
        <LayerList layers={layers} states={states} onUseMyView={useMyView} onRemove={(layerId) => mapOp(runtime, o.id, 'map.removeLayer', { layerId })} />
      </section>
      <section className="ttx-options__section">
        <h3>Add data for this area</h3>
        <div className="ttx-options__list">
          {(Object.keys(DATA_LAYERS) as DataLayerKey[]).map((k) => (
            <button key={k} type="button" onClick={() => addDataLayer(k)}>
              {DATA_LAYERS[k].label}
            </button>
          ))}
        </div>
      </section>
      <section className="ttx-options__section">
        <h3>Boundaries</h3>
        <div className="ttx-options__list">
          {ADMIN_LEVELS.map((level) => (
            <button key={level} type="button" onClick={() => mapOp(runtime, o.id, 'map.addBoundaries', { level })}>
              {ADMIN_LEVEL_NAME[level].many} <span className="ttx-options__sub">· COD-AB</span>
            </button>
          ))}
        </div>
      </section>
      <BoardEvents board={runtime.board as Board} onPick={(eventId, title) => addAndFit('map.addEventLayer', { eventId, title })} />
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
    <section className="ttx-options__section">
      <h3>Events on this board</h3>
      {!eventIds.length ? (
        <p className="ttx-options__empty">Pick an event on the board to show where it happened</p>
      ) : (
        <div className="ttx-options__list">
          {eventIds.map((id) => (
            <button key={id} type="button" title={id} onClick={() => onPick(id, names[id] ?? id)}>
              {names[id] ?? id} <span className="ttx-options__sub">· footprint</span>
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
