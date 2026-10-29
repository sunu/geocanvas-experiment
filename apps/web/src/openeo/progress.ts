import { describeGraph, type OpenEOAnalysisObject, type ProcessGraph } from '@ttx/plugins'

type Analysis = Pick<OpenEOAnalysisObject, 'status'> & Partial<Pick<OpenEOAnalysisObject, 'serviceId'>>

export type StepState = 'done' | 'active' | 'todo' | 'failed'

/** What the card shows for a run: its steps, and for a ready layer what to expect (the board stores no more than this). */
export interface Progress {
  steps: { label: string; state: StepState }[]
  hint?: string
}

const LABELS = ['Approved', 'Tile service created on EOPF', 'Test tile rendered by EOPF']

// The Worker marks a run ready only after EOPF rendered one tile (probeTile in apps/worker/src/openeo.ts). An XYZ
// service computes every other tile when the map asks for it. 6 is the service's minzoom (createService there).
const READY_HINT = 'A test tile rendered. EOPF computes the rest as you view the map, so tiles can load slowly. Zoom 6 or closer, over the approved area.'

export function analysisProgress(analysis: Analysis): Progress {
  const { status, serviceId } = analysis
  // How many steps are finished; the next one is active, or failed when the run is in error.
  const done = status === 'ready' ? 3 : serviceId ? 2 : status === 'requested' || status === 'running' || status === 'error' ? 1 : 0
  const steps = LABELS.map((label, i): Progress['steps'][number] => ({
    label,
    state: i < done ? 'done' : i === done ? (status === 'error' ? 'failed' : status === 'proposed' || status === 'cancelled' ? 'todo' : 'active') : 'todo',
  }))
  return { steps, hint: status === 'ready' ? READY_HINT : undefined }
}

/** Stop deletes the service on EOPF once there is one, and says so. */
export function stopLabel(analysis: Analysis): string {
  if (analysis.status === 'ready') return 'Stop and delete layer'
  if (analysis.status === 'error') return 'Delete service'
  return 'Cancel'
}

/** What the run is doing, as one line; a run with a service is waiting for its test tile. */
export function headline(analysis: Analysis): string {
  switch (analysis.status) {
    case 'proposed': return 'Awaiting your approval'
    case 'requested':
    case 'running': return analysis.serviceId ? 'Rendering a test tile on EOPF…' : 'Creating EOPF tile service…'
    case 'ready': return 'Ready · layer added to map'
    case 'error': return 'Could not create layer'
    case 'cancelled': return 'Stopped'
  }
}

/** What the run asks EOPF for, in lines: the person approving it spends credits on it, so an agent's graph is shown in words. */
export function describeRun(analysis: Partial<Pick<OpenEOAnalysisObject, 'graph' | 'preStart' | 'preEnd' | 'postStart' | 'postEnd'>>): string[] {
  if (!analysis.graph) return [`Sentinel-1 VV · ${analysis.preStart}–${analysis.preEnd} vs ${analysis.postStart}–${analysis.postEnd}`]
  try {
    return describeGraph(JSON.parse(analysis.graph) as ProcessGraph)
  } catch {
    return ['An openEO process graph']
  }
}
