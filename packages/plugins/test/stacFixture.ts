export interface FakeItem {
  id: string
  title: string
  start: string
  collection?: string
  hazards?: string[]
  countries?: string[]
  /** Overrides the id derived from date, country and hazard. */
  corrId?: string
}

/** A Monty event item with just the fields the provider reads. */
export function stacItem({ id, title, start, collection = 'gdacs-events', hazards = ['FL'], countries = ['NPL'], corrId }: FakeItem) {
  return {
    id,
    collection,
    geometry: { type: 'Point' as const, coordinates: [85, 27] },
    properties: {
      title,
      datetime: `${start}T00:00:00Z`,
      start_datetime: `${start}T00:00:00Z`,
      end_datetime: `${start}T00:00:00Z`,
      'monty:hazard_codes': hazards,
      'monty:country_codes': countries,
      'monty:corr_id': corrId ?? `${start}-${countries[0]}-1-${hazards[0]}-1-GCDB`,
    },
  }
}
