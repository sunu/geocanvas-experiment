import { z } from 'zod'
import { Views, type OpContext } from '@ttx/core'
import type { EventFacts } from '../agentTools.js'
import type { PlaceFeatures } from '../geocode.js'
import type { Bbox } from '../mapLayers.js'
import { areaOfView, MAP_HEADER_PX, type Area } from '../mapView.js'
import { countryName } from '../monty/countries.js'

/**
 * Seeds: the inputs of a template (plans/plan-012.md). A seed kind turns what a person gives (an event id, or
 * text such as "Nepal floods 2026") into facts, which the template's nodes are made from. People type text; the
 * form's widget lists candidates, and the op takes the best match.
 */

/** What a template's nodes are made from. A seed or a lookup fills the facts it can. */
export interface Facts {
  eventId?: string
  /** What the template is about: the event's or the place's name. */
  name?: string
  /** ISO dates. */
  start?: string
  end?: string
  /** ISO3. */
  country?: string
  glides?: string[]
  area?: Area
}

export interface Resolved {
  facts: Facts
  /** What was found, for the op's result, e.g. "Nepal - Floods (gdacs-event-1104124-1)". */
  label: string
}

export interface SeedKind<V = any> {
  schema: z.ZodType<V>
  resolve(ctx: OpContext, value: V): Promise<Resolved>
  /** The node a template puts on the canvas for this seed, which its other nodes follow (links/, plan-013). */
  root(facts: Facts): { type: string; fields: Record<string, unknown> }
}

/** Areas smaller than this (degrees) are grown to it, so a point does not zoom a map to its last level. */
const MIN_SPAN = 0.2

export function areaOf([west, south, east, north]: Bbox): Area {
  const grow = (lo: number, hi: number) => (hi - lo >= MIN_SPAN ? [lo, hi] : [(lo + hi) / 2 - MIN_SPAN / 2, (lo + hi) / 2 + MIN_SPAN / 2])
  const [w, e] = grow(west, east)
  const [s, n] = grow(south, north)
  return { west: w!, south: Math.max(-90, s!), east: e!, north: Math.min(90, n!) }
}

const text = z.object({ text: z.string().min(1).describe('What to look for, e.g. "Nepal floods 2026"') })

/** A tool of the runner's environment, or an error that says which one is missing. */
function tools(ctx: OpContext, id: string) {
  if (!ctx.tools?.tool(id)) throw new Error(`Looking this up needs the ${id} tool, which this environment does not have`)
  return ctx.tools
}

export const event: SeedKind<string | { text: string }> = {
  schema: z.union([z.string().min(1).describe('Montandon event id'), text]).meta({ widget: 'event' }),
  async resolve(ctx, value) {
    let id: string
    if (typeof value === 'string') id = value
    else {
      const found = await tools(ctx, 'events.search').run<{ id: string }[] | string>('events.search', { text: value.text, limit: 1 })
      if (typeof found === 'string' || !found[0]) throw new Error(`No event matches "${value.text}"`)
      id = found[0].id
    }
    // Without Montandon, the event card and its footprint still work from the id alone.
    if (!ctx.tools?.tool('events.get')) return { facts: { eventId: id }, label: id }
    const e = await ctx.tools.run<EventFacts>('events.get', { id })
    return {
      facts: { eventId: id, name: e.name, start: e.start, end: e.end, country: e.country, glides: e.glides, ...(e.bbox && { area: areaOf(e.bbox) }) },
      label: `${e.name} (${id})`,
    }
  },
  root: (f) => ({ type: 'event', fields: { ...(f.eventId && { eventId: f.eventId }) } }),
}

/** "my view": what the runner (for an agent: the person it acts for) last looked at on a map of this board. */
export const MY_VIEW = 'my view'

const box = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
  name: z.string().min(1).optional().describe("The area's name"),
})

export const area: SeedKind<string | { text: string } | z.infer<typeof box>> = {
  schema: z.union([z.literal(MY_VIEW).describe('The area I last looked at on a map'), text, box]).meta({ widget: 'area' }),
  async resolve(ctx, value) {
    if (value === MY_VIEW) {
      const a = myView(ctx)
      return { facts: { area: a }, label: 'your map view' }
    }
    if (typeof value === 'string') throw new Error(`Give a place, an area, or "${MY_VIEW}"`)
    if ('text' in value) {
      const found = await tools(ctx, 'data.geocode').run<PlaceFeatures>('data.geocode', { query: value.text, limit: 1 })
      const place = found.features[0]?.properties
      if (!place) throw new Error(`No place matches "${value.text}"`)
      const [lng, lat] = place.lngLat
      const facts: Facts = { name: place.name, area: areaOf(place.bbox ?? [lng, lat, lng, lat]), ...(place.iso3 && { country: place.iso3 }) }
      return { facts, label: place.name }
    }
    const { name, ...a } = value
    return { facts: { area: a, ...(name && { name }) }, label: name ?? 'the given area' }
  },
  // The area as resolved, so the input shows what the template used.
  root: (f) => ({ type: 'input', fields: { kind: 'area', ...(f.area && { value: { ...f.area, ...(f.name && { name: f.name }) } }) } }),
}

/** The area of the runner's most recent view of a map on the board. */
function myView(ctx: OpContext): Area {
  const me = ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf
  const views = new Views(ctx.board.doc)
  const latest = ctx.board
    .list()
    .filter((o) => o.type === 'map')
    .flatMap((o) => {
      const view = me ? views.get(me, o.id) : undefined
      return view ? [{ o, view }] : []
    })
    .sort((a, b) => b.view.at - a.view.at)[0]
  if (!latest) throw new Error('No map view to use: look at a map on the board first, or give a place')
  return areaOfView(latest.view, latest.o.w, latest.o.h - MAP_HEADER_PX)
}

/**
 * Facts that follow from others: an area's country (the country at its center) and a country's area. One
 * country per area, so an area across a border gives the country at its center.
 */
export async function complete(ctx: OpContext, facts: Facts): Promise<Facts> {
  const out = { ...facts }
  if (out.area && !out.country && ctx.tools?.tool('data.reverseGeocode')) {
    const a = out.area
    const lngLat = [(a.west + a.east) / 2, (a.south + a.north) / 2]
    const here = await ctx.tools.run<PlaceFeatures>('data.reverseGeocode', { lngLat }).catch(() => undefined)
    const iso3 = here?.features[0]?.properties.iso3
    if (iso3) out.country = iso3
  }
  if (out.country && !out.area && ctx.tools?.tool('data.geocode')) {
    const found = await ctx.tools.run<PlaceFeatures>('data.geocode', { query: countryName(out.country) ?? out.country, limit: 1 }).catch(() => undefined)
    const bbox = found?.features[0]?.properties.bbox
    if (bbox) out.area = areaOf(bbox)
  }
  if (!out.name && out.country) out.name = countryName(out.country) ?? out.country
  return out
}
