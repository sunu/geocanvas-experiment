import type { Board, ObjectType } from '../board/board'
import type { ConnectionStatus } from '../board/connect'

export type Tool = 'select' | ObjectType

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'box', label: 'Box', key: 'R' },
  { tool: 'text', label: 'Text', key: 'T' },
  { tool: 'map', label: 'Map', key: 'M' },
]

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

interface Props {
  board: Board
  tool: Tool
  onTool(tool: Tool): void
  selection: Set<string>
  zoom: number
  onResetZoom(): void
  status: ConnectionStatus
}

export function Toolbar({ board, tool, onTool, selection, zoom, onResetZoom, status }: Props) {
  const none = selection.size === 0
  // Each button press is its own undo step.
  const act = (f: () => void) => () => {
    board.undo.stopCapturing()
    f()
  }
  return (
    <div className="ttx-toolbar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <button key={t.tool} className={tool === t.tool ? 'is-on' : ''} title={`${t.label} (${t.key})`} onClick={() => onTool(t.tool)}>
          {t.label}
        </button>
      ))}
      <span className="ttx-toolbar__sep" />
      <button title={`Undo (${MOD}Z)`} onClick={() => board.undo.undo()}>↶</button>
      <button title={`Redo (⇧${MOD}Z)`} onClick={() => board.undo.redo()}>↷</button>
      <span className="ttx-toolbar__sep" />
      <button disabled={none} title="Bring to front (])" onClick={act(() => board.bringToFront(selection))}>⤒</button>
      <button disabled={none} title={`Bring forward (${MOD}])`} onClick={act(() => board.step(selection, 1))}>↑</button>
      <button disabled={none} title={`Send backward (${MOD}[)`} onClick={act(() => board.step(selection, -1))}>↓</button>
      <button disabled={none} title="Send to back ([)" onClick={act(() => board.sendToBack(selection))}>⤓</button>
      <button disabled={none} title="Delete (⌫)" onClick={act(() => board.remove(selection))}>✕</button>
      <span className="ttx-toolbar__sep" />
      <button title="Reset zoom to 100%" onClick={onResetZoom}>{Math.round(zoom * 100)}%</button>
      <span className={`ttx-status ttx-status--${status}`} title={status} />
    </div>
  )
}
