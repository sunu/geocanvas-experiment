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
}

const uis = new Map<string, ObjectUI>()

export function registerObjectUI<T extends BoardObject['type']>(type: T, ui: ObjectUI<Extract<BoardObject, { type: T }>>) {
  uis.set(type, ui as unknown as ObjectUI)
}

export const objectUI = (type: string): ObjectUI | undefined => uis.get(type)

/** Types with a tool, in the order they registered. */
export const toolTypes = () => [...uis].filter(([, ui]) => ui.tool).map(([type, ui]) => ({ type, ...ui.tool! }))
