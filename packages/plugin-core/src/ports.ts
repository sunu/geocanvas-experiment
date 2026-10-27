import type { PortTypeDef } from '@geo-canvas/core'

export type Aoi = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>

export interface Table {
  rows: Record<string, unknown>[]
  /** Name of the label column and the value column. */
  x: string
  y: string
  unit?: string
  total?: number
}

export const corePortTypes: PortTypeDef[] = [
  { id: 'any', description: 'Any value' },
  { id: 'geo.aoi', description: 'Area of interest: a GeoJSON Polygon or MultiPolygon feature' },
  { id: 'geo.features', description: 'A GeoJSON FeatureCollection to show on a map' },
  { id: 'core.table', description: 'Rows with a label column and a value column' },
  { id: 'core.number', description: 'A number' },
]
