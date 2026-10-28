import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'

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

// `at`: asking for the same area again is a change too, so views that panned away move back.
const focusField = area.extend({ at: z.number().optional().describe('When it was set') })

/**
 * `focus` is the area that everyone's view of the map moves to when it changes (op map.focus). After that,
 * each person pans their own view again (apps/web/src/map/localView.ts).
 */
export type MapBoardObject = AnyObject & { type: 'map'; basemap: Basemap; focus?: z.infer<typeof focusField> }

const round = (n: number) => Math.round(n * 100) / 100

export const mapPlugin = definePlugin({
  id: 'map',
  title: 'Map',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'map',
      title: 'Map',
      description: 'A live map. Its basemap is shared; each person pans and zooms their own view. Give `focus` to show an area.',
      fields: z.object({
        basemap: basemap.default('light'),
        focus: focusField.optional().meta({ advanced: true }).describe('Area to show (west, south, east, north in degrees)'),
      }),
      defaultSize: { w: 520, h: 360 },
      layer: 'bottom',
      summarize: (o) => {
        const { basemap, focus: f } = o as MapBoardObject
        return `basemap ${basemap}${f ? `, showing west ${round(f.west)} south ${round(f.south)} east ${round(f.east)} north ${round(f.north)}` : ''}`
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
      id: 'map.focus',
      title: 'Show area',
      description: 'Pan and zoom the selected maps to an area, for everyone. Each person can pan away again afterwards.',
      target: { kind: 'objects', types: ['map'] },
      args: area,
      nl: { aliases: ['zoom to', 'pan to', 'fly to'] },
      prepare: (_ctx, a) => ({ ...a, at: Date.now() }),
      apply: (tx, focus, target) => target.kind === 'objects' && tx.update(Object.fromEntries(target.ids.map((id) => [id, { focus }]))),
    }),
  ],
})
