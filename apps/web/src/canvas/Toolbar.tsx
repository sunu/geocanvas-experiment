import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUpIcon,
  CursorIcon,
  TrashIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { ConnectionStatus } from '../board/connect'
import { toolTypes } from './registry'

/** 'select', or the object type to draw. */
export type Tool = string

/** Select, then a tool for each object type whose UI has one (canvas/registry.ts). */
export const tools = (): { tool: Tool; label: string; key: string; Icon: Icon }[] => [
  { tool: 'select', label: 'Select', key: 'V', Icon: CursorIcon },
  ...toolTypes().map((t) => ({ tool: t.type, label: t.label, key: t.key, Icon: t.Icon })),
]

/** Toolbar icon size (px). */
export const ICON = 18

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

interface Props {
  runtime: Runtime
  tool: Tool
  onTool(tool: Tool): void
  selection: Set<string>
  zoom: number
  onResetZoom(): void
  status: ConnectionStatus
}

export function Toolbar({ runtime, tool, onTool, selection, zoom, onResetZoom, status }: Props) {
  const none = selection.size === 0
  // Each button press is its own undo step.
  const act = (opId: string) => () => {
    runtime.beginGesture()
    runtime.dispatch(opId, { kind: 'objects', ids: [...selection] }, {})
  }
  return (
    <div className="ttx-toolbar" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {tools().map((t) => (
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
      <button title={`Undo (${MOD}Z)`} aria-label="Undo" onClick={() => runtime.undo()}>
        <ArrowCounterClockwiseIcon size={ICON} />
      </button>
      <button title={`Redo (⇧${MOD}Z)`} aria-label="Redo" onClick={() => runtime.redo()}>
        <ArrowClockwiseIcon size={ICON} />
      </button>
      <span className="ttx-toolbar__sep" />
      <button disabled={none} title="Bring to front (])" aria-label="Bring to front" onClick={act('core.object.bringToFront')}>
        <ArrowLineUpIcon size={ICON} />
      </button>
      <button disabled={none} title={`Bring forward (${MOD}])`} aria-label="Bring forward" onClick={act('core.object.bringForward')}>
        <ArrowUpIcon size={ICON} />
      </button>
      <button disabled={none} title={`Send backward (${MOD}[)`} aria-label="Send backward" onClick={act('core.object.sendBackward')}>
        <ArrowDownIcon size={ICON} />
      </button>
      <button disabled={none} title="Send to back ([)" aria-label="Send to back" onClick={act('core.object.sendToBack')}>
        <ArrowLineDownIcon size={ICON} />
      </button>
      <button disabled={none} title="Delete (⌫)" aria-label="Delete" onClick={act('core.object.delete')}>
        <TrashIcon size={ICON} />
      </button>
      <span className="ttx-toolbar__sep" />
      <button title="Reset zoom to 100%" onClick={onResetZoom}>{Math.round(zoom * 100)}%</button>
      <span className={`ttx-status ttx-status--${status}`} title={status} />
    </div>
  )
}
