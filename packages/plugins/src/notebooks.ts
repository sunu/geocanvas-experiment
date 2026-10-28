import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import type { MapBoardObject } from './map.js'
import { newLayerId, type MapLayer } from './mapLayers.js'

/**
 * The notebook object type and its ops: a published run of a Notebook Factory notebook (results, the
 * rendered notebook and other files). No React here: the view is registered in apps/web/src/notebooks/ui.tsx.
 * The board stores the run id; each browser reads the run (apps/web/src/notebooks/api.ts).
 */

/** runId is absent until someone picks a run; view is shared, and absent means the summary card. */
export type NotebookBoardObject = AnyObject & { type: 'notebook'; runId?: string; view?: 'card' | 'notebook' }

/** The tool that reads a run's GeoJSON file in the browser (apps/web/src/notebooks/artifact.ts). */
export const NOTEBOOK_ARTIFACT_TOOL = 'notebooks.artifact'

/** A map layer for a GeoJSON file of a run: the recipe names the run and the file, not its url. */
export function notebookResultLayer(runId: string, fileName: string, title?: string): MapLayer {
  return {
    id: newLayerId(),
    tool: NOTEBOOK_ARTIFACT_TOOL,
    input: { runId, name: fileName },
    title: title ?? fileName.replace(/\.geojson$/i, ''),
  }
}

const view = z.enum(['card', 'notebook'])
const runId = z.string().min(1)

export const notebooksPlugin = definePlugin({
  id: 'notebooks',
  title: 'Notebooks',
  dependsOn: ['core', 'map'],
  objectTypes: [
    {
      type: 'notebook',
      title: 'Notebook',
      description: 'A published run of a Notebook Factory notebook (e.g. risk exposure for an area): its summary and files, or the rendered notebook.',
      fields: z.object({ runId: runId.optional(), view: view.optional() }),
      defaultSize: { w: 520, h: 420 },
      layer: 'top',
      summarize: (o) => {
        const { runId, view } = o as NotebookBoardObject
        return runId ? `Notebook Factory run ${runId}${view === 'notebook' ? ', showing the notebook' : ''}` : 'no run picked yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'notebook.setRun',
      title: 'Pick notebook run',
      description: 'Show a published Notebook Factory run in the selected notebook object.',
      target: { kind: 'objects', types: ['notebook'], max: 1 },
      args: z.object({ runId: runId.meta({ widget: 'notebookRun' }).describe('Run') }),
      nl: { aliases: ['change notebook', 'select run'] },
      apply: (tx, { runId }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { runId } }),
    }),
    defineOp({
      id: 'notebook.setView',
      title: 'Show notebook or summary',
      description: "Show the selected notebooks' summary cards or their rendered notebooks, for everyone.",
      target: { kind: 'objects', types: ['notebook'] },
      args: z.object({ view: view.describe("'card' for the summary, 'notebook' for the rendered notebook") }),
      apply: (tx, { view }, target) => target.kind === 'objects' && tx.update(Object.fromEntries(target.ids.map((id) => [id, { view }]))),
    }),
    defineOp({
      id: 'map.addNotebookResult',
      title: 'Add notebook result',
      description: "Add a GeoJSON file published by a Notebook Factory run to a map, as a data layer for everyone. Name the run and the file as listed in the run's artifacts.",
      target: { kind: 'objects', types: ['map'], min: 1, max: 1 },
      args: z.object({
        runId: runId.describe('Notebook Factory run id'),
        name: z
          .string()
          .regex(/\.geojson$/i, 'A GeoJSON file (.geojson)')
          .describe('File name, e.g. "exposure_by_subdivision.geojson"'),
        title: z.string().min(1).optional().describe("The layer's title in the map's list. Default: the file name"),
      }),
      prepare(ctx, { runId, name, title }) {
        const map = ctx.board.get(ctx.target.kind === 'objects' ? (ctx.target.ids[0] ?? '') : '') as MapBoardObject
        return { id: map.id, layers: [...(map.layers ?? []), notebookResultLayer(runId, name, title)] }
      },
      apply: (tx, { id, layers }) => tx.update({ [id]: { layers } }),
    }),
  ],
})
