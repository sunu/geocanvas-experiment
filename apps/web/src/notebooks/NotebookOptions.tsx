import { useState } from 'react'
import type { NotebookBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { RunPicker, useRun, ViewSwitch } from './NotebookObject'

/**
 * A notebook's Options panel in focus: which view it shows, its run and the run's files. The view and the
 * run are set on this person's draft, so others see them when they are shared.
 */
export function NotebookOptions({ runtime, object: o }: ObjectViewProps<NotebookBoardObject>) {
  const run = useRun(o.runId).value
  // A notebook without a run opens with the list of runs.
  const [choosing, setChoosing] = useState(!o.runId)
  const target = { kind: 'objects' as const, ids: [o.id] }
  const pick = (runId: string) => {
    runtime.beginGesture()
    runtime.dispatch('notebook.setRun', target, { runId })
    setChoosing(false)
  }
  const setView = (view: 'card' | 'notebook') => {
    runtime.beginGesture()
    runtime.dispatch('notebook.setView', target, { view })
  }
  const files = Object.entries(run?.artifacts ?? {})

  return (
    <>
      {o.runId && (
        <section className="ttx-options__section">
          <h3>Show</h3>
          <ViewSwitch view={o.view ?? 'card'} onChange={setView} />
        </section>
      )}
      <section className="ttx-options__section">
        <h3>Run</h3>
        {choosing ? (
          <div className="ttx-nbopts__picker">
            <RunPicker selected={o.runId} onPick={pick} />
          </div>
        ) : (
          <div className="ttx-options__list">
            {run && (
              <a href={run.detail_url} target="_blank" rel="noopener noreferrer">
                {run.title} <span className="ttx-options__sub">· open in Notebook Factory</span>
              </a>
            )}
            <button type="button" onClick={() => setChoosing(true)}>
              Choose another run
            </button>
          </div>
        )}
      </section>
      {files.length > 0 && (
        <section className="ttx-options__section">
          <h3>Files</h3>
          {/* Links, not fetches: a download needs no CORS. */}
          <div className="ttx-options__list">
            {files.map(([name, url]) => (
              <a key={name} href={url} target="_blank" rel="noopener noreferrer">
                {name}
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
