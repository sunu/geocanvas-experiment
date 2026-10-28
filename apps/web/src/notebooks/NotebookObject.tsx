import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOutIcon, FileTextIcon, NotebookIcon } from '@phosphor-icons/react'
import type { ObjectViewProps } from '../objects/types'
import { notebookFactory, type NotebookRun, type NotebookTemplate } from './api'

/** Wait after typing before searching. */
const SEARCH_DELAY_MS = 250

/**
 * A published run of a Notebook Factory notebook: its summary and files (card), or the rendered notebook
 * (in an iframe from Notebook Factory). The board stores the run id and which view is shown, so everyone
 * sees the same; each browser fetches the run.
 *
 * Double-click: in the card, choose a run; in the notebook view, scroll and use the notebook (Esc gives
 * the pointer back to the canvas). The header's buttons work without double-clicking.
 */
export function NotebookObject({ board, object: o, editing, onDone }: ObjectViewProps<'notebook'>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const view = o.view ?? 'card'
  const run = useRun(o.runId)

  // While editing, the wheel belongs to the list or the notebook, not the canvas camera. The canvas
  // listens natively, so stop the native event here.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  const pick = (runId: string) => {
    board.undo.stopCapturing()
    board.update({ [o.id]: { runId } })
    onDone()
  }
  const setView = (next: 'card' | 'notebook') => {
    board.undo.stopCapturing()
    board.update({ [o.id]: { view: next } })
  }

  return (
    <div className="ttx-notebook">
      {/* The header takes the pointer without double-clicking: its buttons must not start a drag. */}
      <div className="ttx-notebook__header" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <NotebookIcon size={14} aria-hidden />
        <span className="ttx-notebook__title">{run.value?.title ?? 'Notebook'}</span>
        {run.value && (
          <>
            <div className="ttx-notebook__views" role="group" aria-label="Show">
              <button type="button" className={view === 'card' ? 'is-on' : ''} aria-pressed={view === 'card'} onClick={() => setView('card')}>
                Summary
              </button>
              <button type="button" className={view === 'notebook' ? 'is-on' : ''} aria-pressed={view === 'notebook'} onClick={() => setView('notebook')}>
                Notebook
              </button>
            </div>
            <a href={run.value.detail_url} target="_blank" rel="noopener noreferrer" title="Open in Notebook Factory" aria-label="Open in Notebook Factory">
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </div>
      <div ref={bodyRef} className="ttx-notebook__body">
        {editing && (view === 'card' || !o.runId) ? (
          <RunPicker selected={o.runId} onPick={pick} />
        ) : !o.runId ? (
          <div className="ttx-notebook__empty">Double-click to choose a notebook run</div>
        ) : run.error !== undefined ? (
          <div className="ttx-notebook__empty">Could not load the run: {errorText(run.error)}</div>
        ) : !run.value ? (
          <div className="ttx-notebook__empty">Loading…</div>
        ) : view === 'notebook' ? (
          <>
            <iframe
              className="ttx-notebook__frame"
              src={run.value.output_url}
              title={run.value.title}
              loading="lazy"
              // Its own origin, and no access to the board's: the notebook's scripts (interactive outputs) run isolated.
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads"
              style={{ pointerEvents: editing ? 'auto' : 'none' }}
            />
            {!editing && <div className="ttx-notebook__hint">Double-click to scroll and use the notebook</div>}
          </>
        ) : (
          <RunCard run={run.value} />
        )}
      </div>
    </div>
  )
}

/** The run's details for one id. Changing the id drops the old details at once, so they never show under the new id. */
function useRun(runId: string | undefined): { value?: NotebookRun; error?: unknown } {
  const [state, setState] = useState<{ runId: string; value?: NotebookRun; error?: unknown }>()
  useEffect(() => {
    if (!runId) return
    let current = true
    notebookFactory.getRun(runId).then(
      (value) => current && setState({ runId, value }),
      (error) => current && setState({ runId, error }),
    )
    return () => {
      current = false
    }
  }, [runId])
  return runId && state?.runId === runId ? state : {}
}

function RunCard({ run }: { run: NotebookRun }) {
  const place = run.area ? [run.area.name, run.area.level > 0 ? run.area.country_name : undefined].filter(Boolean).join(', ') : undefined
  const files = Object.entries(run.artifacts ?? {})
  const text = run.summary || run.description
  return (
    <div className="ttx-notebook__card">
      {run.subtitle && <div className="ttx-notebook__subtitle">{run.subtitle}</div>}
      <div className="ttx-notebook__meta">
        {[run.notebook_title, place, run.stac_item?.title, run.finished_at && formatDate(run.finished_at)].filter(Boolean).join(' · ')}
      </div>
      {text && <div className="ttx-notebook__text">{text}</div>}
      {files.length > 0 && (
        <div className="ttx-notebook__files">
          <div className="ttx-notebook__label">Files</div>
          {/* Links, not fetches: a download needs no CORS. */}
          {files.map(([name, url]) => (
            <a key={name} href={url} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>
              <FileTextIcon size={14} aria-hidden />
              {name}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** Published runs, newest first. Search by text (e.g. a country) and narrow to one notebook template. */
function RunPicker({ selected, onPick }: { selected?: string; onPick(id: string): void }) {
  const [search, setSearch] = useState('')
  const [template, setTemplate] = useState('')
  const [templates, setTemplates] = useState<NotebookTemplate[]>([])
  const [state, setState] = useState<{ loading: boolean; runs?: NotebookRun[]; count?: number; error?: unknown }>({ loading: true })

  useEffect(() => {
    let current = true
    notebookFactory.listTemplates().then((t) => current && setTemplates(t), () => {})
    return () => {
      current = false
    }
  }, [])

  // Only the answer to the latest search is used; an earlier, slower one is dropped.
  useEffect(() => {
    const abort = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    const timer = setTimeout(() => {
      notebookFactory.listRuns({ search, notebook: template }, abort.signal).then(
        ({ runs, count }) => setState({ loading: false, runs, count }),
        (error) => !abort.signal.aborted && setState((s) => ({ ...s, loading: false, error })),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [search, template])

  const runs = state.runs ?? []
  const status = state.loading
    ? 'Loading runs…'
    : state.error !== undefined
      ? `Could not load runs: ${errorText(state.error)}`
      : `${state.count ?? 0} published ${state.count === 1 ? 'run' : 'runs'}${(state.count ?? 0) > runs.length ? `, showing the newest ${runs.length}` : ''}`

  return (
    <div className="ttx-notebookpick">
      <div className="ttx-notebookpick__filters">
        <input type="search" autoFocus aria-label="Search runs" placeholder="Search, e.g. Nepal" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Notebook" value={template} onChange={(e) => setTemplate(e.target.value)}>
          <option value="">All notebooks</option>
          {templates.map((t) => (
            <option key={t.slug} value={t.slug}>
              {t.title}
            </option>
          ))}
        </select>
      </div>
      <div className="ttx-notebookpick__status">{status}</div>
      <div className="ttx-notebookpick__list">
        {runs.map((r) => (
          <button type="button" key={r.id} className={`ttx-notebookpick__item ${selected === r.id ? 'is-on' : ''}`} onClick={() => onPick(r.id)}>
            <span className="ttx-notebookpick__name">{r.title}</span>
            <span className="ttx-notebookpick__meta">{[r.subtitle, r.finished_at && formatDate(r.finished_at)].filter(Boolean).join(' · ')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const formatDate = (iso: string) => iso.slice(0, 10)
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
