import type { Board as CoreBoard, BoxObject, TextObject } from '@ttx/core'
import type { EventBoardObject } from '../events/plugin'
import type { MapBoardObject } from '../map/plugin'

/**
 * The objects of this app's plugins (plugins.ts), for typed reads in the UI. The board itself and
 * every write are in @ttx/core: the UI reads `runtime.board` and writes only by dispatching ops.
 *
 * Map views (center, zoom) are not on the board on purpose: each person pans their own maps.
 */
export type BoardObject = BoxObject | TextObject | MapBoardObject | EventBoardObject

export type ObjectType = BoardObject['type']

export type Board = CoreBoard<BoardObject>
