export type DisasterType = 'cyclone' | 'flood' | 'earthquake' | 'drought'
export type Severity = 'green' | 'orange' | 'red'

export interface DisasterEvent {
  id: string
  type: DisasterType
  name: string
  region: string
  country: string
  /** ISO date. */
  start: string
  end: string
  year: number
  center: [number, number]
  severity: Severity
  /** Footprint: the area that the event affected. */
  footprint: GeoJSON.Feature<GeoJSON.Polygon>
}

export interface EventSummary {
  id: string
  name: string
  type: DisasterType
  year: number
  country: string
  severity: Severity
}

export interface ImpactRow {
  district: string
  people: number
  /** USD millions. */
  damage: number
}

export interface EventQuery {
  near: [number, number]
  radiusKm: number
  types?: DisasterType[]
  fromYear: number
  toYear: number
  excludeId?: string
}

/** Data access for the disasters plugin. A mock and, later, real API clients implement it. */
export interface DisasterProvider {
  listEvents(): Promise<EventSummary[]>
  getEvent(id: string): Promise<DisasterEvent>
  searchEvents(q: EventQuery): Promise<DisasterEvent[]>
  /** Impact per district inside the AOI. The AOI defaults to the event footprint. */
  getImpact(eventId: string, aoi?: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>): Promise<ImpactRow[]>
}
