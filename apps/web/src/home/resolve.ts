import { glidesOf, type PlaceFeatures, type TemplateId } from '@ttx/plugins'
import { monty } from '../events/monty'
import { tools } from '../tools/registry'
import type { PendingSetup } from './pending'

const ISO3 = /^[A-Z]{3}$/

/**
 * Turn what the New board dialog chose into the board's setup: the event's name, country and GLIDE numbers,
 * and the place's area. It runs before the board is made, so a failure shows in the dialog.
 */
export async function resolveSetup(choice: { title?: string; template?: TemplateId; eventId?: string; place?: string }): Promise<PendingSetup> {
  const { title, template, eventId, place } = choice
  const setup: PendingSetup = { title, template }
  if (!template) return setup
  if (eventId) {
    const event = await monty.getEvent(eventId)
    Object.assign(setup, { eventId, eventName: event.name, glides: glidesOf(event) })
    if (ISO3.test(event.country)) setup.country = event.country
  }
  if (place?.trim()) {
    const fc = await tools.run<PlaceFeatures>('data.geocode', { query: place.trim(), limit: 1 })
    const bbox = fc.features[0]?.properties.bbox
    if (!bbox) throw new Error(`No area found for “${place.trim()}”`)
    setup.bbox = bbox
  }
  return setup
}
