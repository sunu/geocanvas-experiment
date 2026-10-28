import type { ComponentType } from 'react'
import type { Icon } from '@phosphor-icons/react'
import type { Board, BoardObject, NewObject, ObjectType } from '../board/board'
import type { Rect } from '../canvas/camera'
import type { ColorName } from '../canvas/style'

export interface ObjectViewProps<T extends ObjectType = ObjectType> {
  board: Board
  object: Extract<BoardObject, { type: T }>
  editing: boolean
  /** End editing, e.g. once an event is picked. */
  onDone(): void
}

/**
 * Everything the canvas, toolbar and side panel need to know about one kind of object.
 * To add a type: write its fields into ObjectFields and one of these in a file in objects/,
 * then list it in objects/registry.ts.
 */
export interface ObjectTypeDef<T extends ObjectType = ObjectType> {
  type: T
  /** Toolbar tooltip and screen-reader label. */
  label: string
  /** Tool shortcut: one lowercase letter (v is the select tool). */
  key: string
  Icon: Icon
  /** Size when placed with a click instead of drawn. */
  size: { w: number; h: number }
  /** New objects go on top (content) or to the bottom (backgrounds and frames, so they never cover content). */
  layer: 'top' | 'bottom'
  /** A new object of this type in rectangle r, with its fields' starting values. */
  create(r: Rect): Extract<NewObject, { type: T }>
  /** Draws the object inside its box on the canvas. */
  View: ComponentType<ObjectViewProps<T>>
  /** Double-click edits it (type in a text, use a map, pick an event). */
  editable?: boolean
  /** A new one opens for editing at once. */
  editOnCreate?: boolean
  /** Resizing changes only its width: its height follows its content. */
  widthOnly?: boolean
  /** Its color can be set in the side panel; objects with none stored use this one. */
  defaultColor?: ColorName
  /** Its text size can be set in the side panel. */
  textSize?: boolean
  /** Removed when editing ends with nothing in it. */
  isEmpty?(o: Extract<BoardObject, { type: T }>): boolean
}
