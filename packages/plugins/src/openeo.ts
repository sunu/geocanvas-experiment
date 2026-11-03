import { z } from 'zod'
import { defineOp, definePlugin, defineTool, Views, type AnyObject } from '@ttx/core'
import { bboxOf, newLayerId, type Bbox } from './mapLayers.js'
import { areaOfView, MAP_HEADER_PX } from './mapView.js'
import type { MapBoardObject } from './map.js'
import { describeGraph, EXAMPLE_GRAPH, graphProblems, MAX_AREA_SQ_DEG, MAX_NODES, MAX_WINDOW_DAYS, withArea, type ProcessGraph } from './openeoGraph.js'

export const OPENEO_BASE_URL = 'https://api.explorer.eopf.copernicus.eu/openeo'
const statuses = ['proposed', 'requested', 'running', 'ready', 'error', 'cancelled'] as const
export type OpenEOStatus = (typeof statuses)[number]

export type OpenEOAnalysisObject = AnyObject & {
  type: 'openeo'
  mapId: string
  title: string
  area: Bbox
  /** The Sentinel-1 change windows: only a proposal made by openeo.proposeSarChange has them. */
  preStart?: string
  preEnd?: string
  postStart?: string
  postEnd?: string
  /** Any other proposal: its process graph as JSON, written by openeo.proposeGraph. */
  graph?: string
  status: OpenEOStatus
  layerId?: string
  serviceId?: string
  tileUrl?: string
  error?: string
}

const oneMap = { kind: 'objects', types: ['map'], min: 1, max: 1 } as const
const oneAnalysis = { kind: 'objects', types: ['openeo'], min: 1, max: 1 } as const
const onlyId = (target: { kind: string; ids?: string[] }) => target.kind === 'objects' ? target.ids![0]! : ''
const areaSchema = z.object({ west: z.number().min(-180).max(180), south: z.number().min(-90).max(90), east: z.number().min(-180).max(180), north: z.number().min(-90).max(90) })
// No defaults: a window with no scenes makes an empty layer, so whoever proposes must pick dates that have some.
const WINDOW = 'A date (YYYY-MM-DD); check it has scenes with openeo__coverage (sentinel-1-grd-rtc-acquisitions-staging)'
const dates = {
  preStart: z.string().date().describe(WINDOW),
  preEnd: z.string().date(),
  postStart: z.string().date(),
  postEnd: z.string().date(),
}

/** The area a proposal covers: the one given, else what the person (for an agent: the asker) sees of the map. */
function resolveArea(ctx: { board: { doc: ConstructorParameters<typeof Views>[0] }; actor: { kind: string; id?: string; onBehalfOf?: string } }, map: MapBoardObject, given?: z.infer<typeof areaSchema>): Bbox {
  if (given) return bboxOf(given)
  const views = new Views(ctx.board.doc)
  const person = ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf
  const view = (person && views.get(person, map.id)) || views.latest(map.id)?.view
  if (!view) throw new Error('Give an area or open the map before proposing an analysis')
  return bboxOf(areaOfView(view, map.w, map.h - MAP_HEADER_PX))
}

