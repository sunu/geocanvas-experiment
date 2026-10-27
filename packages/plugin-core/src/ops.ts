import { z } from 'zod'
import { defineOp, type TargetRef } from '@geo-canvas/core'
import { bboxOf, fitBounds, round } from './geo/project.js'
import { mapViewSchema, mapViewport } from './nodes.js'

const only = (t: TargetRef) => (t.kind === 'nodes' ? t.ids[0]! : '')

export const setTextOp = defineOp({
  id: 'core.text.setContent',
  title: 'Edit text',
  description: 'Set the title and text of a text block or a sticky note.',
  target: { kind: 'node', types: ['core.text', 'core.sticky'], min: 1, max: 1 },
  args: z.object({
    text: z.string().meta({ widget: 'textarea', nl: { extract: 'text' } }),
    title: z.string().meta({ nl: { extract: 'text' } }).optional(),
  }),
  defaults: (ctx) => {
    const n = ctx.reader.node(only(ctx.target))
    return { text: String(n?.props.text ?? ''), title: n?.props.title as string | undefined }
  },
  apply: (tx, plan, target) => {
    const n = tx.reader.node(only(target))!
    tx.updateProps(n.id, n.type === 'core.sticky' ? { text: plan.text } : plan)
  },
})

export const setStickyColorOp = defineOp({
  id: 'core.sticky.setColor',
  title: 'Set color',
  description: 'Change the color of sticky notes.',
  target: { kind: 'node', types: ['core.sticky'] },
  args: z.object({ color: z.enum(['yellow', 'blue', 'green', 'pink', 'orange']) }),
  apply: (tx, plan, target) => {
    for (const id of target.kind === 'nodes' ? target.ids : []) tx.updateProps(id, { color: plan.color })
  },
})

export const setAoiOp = defineOp({
  id: 'core.map.setAoi',
  title: 'Set AOI',
  description: 'Set the area of interest of a map. It replaces the AOI from the input link.',
  target: { kind: 'node', types: ['core.map'], min: 1, max: 1 },
  args: z.object({
    aoi: z.custom<GeoJSON.Feature>((v) => !!v && typeof v === 'object').meta({ widget: 'aoi' }).describe('GeoJSON polygon feature'),
  }),
  apply: (tx, plan, target) => tx.updateProps(only(target), { aoiOverride: plan.aoi }),
})

export const clearAoiOp = defineOp({
  id: 'core.map.clearAoi',
  title: 'Reset AOI',
  description: 'Remove the AOI that a user set. The map uses the AOI from its input link again.',
  target: { kind: 'node', types: ['core.map'], min: 1, max: 1 },
  args: z.object({}),
  when: (ctx) => !!ctx.reader.node(only(ctx.target))?.props.aoiOverride,
  apply: (tx, _plan, target) => tx.updateProps(only(target), { aoiOverride: undefined }),
})

export const scaleAoiOp = defineOp({
  id: 'core.map.bufferAoi',
  title: 'Grow or shrink AOI',
  description: 'Scale the current AOI of a map around its center. factor 1.5 makes it 50% larger.',
  target: { kind: 'node', types: ['core.map'], min: 1, max: 1 },
  args: z.object({
    factor: z.number().min(0.1).max(10).default(1.5).meta({ nl: { extract: 'factor', examples: ['50% bigger', 'half the size'] } }),
  }),
  nl: { examples: ['make the AOI 50% bigger', 'shrink the area by 20%'] },
  when: (ctx) => !!ctx.derived(only(ctx.target))?.result?.outputs?.aoi,
  prepare: (ctx, args) => {
    const aoi = ctx.derived(only(ctx.target))!.result!.outputs!.aoi as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    return { aoi: scaleFeature(aoi, args.factor) }
  },
  apply: (tx, plan, target) => tx.updateProps(only(target), { aoiOverride: plan.aoi }),
})

