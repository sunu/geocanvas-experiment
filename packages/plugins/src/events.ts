import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject, type OpContext } from '@ttx/core'
import type { MapBoardObject } from './map.js'
import { layerStyle, newLayerId, type LayerStyle, type MapLayer } from './mapLayers.js'
import type { EventFootprint } from './monty/client.js'
import { sourceLabel } from './monty/sources.js'

/**
 * The event object type and its ops. No React here: the view is registered in apps/web/src/events/ui.ts.
 * The board stores only the Montandon event id; each browser fetches the details (apps/web/src/events/monty.ts).
 */

/** eventId is absent until someone picks an event. */
export type EventBoardObject = AnyObject & { type: 'event'; eventId?: string }

/** The tool that reads an event's footprint from Montandon in the browser (apps/web/src/events/footprint.ts). */
export const EVENT_FOOTPRINT_TOOL = 'events.footprint'

/**
 * One part of an event's footprint, as its own map layer: one Montandon item's area or track (`itemId`), or all the
 * points of the footprint together (`points`), which are many and small. A layer with neither is the whole footprint,
 * as the agent and the templates add it.
 */
export const footprintPart = z
  .object({
    title: z.string().min(1).describe("The layer's title"),
    itemId: z.string().min(1).optional().describe('A Montandon item of the footprint: its area or track'),
    points: z.literal(true).optional().describe('All the points of the footprint'),
    style: layerStyle.optional(),
  })
  .refine((p) => !p.itemId !== !p.points, 'Give either itemId or points')
export type FootprintPart = z.infer<typeof footprintPart>

/** A map layer for where an event happened: the recipe names the event, and each browser asks Montandon. */
export function eventLayer(eventId: string, title?: string, part?: Omit<FootprintPart, 'title'>): MapLayer {
  return {
    id: newLayerId(),
    tool: EVENT_FOOTPRINT_TOOL,
    input: { eventId, ...(part?.itemId && { itemId: part.itemId }), ...(part?.points && { points: true }) },
    title: title ?? `Event ${eventId}`,
    ...(part?.style && { style: part.style }),
  }
}

/**
 * Each source's areas in their own color, from the layer list's swatches (apps/web/src/map/LayerList.tsx), so the
 * swatch shows as picked and people can change it. Sources not listed get the default, the accent blue. EM-DAT's
 * areas are the admin areas it records as affected, often a whole country: faint, like event areas.
 */
const SOURCE_STYLES: Record<string, LayerStyle> = {
  gdacs: { color: '#2563eb' },
  cems: { color: '#ea580c' },
  emdat: { color: '#ca8a04', opacity: 0.25 },
  usgs: { color: '#dc2626' },
  ibtracs: { color: '#7c3aed' },
  gfd: { color: '#0891b2' },
  pdc: { color: '#16a34a' },
}
/** Areas that only locate an event are often a whole country: grey and faint, so they do not hide the hazard areas. */
const EVENT_AREA_STYLE: LayerStyle = { color: '#18181b', opacity: 0.15 }
/** The points come from many sources: colored by source, as categories. */
const POINTS_STYLE: LayerStyle = { byProperty: 'source' }

/** A layer of a whole footprint, which can be split into its parts. */
export const isWholeFootprint = (l: MapLayer) => l.tool === EVENT_FOOTPRINT_TOOL && !l.input.itemId && !l.input.points

const isPoint = (type: string) => type === 'Point' || type === 'MultiPoint'

/**
 * A footprint's parts, each a layer named by its source and title: the hazard areas and tracks first (flood extents,
 * cyclone tracks), then the areas that only locate an event (often a whole country, e.g. EM-DAT's and IFRC's), then
 * all the points in one layer, named after the event, so they draw on top.
 */
export function footprintParts(fc: EventFootprint, eventTitle: string): FootprintPart[] {
  const areas = fc.features.filter((f) => !isPoint(f.geometry.type))
  const part = (f: EventFootprint['features'][number]): FootprintPart => {
    const style = SOURCE_STYLES[f.properties.source]
    return {
      itemId: f.properties.id,
      title: `${sourceLabel(f.properties.source)} · ${f.properties.title ?? f.properties.id}${f.properties.kind === 'event' ? ' (event area)' : ''}`,
      ...(f.properties.kind === 'event' ? { style: EVENT_AREA_STYLE } : style && { style }),
    }
  }
  return [
    ...areas.filter((f) => f.properties.kind === 'hazard').map(part),
    ...areas.filter((f) => f.properties.kind === 'event').map(part),
    ...(fc.features.some((f) => isPoint(f.geometry.type)) ? [{ points: true as const, title: `${eventTitle} · points`, style: POINTS_STYLE }] : []),
  ]
}

