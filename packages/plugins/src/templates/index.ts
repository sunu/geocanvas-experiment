import { definePlugin } from '@ttx/core'
import { eventLayer } from '../events.js'
import { choroplethLayer } from '../hapi.js'
import { defineTemplate } from './define.js'
import * as seed from './seeds.js'

/** A short date range, e.g. "2026-08-02" or "2026-08-02 to 2026-08-09". */
const when = (start?: string, end?: string) => (start ? (end && end.slice(0, 10) !== start.slice(0, 10) ? `${start.slice(0, 10)} to ${end.slice(0, 10)}` : start.slice(0, 10)) : '')

const sticky = (text: string, col: number) => ({ type: 'sticky', fields: () => ({ text }), col })

/** A situation report's start: the event, where it happened, what ReliefWeb has on it and the country's context. */
export const sitrep = defineTemplate({
  id: 'sitrep',
  title: 'Situation report',
  description:
    'Start a situation report for a disaster event: the event card, a map of where it happened, its ReliefWeb updates (when it has GLIDE numbers), the country context, and notes for key figures, needs and gaps.',
  seeds: { event: { kind: seed.event, label: 'Event' } },
  heading: (f) => `Situation report: ${f.name ?? f.eventId}${f.start ? ` (${when(f.start, f.end)})` : ''}`,
  nodes: [
    { type: 'event', needs: ['eventId'], fields: (f) => ({ eventId: f.eventId }), col: 0 },
    { type: 'country', needs: ['country'], fields: (f) => ({ country: f.country }), col: 0 },
    { type: 'map', needs: ['eventId'], fields: (f) => ({ layers: [eventLayer(f.eventId!, f.name)] }), col: 1, size: { w: 640, h: 520 } },
    { type: 'reliefweb', needs: ['glides'], fields: (f) => ({ glides: f.glides, ...(f.name && { title: f.name }) }), col: 2 },
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
    "Explore conflict in an area of interest: a map of political violence events by province (ACLED via HDX HAPI) for the area's country, the conflict trend, who works where, the country context, and notes.",
  seeds: { area: { kind: seed.area, label: 'Area of interest' } },
  heading: (f) => `Conflict: ${f.name ?? 'area of interest'}`,
  nodes: [
    { type: 'map', needs: ['country'], fields: (f) => ({ layers: [choroplethLayer(f.country!, 'conflictEvents', 1)] }), col: 0, size: { w: 640, h: 520 } },
    { type: 'conflict', needs: ['country'], fields: (f) => ({ country: f.country }), col: 1 },
    { type: 'presence', needs: ['country'], fields: (f) => ({ country: f.country }), col: 1 },
    { type: 'country', needs: ['country'], fields: (f) => ({ country: f.country }), col: 2 },
    sticky('Hotspots', 3),
    sticky('Access constraints', 3),
  ],
})

export const templatesPlugin = definePlugin({
  id: 'templates',
  title: 'Templates',
  dependsOn: ['core', 'map', 'events', 'reliefweb', 'hapi'],
  ops: [sitrep, conflict],
})

export { defineTemplate, TEMPLATE_OP_PREFIX, type TemplateDef, type TemplateNode } from './define.js'
export { MY_VIEW, type Facts, type SeedKind } from './seeds.js'
