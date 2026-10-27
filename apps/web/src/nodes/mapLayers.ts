import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer } from '@deck.gl/layers'

/**
 * deck.gl layer factories, keyed by port type. A map node makes layers for each
 * input value with a matching factory. Plugins can register factories for their own port types.
 */
export type LayerFactory = (value: unknown, ctx: { id: string; dark: boolean }) => Layer[]

export const layerFactories = new Map<string, LayerFactory>()

export function registerLayerFactory(portType: string, f: LayerFactory) {
  layerFactories.set(portType, f)
}

type RGBA = [number, number, number, number]

registerLayerFactory('geo.aoi', (value, { id }) => [
  new GeoJsonLayer({
    id: `${id}-aoi`,
    data: value as GeoJSON.Feature,
    filled: true,
    stroked: true,
    getFillColor: [224, 49, 49, 50],
    getLineColor: [224, 49, 49, 220],
    lineWidthUnits: 'pixels',
    getLineWidth: 2,
  }),
])

/** Features may set properties.color ([r,g,b]) and properties.name. */
registerLayerFactory('geo.features', (value, { id, dark }) => [
  new GeoJsonLayer({
    id: `${id}-features`,
    data: value as GeoJSON.FeatureCollection,
    pointType: 'circle',
    pickable: true,
    getPointRadius: 7,
    pointRadiusUnits: 'pixels',
    getFillColor: (f: GeoJSON.Feature) => [...((f.properties?.color as number[]) ?? [25, 113, 194]), 220] as RGBA,
    getLineColor: dark ? [20, 20, 20, 255] : [255, 255, 255, 255],
    lineWidthUnits: 'pixels',
    getLineWidth: 1.5,
    stroked: true,
  }),
])
