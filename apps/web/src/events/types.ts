export type DisasterType = 'cyclone' | 'flood' | 'earthquake' | 'drought'

/** One event in the picker. */
export interface EventSummary {
  id: string
  name: string
  type: DisasterType
  /** ISO date. */
  start: string
  year: number
  /** ISO 3166-1 alpha-3, as Monty stores it. */
  country: string
  /** The source's short name, e.g. "EM-DAT". */
  source: string
}

/** An event with what Monty knows about it. */
export interface DisasterEvent extends EventSummary {
  /** ISO date. */
  end: string
  /** Hazard intensity, e.g. magnitude 7.8 or wind speed 204 km/h. */
  hazard?: { value: number; unit: string; label: string }
  /** Headline impact totals: the largest figure across sources. Damage is USD millions. */
  impacts?: ImpactTotals
  /** Monty correlation id. Links the event to its impact rows. */
  corrId?: string
  /**
   * What each Monty source reports about the event. Sources record the same event under different ids, so these are
   * found by hazard, country and time.
   */
  sources?: SourceReport[]
}

export interface SourceReport {
  /** Monty source name, e.g. "gdacs", "emdat", "usgs". */
  source: string
  /** Events of this source that describe the event. Empty when the source only has impact data. */
  eventIds: string[]
  impacts?: ImpactTotals
}

export interface ImpactTotals {
  deaths?: number
  injured?: number
  affected?: number
  displaced?: number
  /** USD millions. */
  damage?: number
}
