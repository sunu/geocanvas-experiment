import { z } from 'zod'
import type { NodeTypeDef, PortMap } from '@geo-canvas/core'
import type { Aoi, Table } from './ports.js'

export const mapViewSchema = z.object({
  center: z.tuple([z.number(), z.number()]).describe('[longitude, latitude]'),
  zoom: z.number().min(0).max(22),
  bearing: z.number().optional(),
})

/** Height of the node header above the map. The map viewport is the node minus this. */
export const MAP_HEADER_H = 34

export function mapViewport(layout: { w: number; h: number }) {
  return { w: layout.w, h: Math.max(1, layout.h - MAP_HEADER_H) }
}

const geojson = z.custom<GeoJSON.GeoJSON>((v) => !!v && typeof v === 'object' && 'type' in (v as object))

export const stickyNode: NodeTypeDef = {
  type: 'core.sticky',
  title: 'Sticky note',
  description: 'A short note.',
  props: z.object({
    text: z.string().meta({ widget: 'textarea' }).default(''),
    color: z.enum(['yellow', 'blue', 'green', 'pink', 'orange']).default('yellow'),
  }),
  summarize: (n) => `sticky: ${String(n.props.text).slice(0, 80)}`,
  defaultSize: { w: 200, h: 200 },
}

/** Replace {{path.to.value}} with values from the inputs. */
export function renderBindings(text: string, scope: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    let v: unknown = scope
    for (const key of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined
    if (v === undefined || v === null) return '—'
    return typeof v === 'number' ? v.toLocaleString('en-US') : String(v)
  })
}

export const textNode: NodeTypeDef = {
  type: 'core.text',
  title: 'Text block',
  description: 'Markdown text. Use {{port.field}} to show values from linked nodes.',
  props: z.object({
    title: z.string().default(''),
    text: z.string().meta({ widget: 'textarea' }).default(''),
    /** Names of the input ports. Each one can take a link. */
    ports: z.array(z.string()).meta({ advanced: true }).default(['context']),
  }),
  inputs: (node) =>
    Object.fromEntries(((node.props.ports as string[]) ?? []).map((p) => [p, { type: 'any', label: p }])) as PortMap,
  compute: ({ node, inputs }) => ({ data: { rendered: renderBindings(String(node.props.text ?? ''), inputs) } }),
  summarize: (n, data) =>
    `text "${n.props.title}": ${String((data as { rendered?: string })?.rendered ?? n.props.text).slice(0, 200)}`,
  defaultSize: { w: 360, h: 220 },
}

export const mapNode: NodeTypeDef = {
  type: 'core.map',
  title: 'Map',
  description: 'A map. It shows an area of interest (AOI) and features. Its AOI output goes to linked nodes.',
  props: z.object({
    title: z.string().default('Map'),
    basemap: z.enum(['streets', 'light', 'dark', 'satellite']).default('light'),
    /** AOI that a user drew. It replaces the AOI from the input. */
    aoiOverride: geojson.meta({ advanced: true, widget: 'aoi' }).optional(),
    /** Shared camera of the map. Set by core.map.setView and core.map.fitToAoi. */
    view: mapViewSchema.meta({ advanced: true }).optional(),
    /** Fit the view when the AOI changes. */
    autoFit: z.boolean().meta({ advanced: true }).default(true),
  }),
  inputs: {
    aoi: { type: 'geo.aoi', label: 'AOI' },
    features: { type: 'geo.features', label: 'Features' },
  },
  outputs: { aoi: { type: 'geo.aoi', label: 'AOI' } },
  // Fit the shared view when the effective AOI changes (the originator runs it, once).
  onInputsChanged: {
    op: 'core.map.fitToAoi',
    enabledProp: 'autoFit',
    key: (node, inputs) => node.props.aoiOverride ?? inputs.aoi ?? null,
    args: (node, inputs) => (node.props.aoiOverride ?? inputs.aoi ? {} : undefined),
  },
  compute: ({ node, inputs }) => {
    const aoi = (node.props.aoiOverride as Aoi | undefined) ?? (inputs.aoi as Aoi | undefined)
    return {
      outputs: aoi ? { aoi } : {},
      data: { aoi, features: inputs.features, overridden: !!node.props.aoiOverride },
    }
  },
  summarize: (n, data) => {
    const d = data as { aoi?: Aoi; overridden?: boolean } | undefined
    return `map "${n.props.title}"${d?.aoi ? `, AOI set${d.overridden ? ' by user' : ' from input'}` : ', no AOI'}`
  },
  defaultSize: { w: 520, h: 380 },
}

export const chartNode: NodeTypeDef = {
  type: 'core.chart',
  title: 'Chart',
  description: 'A chart. It gets rows from a data function. The inputs of the data function are its input ports.',
  props: z.object({
    title: z.string().default('Chart'),
    /** Id of a data function that a plugin registered. */
    source: z.string().meta({ widget: 'dataFunction', ask: true }).optional(),
    params: z.record(z.string(), z.unknown()).meta({ advanced: true }).default({}),
    mark: z.enum(['bar', 'line', 'arc', 'point']).default('bar'),
    /** Extra Vega-Lite properties that go over the default spec. */
    spec: z.record(z.string(), z.unknown()).meta({ advanced: true }).optional(),
  }),
  inputs: (node, registry) => {
    const fn = node.props.source ? registry.dataFunction(String(node.props.source)) : undefined
    return fn ? fn.inputs : {}
  },
  outputs: { table: { type: 'core.table' }, total: { type: 'core.number' } },
  async compute({ node, inputs, callData }) {
    if (!node.props.source) return { data: { empty: 'No data source' } }
    const table = (await callData(String(node.props.source), inputs, node.props.params)) as Table | undefined
    if (!table) return { data: { empty: 'Waiting for inputs' } }
    return { outputs: { table, total: table.total }, data: { table } }
  },
  summarize: (n, data) => {
    const t = (data as { table?: Table })?.table
    if (!t) return `chart "${n.props.title}" (no data)`
    const top = t.rows.slice(0, 5).map((r) => `${r[t.x]}=${r[t.y]}`).join(', ')
    return `chart "${n.props.title}": total ${t.total ?? '?'} ${t.unit ?? ''}; ${top}`
  },
  defaultSize: { w: 420, h: 300 },
}

export const coreNodeTypes = [stickyNode, textNode, mapNode, chartNode]
