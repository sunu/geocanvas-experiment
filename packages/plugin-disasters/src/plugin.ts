import { z } from 'zod'
import { ulid } from 'ulid'
import { defineOp, definePlugin, type NodeTypeDef, type TargetRef } from '@geo-canvas/core'
import type { Aoi, Table } from '@geo-canvas/plugin-core'
import { MockDisasterProvider } from './mockProvider.js'
import type { DisasterEvent, DisasterProvider, DisasterType } from './types.js'

export const PROVIDER = 'disasters'
const TYPES = ['cyclone', 'flood', 'earthquake', 'drought'] as const

const only = (t: TargetRef) => (t.kind === 'nodes' ? t.ids[0]! : '')
const eventIdArg = z.string().meta({ widget: 'disasters.event' }).describe('Id of a disaster event')

// ---------- Node types ----------

export const eventNode: NodeTypeDef = {
  type: 'disasters.event',
  title: 'Disaster event',
  description: 'One natural disaster. Outputs the event and its footprint (affected area).',
  props: z.object({ eventId: z.string().optional() }),
  outputs: {
    event: { type: 'disasters.event', label: 'Event' },
    footprint: { type: 'geo.aoi', label: 'Footprint' },
  },
  async compute({ node, provider }) {
    const id = node.props.eventId as string | undefined
    if (!id) return { data: { empty: 'No event selected' } }
    const event = await provider<DisasterProvider>(PROVIDER).getEvent(id)
    return { outputs: { event, footprint: event.footprint }, data: { event } }
  },
  summarize: (n, data) => {
    const e = (data as { event?: DisasterEvent })?.event
    return e ? `disaster event ${e.id}: ${e.name}, ${e.type}, severity ${e.severity}, ${e.start} to ${e.end}` : 'disaster event (none selected)'
  },
  defaultSize: { w: 300, h: 140 },
}

const CHILD = { w: 230, h: 120, gap: 12, cols: 3, header: 56 }

export const relatedEventsNode: NodeTypeDef = {
  type: 'disasters.relatedEvents',
  title: 'Related disasters',
  description:
    'A group of disaster events near the input event, from the last yearRange years. With autoSync on, it regenerates when the input event changes.',
  props: z.object({
    title: z.string().default('Related disasters'),
    yearRange: z.number().int().min(1).max(100).default(10),
    sameType: z.boolean().default(true),
    radiusKm: z.number().min(10).max(3000).default(400),
    autoSync: z.boolean().default(true),
    seedEventId: z.string().optional(),
  }),
  inputs: { event: { type: 'disasters.event', label: 'Seed event' } },
  outputs: { features: { type: 'geo.features', label: 'Event points' } },
  group: { childType: 'disasters.event' },
  onInputsChanged: {
    op: 'disasters.relatedEvents.regenerate',
    enabledProp: 'autoSync',
    args: (_node, inputs) => (inputs.event ? {} : undefined),
  },
  async compute({ node, reader, provider }) {
    const p = provider<DisasterProvider>(PROVIDER)
    const ids = reader
      .children(node.id)
      .map((c) => c.props.eventId as string | undefined)
      .filter((x): x is string => !!x)
    const events = await Promise.all(ids.map((id) => p.getEvent(id).catch(() => undefined)))
    const features: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: events
        .filter((e): e is DisasterEvent => !!e)
        .map((e) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: e.center },
          properties: { id: e.id, name: e.name, year: e.year, type: e.type, severity: e.severity },
        })),
    }
    return { outputs: { features }, data: { count: features.features.length } }
  },
  summarize: (n, data) =>
    `related disasters group: ${(data as { count?: number })?.count ?? 0} events, last ${n.props.yearRange} years, ${n.props.sameType ? 'same type' : 'all types'}, within ${n.props.radiusKm} km`,
  defaultSize: { w: CHILD.cols * (CHILD.w + CHILD.gap) + CHILD.gap, h: 300 },
}

// ---------- Ops ----------

export const changeEventOp = defineOp({
  id: 'disasters.event.change',
  title: 'Change disaster',
  description: 'Pick a different disaster event for this node. Linked nodes update.',
  target: { kind: 'node', types: ['disasters.event'], min: 1, max: 1 },
  args: z.object({ eventId: eventIdArg }),
  defaults: (ctx) => ({ eventId: ctx.reader.node(only(ctx.target))?.props.eventId as string | undefined }),
  async prepare(ctx, args) {
    const e = await ctx.provider<DisasterProvider>(PROVIDER).getEvent(args.eventId)
    return { eventId: e.id, name: e.name }
  },
  apply: (tx, plan, target) => tx.updateProps(only(target), { eventId: plan.eventId }),
  describePlan: (p) => `Seed event becomes ${p.name}`,
})

