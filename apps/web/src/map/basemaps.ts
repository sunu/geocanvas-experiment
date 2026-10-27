import type { StyleSpecification } from 'maplibre-gl'
import type { Basemap } from '@ttx/shapes'

/** Basemaps that need no API key. */
const VECTOR_STYLES: Record<Exclude<Basemap, 'satellite'>, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
  streets: 'https://tiles.openfreemap.org/styles/liberty',
}

const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
}

export function basemapStyle(name: Basemap): string | StyleSpecification {
  return name === 'satellite' ? SATELLITE : VECTOR_STYLES[name]
}