export const setViewOp = defineOp({
  id: 'core.map.setView',
  title: 'Set map view',
  description: 'Set the center and zoom of a map. All users see the same view.',
  target: { kind: 'node', types: ['core.map'], min: 1, max: 1 },
  args: mapViewSchema,
  hidden: true,
  // A pan is many small moves: merge them into one undo step.
  mergeKey: (t) => `core.map.setView:${only(t)}`,
  prepare: (_ctx, v) => ({ center: [round(v.center[0]), round(v.center[1])] as [number, number], zoom: round(v.zoom, 3), ...(v.bearing ? { bearing: round(v.bearing, 2) } : {}) }),
  apply: (tx, view, target) => tx.updateProps(only(target), { view }),
})

export const fitToAoiOp = defineOp({
  id: 'core.map.fitToAoi',
  title: 'Zoom map to AOI',
  description: 'Set the map view so that the whole area of interest is visible.',
  target: { kind: 'node', types: ['core.map'], min: 1, max: 1 },
  args: z.object({ padding: z.number().min(0).max(200).default(30).meta({ advanced: true }) }),
  nl: { examples: ['zoom the map to the affected area', 'show the whole AOI'] },
  when: (ctx) => !!ctx.derived(only(ctx.target))?.result?.outputs?.aoi,
  prepare(ctx, args) {
    const id = only(ctx.target)
    const aoi = ctx.derived(id)?.result?.outputs?.aoi as GeoJSON.Feature | undefined
    if (!aoi) throw new Error('This map has no AOI')
    const node = ctx.reader.node(id)!
    return fitBounds(bboxOf(aoi), mapViewport(node.layout), args.padding)
  },
  apply: (tx, view, target) => tx.updateProps(only(target), { view }),
})

export const setBasemapOp = defineOp({
  id: 'core.map.setBasemap',
  title: 'Set basemap',
  description: 'Change the basemap style of a map.',
  target: { kind: 'node', types: ['core.map'] },
  args: z.object({ basemap: z.enum(['streets', 'light', 'dark', 'satellite']) }),
  apply: (tx, plan, target) => {
    for (const id of target.kind === 'nodes' ? target.ids : []) tx.updateProps(id, { basemap: plan.basemap })
  },
})

export const setChartSourceOp = defineOp({
  id: 'core.chart.setSource',
  title: 'Set chart data',
  description: 'Choose the data function of a chart, and its params.',
  target: { kind: 'node', types: ['core.chart'], min: 1, max: 1 },
  args: z.object({
    source: z.string().meta({ widget: 'dataFunction' }),
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  apply: (tx, plan, target) => tx.updateProps(only(target), plan),
})

export const setChartMarkOp = defineOp({
  id: 'core.chart.setMark',
  title: 'Set chart type',
  description: 'Show a chart as bars, a line, a pie, or points.',
  target: { kind: 'node', types: ['core.chart'] },
  args: z.object({
    mark: z
      .enum(['bar', 'line', 'arc', 'point'])
      .meta({ nl: { labels: { bar: 'bar chart', line: 'line chart', arc: 'pie or donut chart', point: 'scatter or dot plot' } } }),
  }),
  nl: { examples: ['show it as a pie chart', 'make this a line chart'] },
  apply: (tx, plan, target) => {
    for (const id of target.kind === 'nodes' ? target.ids : []) tx.updateProps(id, { mark: plan.mark })
  },
})

export const coreNodeOps = [
  setTextOp,
  setStickyColorOp,
  setAoiOp,
  clearAoiOp,
  scaleAoiOp,
  setBasemapOp,
  setViewOp,
  fitToAoiOp,
  setChartSourceOp,
  setChartMarkOp,
]

/** Scale every coordinate of a polygon feature around its bbox center. */
function scaleFeature<T extends GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>(f: T, k: number): T {
  const coords = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const poly of coords) for (const ring of poly) for (const [x, y] of ring) {
    minX = Math.min(minX, x!); minY = Math.min(minY, y!); maxX = Math.max(maxX, x!); maxY = Math.max(maxY, y!)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const scale = (ring: GeoJSON.Position[]) => ring.map(([x, y]) => [cx + (x! - cx) * k, cy + (y! - cy) * k])
  const geometry =
    f.geometry.type === 'Polygon'
      ? { type: 'Polygon' as const, coordinates: f.geometry.coordinates.map(scale) }
      : { type: 'MultiPolygon' as const, coordinates: f.geometry.coordinates.map((p) => p.map(scale)) }
  return { ...f, geometry }
}
