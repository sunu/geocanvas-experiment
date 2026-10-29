import type { Runtime } from '@ttx/core'
import type { MapBoardObject } from '@ttx/plugins'
import { roomFromHash } from '../board/room'
import { fitMapToLayer } from '../map/MapObject'
import { kindOf, uploadFile } from '../uploads/upload'

/** The red of closures (useRoutes.ts). */
const AFFECTED_RED = '#dc2626'

/**
 * Import affected areas into a map's scenario: upload a GeoJSON file to the board (the room keeps it, as it keeps
 * images and PDFs), then add it to the map as a layer whose features close the roads they cover, drawn in red, and fit
 * this person's view to it. In focus the layer goes on the draft, like every change there.
 */
export async function importAffectedAreas(runtime: Runtime, mapId: string, file: File, onProgress?: (sent: number) => void) {
  if (kindOf(file) !== 'data') throw new Error(`${file.name} is not a GeoJSON file`)
  const room = roomFromHash(location.hash)
  if (!room) throw new Error('This board has no room to upload to')
  const fileId = await uploadFile(file, room, runtime.actor.id, onProgress)
  const before = new Set((runtime.board.get(mapId) as MapBoardObject | undefined)?.layers?.map((l) => l.id))
  runtime.beginGesture()
  const res = runtime.dispatch('map.addUploadLayer', { kind: 'objects', ids: [mapId] }, { fileId, name: file.name, blocks: true })
  if (res.status === 'failed') throw new Error(res.error)
  const added = (runtime.board.get(mapId) as MapBoardObject | undefined)?.layers?.find((l) => !before.has(l.id))
  if (!added) return
  // In the closures' red, apart from the data layers' blue; in the same undo step.
  runtime.dispatch('map.setLayerStyle', { kind: 'objects', ids: [mapId] }, { layerId: added.id, style: { color: AFFECTED_RED } })
  fitMapToLayer(runtime, mapId, added)
}
