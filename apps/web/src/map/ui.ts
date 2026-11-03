import { MapTrifoldIcon } from '@phosphor-icons/react'
import { analysisOf, ANALYSIS_TITLE, type MapBoardObject } from '@ttx/plugins'
import { registerObjectUI } from '../canvas/registry'
import { MapObject } from './MapObject'
import { MapOptions, shareMapView } from './MapOptions'

registerObjectUI('map', {
  View: MapObject,
  tool: { key: 'M', label: 'Map', Icon: MapTrifoldIcon },
  editable: true,
  // 'map:routes' and 'map:exposure' in the toolbar are a route map and a flood exposure map.
  variantField: 'analysis',
  Options: MapOptions,
  beforeShare: shareMapView,
  panel: (o: MapBoardObject) => {
    const layers = o.layers ?? []
    return {
      title: layers.length === 1 ? layers[0]!.title : 'Untitled map',
      description: layers.length ? layers.map((l) => l.title).join(', ') : 'No data layers yet',
      metadata: [
        ...(analysisOf(o) ? [['For', ANALYSIS_TITLE[analysisOf(o)!]] as [string, string]] : []),
        ['Basemap', o.basemap.charAt(0).toUpperCase() + o.basemap.slice(1)],
        ['Layers', String(layers.length)],
        ['Annotations', String(o.annotations?.length ?? 0)],
        ['Projection', 'Web Mercator'],
      ],
    }
  },
})
