import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import { BASEMAPS, type Basemap } from './basemaps'

/** The map object type and its ops. No React here: the view is registered in map/ui.ts. */

export type MapBoardObject = AnyObject & { type: 'map'; basemap: Basemap }

const basemap = z.enum(BASEMAPS).describe('Basemap')

export const mapPlugin = definePlugin({
  id: 'map',
  title: 'Map',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'map',
      title: 'Map',
      description: 'A live map. Its basemap is shared; each person pans and zooms their own view.',
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
  ],
})
