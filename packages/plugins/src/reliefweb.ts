import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import type { DisasterEvent } from './monty/types.js'

/**
 * A feed of ReliefWeb updates (situation reports, maps, appeals) for a disaster, made from an event.
 * No React here: the view is registered in apps/web/src/reliefweb/ui.tsx. The board stores the disaster's
 * GLIDE numbers; each browser reads the updates (apps/web/src/reliefweb/feed.ts).
 */

/** GLIDE, the global disaster identifier, e.g. "FF-2026-000162-NPL": hazard, year, number, ISO3 country. */
export const GLIDE = /^[A-Z]{2}-\d{4}-\d{6}-[A-Z]{3}$/

const glide = z.string().regex(GLIDE, 'A GLIDE number, e.g. "FF-2026-000162-NPL"')

/** glides is empty until a disaster is set. */
export type ReliefWebBoardObject = AnyObject & { type: 'reliefweb'; glides: string[]; title?: string }

/**
 * The GLIDE numbers of a Montandon event: its own when it is a GLIDE record, and those of the GLIDE records
 * found for it in the other sources (same hazard, country and time). Montandon's GLIDE event ids are
 * "glide-event-<GLIDE>".
 */
export function glidesOf(event: Pick<DisasterEvent, 'id' | 'sources'>): string[] {
  const ids = [event.id, ...(event.sources?.find((s) => s.source === 'glide')?.eventIds ?? [])]
  return [...new Set(ids.flatMap((id) => (id.startsWith('glide-event-') ? [id.slice('glide-event-'.length).toUpperCase()] : [])))].filter((g) => GLIDE.test(g))
}

/** A feed on the board for the same disaster: the same GLIDE numbers, in any order. */
export function feedFor(objects: readonly AnyObject[], glides: string[]): ReliefWebBoardObject | undefined {
  const key = [...glides].sort().join(',')
  return objects.find((o): o is ReliefWebBoardObject => o.type === 'reliefweb' && [...((o as ReliefWebBoardObject).glides ?? [])].sort().join(',') === key)
}

export const reliefwebPlugin = definePlugin({
  id: 'reliefweb',
  title: 'ReliefWeb',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'reliefweb',
      title: 'ReliefWeb updates',
      description: 'The latest ReliefWeb updates (situation reports, maps, appeals) for a disaster, by its GLIDE numbers.',
      fields: z.object({
        glides: z.array(glide).default([]).describe('GLIDE numbers of the disaster'),
        title: z.string().min(1).optional().describe('What the feed is about, e.g. the event name'),
      }),
      defaultSize: { w: 380, h: 440 },
      layer: 'top',
      summarize: (o) => {
        const { glides, title } = o as ReliefWebBoardObject
        return glides.length ? `ReliefWeb updates for ${title ? `${title}, ` : ''}GLIDE ${glides.join(', ')}` : 'no disaster set yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'reliefweb.setDisaster',
      title: 'Set ReliefWeb disaster',
      description: 'Show the ReliefWeb updates of a disaster, by its GLIDE numbers, in the selected feed.',
      target: { kind: 'objects', types: ['reliefweb'], max: 1 },
      args: z.object({
        glides: z.array(glide).min(1).describe('GLIDE numbers, e.g. ["FF-2026-000162-NPL"]'),
        title: z.string().min(1).optional().describe('What the feed is about, e.g. the event name'),
      }),
      apply: (tx, { glides, title }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { glides, ...(title && { title }) } }),
    }),
  ],
})
