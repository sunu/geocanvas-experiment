import { MapTrifoldIcon } from '@phosphor-icons/react'
import type { Basemap } from '../map/basemaps'
import { MapObject } from '../map/MapObject'
import type { ObjectTypeDef } from './types'

declare module '../board/board' {
  interface ObjectFields {
    /** The basemap is shared; the view (center, zoom) is per person and not stored here. */
    map: { basemap: Basemap }
  }
}

export const map: ObjectTypeDef<'map'> = {
  type: 'map',
  label: 'Map',
  key: 'm',
  Icon: MapTrifoldIcon,
  size: { w: 520, h: 360 },
  layer: 'bottom',
  create: (r) => ({ type: 'map', ...r, basemap: 'light' }),
  View: MapObject,
  editable: true,
}
