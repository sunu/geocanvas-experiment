import { z } from 'zod'
import { defineOp, definePlugin, UPLOAD_ID, Views, type AnyObject, type BoardTx, type OpContext } from '@ttx/core'
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
import { mapAnnotation, SHAPE_COLORS, SHAPE_POINTS, SHAPES, type MapAnnotation, type MapShape, type ShapeColor } from './mapAnnotations.js'
import { closureGeometry, mapScenario, MAX_ROUTE_KM, nextRouteColor, RETURN_PERIODS, ROUTE_PROFILES, type ClosureGeometry, type MapScenario } from './mapScenario.js'
import { areaOfView, MAP_HEADER_PX, viewOfArea } from './mapView.js'
import { checkArea, FORECAST_VARIABLES, forecastLayer, gfs, HORIZONS, latestRun, type ForecastVariable, type Horizon } from './weather.js'

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
 * `layers` (mapLayers.ts), `annotations` (mapAnnotations.ts) and `scenario` (mapScenario.ts) are optional: maps made before
 * them have none. Each is replaced as a whole, so two people adding a layer at the same moment keep only one of the two, and two
 * people typing in two stickies of one map at the same moment can lose each other's last keystrokes.
 */
export type MapBoardObject = AnyObject & { type: 'map'; basemap: Basemap; layers?: MapLayer[]; annotations?: MapAnnotation[]; scenario?: MapScenario }

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

/** An annotation write: the map's whole new list. */
const setAnnotations = (tx: BoardTx, id: string, annotations: MapAnnotation[]) => tx.update({ [id]: { annotations } })

/** The map's annotations with one of them changed, or an error if it has no such annotation. */
function changeAnnotation(map: MapBoardObject, annotationId: string, change: (a: MapAnnotation) => MapAnnotation | undefined) {
  const annotations = map.annotations ?? []
  if (!annotations.some((a) => a.id === annotationId)) throw new Error(`The map has no annotation ${annotationId}`)
  return { id: map.id, annotations: annotations.flatMap((a) => (a.id === annotationId ? (change(a) ?? []) : [a])) }
}

/** Where a shape is, for the agent: an arrow's ends, a circle's center, or its first point and how many there are. */
function describePoints({ shape, points }: MapShape) {
  const at = (p: [number, number]) => p.map((v) => Math.round(v * 1e4) / 1e4).join(', ')
  if (shape === 'arrow' || shape === 'line') return `from ${at(points[0]!)} to ${at(points[1]!)}`
  if (shape === 'circle') return `around ${at(points[0]!)}`
  if (shape === 'rectangle') return `from ${at(points[0]!)} to ${at(points[1]!)}`
  return `of ${points.length} points from ${at(points[0]!)}`
}

/** The browser tool that reads an uploaded GeoJSON file (apps/web/src/data/fromUrl.ts). */
export const UPLOAD_FEATURES_TOOL = 'data.uploadFeatures'

const NO_SCENARIO: MapScenario = { routes: [], closures: [] }

/** A scenario write: the map's whole new scenario (see MapBoardObject). */
const setScenario = (tx: BoardTx, id: string, scenario: MapScenario) => tx.update({ [id]: { scenario } })

/** A list with one item changed or removed (`change` returns undefined), or an error if it has no such item. */
function changeItem<T extends { id: string }>(items: T[], id: string, what: string, change: (t: T) => T | undefined): T[] {
  if (!items.some((t) => t.id === id)) throw new Error(`The map has no ${what} ${id}`)
  return items.flatMap((t) => (t.id === id ? (change(t) ?? []) : [t]))
}

/** Great-circle distance in km. */
function kmBetween([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) {
  const rad = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(a))
}

function checkEnds(from: [number, number], to: [number, number]) {
  const km = kmBetween(from, to)
  if (km > MAX_ROUTE_KM) throw new Error(`The ends are ${Math.round(km)} km apart: routing in the browser covers at most ${MAX_ROUTE_KM} km`)
}