const eventId = z.string().min(1)
const oneMap = { kind: 'objects', types: ['map'], min: 1, max: 1 } as const
const mapOf = (ctx: OpContext) => ctx.board.get(ctx.target.kind === 'objects' ? (ctx.target.ids[0] ?? '') : '') as MapBoardObject
const layersOf = (eventId: string, parts: FootprintPart[]) => parts.map(({ title, ...part }) => eventLayer(eventId, title, part))

export const eventsPlugin = definePlugin({
  id: 'events',
  title: 'Events',
  dependsOn: ['core', 'map'],
  objectTypes: [
    {
      type: 'event',
      title: 'Event',
      description: 'A disaster event from Montandon, with its impacts and the sources that report it.',
      fields: z.object({ eventId: z.string().min(1).optional() }),
      defaultSize: { w: 380, h: 320 },
      layer: 'top',
      summarize: (o) => ((o as EventBoardObject).eventId ? `Montandon event ${(o as EventBoardObject).eventId}` : 'no event picked yet'),
    },
  ],
  ops: [
    defineOp({
      id: 'event.setEvent',
      title: 'Pick event',
      description: 'Show a Montandon event in the selected event object.',
      target: { kind: 'objects', types: ['event'], max: 1 },
      args: z.object({ eventId: eventId.meta({ widget: 'event' }).describe('Event') }),
      nl: { aliases: ['change event', 'select event'] },
      apply: (tx, { eventId }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { eventId } }),
    }),
    defineOp({
      id: 'map.addEventLayer',
      title: 'Add event footprint',
      description:
        "Add where a Montandon event happened to a map, as a data layer for everyone: each source's hazard area or track " +
        '(flood extent, cyclone track, earthquake area) and the event points.',
      target: { kind: 'objects', types: ['map'], min: 1, max: 1 },
      args: z.object({
        eventId: eventId.meta({ widget: 'event' }).describe('Montandon event id, e.g. from an event object on the board'),
        title: z.string().min(1).optional().describe("The layer's title in the map's list. Default: the event id"),
      }),
      prepare(ctx, { eventId, title }) {
        const map = ctx.board.get(ctx.target.kind === 'objects' ? (ctx.target.ids[0] ?? '') : '') as MapBoardObject
        return { id: map.id, layers: [...(map.layers ?? []), eventLayer(eventId, title)] }
      },
      apply: (tx, { id, layers }) => tx.update({ [id]: { layers } }),
    }),
    defineOp({
      id: 'map.addEventLayers',
      title: 'Add event footprint by source',
      description: "Add an event's footprint to a map as one layer per part (footprintParts), for everyone. The browser reads the parts first.",
      target: oneMap,
      hidden: true,
      args: z.object({ eventId, parts: z.array(footprintPart).min(1) }),
      prepare(ctx, { eventId, parts }) {
        const map = mapOf(ctx)
        return { id: map.id, layers: [...(map.layers ?? []), ...layersOf(eventId, parts)] }
      },
      apply: (tx, { id, layers }) => tx.update({ [id]: { layers } }),
    }),
    defineOp({
      id: 'map.splitEventLayer',
      title: 'Split event footprint',
      description: "Replace a map's layer of a whole event footprint by one layer per part, in its place, for everyone. Each part keeps the layer's filter, and its style if it has one.",
      target: oneMap,
      hidden: true,
      args: z.object({ layerId: z.string(), parts: z.array(footprintPart).min(1) }),
      prepare(ctx, { layerId, parts }) {
        const map = mapOf(ctx)
        const layers = map.layers ?? []
        const whole = layers.find((l) => l.id === layerId)
        if (!whole || !isWholeFootprint(whole)) throw new Error(`The map has no whole event footprint ${layerId}`)
        // The whole layer's style, if someone set one; else each part's own.
        const split = layersOf(String(whole.input.eventId), parts).map(({ id, input, title, style }) => ({ ...whole, id, input, title, ...(!whole.style && style && { style }) }))
        return { id: map.id, layers: layers.flatMap((l) => (l.id === layerId ? split : [l])) }
      },
      apply: (tx, { id, layers }) => tx.update({ [id]: { layers } }),
    }),
  ],
})
