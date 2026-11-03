import { z } from 'zod'
import { defineTool } from '@ttx/core'
import type { NotebookFactory } from './api'

/**
 * Published Notebook Factory runs, as the notebook card's run picker finds them (NotebookFactory.listRuns), so an
 * agent can find a run id for notebook.setRun and the file names for map.addNotebookResult.
 */
export function notebookRunsTool(nbf: Pick<NotebookFactory, 'listRuns'>) {
  return defineTool({
    id: 'notebooks.runs',
    plugin: 'notebooks',
    title: 'Search notebook runs',
    description:
      'Published Notebook Factory runs (e.g. risk exposure or impact estimation for an area), newest first, at most 20. ' +
      'Each has its id (for notebook.setRun), title, template, area, date and the names of its published files ' +
      '(GeoJSON files can be shown with map.addNotebookResult).',
    input: z.object({
      search: z.string().optional().describe('Words in the run title or area, e.g. "Mozambique"'),
      notebook: z.string().optional().describe('Template slug, e.g. "uc1-risk-exposure"'),
    }),
    output: 'notebooks.runs',
    // People publish runs at any time: search again each time.
    cache: false,
    async run(q, ctx) {
      const { count, runs } = await nbf.listRuns(q, ctx.signal)
      return {
        count,
        runs: runs.map((r) => ({
          id: r.id,
          title: r.title,
          notebook: r.notebook,
          template: r.notebook_title,
          summary: r.summary,
          area: r.area?.name ?? null,
          finished_at: r.finished_at,
          files: Object.keys(r.artifacts ?? {}),
        })),
      }
    },
  })
}
