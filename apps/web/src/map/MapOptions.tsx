import { Views, type Runtime } from '@ttx/core'
import { BASEMAPS, DATA_LAYERS, type DataLayerKey, type MapBoardObject, type MapLayer, type Place } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { LayerList } from './LayerList'
import { useLayerStates } from './layers'
import { areaOf, goTo, liveMap } from './live'
import { PlaceSearch } from './PlaceSearch'

/** A map op as its own undo step. In focus, `runtime` is the draft: others see it once shared. */
function mapOp(runtime: Runtime, id: string, op: string, args: Record<string, unknown>) {
  runtime.beginGesture()
  runtime.dispatch(op, { kind: 'objects', ids: [id] }, args)
}

const NO_LAYERS: MapLayer[] = []

/** The map's contextual tools in focus mode: go to a place, its data layers, add data for the area in view, basemap. */
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