/** A circle of `meters` around a place, as a polygon of 32 sides. */
function circle(lng: number, lat: number, meters: number): ClosureGeometry {
  const dLat = meters / 111_195
  const dLng = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180))
  const ring = Array.from({ length: 33 }, (_, i): [number, number] => {
    const a = ((i % 32) / 32) * 2 * Math.PI
    return [Math.round((lng + dLng * Math.cos(a)) * 1e6) / 1e6, Math.round((lat + dLat * Math.sin(a)) * 1e6) / 1e6]
  })
  return { type: 'Polygon', coordinates: [ring] }
}

const lng = z.number().min(-180).max(180).describe('Longitude')
const lat = z.number().min(-90).max(90).describe('Latitude')
const annotationId = z.string().describe("The annotation's id, from the map's annotations")

const place = z.object({ lng, lat })
const routeId = z.string().describe("The route's id, from the map's scenario")
const closureId = z.string().describe("The closure's id, from the map's scenario")
const profile = z.enum(ROUTE_PROFILES).describe('car, or truck: slower, and keeps off roads closed to heavy vehicles')

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
      fields: z.object({
        basemap: basemap.default('light'),
        layers: z.array(mapLayer).optional(),
        annotations: z.array(mapAnnotation).optional(),
        scenario: mapScenario.optional(),
      }),
      defaultSize: { w: 520, h: 360 },
      layer: 'bottom',
      summarize: (o) => {
        const { basemap, layers, annotations = [], scenario = NO_SCENARIO } = o as MapBoardObject
        const layer = (l: MapLayer) =>
          `${l.title} (${l.id}${l.filter ? `, only ${l.filter.property} ${l.filter.op} ${JSON.stringify(l.filter.value)}` : ''}${l.blocks ? ', blocks roads' : ''})`
        const stickies = annotations.flatMap((a) => (a.kind === 'sticky' ? [`${JSON.stringify(a.text.slice(0, 100))} at ${a.lngLat.join(', ')} (${a.id})`] : []))
        const shapes = annotations.flatMap((a) => (a.kind === 'shape' ? [`${a.color} ${a.shape} ${describePoints(a)} (${a.id})`] : []))
        const routes = scenario.routes.map((r) => `${JSON.stringify(r.title)}, ${r.profile} from ${r.from.join(', ')} to ${r.to.join(', ')} (${r.id})`)
        const closures = scenario.closures.map(
          (c) => `${c.geometry.type.toLowerCase()}${c.note ? ` ${JSON.stringify(c.note.slice(0, 100))}` : ''}${c.off ? ', switched off' : ''} (${c.id})`,
        )
        return [
          `basemap ${basemap}`,
          layers?.length && `layers: ${layers.map(layer).join(', ')}`,
          stickies.length && `sticky notes: ${stickies.join(', ')}`,
          shapes.length && `shapes: ${shapes.join(', ')}`,
          routes.length && `routes: ${routes.join(', ')}`,
          closures.length && `road closures: ${closures.join(', ')}`,
          scenario.exposure?.buildings &&
            `exposure: buildings in flood areas counted${scenario.exposure.returnPeriod ? `, with the depth and damage of a ${scenario.exposure.returnPeriod}-year river flood` : ''}`,
        ]
          .filter(Boolean)
          .join('; ')
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
      id: 'map.addUploadLayer',
      title: 'Add uploaded data',
      description:
        "Add a GeoJSON file uploaded to the board to a map as a layer, for everyone. With `blocks`, its features close the roads they cover in the map's scenario (e.g. a flood extent).",
      target: oneMap,
      args: z.object({
        fileId: z.string().regex(UPLOAD_ID).describe('Id of an uploaded GeoJSON file: the <id> in its link /uploads/<id>'),
        name: z.string().min(1).describe("The layer's title, e.g. the file's name"),
        blocks: z.boolean().optional(),
      }),
      prepare(ctx, { fileId, name, blocks }) {
        const map = mapOf(ctx)
        const added: MapLayer = { id: newLayerId(), tool: UPLOAD_FEATURES_TOOL, input: { fileId }, title: name, ...(blocks && { blocks }) }
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
      id: 'map.addForecast',
      title: 'Add weather forecast',
      description: `Add a NOAA GFS weather forecast to a map, for everyone: ${Object.entries(FORECAST_VARIABLES)
        .map(([k, v]) => `${k} (${v.description})`)
        .join(', ')}, over the next 24, 48, 72 or 120 hours, on a 0.25° grid (about 28 km). It is forecast context, not an official warning or impact estimate. ` +
        'The latest complete forecast run is fixed when the layer is added, so everyone sees the same run. Without an area: the area the asker sees on the map (at most 30° wide and high).',
      target: oneMap,
      args: z.object({
        variable: z.enum(Object.keys(FORECAST_VARIABLES) as [ForecastVariable, ...ForecastVariable[]]).describe('rain: total rain; wind: strongest wind'),
        hours: z.union(HORIZONS.map((h) => z.literal(h))).default(72).describe('Hours ahead'),
        area: area.optional(),
        run: z.iso.datetime().optional().describe('A forecast run (ISO time) instead of the latest'),
      }),
      async prepare(ctx, { variable, hours, area, run }) {
        const map = mapOf(ctx)
        const bbox = areaFor(ctx, map, area)
        checkArea(bbox)
        const at = run ?? (await latestRun(gfs, variable, hours as Horizon, bbox))
        return { id: map.id, layers: [...(map.layers ?? []), forecastLayer(variable, hours as Horizon, at, bbox)] }
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
      id: 'map.addShape',
      title: 'Draw shape on map',
      description: `Draw a shape on a map, for everyone, by its points [longitude, latitude]: ${SHAPES.join(', ')}. An arrow or a line takes 2 points (an arrow points from the first to the second), a rectangle 2 opposite corners, a circle its center and a point on its edge, a polygon 3 or more corners, freehand a path.`,
      target: oneMap,
      args: z.object({
        shape: z.enum(SHAPES),
        points: z.array(z.tuple([lng, lat])).min(2).max(2000),
        color: z.enum(Object.keys(SHAPE_COLORS) as [ShapeColor, ...ShapeColor[]]).default('red'),
      }),
      prepare(ctx, { shape, points, color }) {
        const [min, max] = SHAPE_POINTS[shape]
        if (points.length < min || points.length > max) throw new Error(`A ${shape} takes ${min === max ? min : `${min} to ${max}`} points, not ${points.length}`)
        const map = mapOf(ctx)
        const added: MapShape = { id: newLayerId(), kind: 'shape', shape, points, color }
        return { id: map.id, annotations: [...(map.annotations ?? []), added] }
      },
      apply: (tx, { id, annotations }) => setAnnotations(tx, id, annotations),
    }),
    defineOp({
      id: 'map.addSticky',
      title: 'Add sticky note on map',
      description: 'Pin a sticky note with text to a place on a map, for everyone. It stays on that place as people pan and zoom.',
      target: oneMap,
      args: z.object({ lng, lat, text: z.string().default('').describe('The text') }),
      prepare(ctx, { lng, lat, text }) {
        const map = mapOf(ctx)
        const added: MapAnnotation = { id: newLayerId(), kind: 'sticky', lngLat: [lng, lat], text }
        return { id: map.id, annotations: [...(map.annotations ?? []), added] }
      },
      apply: (tx, { id, annotations }) => setAnnotations(tx, id, annotations),
    }),
    defineOp({
      id: 'map.setStickyText',
      title: 'Set sticky note text',
      description: "Replace the text of a sticky note on a map.",
      target: oneMap,
      // Typing: one op log entry per editing gesture.
      gesture: true,
      args: z.object({ annotationId, text: z.string() }),
      prepare: (ctx, { annotationId, text }) => changeAnnotation(mapOf(ctx), annotationId, (a) => ({ ...a, text })),
      apply: (tx, { id, annotations }) => setAnnotations(tx, id, annotations),
    }),
    defineOp({
      id: 'map.moveAnnotation',
      title: 'Move annotation',
      description: "Move an annotation of a map to another place, for everyone: a sticky note's place, or a shape's first point, with the rest of the shape following it.",
      target: oneMap,
      args: z.object({ annotationId, lng, lat }),
      prepare: (ctx, { annotationId, lng, lat }) =>
        changeAnnotation(mapOf(ctx), annotationId, (a) => {
          if (a.kind === 'sticky') return { ...a, lngLat: [lng, lat] }
          const [dx, dy] = [lng - a.points[0]![0], lat - a.points[0]![1]]
          return { ...a, points: a.points.map(([x, y]) => [Math.min(180, Math.max(-180, x + dx)), Math.min(90, Math.max(-90, y + dy))] as [number, number]) }
        }),
      apply: (tx, { id, annotations }) => setAnnotations(tx, id, annotations),
    }),
    defineOp({
      id: 'map.removeAnnotation',
      title: 'Remove annotation',
      description: 'Remove an annotation from a map, for everyone.',
      target: oneMap,
      args: z.object({ annotationId }),
      prepare: (ctx, { annotationId }) => changeAnnotation(mapOf(ctx), annotationId, () => undefined),
      apply: (tx, { id, annotations }) => setAnnotations(tx, id, annotations),
    }),
    defineOp({
      id: 'map.addRoute',
      title: 'Add route',
      description: `Add a route between two places to a map's scenario, for everyone, at most ${MAX_ROUTE_KM} km apart. Each browser finds the fastest way by road (Overture's road network), around the scenario's road closures that are on and the features of the map's layers that block roads, and shows how much longer the closures make it. Find places' coordinates with the geocoder first.`,
      target: oneMap,
      args: z.object({
        from: place.describe('Where it starts'),
        to: place.describe('Where it ends'),
        profile: profile.default('car'),
        title: z.string().min(1).optional().describe('A name, e.g. "Port → Central Hospital"; default "Route N"'),
      }),
      prepare(ctx, { from, to, profile, title }) {
        const map = mapOf(ctx)
        const scenario = map.scenario ?? NO_SCENARIO
        checkEnds([from.lng, from.lat], [to.lng, to.lat])
        const route = {
          id: newLayerId(),
          title: title ?? `Route ${scenario.routes.length + 1}`,
          from: [from.lng, from.lat] as [number, number],
          to: [to.lng, to.lat] as [number, number],
          profile,
          color: nextRouteColor(scenario.routes),
        }
        return { id: map.id, scenario: { ...scenario, routes: [...scenario.routes, route] } }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.setRoute',
      title: 'Change route',
      description: "Rename a route of a map's scenario, move its start or end, or change its vehicle, for everyone.",
      target: oneMap,
      args: z.object({ routeId, title: z.string().min(1).optional(), from: place.optional(), to: place.optional(), profile: profile.optional() }),
      prepare(ctx, { routeId, title, from, to, profile }) {
        const map = mapOf(ctx)
        const scenario = map.scenario ?? NO_SCENARIO
        const routes = changeItem(scenario.routes, routeId, 'route', (r) => {
          const next = {
            ...r,
            ...(title && { title }),
            ...(from && { from: [from.lng, from.lat] as [number, number] }),
            ...(to && { to: [to.lng, to.lat] as [number, number] }),
            ...(profile && { profile }),
          }
          checkEnds(next.from, next.to)
          return next
        })
        return { id: map.id, scenario: { ...scenario, routes } }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.removeRoute',
      title: 'Remove route',
      description: "Remove a route from a map's scenario, for everyone.",
      target: oneMap,
      args: z.object({ routeId }),
      prepare(ctx, { routeId }) {
        const map = mapOf(ctx)
        const scenario = map.scenario ?? NO_SCENARIO
        return { id: map.id, scenario: { ...scenario, routes: changeItem(scenario.routes, routeId, 'route', () => undefined) } }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.addClosure',
      title: 'Close roads',
      description:
        "Close roads in a map's scenario, for everyone, so its routes go around them. Give `around` (every road within that many metres of a place, e.g. a flooded town) or `geometry`: a Point closes the roads within 25 m of it (a collapsed bridge), a LineString the roads that run along it (not those that cross it), a Polygon every road inside it.",
      target: oneMap,
      args: z.object({
        around: z.object({ lng, lat, meters: z.number().min(10).max(20_000).describe('Radius in metres') }).optional(),
        geometry: closureGeometry.optional().describe('GeoJSON geometry, [longitude, latitude] positions'),
        note: z.string().optional().describe('Why, e.g. "bridge down"'),
      }),
      prepare(ctx, { around, geometry, note }) {
        if (!around === !geometry) throw new Error('Give either `around` or `geometry`')
        const map = mapOf(ctx)
        const scenario = map.scenario ?? NO_SCENARIO
        const closure = { id: newLayerId(), geometry: geometry ?? circle(around!.lng, around!.lat, around!.meters), ...(note && { note }) }
        return { id: map.id, scenario: { ...scenario, closures: [...scenario.closures, closure] } }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.setClosure',
      title: 'Change road closure',
      description: "Change the note of a road closure in a map's scenario, or switch it off (routes ignore it) or on again, for everyone.",
      target: oneMap,
      args: z.object({ closureId, note: z.string().optional(), off: z.boolean().optional() }),
      prepare(ctx, { closureId, note, off }) {
        const map = mapOf(ctx)
        const scenario = map.scenario ?? NO_SCENARIO
        const closures = changeItem(scenario.closures, closureId, 'closure', ({ note: oldNote, off: oldOff, ...c }) => {
          const n = note ?? oldNote
          const o = off ?? oldOff
          return { ...c, ...(n && { note: n }), ...(o && { off: true as const }) }
        })
        return { id: map.id, scenario: { ...scenario, closures } }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.removeClosure',
      title: 'Open roads again',
      description: "Remove a road closure from a map's scenario, for everyone.",
      target: oneMap,
      args: z.object({ closureId }),
      prepare(ctx, { closureId }) {
        const map = mapOf(ctx)
        const scenario = map.scenario ?? NO_SCENARIO
        return { id: map.id, scenario: { ...scenario, closures: changeItem(scenario.closures, closureId, 'closure', () => undefined) } }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.setExposure',
      title: 'Count exposed buildings',
      description:
        "Count the buildings in a map scenario's flood areas, for everyone, or stop counting them: the polygons of its road closures that are on and of its layers that block roads. Each browser counts Overture's buildings and OpenStreetMap's health facilities and schools in them, and the count with the closures (what-ifs) is compared with the count without them. Areas up to about half a square degree; a country-wide area is too large.",
      target: oneMap,
      args: z.object({
        buildings: z.boolean().describe('Count buildings in the flood areas'),
        returnPeriod: z
          .union(RETURN_PERIODS.map((r) => z.literal(r)))
          .optional()
          .describe('Also estimate flood depth and damage, for a river flood of this return period (years), from the GloFAS hazard maps'),
      }),
      prepare(ctx, { buildings, returnPeriod }) {
        const map = mapOf(ctx)
        const { exposure: _, ...scenario } = map.scenario ?? NO_SCENARIO
        return { id: map.id, scenario: buildings ? { ...scenario, exposure: { buildings, ...(returnPeriod && { returnPeriod }) } } : scenario }
      },
      apply: (tx, { id, scenario }) => setScenario(tx, id, scenario),
    }),
    defineOp({
      id: 'map.setLayerBlocks',
      title: 'Layer blocks roads',
      description: "Make the features of a map's layer close the roads they cover in its scenario (e.g. a flood extent), or stop them doing so; for everyone.",
      target: oneMap,
      args: z.object({ layerId, blocks: z.boolean() }),
      prepare: (ctx, { layerId, blocks }) => changeLayer(mapOf(ctx), layerId, ({ blocks: _, ...l }) => (blocks ? { ...l, blocks } : l)),
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
        const removed = layers.find((l) => l.id === layerId)
        if (!removed) throw new Error(`The map has no layer ${layerId}`)
        const analysisId = removed.tool === 'openeo.tiles' && typeof removed.input.analysisId === 'string' ? removed.input.analysisId : undefined
        return { id: map.id, layers: layers.filter((l) => l.id !== layerId), ...(analysisId ? { analysisId } : {}) }
      },
      apply(tx, { id, layers, analysisId }) {
        setLayers(tx, id, layers)
        // Removing an openEO layer also removes its board object. The Worker observes that
        // deletion and cancels the public EOPF service, including if it is still starting.
        if (analysisId) tx.remove([analysisId])
      },
    }),
  ],
})
