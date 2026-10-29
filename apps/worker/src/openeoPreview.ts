import type { Runtime } from '@ttx/core'
import { previewOpenEOGraph, type OpenEOAnalysisObject } from '@ttx/plugins'
import { analysisGraph, validateAnalysis } from './openeo'
import type { OpenEOClient } from './openeoClient'

export type OpenEOPreviewResult = { status: number; result?: string; error?: string }

/** Preview the stored proposal, rather than accepting a graph from the browser. */
export async function previewOpenEOAnalysis(runtime: Runtime, client: OpenEOClient, analysisId: string): Promise<OpenEOPreviewResult> {
  if (!client.hasCredentials) return { status: 503, error: 'openEO preview is not configured on this server.' }

  const analysis = runtime.board.get(analysisId) as OpenEOAnalysisObject | undefined
  if (!analysis || analysis.type !== 'openeo') return { status: 404, error: 'No openEO proposal with that id.' }
  if (!(analysis.status === 'proposed' || (analysis.status === 'error' && !analysis.serviceId))) {
    return { status: 409, error: 'Preview is available only before the analysis is approved and run.' }
  }
  if (runtime.board.get(analysis.mapId)?.type !== 'map') return { status: 409, error: 'The proposal’s map no longer exists.' }

  let graph
  try {
    validateAnalysis(analysis)
    graph = analysisGraph(analysis)
  } catch (error) {
    return { status: 400, error: String((error as Error)?.message ?? error) }
  }

  try {
    const [west, south, east, north] = analysis.area
    const result = await previewOpenEOGraph({ west, south, east, north }, graph, (processGraph, signal) =>
      client.request('/result', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ process: { process_graph: processGraph } }),
        signal,
      }),
    )
    return { status: 200, result }
  } catch (error) {
    return { status: 502, error: String((error as Error)?.message ?? error).slice(0, 500) }
  }
}
