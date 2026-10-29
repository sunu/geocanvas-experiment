import { z } from 'zod'
import { defineOp, definePlugin, Views, type AnyObject, type BoardTx, type OpContext } from '@ttx/core'
import {
  ADMIN_LEVEL_NAME,
  ADMIN_LEVELS,
  BOUNDARIES_TOOL,
  bboxOf,
  DATA_LAYERS,
  guessFormat,
  layerFilter,
  layerStyle,
  mapLayer,
  newLayerId,
  URL_FORMATS,
  urlTitle,
  type AdminLevel,
  type DataLayerKey,
  type MapLayer,
  type UrlFormat,
} from './mapLayers.js'
import { areaOfView, MAP_HEADER_PX, viewOfArea } from './mapView.js'

/** The map object type and its ops. No React here: the view is registered in apps/web/src/map/ui.ts. */

/** Stored in each map's `basemap` field. The styles are in apps/web/src/map/basemaps.ts. */
export const BASEMAPS = ['light', 'dark', 'streets', 'satellite'] as const
export type Basemap = (typeof BASEMAPS)[number]

const basemap = z.enum(BASEMAPS).describe('Basemap')

/** An area in degrees (WGS 84). */
const area = z.object({
  west: z.number().min(-180).max(180).describe('West edge (longitude)'),
  south: z.number().min(-90).max(90).describe('South edge (latitude)'),
  east: z.number().min(-180).max(180).describe('East edge (longitude)'),
  north: z.number().min(-90).max(90).describe('North edge (latitude)'),
})
export type MapArea = z.infer<typeof area>

/**
 * Each person's view of a map is not here: it is in the doc's `views` (Views in @ttx/core).
 * `layers` (mapLayers.ts) is optional: maps made before it have none. It is replaced as a whole, so two
 * people adding a layer at the same moment keep only one of the two.
 */
export type MapBoardObject = AnyObject & { type: 'map'; basemap: Basemap; layers?: MapLayer[] }

const oneMap = { kind: 'objects', types: ['map'], min: 1, max: 1 } as const

/** The one map an op targets. */
const mapOf = (ctx: OpContext) => ctx.board.get(ctx.target.kind === 'objects' ? (ctx.target.ids[0] ?? '') : '') as MapBoardObject

/**
 * `area`, or the area the runner sees on the map: their own view, or for an agent the view of the person it
 * acts for. The UI passes `area`, since a view is saved only a second after a pan.
 */
function areaFor(ctx: OpContext, map: MapBoardObject, given: MapArea | undefined) {
  if (given) return bboxOf(given)
  const views = new Views(ctx.board.doc)
  const me = ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf
  const view = (me && views.get(me, map.id)) || views.latest(map.id)?.view
  if (!view) throw new Error('Give `area`: nobody has looked at this map yet')
  return bboxOf(areaOfView(view, map.w, map.h - MAP_HEADER_PX))
}

/** A layer write: the map's whole new list (see MapBoardObject). */
const setLayers = (tx: BoardTx, id: string, layers: MapLayer[]) => tx.update({ [id]: { layers } })

/** The map's layers with one of them changed, or an error if it has no such layer. */
function changeLayer(map: MapBoardObject, layerId: string, change: (l: MapLayer) => MapLayer) {
  const layers = map.layers ?? []
  if (!layers.some((l) => l.id === layerId)) throw new Error(`The map has no layer ${layerId}`)
  return { id: map.id, layers: layers.map((l) => (l.id === layerId ? change(l) : l)) }
}

const dataLayer = z.enum(Object.keys(DATA_LAYERS) as [DataLayerKey, ...DataLayerKey[]])
const layerId = z.string().describe("The layer's id, from the map's layers")

const forPeople = z
  .union([z.literal('everyone'), z.array(z.string()).min(1)])
  .optional()
  .describe("Whose views to change: person ids, or 'everyone'. Without it: the person who runs it, or the person an agent acts for.")

