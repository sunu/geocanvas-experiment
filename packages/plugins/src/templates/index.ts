import { definePlugin } from '@ttx/core'
import { defineTemplate, type ContentNode } from './define.js'
import * as seed from './seeds.js'

const sticky = (text: string, col: number): ContentNode => ({ type: 'sticky', fields: { text }, col })

/** A situation report's start: the event, where it happened, what ReliefWeb has on it and the country's context. */
export const sitrep = defineTemplate({
  id: 'sitrep',
  title: 'Situation report',
  description:
    'Start a situation report for a disaster event: the event card, a map of where it happened, its ReliefWeb updates, the country context, and notes for key figures, needs and gaps, in a frame. The map, feed, country card and frame title follow the event card.',
  seeds: { event: { kind: seed.event, label: 'Event' } },
  frames: [{ prefix: 'Situation report: ' }],
  nodes: [
    { root: 'event', col: 0 },
    { type: 'country', link: { recipe: 'country' }, col: 0 },
    { type: 'map', link: { recipe: 'eventFootprint' }, col: 1, size: { w: 640, h: 520 } },
    { type: 'reliefweb', link: { recipe: 'reliefweb' }, col: 2 },
    sticky('Key figures', 3),
    sticky('Needs', 3),
    sticky('Gaps', 3),
  ],
})

/** Conflict in an area: political violence by province, who works where, and the country's context. */
export const conflict = defineTemplate({
  id: 'conflict',
  title: 'Conflict explorer',
  description:
    "Explore conflict in an area of interest: the area as an input, a map of political violence events by province (ACLED via HDX HAPI) for the area's country, the conflict trend, who works where, the country context, and notes, in a frame. Everything follows the area input.",
  seeds: { area: { kind: seed.area, label: 'Area of interest' } },
  frames: [{ prefix: 'Conflict: ' }],
  nodes: [
    { root: 'area', col: 0 },
    { type: 'map', link: { recipe: 'conflictChoropleth' }, col: 0, size: { w: 640, h: 520 } },
    { type: 'conflict', link: { recipe: 'country' }, col: 1 },
    { type: 'presence', link: { recipe: 'country' }, col: 1 },
    { type: 'country', link: { recipe: 'country' }, col: 2 },
    sticky('Hotspots', 3),
    sticky('Access constraints', 3),
  ],
})

export const templatesPlugin = definePlugin({
  id: 'templates',
  title: 'Templates',
  dependsOn: ['core', 'map', 'events', 'reliefweb', 'hapi', 'inputs', 'links'],
  ops: [sitrep, conflict],
})

export { defineTemplate, GAP, TEMPLATE_OP_PREFIX, type ContentNode, type RootNode, type TemplateDef, type TemplateNode } from './define.js'
export { MY_VIEW, type Facts, type SeedKind } from './seeds.js'