const regenerateArgs = z.object({
  yearRange: z.number().int().min(1).max(100).describe('How many years back from the seed event'),
  sameType: z.boolean().describe('Only events of the same type as the seed'),
  radiusKm: z.number().min(10).max(3000).describe('Search radius around the seed, in km'),
})

export const regenerateOp = defineOp({
  id: 'disasters.relatedEvents.regenerate',
  title: 'Regenerate related disasters',
  description:
    'Search again for disasters near the seed event and replace the events in this group. Use yearRange to set how many years back to search.',
  target: { kind: 'node', types: ['disasters.relatedEvents'], min: 1, max: 1 },
  args: regenerateArgs,
  defaults(ctx) {
    const p = ctx.reader.node(only(ctx.target))?.props ?? {}
    return { yearRange: p.yearRange as number, sameType: p.sameType as boolean, radiusKm: p.radiusKm as number }
  },
  async prepare(ctx, args) {
    const groupId = only(ctx.target)
    const seed = ctx.derived(groupId)?.inputs?.event as DisasterEvent | undefined
    if (!seed) throw new Error('Link a disaster event to this group first')
    const events = await ctx.provider<DisasterProvider>(PROVIDER).searchEvents({
      near: seed.center,
      radiusKm: args.radiusKm,
      types: args.sameType ? [seed.type as DisasterType] : undefined,
      fromYear: seed.year - args.yearRange,
      toYear: seed.year,
      excludeId: seed.id,
    })
    return {
      groupId,
      args,
      seedEventId: seed.id,
      oldChildren: ctx.reader.children(groupId).map((c) => c.id),
      children: events.map((e) => ({ id: ulid(), eventId: e.id })),
    }
  },
  apply(tx, plan) {
    const group = tx.reader.node(plan.groupId)!
    for (const id of plan.oldChildren) tx.deleteNode(id)
    plan.children.forEach((c, i) => {
      const col = i % CHILD.cols
      const row = Math.floor(i / CHILD.cols)
      tx.createNode({
        id: c.id,
        type: 'disasters.event',
        props: { eventId: c.eventId },
        parentId: plan.groupId,
        layout: {
          x: group.layout.x + CHILD.gap + col * (CHILD.w + CHILD.gap),
          y: group.layout.y + CHILD.header + row * (CHILD.h + CHILD.gap),
          w: CHILD.w,
          h: CHILD.h,
        },
      })
    })
    const rows = Math.max(1, Math.ceil(plan.children.length / CHILD.cols))
    tx.setLayout(plan.groupId, { h: CHILD.header + rows * (CHILD.h + CHILD.gap) + CHILD.gap })
    tx.updateProps(plan.groupId, { ...plan.args, seedEventId: plan.seedEventId })
  },
  describePlan: (p) => `${p.children.length} events replace ${p.oldChildren.length}`,
})

export const addEventOp = defineOp({
  id: 'disasters.event.add',
  title: 'Add disaster event',
  description: 'Add a node for one disaster event.',
  target: { kind: 'canvas' },
  args: z.object({ eventId: eventIdArg, x: z.number().default(0), y: z.number().default(0) }),
  prepare: (_ctx, args) => ({ ...args, id: ulid() }),
  apply: (tx, plan) => {
    tx.createNode({ id: plan.id, type: 'disasters.event', props: { eventId: plan.eventId }, layout: { x: plan.x, y: plan.y } })
  },
})

// ---------- Data functions ----------

const impactInputs = {
  event: { type: 'disasters.event', label: 'Event' },
  aoi: { type: 'geo.aoi', label: 'AOI' },
}

async function impactTable(
  inputs: Record<string, unknown>,
  provider: DisasterProvider,
  metric: 'people' | 'damage',
  top: number,
): Promise<Table | undefined> {
  const event = inputs.event as DisasterEvent | undefined
  if (!event) return undefined
  const rows = await provider.getImpact(event.id, inputs.aoi as Aoi | undefined)
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric])
  const total = Math.round(rows.reduce((s, r) => s + r[metric], 0) * 100) / 100
  const head = sorted.slice(0, top).map((r) => ({ district: r.district, value: r[metric] }))
  const rest = sorted.slice(top).reduce((s, r) => s + r[metric], 0)
  if (rest > 0) head.push({ district: 'Other', value: Math.round(rest * 100) / 100 })
  return { rows: head, x: 'district', y: 'value', unit: metric === 'people' ? 'people' : 'USD m', total }
}

