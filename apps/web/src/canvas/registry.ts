import type { ComponentType, CSSProperties } from 'react'
import type { Icon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'

export interface ObjectViewProps<O extends BoardObject = BoardObject> {
  runtime: Runtime
  object: O
  editing: boolean
  /** The object is done editing, e.g. an event was picked. */
  onDone(): void
  /** It fills the screen in focus mode; `runtime` is then this person's draft of the board. */
  focused: boolean
  /** Open it in focus mode: for a focus button in its header. Only for focusable types, and not while focused. */
  onFocus?(): void
}

/** The parts of the object panel that depend on the type. Its type's name is the badge, and its history gives Updated and Prompt. */
export interface PanelInfo {
  title: string
  description?: string
  /** Label and value rows under Metadata. */
  metadata: [label: string, value: string][]
}

/** How the canvas shows one object type. Plugins' object types are headless; their UI registers here. */
export interface ObjectUI<O extends BoardObject = BoardObject> {
  /** Content of the object's frame. */
  View?: ComponentType<ObjectViewProps<O>>
  /** Extra style for the frame, e.g. a box's fill. */
  frameStyle?(object: O): CSSProperties
  /** A toolbar tool that draws this type. */
  tool?: { key: string; label: string; Icon: Icon }
  /** Double-click edits it: types into a text, gives a map the pointer, opens an event's search. */
  editable?: boolean
  /** A new one opens for editing at once. */
  editOnCreate?: boolean
  /** Resizing changes only its width: its height follows its content. */
  widthOnly?: boolean
  /** Removed when editing ends with nothing in it. */
  isEmpty?(object: O): boolean
  /** What the object panel (canvas/ObjectPanel.tsx) says about one of them when it is the only selection. A type without it has no panel. */
  panel?(object: O): PanelInfo
}

/**
 * A type with in-focus mode (agent-docs/tasks/in-focus-widgets.md): its view fills the screen, with
 * its Options panel beside it. Both get this person's draft of the board as `runtime`, so changes made
 * there reach others only when shared.
 */
export interface FocusableObjectUI<O extends BoardObject = BoardObject> extends ObjectUI<O> {
  /** Contextual tools, beside the object in focus. Every change is an op on `runtime` (the draft). */
  Options: ComponentType<ObjectViewProps<O>>
  /** Ops to run on the draft just before it is shared, e.g. a map shares its view. */
  beforeShare?(runtime: Runtime, object: O): void
}

export const isFocusable = (ui: ObjectUI | undefined): ui is FocusableObjectUI => !!ui && 'Options' in ui

const uis = new Map<string, ObjectUI>()

export function registerObjectUI<T extends BoardObject['type']>(type: T, ui: ObjectUI<Extract<BoardObject, { type: T }>> | FocusableObjectUI<Extract<BoardObject, { type: T }>>) {
  uis.set(type, ui as unknown as ObjectUI)
}

export const objectUI = (type: string): ObjectUI | undefined => uis.get(type)

/** Types with a tool, in the order they registered. */
export const toolTypes = () => [...uis].filter(([, ui]) => ui.tool).map(([type, ui]) => ({ type, ...ui.tool! }))

export interface WidgetProps {
  value: unknown
  onChange(value: unknown): void
  /** The field's JSON Schema, from zod. */
  schema: Record<string, unknown>
}

const widgets = new Map<string, ComponentType<WidgetProps>>()

/** A form field for args marked with zod `.meta({ widget: name })`, e.g. a color or an event. */
export function registerWidget(name: string, widget: ComponentType<WidgetProps>) {
  widgets.set(name, widget)
}

export const widget = (name: string) => widgets.get(name)
