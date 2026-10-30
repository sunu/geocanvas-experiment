import { PlayIcon, TerminalWindowIcon } from '@phosphor-icons/react'
import type { CodeBoardObject } from '@ttx/plugins'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { useReportLoading } from '../canvas/loading'
import type { ObjectViewProps } from '../canvas/registry'
import { CodeSource, RunError, RunStatus, useRunCell } from './cell'
import { Output } from './Output'

/**
 * A code cell (plans/plan-020.md): its Python, its latest output and how its last run went. Double-click edits
 * the code; Run (or ⌘/Shift+Enter while editing) runs it on this person's JupyterHub. Anyone can read and edit
 * it; only a person with a hub login can run it. The output stays on the board for everyone.
 */
export function CodeObject({ runtime, object: cell, editing, onDone }: ObjectViewProps<CodeBoardObject>) {
  const { run, running, problem, canRun, why } = useRunCell(runtime, cell.id)
  useReportLoading(running)
  return (
    <div className="ttx-code">
      <ObjectHeader icon={<TerminalWindowIcon size={14} aria-hidden />} title={cell.title}>
        <button type="button" className="ttx-code__run" disabled={!canRun || running} title={why ?? 'Run (⌘Enter)'} aria-label="Run" onPointerDown={(e) => e.stopPropagation()} onClick={() => void run()}>
          <PlayIcon size={14} />
        </button>
      </ObjectHeader>
      <CodeSource runtime={runtime} cell={cell} editing={editing} onRun={() => canRun && void run()} onDone={onDone} />
      <div className="ttx-code__status">
        {running ? <span>Running…</span> : <RunStatus cell={cell} />}
        {!canRun && <span className="ttx-code__hint">{why}</span>}
      </div>
      {problem && <div className="ttx-code__problem">{problem}</div>}
      <RunError runtime={runtime} cell={cell} />
      {cell.output && (
        <div className="ttx-code__output">
          <Output output={cell.output} />
        </div>
      )}
    </div>
  )
}
