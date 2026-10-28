import { MapTrifoldIcon } from '@phosphor-icons/react'
import { registerObjectUI } from '../canvas/registry'
import { MapObject } from './MapObject'
import { MapOptions, shareMapView } from './MapOptions'

registerObjectUI('map', {
  View: MapObject,
  tool: { key: 'M', label: 'Map', Icon: MapTrifoldIcon },
  editable: true,
  Options: MapOptions,
  beforeShare: shareMapView,
})