const topParam = z.object({ top: z.number().int().min(1).max(50).default(8) })

// ---------- Plugin ----------

export function createDisastersPlugin(provider: DisasterProvider = new MockDisasterProvider()) {
  return definePlugin({
    id: 'disasters',
    version: '0.0.1',
    title: 'Disasters',
    dependsOn: ['core'],
    portTypes: [{ id: 'disasters.event', description: 'A disaster event with type, dates, severity, and footprint' }],
    nodeTypes: [eventNode, relatedEventsNode],
    ops: [changeEventOp, regenerateOp, addEventOp],
    providers: { [PROVIDER]: provider },
    dataFunctions: [
      {
        id: 'disasters.peopleAffected',
        title: 'People affected',
        description: 'People affected per district, inside the AOI.',
        inputs: impactInputs,
        params: topParam,
        output: 'core.table',
        run: (inputs, params, ctx) =>
          impactTable(inputs, ctx.provider<DisasterProvider>(PROVIDER), 'people', (params as { top: number }).top),
      },
      {
        id: 'disasters.estimatedDamage',
        title: 'Estimated damage',
        description: 'Estimated damage in USD millions per district, inside the AOI.',
        inputs: impactInputs,
        params: topParam,
        output: 'core.table',
        run: (inputs, params, ctx) =>
          impactTable(inputs, ctx.provider<DisasterProvider>(PROVIDER), 'damage', (params as { top: number }).top),
      },
    ],
    templates: [
      {
        id: 'disasters.sitrep',
        title: 'Situation report',
        description:
          'A situation report for one disaster: event, affected-area map, people affected, estimated damage, summary, and related disasters.',
        inputs: z.object({ eventId: eventIdArg }),
        build: ({ eventId }) => ({
          nodes: [
            { key: 'seed', type: 'disasters.event', props: { eventId }, layout: { x: 0, y: 0, w: 380, h: 150 } },
            {
              key: 'summary',
              type: 'core.text',
              layout: { x: 0, y: 180, w: 380, h: 280 },
              props: {
                title: 'Summary',
                ports: ['event', 'people', 'damage'],
                text: [
                  '## {{event.name}}',
                  '**Type:** {{event.type}} · **Severity:** {{event.severity}}',
                  '**Dates:** {{event.start}} to {{event.end}}',
                  '',
                  '**People affected in AOI:** {{people.total}}',
                  '**Estimated damage in AOI:** USD {{damage.total}} m',
                  '',
                  '_Mock data._',
                ].join('\n'),
              },
            },
            { key: 'map', type: 'core.map', props: { title: 'Affected area' }, layout: { x: 410, y: 0, w: 600, h: 460 } },
            {
              key: 'people',
              type: 'core.chart',
              props: { title: 'People affected by district', source: 'disasters.peopleAffected', mark: 'bar' },
              layout: { x: 1040, y: 0, w: 440, h: 220 },
            },
            {
              key: 'damage',
              type: 'core.chart',
              props: { title: 'Estimated damage (USD m)', source: 'disasters.estimatedDamage', mark: 'bar' },
              layout: { x: 1040, y: 240, w: 440, h: 220 },
            },
            { key: 'related', type: 'disasters.relatedEvents', layout: { x: 0, y: 500, w: 734, h: 300 } },
          ],
          links: [
            { from: { key: 'seed', port: 'footprint' }, to: { key: 'map', port: 'aoi' } },
            { from: { key: 'seed', port: 'event' }, to: { key: 'people', port: 'event' } },
            { from: { key: 'seed', port: 'event' }, to: { key: 'damage', port: 'event' } },
            { from: { key: 'map', port: 'aoi' }, to: { key: 'people', port: 'aoi' } },
            { from: { key: 'map', port: 'aoi' }, to: { key: 'damage', port: 'aoi' } },
            { from: { key: 'seed', port: 'event' }, to: { key: 'summary', port: 'event' } },
            { from: { key: 'people', port: 'table' }, to: { key: 'summary', port: 'people' } },
            { from: { key: 'damage', port: 'table' }, to: { key: 'summary', port: 'damage' } },
            { from: { key: 'seed', port: 'event' }, to: { key: 'related', port: 'event' } },
            { from: { key: 'related', port: 'features' }, to: { key: 'map', port: 'features' } },
          ],
        }),
      },
    ],
  })
}
