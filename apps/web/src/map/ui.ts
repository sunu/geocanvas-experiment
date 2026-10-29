import { MapTrifoldIcon } from '@phosphor-icons/react'
import type { MapBoardObject } from '@ttx/plugins'
import { registerObjectUI } from '../canvas/registry'
import { MapObject } from './MapObject'
import { MapOptions, shareMapView } from './MapOptions'

registerObjectUI('map', {
  View: MapObject,
  tool: { key: 'M', label: 'Map', Icon: MapTrifoldIcon },
  editable: true,
  Options: MapOptions,
  beforeShare: shareMapView,
  panel: (o: MapBoardObject) => {
    const layers = o.layers ?? []
    return {
      title: layers.length === 1 ? layers[0]!.title : 'Untitled map',
      description: layers.length ? layers.map((l) => l.title).join(', ') : 'No data layers yet',
      metadata: [
        ['Basemap', o.basemap.charAt(0).toUpperCase() + o.basemap.slice(1)],
        ['Layers', String(layers.length)],
        ['Annotations', String(o.annotations?.length ?? 0)],
        ['Projection', 'Web Mercator'],
      ],
    }
  },
})
