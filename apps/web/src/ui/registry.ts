import type { ComponentType } from 'react'
import type { ComputeState, NodeRecord } from '@geo-canvas/core'

export interface NodeViewProps {
  node: NodeRecord
  derived: ComputeState | undefined
  /** True when the user double-clicked the node to work inside it. */
  editing: boolean
  width: number
  height: number
}

export interface NodeUI {
  View: ComponentType<NodeViewProps>
  /** Optional buttons in the node header. */
  Actions?: ComponentType<{ node: NodeRecord }>
  /** Hide the standard header (e.g. sticky notes). */
  bare?: boolean
  icon?: string
  /** Go to edit mode right after the user adds one (sticky, text). */
  editOnCreate?: boolean
  /** Double-click enters focus mode (e.g. maps), not only edit mode. */
  focusOnDoubleClick?: boolean
}

export interface WidgetProps {
  value: unknown
  onChange(v: unknown): void
  schema: Record<string, unknown>
}

/** UI parts that plugins add. The headless plugin defs have no React code. */
export const nodeUIs = new Map<string, NodeUI>()
export const widgets = new Map<string, ComponentType<WidgetProps>>()

export function registerNodeUI(type: string, ui: NodeUI) {
  nodeUIs.set(type, ui)
}

export function registerWidget(name: string, w: ComponentType<WidgetProps>) {
  widgets.set(name, w)
}