export const openEOPlugin = definePlugin({
  id: 'openeo',
  title: 'openEO',
  description: 'Satellite analysis layers from EOPF openEO, which a person approves.',
  optional: true,
  dependsOn: ['map'],
  objectTypes: [{
    type: 'openeo',
    title: 'SAR change analysis',
    description: 'A proposed Sentinel-1 pre/post-event surface-change analysis. Approval starts the EOPF XYZ service.',
    addable: false,
    fields: z.object({
      mapId: z.string(),
      title: z.string(),
      area: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      preStart: z.string().optional(),
      preEnd: z.string().optional(),
      postStart: z.string().optional(),
      postEnd: z.string().optional(),
      graph: z.string().optional(),
      status: z.enum(statuses),
      layerId: z.string().optional(),
      serviceId: z.string().optional(),
      tileUrl: z.string().optional(),
      error: z.string().optional(),
    }),
    defaultSize: { w: 340, h: 290 },
    layer: 'top',
    summarize: (o) => {
      const a = o as OpenEOAnalysisObject
      return `${a.status}: ${a.title}, ${a.graph ? describeGraph(JSON.parse(a.graph) as ProcessGraph)[0] : `${a.preStart}–${a.preEnd} vs ${a.postStart}–${a.postEnd}`}`
    },
  }],
  ops: [
    defineOp({
      id: 'openeo.proposeSarChange',
      title: 'Propose Sentinel-1 change layer',
      description: 'Propose a pre/post Sentinel-1 VV surface-change layer for a map. This creates a proposal only; it does not contact openEO until a user approves it.',
      target: oneMap,
      args: z.object({ title: z.string().default('Sentinel-1 surface change'), area: areaSchema.optional(), ...dates }),
      nl: { examples: ['propose a Sentinel-1 change layer before and after the flood', 'compare radar backscatter before and after this event'] },
      prepare(ctx, args) {
        const map = ctx.board.get(onlyId(ctx.target)) as MapBoardObject
        return { map, ...args, area: resolveArea(ctx, map, args.area) }
      },
      apply(tx, plan) {
        tx.add('openeo', {
          mapId: plan.map.id,
          title: plan.title,
          area: plan.area,
          preStart: plan.preStart,
          preEnd: plan.preEnd,
          postStart: plan.postStart,
          postEnd: plan.postEnd,
          status: 'proposed',
          x: plan.map.x + plan.map.w + 24,
          y: plan.map.y,
          w: 340,
          h: 290,
        })
      },
      describePlan: (plan) => `Create a reviewable SAR-change proposal for ${plan.title}; the user must approve before CDSE work starts.`,
    }),
    defineOp({
      id: 'openeo.proposeGraph',
      title: 'Propose an openEO layer',
      description:
        'Propose a map layer from any openEO process graph on EOPF (Sentinel-1, -2 and -3 collections): an index such as NDVI, a true-colour image, a before/after change. ' +
        'This creates a proposal only; a user must review it and click "Approve & run", so never say it has started. ' +
        'First call openeo__collections for collection ids and band names, and openeo__coverage to check that the area has scenes in the dates: propose only where it does. ' +
        `processGraph is an openEO process graph: an object of named nodes {"process_id", "arguments", "result"?}; one node's output feeds another with {"from_node": "name"}. ` +
        `Rules: exactly one node has "result": true, and it is a save_result with "format": "PNG" fed by a node scaled to 0-255 with linear_scale_range; each load_collection needs a temporal_extent of at most ${MAX_WINDOW_DAYS} days whose END IS EXCLUSIVE (for one day D use [D, the next day]; [D, D] is empty); for a cloud-free image pick the days that openeo__coverage lists with low cloud cover and use a window of just those days; ` +
        `leave out spatial_extent (it is set from area); at most ${MAX_NODES} nodes; area at most ${MAX_AREA_SQ_DEG} square degrees. ` +
        'Sentinel-2 reflectance on EOPF is 0-1, not 0-10000: for true colour (b04, b03, b02) scale with linear_scale_range inputMin 0, inputMax 0.3, or the layer is all black; NDVI and NDWI run from -1 to 1. ' +
        `Example, Sentinel-2 NDVI as a median over the dates: ${JSON.stringify(EXAMPLE_GRAPH)}`,
      target: oneMap,
      args: z.object({
        title: z.string().min(1).max(80).describe('What the layer shows, e.g. "Rome NDVI, Sept 2026"'),
        area: areaSchema.optional(),
        processGraph: z.record(z.string(), z.unknown()).describe('The openEO process graph'),
      }),
      nl: { examples: ['show NDVI for Rome from Sentinel-2', 'make a true-colour layer of this area for September'] },
      prepare(ctx, args) {
        const map = ctx.board.get(onlyId(ctx.target)) as MapBoardObject
        const area = resolveArea(ctx, map, args.area)
        const [west, south, east, north] = area
        if ((east - west) * (north - south) > MAX_AREA_SQ_DEG) throw new Error(`The area is too large; use at most ${MAX_AREA_SQ_DEG} square degrees.`)
        const problems = graphProblems(args.processGraph)
        if (problems.length) throw new Error(`The process graph cannot run: ${problems.join(' ')}`)
        return { map, title: args.title, area, graph: JSON.stringify(withArea(args.processGraph as ProcessGraph, area)) }
      },
      apply(tx, plan) {
        tx.add('openeo', { mapId: plan.map.id, title: plan.title, area: plan.area, graph: plan.graph, status: 'proposed', x: plan.map.x + plan.map.w + 24, y: plan.map.y, w: 340, h: 290 })
      },
      describePlan: (plan) => `Create a reviewable openEO proposal "${plan.title}"; the user must approve before EOPF work starts.`,
    }),
    defineOp({
      id: 'openeo.approveSarChange',
      title: 'Approve and run SAR analysis',
      description: 'Start the proposed Sentinel-1 analysis and add its result to the map when ready. This may use openEO credits.',
      target: oneAnalysis,
      args: z.object({}),
      risk: 'high',
      when: (ctx) => ['proposed', 'error'].includes((ctx.board.get(onlyId(ctx.target)) as OpenEOAnalysisObject | undefined)?.status ?? ''),
      prepare: (ctx) => {
        const analysis = ctx.board.get(onlyId(ctx.target)) as OpenEOAnalysisObject
        if (!(ctx.board.get(analysis.mapId)?.type === 'map')) throw new Error('The target map no longer exists')
        const anotherActive = ctx.board.list().find((object) => object.type === 'openeo' && object.id !== analysis.id && isActive(object as OpenEOAnalysisObject))
        if (anotherActive) throw new Error('Stop the active openEO analysis before starting another one on this board')
        return { analysis, layerId: analysis.layerId ?? newLayerId() }
      },
      apply(tx, { analysis, layerId }) {
        const map = tx.get(analysis.mapId) as MapBoardObject
        const existing = (map.layers ?? []).some((l) => l.id === layerId)
        tx.update({ [analysis.id]: { status: 'requested', layerId, error: '' } })
        if (!existing) {
          tx.update({ [map.id]: { layers: [...(map.layers ?? []), { id: layerId, tool: 'openeo.tiles', input: { analysisId: analysis.id }, title: analysis.title }] } })
        }
      },
      describePlan: ({ analysis }) => `Run ${analysis.title} on EOPF openEO; the tile layer will appear on the selected map.`,
    }),
    defineOp({
      id: 'openeo.cancelSarChange',
      title: 'Stop openEO analysis',
      description: 'Cancel the openEO tile service created for this analysis.',
      target: oneAnalysis,
      args: z.object({}),
      risk: 'high',
      when: (ctx) => {
        const analysis = ctx.board.get(onlyId(ctx.target)) as OpenEOAnalysisObject | undefined
        return !!analysis && (['requested', 'running', 'ready'].includes(analysis.status) || (analysis.status === 'error' && !!analysis.serviceId))
      },
      apply(tx, _args, target) {
        const analysis = tx.get(onlyId(target)) as OpenEOAnalysisObject
        tx.update({ [analysis.id]: { status: 'cancelled' } })
        if (analysis.layerId) {
          const map = tx.get(analysis.mapId) as MapBoardObject | undefined
          if (map) tx.update({ [map.id]: { layers: (map.layers ?? []).filter((layer) => layer.id !== analysis.layerId) } })
        }
      },
    }),
    defineOp({
      id: 'openeo.setStatus',
      title: 'Update openEO analysis status',
      description: 'Internal Worker update for a managed openEO service.',
      hidden: true,
      target: oneAnalysis,
      args: z.object({ status: z.enum(statuses), serviceId: z.string().optional(), tileUrl: z.string().optional(), error: z.string().optional() }),
      apply(tx, args, target) {
        const id = onlyId(target)
        const analysis = tx.get(id) as OpenEOAnalysisObject
        tx.update({ [id]: args })
        if (args.status === 'ready' && args.tileUrl && analysis.layerId) {
          const map = tx.get(analysis.mapId) as MapBoardObject | undefined
          if (!map) return
          const layers = (map.layers ?? []).map((layer) => layer.id === analysis.layerId
          ? { ...layer, input: { analysisId: id, tiles: args.tileUrl, attribution: 'Copernicus Sentinel data' } }
            : layer)
          tx.update({ [map.id]: { layers } })
        }
        if (args.status === 'error' && analysis.layerId) {
          const map = tx.get(analysis.mapId) as MapBoardObject | undefined
          if (map) tx.update({ [map.id]: { layers: (map.layers ?? []).map((layer) => layer.id === analysis.layerId ? { ...layer, input: { analysisId: id } } : layer) } })
        }
        if (args.status === 'cancelled' && analysis.layerId) {
          const map = tx.get(analysis.mapId) as MapBoardObject | undefined
          if (map) tx.update({ [map.id]: { layers: (map.layers ?? []).filter((layer) => layer.id !== analysis.layerId) } })
        }
      },
    }),
  ],
})

/** Browser-side renderer tool: the Worker has already inserted the public tile template into the recipe. */
export const openEOTilesTool = defineTool({
  id: 'openeo.tiles',
  plugin: 'openeo',
  title: 'openEO XYZ tiles',
  description: 'A public XYZ tile URL for a completed openEO analysis.',
  input: z.object({ analysisId: z.string(), tiles: z.string().optional(), attribution: z.string().optional() }),
  output: 'geo.tiles',
  cache: false,
  // The map draws a geo.tiles result from its `url`; until the Worker has made the service there is none, and the
  // layer list says it is waiting.
  run: ({ tiles, attribution }) => ({
    status: tiles ? ('ready' as const) : ('running' as const),
    ...(tiles ? { url: tiles } : {}),
    attribution: attribution ?? 'Copernicus Sentinel data',
  }),
})

export function isActive(analysis: OpenEOAnalysisObject) {
  return ['requested', 'running', 'ready'].includes(analysis.status) || (analysis.status === 'error' && !!analysis.serviceId)
}
