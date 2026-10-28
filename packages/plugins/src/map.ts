import { z } from 'zod'
import { defineOp, definePlugin, Views, type AnyObject } from '@ttx/core'
import { MAP_HEADER_PX, viewOfArea } from './mapView.js'

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

/** Each person's view of a map is not here: it is in the doc's `views` (Views in @ttx/core). */
export type MapBoardObject = AnyObject & { type: 'map'; basemap: Basemap }

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
      fields: z.object({ basemap: basemap.default('light') }),
      defaultSize: { w: 520, h: 360 },
      layer: 'bottom',
      summarize: (o) => `basemap ${(o as MapBoardObject).basemap}`,
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
  ],
})
