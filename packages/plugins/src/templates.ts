import { z } from 'zod'
import { defineOp, definePlugin, type Registry } from '@ttx/core'
import { eventLayer } from './events.js'
import { iso3 } from './hapi.js'
import { boundariesLayer } from './mapLayers.js'
import { GLIDE } from './reliefweb.js'

/**
 * Board templates (agent-docs/tasks/board-templates.md): a set of widgets laid out for one job, added by one op.
 * A template is code, not stored data: the board keeps only the objects it added, with their recipes. Every part
 * of the context is optional, so a template can be set up first and its widgets filled in on the board.
 */

export interface TemplateContext {
  title?: string
  eventId?: string
  eventName?: string
  /** ISO3 code of the event's country. */
  country?: string
  glides?: string[]
}

/** One object to add: x and y relative to the template's top left; w and h default to the type's size. */
export interface TemplateItem {
  type: string
  fields: Record<string, unknown> & { x: number; y: number; w?: number; h?: number }
}

export interface BoardTemplate {
  title: string
  description: string
  build(ctx: TemplateContext, registry: Registry): TemplateItem[]
}

const GAP = 24
const sizeOf = (registry: Registry, type: string) => registry.objectType(type)!.defaultSize

/** The report sections of a situation report, as sticky notes until reports exist. */
const SITREP_SECTIONS = ['Key figures', 'Situation overview', 'Needs', 'Response', 'Gaps']
const SITREP_MAP = { w: 800, h: 784 }

/**
 * A situation report: the event and its ReliefWeb feed; a map of its footprint over the provinces; the country's
 * context, who's where and conflict; notes for the report's sections. Without an event or a country, the widgets
 * come empty and people pick them on the board.
 */
const sitrep: BoardTemplate = {
  title: 'SitRep',
  description: 'Event, ReliefWeb feed, map, country context, who’s where, conflict and notes for the report sections.',
  build({ title, eventId, eventName, country, glides }, registry) {
    const col = sizeOf(registry, 'event').w
    const [a, b, c, d] = [0, col + GAP, col + GAP + SITREP_MAP.w + GAP, 2 * (col + GAP) + SITREP_MAP.w + GAP]
    const top = 80
    const items: TemplateItem[] = [
      { type: 'text', fields: { x: a, y: 0, w: d + col, h: 48, text: title ? `${title}: situation report` : 'Situation report', fontSize: 32 } },
      { type: 'event', fields: { x: a, y: top, eventId } },
      {
        type: 'map',
        fields: { x: b, y: top, ...SITREP_MAP, layers: [boundariesLayer(1), ...(eventId ? [eventLayer(eventId, eventName)] : [])] },
      },
      { type: 'country', fields: { x: c, y: top, country } },
      { type: 'conflict', fields: { x: d, y: top, country } },
      { type: 'presence', fields: { x: c, y: top + sizeOf(registry, 'country').h + GAP, country } },
    ]
    if (glides?.length) items.push({ type: 'reliefweb', fields: { x: a, y: top + sizeOf(registry, 'event').h + GAP, glides, title: eventName } })
    const bottom = Math.max(...items.map((i) => i.fields.y + (i.fields.h ?? sizeOf(registry, i.type).h)))
    const note = sizeOf(registry, 'sticky').w
    SITREP_SECTIONS.forEach((text, i) => items.push({ type: 'sticky', fields: { x: a + i * (note + GAP), y: bottom + 2 * GAP, text } }))
    return items
  },
}

export const TEMPLATES = { sitrep } satisfies Record<string, BoardTemplate>
export type TemplateId = keyof typeof TEMPLATES

/** The op that sets up a board from a template. The agent's callOp centers it in the asker's view (agent/call.ts). */
export const APPLY_TEMPLATE = 'board.applyTemplate'

export const templatesPlugin = definePlugin({
  id: 'templates',
  title: 'Templates',
  dependsOn: ['core'],
  ops: [
    defineOp({
      id: APPLY_TEMPLATE,
      title: 'Set up from a template',
      description:
        'Add a set of widgets laid out for one job, e.g. a situation report (sitrep) for a Montandon event, in one undo step. ' +
        'Every part of the context is optional: widgets without one are added empty, to be picked on the board.',
      target: { kind: 'canvas' },
      args: z.object({
        template: z.enum(Object.keys(TEMPLATES) as [TemplateId, ...TemplateId[]]).describe('Template'),
        title: z.string().trim().max(80).optional().describe('Also name the board'),
        eventId: z.string().min(1).optional().describe('Montandon event id, e.g. from events__search'),
        eventName: z.string().min(1).optional().describe("The event's name"),
        country: iso3.optional().describe("ISO3 code of the event's country"),
        glides: z.array(z.string().regex(GLIDE)).optional().describe("The event's GLIDE numbers, for its ReliefWeb feed"),
        x: z.number().default(0).meta({ advanced: true }).describe('Center of the template, in canvas units'),
        y: z.number().default(0).meta({ advanced: true }).describe('Center of the template, in canvas units'),
      }),
      nl: { aliases: ['use template', 'sitrep', 'situation report'] },
      // Lay out and check everything here: a write that fails halfway through apply would stay.
      prepare(ctx, { template, title, x, y, ...rest }) {
        const items = TEMPLATES[template].build({ title, ...rest }, ctx.registry).map(({ type, fields }) => ({
          type,
          fields: { ...fields, w: fields.w ?? sizeOf(ctx.registry, type).w, h: fields.h ?? sizeOf(ctx.registry, type).h },
        }))
        const right = Math.max(...items.map((i) => i.fields.x + i.fields.w))
        const bottom = Math.max(...items.map((i) => i.fields.y + i.fields.h))
        const [dx, dy] = [Math.round(x - right / 2), Math.round(y - bottom / 2)]
        for (const i of items) ctx.registry.objectSchema(i.type).parse({ ...i.fields, z: 0 })
        return { title, items: items.map(({ type, fields }) => ({ type, fields: { ...fields, x: fields.x + dx, y: fields.y + dy } })) }
      },
      apply(tx, { title, items }) {
        for (const { type, fields } of items) tx.add(type, fields)
        if (title) tx.setTitle(title)
      },
    }),
  ],
})
