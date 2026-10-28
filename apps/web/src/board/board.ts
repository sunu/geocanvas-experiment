import type { Board as CoreBoard, BoxObject, StickyObject, TextObject } from '@ttx/core'
import type { ConflictBoardObject, CountryBoardObject, EventBoardObject, MapBoardObject, NotebookBoardObject, PresenceBoardObject, ReliefWebBoardObject } from '@ttx/plugins'

/**
 * The objects of this app's plugins (plugins.ts), for typed reads in the UI. The board itself and
 * every write are in @ttx/core: the UI reads `runtime.board` and writes only by dispatching ops.
 *
 * Map views (center, zoom) are not on the board on purpose: each person pans their own maps.
 */
export type BoardObject = BoxObject | TextObject | StickyObject | MapBoardObject | EventBoardObject | NotebookBoardObject | ReliefWebBoardObject | CountryBoardObject | PresenceBoardObject | ConflictBoardObject

export type ObjectType = BoardObject['type']

export type Board = CoreBoard<BoardObject>
