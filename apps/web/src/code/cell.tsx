import { lazy, Suspense, useState } from 'react'
import type { Runtime } from '@ttx/core'
import { hashSource, type CodeBoardObject } from '@ttx/plugins'
import { askAgent } from '../agent/ask'
import { useHub } from './hub'

/**
 * The parts of a code cell that its card (CodeObject.tsx) and the footnote of what shows it (Footnote.tsx) share:
 * running it, its code (an editor while edited), and how its last run went.
 */

const Editor = lazy(() => import('./Editor'))

/** Run a cell as this person. Its own errors go on the cell; `problem` is why it could not run at all. */
export function useRunCell(runtime: Runtime, id: string) {
  const hub = useHub()
  const [running, setRunning] = useState(false)
  const [problem, setProblem] = useState<string>()
  const run = async () => {
    if (running) return
    setRunning(true)
    setProblem(undefined)
    runtime.beginGesture()
    const r = await runtime.invoke('code.run', { kind: 'objects', ids: [id] }, {})
    setRunning(false)
    if (r.status === 'failed') setProblem(r.error)
  }
  const canRun = hub.status === 'ready'
  const why = hub.status === 'checking' ? 'Checking your JupyterHub login…' : hub.status === 'error' ? hub.error : 'Connect your JupyterHub in the user menu to run code'
  return { run, running, problem, canRun, why: canRun ? undefined : why }
}

/** The code: plain while read, CodeMirror while edited. Typing is one undo step per edit session. */
export function CodeSource({ runtime, cell, editing, onRun, onDone }: { runtime: Runtime; cell: CodeBoardObject; editing: boolean; onRun(): void; onDone(): void }) {
  if (!editing) return <pre className="ttx-code__source">{cell.source || <span className="ttx-code__placeholder">Double-click to write Python</span>}</pre>
  return (
    <Suspense fallback={<pre className="ttx-code__source">{cell.source}</pre>}>
      <div className="ttx-code__editing" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <Editor
          autoFocus
          value={cell.source}
          onChange={(source) => runtime.dispatch('code.setSource', { kind: 'objects', ids: [cell.id] }, { source })}
          onRun={onRun}
          onEscape={onDone}
        />
      </div>
    </Suspense>
  )
}

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(at).toLocaleDateString()
}

/** "Ran 2 min ago by Ada · 1.2 s", and whether the code changed since. */
export function RunStatus({ cell }: { cell: CodeBoardObject }) {
  const run = cell.run
  if (!run) return <span>Not run yet</span>
  const edited = run.sourceHash !== hashSource(cell.source)
  return (
    <span>
      {run.status === 'error' ? 'Failed' : 'Ran'} {ago(run.at)} by {run.by} · {(run.ms / 1000).toFixed(1)} s{edited && <strong> · edited, not run</strong>}
    </span>
  )
}

/** The latest run's error, with its traceback and print output, and a way to ask the agent to fix it. */
export function RunError({ runtime, cell }: { runtime: Runtime; cell: CodeBoardObject }) {
  const [open, setOpen] = useState(false)
  const error = cell.run?.status === 'error' ? cell.run.error : undefined
  if (!error) return null
  return (
    <div className="ttx-code__error" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ttx-code__error-head">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <strong>{error.ename}</strong>: {error.evalue}
        </button>
        <button type="button" onClick={() => askAgent(runtime.actor, `Fix the error in the code "${cell.title}" and run it again.`, [cell.id])}>
          Ask agent to fix
        </button>
      </div>
      {open && <pre>{[...error.traceback, ...(cell.run?.stdout ? ['', cell.run.stdout] : [])].join('\n')}</pre>}
    </div>
  )
}
