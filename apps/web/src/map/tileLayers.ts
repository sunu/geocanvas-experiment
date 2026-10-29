import type { Map as MapLibreMap } from 'maplibre-gl'
import type { LayerState } from './layers'

const PREFIX = 'ttx-xyz-'

/** Synchronize shared EOPF/custom XYZ recipes with MapLibre raster sources. */
export function syncTileLayers(map: MapLibreMap, states: LayerState[]) {
  const tiles = states.filter((state) => state.output === 'geo.tiles' && state.value !== undefined)
  const desired = new Map(tiles.map((state) => [`${PREFIX}${state.id}`, state]))

  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith(PREFIX) && !desired.has(layer.id)) map.removeLayer(layer.id)
  }
  for (const [id, source] of Object.entries(map.getStyle().sources)) {
    if (id.startsWith(PREFIX) && !desired.has(id)) map.removeSource(id)
  }

  for (const [id, state] of desired) {
    const value = state.value as { tiles?: unknown; bounds?: unknown; opacity?: unknown; attribution?: unknown }
    if (!Array.isArray(value.tiles) || !value.tiles.every((url) => typeof url === 'string')) continue
    const tileUrls = value.tiles as string[]
    const existing = map.getStyle().sources[id] as { tiles?: string[] } | undefined
    const same = existing && JSON.stringify(existing.tiles) === JSON.stringify(tileUrls)
    if (!same) {
      if (map.getLayer(id)) map.removeLayer(id)
      if (existing) map.removeSource(id)
      map.addSource(id, {
        type: 'raster',
        tiles: tileUrls,
        tileSize: 256,
        ...(Array.isArray(value.bounds) && value.bounds.length === 4 ? { bounds: value.bounds as [number, number, number, number] } : {}),
        ...(typeof value.attribution === 'string' ? { attribution: value.attribution } : {}),
      })
    }
    const opacity = typeof value.opacity === 'number' ? value.opacity : 0.78
    if (map.getLayer(id)) {
      map.setPaintProperty(id, 'raster-opacity', opacity)
    } else {
      const before = map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity } }, before)
    }
  }
}
