import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUpIcon,
  CursorIcon,
  MapTrifoldIcon,
  RectangleIcon,
  TextTIcon,
  TrashIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { Board, ObjectType } from '../board/board'
import type { ConnectionStatus } from '../board/connect'

export type Tool = 'select' | ObjectType

const TOOLS: { tool: Tool; label: string; key: string; Icon: Icon }[] = [
  { tool: 'select', label: 'Select', key: 'V', Icon: CursorIcon },
  { tool: 'box', label: 'Box', key: 'R', Icon: RectangleIcon },
  { tool: 'text', label: 'Text', key: 'T', Icon: TextTIcon },
  { tool: 'map', label: 'Map', key: 'M', Icon: MapTrifoldIcon },
]

/** Toolbar icon size (px). */
export const ICON = 18

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
        <button
          key={t.tool}
          className={tool === t.tool ? 'is-on' : ''}
          title={`${t.label} (${t.key})`}
          aria-label={t.label}
          aria-pressed={tool === t.tool}
          onClick={() => onTool(t.tool)}
        >
          <t.Icon size={ICON} />
        </button>
      ))}
      <span className="ttx-toolbar__sep" />
      <button title={`Undo (${MOD}Z)`} aria-label="Undo" onClick={() => board.undo.undo()}>
        <ArrowCounterClockwiseIcon size={ICON} />
      </button>
      <button title={`Redo (⇧${MOD}Z)`} aria-label="Redo" onClick={() => board.undo.redo()}>
        <ArrowClockwiseIcon size={ICON} />
      </button>
      <span className="ttx-toolbar__sep" />
      <button disabled={none} title="Bring to front (])" aria-label="Bring to front" onClick={act(() => board.bringToFront(selection))}>
        <ArrowLineUpIcon size={ICON} />
      </button>
      <button disabled={none} title={`Bring forward (${MOD}])`} aria-label="Bring forward" onClick={act(() => board.step(selection, 1))}>
        <ArrowUpIcon size={ICON} />
      </button>
      <button disabled={none} title={`Send backward (${MOD}[)`} aria-label="Send backward" onClick={act(() => board.step(selection, -1))}>
        <ArrowDownIcon size={ICON} />
      </button>
      <button disabled={none} title="Send to back ([)" aria-label="Send to back" onClick={act(() => board.sendToBack(selection))}>
        <ArrowLineDownIcon size={ICON} />
      </button>
      <button disabled={none} title="Delete (⌫)" aria-label="Delete" onClick={act(() => board.remove(selection))}>
        <TrashIcon size={ICON} />
      </button>
      <span className="ttx-toolbar__sep" />
      <button title="Reset zoom to 100%" onClick={onResetZoom}>{Math.round(zoom * 100)}%</button>
      <span className={`ttx-status ttx-status--${status}`} title={status} />
    </div>
  )
}