export const mapPlugin = definePlugin({
  id: 'map',
  title: 'Map',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'map',
      title: 'Map',
      description: 'A live map. Its basemap is shared; each person has their own view (use map.showArea to change one).',
      fields: z.object({ basemap: basemap.default('light'), layers: z.array(mapLayer).optional() }),
      defaultSize: { w: 520, h: 360 },
      layer: 'bottom',
      summarize: (o) => {
        const { basemap, layers } = o as MapBoardObject
        return `basemap ${basemap}${layers?.length ? `; layers: ${layers.map((l) => `${l.title} (${l.id}${l.filter ? `, only ${l.filter.property} ${l.filter.op} ${JSON.stringify(l.filter.value)}` : ''})`).join(', ')}` : ''}`
      },
    },
  ],
  ops: [
    defineOp({
      id: 'map.setBasemap',
      title: 'Set basemap',
      description: 'Change the basemap of the selected maps for everyone.',
      target: { kind: 'objects', types: ['map'] },
      args: z.object({ basemap }),
      defaults: (ctx) => {
        const first = ctx.target.kind === 'objects' ? (ctx.board.get(ctx.target.ids[0] ?? '') as MapBoardObject | undefined) : undefined
        return first ? { basemap: first.basemap } : {}
      },
      apply: (tx, { basemap }, target) => target.kind === 'objects' && tx.update(Object.fromEntries(target.ids.map((id) => [id, { basemap }]))),
    }),
    defineOp({
      id: 'map.showArea',
      title: 'Show area',
      description: "Pan and zoom the selected maps to an area, in some people's views. Each person can pan away again afterwards.",
      target: { kind: 'objects', types: ['map'] },
      args: area.extend({ for: forPeople }),
      nl: { aliases: ['zoom to', 'pan to', 'fly to'] },
      prepare(ctx, { for: who, ...a }) {
        const views = new Views(ctx.board.doc)
        const me = ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf
        if (!who && !me) throw new Error("Give `for`: the ids of the people whose views to change, or 'everyone'")
        return (ctx.target.kind === 'objects' ? ctx.target.ids : []).flatMap((id) => {
          const o = ctx.board.get(id)!
          const { center, zoom } = viewOfArea(a, o.w, o.h - MAP_HEADER_PX)
          // 'everyone': each person who has a view of it. The runner's view too, so people who open the map
          // later start here (they start at its latest view).
          const people = who === 'everyone' ? [...new Set([...views.of(id).map((v) => v.person), ctx.actor.id])] : (who ?? [me!])
          return people.map((person) => ({ person, id, view: { center, zoom, bearing: 0 } }))
        })
      },
      apply(tx, changes) {
        for (const { person, id, view } of changes) tx.setView(person, id, view)
      },
    }),
    defineOp({
      id: 'map.addLayer',
      title: 'Add data layer',
      description: `Add a data layer to a map, for everyone, with the data of one area: ${Object.entries(DATA_LAYERS)
        .map(([k, d]) => `${k} (${d.label})`)
        .join(', ')}. Without an area: the area the asker sees on the map.`,
      target: oneMap,
      args: z.object({ layer: dataLayer.describe('Which data'), area: area.optional() }),
      prepare(ctx, { layer, area }) {
        const map = mapOf(ctx)
        const d = DATA_LAYERS[layer]
        const added: MapLayer = { id: newLayerId(), tool: d.tool, input: { ...d.input, area: areaFor(ctx, map, area) }, title: d.title }
        return { id: map.id, layers: [...(map.layers ?? []), added] }
      },
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.addUrlLayer',
      title: 'Add layer from a URL',
      description: `Add a layer read from a URL to a map, for everyone. Formats: ${Object.entries(URL_FORMATS)
        .map(([k, f]) => `${k} (${f.label})`)
        .join(', ')}. Without a format it is guessed from the URL. The server must allow CORS. A COG must have one band; give its value range for the color ramp.`,
      target: oneMap,
      args: z.object({
        url: z.url({ protocol: /^https?$/ }).describe('http(s) URL; for xyz a template with {z}, {x} and {y}'),
        format: z.enum(Object.keys(URL_FORMATS) as [UrlFormat, ...UrlFormat[]]).optional().describe('Guessed from the URL when left out'),
        title: z.string().min(1).optional(),
        min: z.number().optional().describe('cog only: values at or below this are not drawn (default 0)'),
        max: z.number().optional().describe('cog only: values at or above this get the last color (default 100)'),
        attribution: z.string().optional().describe("The data's attribution, which its license may require"),
      }),
      prepare(ctx, { url, format, title, min, max, attribution }) {
        const f = format ?? guessFormat(url)
        if (!f) throw new Error(`Give \`format\`: the URL does not say which it is (${Object.keys(URL_FORMATS).join(', ')})`)
        if (f === 'xyz' && !/\{z\}/i.test(url)) throw new Error('An xyz URL needs {z}, {x} and {y}')
        if (f === 'cog' && min !== undefined && max !== undefined && min >= max) throw new Error('`min` must be below `max`')
        const map = mapOf(ctx)
        const input = {
          url,
          ...(URL_FORMATS[f].tool === 'data.urlFeatures' && { format: f }),
          ...(f === 'cog' && { rescale: [min ?? 0, max ?? 100] }),
          ...(attribution && { attribution }),
        }
        const added: MapLayer = { id: newLayerId(), tool: URL_FORMATS[f].tool, input, title: title ?? urlTitle(url, f) }
        return { id: map.id, layers: [...(map.layers ?? []), added] }
      },
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.addBoundaries',
      title: 'Add boundaries',
      description: "Add OCHA's administrative boundaries (COD-AB) to a map, for everyone: provinces (level 1) or districts (level 2), with their P-codes, in the 112 countries COD-AB covers.",
      target: oneMap,
      args: z.object({ level: z.union(ADMIN_LEVELS.map((l) => z.literal(l))).default(1).describe('1 for provinces, 2 for districts') }),
      prepare(ctx, { level }) {
        const map = mapOf(ctx)
        const added: MapLayer = { id: newLayerId(), tool: BOUNDARIES_TOOL, input: { level }, title: `${ADMIN_LEVEL_NAME[level as AdminLevel].many} (COD-AB)` }
        return { id: map.id, layers: [...(map.layers ?? []), added] }
      },
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.pinPlace',
      title: 'Pin place',
      description: 'Mark a place on a map for everyone, by name: the layer finds the place again in each browser (data.geocode).',
      target: oneMap,
      args: z.object({ place: z.string().min(1).describe('The place, e.g. "Beira, Mozambique"') }),
      prepare(ctx, { place }) {
        const map = mapOf(ctx)
        const added: MapLayer = { id: newLayerId(), tool: 'data.geocode', input: { query: place, limit: 1 }, title: place }
        return { id: map.id, layers: [...(map.layers ?? []), added] }
      },
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.setLayerArea',
      title: 'Set layer area',
      description: "Show a map's data layer for another area, for everyone. Without an area: the area the asker sees on the map.",
      target: oneMap,
      args: z.object({ layerId, area: area.optional() }),
      prepare(ctx, { layerId, area }) {
        const map = mapOf(ctx)
        const layers = map.layers ?? []
        const layer = layers.find((l) => l.id === layerId)
        if (!layer) throw new Error(`The map has no layer ${layerId}`)
        if (!Array.isArray(layer.input.area)) throw new Error(`Layer ${layerId} has no area`)
        const bbox = areaFor(ctx, map, area)
        return { id: map.id, layers: layers.map((l) => (l.id === layerId ? { ...l, input: { ...l.input, area: bbox } } : l)) }
      },
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.setLayerFilter',
      title: 'Filter layer',
      description: "Draw only the features of a map's layer whose property matches, for everyone. Without `filter`: draw them all again. Features only, not rasters, tiles or boundaries.",
      target: oneMap,
      args: z.object({ layerId, filter: layerFilter.optional() }),
      prepare: (ctx, { layerId, filter }) => changeLayer(mapOf(ctx), layerId, ({ filter: _, ...l }) => (filter ? { ...l, filter } : l)),
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.setLayerStyle',
      title: 'Style layer',
      description: "Set how a map's layer is drawn, for everyone: its color or the property that colors it (features only), and its opacity. Replaces the layer's style; {} goes back to the default.",
      target: oneMap,
      args: z.object({ layerId, style: layerStyle }),
      prepare: (ctx, { layerId, style }) =>
        changeLayer(mapOf(ctx), layerId, ({ style: _, ...l }) => (Object.values(style).some((v) => v !== undefined) ? { ...l, style } : l)),
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
    defineOp({
      id: 'map.removeLayer',
      title: 'Remove data layer',
      description: "Remove a data layer from a map, for everyone.",
      target: oneMap,
      args: z.object({ layerId }),
      prepare(ctx, { layerId }) {
        const map = mapOf(ctx)
        const layers = map.layers ?? []
        if (!layers.some((l) => l.id === layerId)) throw new Error(`The map has no layer ${layerId}`)
        return { id: map.id, layers: layers.filter((l) => l.id !== layerId) }
      },
      apply: (tx, { id, layers }) => setLayers(tx, id, layers),
    }),
  ],
})
