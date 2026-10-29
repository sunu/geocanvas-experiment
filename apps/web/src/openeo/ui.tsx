import { useState } from 'react'
import type { OpenEOAnalysisObject } from '@ttx/plugins'
import { registerObjectUI, type ObjectViewProps } from '../canvas/registry'
import { roomFromHash } from '../board/room'
import { analysisProgress, describeRun, headline, stopLabel } from './progress'

function AnalysisView({ runtime, object }: ObjectViewProps<OpenEOAnalysisObject>) {
  const state = object.status
  const progress = analysisProgress(object)
  // runtime.invoke does not throw when an op fails (e.g. another analysis is still active): it answers with the reason.
  const [failure, setFailure] = useState<string>()
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<{ text: string; ok: boolean }>()
  const run = async (opId: string) => {
    setFailure(undefined)
    const result = await runtime.invoke(opId, { kind: 'objects', ids: [object.id] }, {})
    if (result.status === 'failed') setFailure(result.error)
  }
  const preview = async () => {
    setFailure(undefined)
    setPreviewResult(undefined)
    const room = roomFromHash(location.hash)
    if (!room) {
      setPreviewResult({ text: 'Could not identify this board. Reload and try again.', ok: false })
      return
    }
    setPreviewing(true)
    try {
      const response = await fetch(`/openeo/preview?room=${encodeURIComponent(room)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisId: object.id }),
      })
      const body = (await response.json().catch(() => ({}))) as { result?: string; error?: string }
      const text = response.ok ? body.result ?? 'Preview returned no result.' : body.error ?? `Preview failed (${response.status}).`
      setPreviewResult({ text, ok: response.ok && text.startsWith('Rendered OK:') })
    } catch (error) {
      setPreviewResult({ text: `Preview failed: ${String((error as Error)?.message ?? error)}`, ok: false })
    } finally {
      setPreviewing(false)
    }
  }
  const canApprove = state === 'proposed' || (state === 'error' && !object.serviceId)
  return (
    <div className="ttx-openeo">
      <b>{object.title}</b>
      {describeRun(object).map((line) => (
        <span key={line}>{line}</span>
      ))}
      {object.graph && (
        <details className="ttx-openeo__graph" onPointerDown={(event) => event.stopPropagation()}>
          <summary>Process graph</summary>
          <pre>{prettyGraph(object.graph)}</pre>
        </details>
      )}
      <span className={`ttx-openeo__status is-${state}`}>{headline(object)}</span>
      {state !== 'proposed' && state !== 'cancelled' && (
        <ol className="ttx-openeo__steps">
          {progress.steps.map((step) => (
            <li key={step.label} className={`is-${step.state}`}>
              {step.label}
            </li>
          ))}
        </ol>
      )}
      {progress.hint && <span className="ttx-openeo__hint">{progress.hint}</span>}
      {object.error && <span className="ttx-openeo__error">{object.error}</span>}
      {failure && <span className="ttx-openeo__error">{failure}</span>}
      {previewResult && (
        <span className={`ttx-openeo__preview-result${previewResult.ok ? ' is-success' : ''}`} role="status" aria-live="polite">
          {previewResult.text}
        </span>
      )}
      <small>{object.graph ? 'Proposed by an agent: check what it loads and does before you run it.' : 'Surface-change candidates only; not a validated flood extent.'}</small>
      {canApprove && (
        <>
          <button
            className="ttx-button"
            title="This renders a small test image and may consume openEO compute credits"
            disabled={previewing}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void preview()}
          >
            {previewing ? 'Previewing…' : 'Preview run'}
          </button>
          <small>The preview may take up to 100 seconds and use openEO compute.</small>
          <button
            className="ttx-button ttx-button--primary"
            title="This may consume openEO credits"
            disabled={previewing}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void run('openeo.approveSarChange')}
          >
            Approve &amp; run
          </button>
        </>
      )}
      {['requested', 'running', 'ready'].includes(state) || (state === 'error' && !!object.serviceId) ? (
        <button className="ttx-button" onPointerDown={(event) => event.stopPropagation()} onClick={() => void run('openeo.cancelSarChange')}>{stopLabel(object)}</button>
      ) : null}
    </div>
  )
}

function prettyGraph(graph: string): string {
  try {
    return JSON.stringify(JSON.parse(graph), null, 2)
  } catch {
    return graph
  }
}

registerObjectUI('openeo', { View: AnalysisView })
