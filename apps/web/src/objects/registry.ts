import type { ObjectType } from '../board/board'
import { box } from './box'
import { event } from './event'
import { map } from './map'
import { notebook } from './notebook'
import { sticky } from './sticky'
import { text } from './text'
import type { ObjectTypeDef } from './types'

/**
 * Every object type, in toolbar order. Keyed by every type in ObjectFields, so a type with
 * fields but no definition here does not compile.
 */
const OBJECT_TYPES: { [T in ObjectType]: ObjectTypeDef<T> } = { box, text, sticky, map, event, notebook }

/** All object types, in toolbar order. */
export const objectTypes = Object.values(OBJECT_TYPES) as ObjectTypeDef[]

/**
 * The definition of a type, or undefined for a type this build does not know: a board can hold
 * objects made by a newer version of the app, e.g. from a tab opened before a deploy.
 */
export function objectType(type: string): ObjectTypeDef | undefined {
  // Each entry fits its own type; the cast widens it so callers can pass any object of the union.
  return (OBJECT_TYPES as Record<string, unknown>)[type] as ObjectTypeDef | undefined
}
