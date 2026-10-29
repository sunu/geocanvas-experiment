import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOutIcon, FileTextIcon, MapTrifoldIcon, NotebookIcon } from '@phosphor-icons/react'
import { notebookResultLayer, type NotebookBoardObject } from '@ttx/plugins'
import { FocusButton } from '../canvas/OptionsPanel'
import type { ObjectViewProps } from '../canvas/registry'
import { boundsOf } from '../map/layers'
import { fitMapTo } from '../map/MapObject'
import { tools } from '../tools/registry'
import { isGeoJson, notebookFactory, notebookResultTitle, type NotebookRun, type NotebookTemplate } from './api'
import { ObjectHeader } from '../canvas/ObjectHeader'

/** Gap between a notebook and a map made from its results (world units). */
const GAP = 24

/** Wait after typing before searching. */
const SEARCH_DELAY_MS = 250

/**
 * A published run of a Notebook Factory notebook: its summary and files (card), or the rendered notebook
 * (in an iframe from Notebook Factory). The board stores the run id and which view is shown, so everyone
 * sees the same; each browser fetches the run.
 *
 * Double-click: in the card, choose a run; in the notebook view, scroll and use the notebook (Esc gives
 * the pointer back to the canvas). The header's buttons work without double-clicking.
 *
 * Focus (F or the header's button) fills the screen with the view, which then has the pointer; the run,
 * the view and the files are in its Options panel (NotebookOptions.tsx).
 */
export function NotebookObject({ runtime, object: o, editing, onDone, focused, onFocus }: ObjectViewProps<NotebookBoardObject>) {
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

  // Every write is an op, as its own undo step.
  const pick = (runId: string) => {
    runtime.beginGesture()
    runtime.dispatch('notebook.setRun', { kind: 'objects', ids: [o.id] }, { runId })
    onDone()
  }
  const setView = (next: 'card' | 'notebook') => {
    runtime.beginGesture()
    runtime.dispatch('notebook.setView', { kind: 'objects', ids: [o.id] }, { view: next })
  }
  /**
   * A new map to the right of the notebook, with the file as its layer, for everyone; this person's view fits
   * the data. The data is read first, so the view can be written before the map appears and the map starts
   * there (a view written after it appears loses to the map saving its first view).
   */
  const showOnNewMap = async (r: NotebookRun, fileName: string) => {
    const layer = notebookResultLayer(r.id, fileName, notebookResultTitle(fileName, r.title))
    // A failure here shows in the new map's layer list, from the same cached run.
    const fc = await tools.run<GeoJSON.FeatureCollection>(layer.tool, layer.input).catch(() => undefined)
    runtime.beginGesture()
    const mapId = runtime.dispatch('map.add', { kind: 'canvas' }, { x: o.x + o.w + GAP, y: o.y, layers: [layer] }).created?.[0]
    const bbox = fc && boundsOf(fc)
    if (mapId && bbox) fitMapTo(runtime, mapId, bbox)
  }

  return (
    <div className="ttx-notebook">
      <ObjectHeader icon={<NotebookIcon size={14} aria-hidden />} title={run.value?.title ?? 'Notebook'}>
        {run.value && (
          <>
            {/* In focus the Options panel switches the view. */}
            {!focused && <ViewSwitch view={view} onChange={setView} />}
            <a href={run.value.detail_url} target="_blank" rel="noopener noreferrer" title="Open in Notebook Factory" aria-label="Open in Notebook Factory">
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
        {!focused && onFocus && <FocusButton onFocus={onFocus} />}
      </ObjectHeader>
      <div ref={bodyRef} className="ttx-notebook__body">
        {/* A focused notebook is always editing; its run is picked in the Options panel. */}
        {editing && !focused && (view === 'card' || !o.runId) ? (
          <RunPicker selected={o.runId} onPick={pick} />
        ) : !o.runId ? (
          <div className="ttx-notebook__empty">{focused ? 'Choose a notebook run in the options' : 'Double-click to choose a notebook run'}</div>
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
              // The page keeps Notebook Factory's origin (allow-same-origin): its scripts are ES modules, which load
              // with CORS, and from a sandbox's opaque "null" origin every one of them was blocked. It is still
              // isolated from the board, a different origin; the sandbox also keeps it from navigating the board's tab.
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
              style={{ pointerEvents: editing ? 'auto' : 'none' }}
            />
            {!editing && <div className="ttx-notebook__hint">Double-click to scroll and use the notebook</div>}
          </>
        ) : (
          // Not in focus: the new map would go into the draft, hidden behind the focused notebook until shared.
          <RunCard run={run.value} onShowOnNewMap={focused ? undefined : (name) => showOnNewMap(run.value!, name)} />
        )}
      </div>
    </div>
  )
}

/** Summary or Notebook: which view everyone sees. */
export function ViewSwitch({ view, onChange }: { view: 'card' | 'notebook'; onChange(view: 'card' | 'notebook'): void }) {
  return (
    <div className="ttx-notebook__views" role="group" aria-label="Show">
      <button type="button" className={view === 'card' ? 'is-on' : ''} aria-pressed={view === 'card'} onClick={() => onChange('card')}>
        Summary
      </button>
      <button type="button" className={view === 'notebook' ? 'is-on' : ''} aria-pressed={view === 'notebook'} onClick={() => onChange('notebook')}>
        Notebook
      </button>
    </div>
  )
}

/** The run's details for one id. Changing the id drops the old details at once, so they never show under the new id. */
export function useRun(runId: string | undefined): { value?: NotebookRun; error?: unknown } {
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

function RunCard({ run, onShowOnNewMap }: { run: NotebookRun; onShowOnNewMap?(fileName: string): void }) {
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
            <div key={name} className="ttx-notebook__file" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <FileTextIcon size={14} aria-hidden />
                {name}
              </a>
              {onShowOnNewMap && isGeoJson(name) && (
                <button type="button" title="Show on a new map next to this notebook" onClick={() => onShowOnNewMap(name)}>
                  <MapTrifoldIcon size={12} aria-hidden />
                  Show on a new map
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Published runs, newest first. Search by text (e.g. a country) and narrow to one notebook template. */
export function RunPicker({ selected, onPick }: { selected?: string; onPick(id: string): void }) {
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
