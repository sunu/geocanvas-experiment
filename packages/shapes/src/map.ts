import { createShapePropsMigrationSequence, type RecordProps, type TLShape } from '@tldraw/tlschema'
import { T } from '@tldraw/validate'

export const MAP_SHAPE = 'map'

export const BASEMAPS = ['light', 'dark', 'streets', 'satellite'] as const
export type Basemap = (typeof BASEMAPS)[number]

export interface MapShapeProps {
  w: number
  h: number
  basemap: Basemap
}

declare module '@tldraw/tlschema' {
  interface TLGlobalShapePropsMap {
    [MAP_SHAPE]: MapShapeProps
  }
}

export type MapShape = TLShape<typeof MAP_SHAPE>

/**
 * Shared board state of a map. The camera (center, zoom) is not here on purpose:
 * each person pans their own map, and nobody's map moves under them.
 */
export const mapShapeProps: RecordProps<MapShape> = {
  w: T.nonZeroNumber,
  h: T.nonZeroNumber,
  basemap: T.literalEnum(...BASEMAPS),
}

export const mapShapeMigrations = createShapePropsMigrationSequence({ sequence: [] })
