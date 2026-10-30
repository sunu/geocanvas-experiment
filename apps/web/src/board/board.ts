import type { Board as CoreBoard, BoxObject, FrameObject, StickyObject, TextObject } from '@ttx/core'
import type { ConflictBoardObject, CountryBoardObject, EventBoardObject, GithubBoardObject, IfrcGoBoardObject, ImageBoardObject, InputBoardObject, MapBoardObject, NotebookBoardObject, OpenEOAnalysisObject, PdfBoardObject, PresenceBoardObject, ReliefWebBoardObject, ReportBoardObject } from '@ttx/plugins'

/**
 * The objects of this app's plugins (plugins.ts), for typed reads in the UI. The board itself and
 * every write are in @ttx/core: the UI reads `runtime.board` and writes only by dispatching ops.
 *
 * Map views (center, zoom) are not on the board on purpose: each person pans their own maps.
 */
export type BoardObject = BoxObject | TextObject | StickyObject | FrameObject | MapBoardObject | EventBoardObject | NotebookBoardObject | ReliefWebBoardObject | GithubBoardObject | IfrcGoBoardObject | CountryBoardObject | PresenceBoardObject | ConflictBoardObject | ImageBoardObject | InputBoardObject | PdfBoardObject | OpenEOAnalysisObject | ReportBoardObject

export type ObjectType = BoardObject['type']

export type Board = CoreBoard<BoardObject>
