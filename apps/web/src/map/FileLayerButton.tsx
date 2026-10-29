import { useRef, useState } from 'react'
import { UploadSimpleIcon } from '@phosphor-icons/react'
import type { UrlFormat } from '@ttx/plugins'
import { roomFromHash } from '../board/room'
import { fileLink, maxMb, refusal, uploadFile, uploadType } from '../uploads/upload'
import type { UrlLayerArgs } from './UrlLayerForm'

/** The layer format of each kind of map data the board keeps (UPLOAD_TYPES in @ttx/core uploads.ts). */
const FORMATS: Record<string, UrlFormat> = {
  'application/geo+json': 'geojson',
  'application/vnd.apache.parquet': 'geoparquet',
  'application/zip': 'shapefile',
}

/**
 * Upload a GeoJSON, GeoParquet or zipped shapefile from this computer and add it as a layer from its link
 * (map.addUrlLayer): the file is served from the board's own origin, so every browser can read it with no CORS.
 */
export function FileLayerButton({ person, onAdd }: { person: string; onAdd(args: UrlLayerArgs): void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number>()
  const [error, setError] = useState<string>()

  const upload = async (file: File) => {
    setError(undefined)
    const room = roomFromHash(location.hash)
    const refused = room ? refusal(file, ['data']) : 'This board has no room to upload to'
    if (refused) return setError(refused)
    setProgress(0)
    try {
      const id = await uploadFile(file, room!, person, setProgress)
      onAdd({ url: fileLink(id), format: FORMATS[uploadType(file)]!, title: file.name })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProgress(undefined)
    }
  }

  return (
    <div className="ttx-location">
      <button type="button" disabled={progress !== undefined} onClick={() => inputRef.current?.click()}>
        <UploadSimpleIcon size={14} aria-hidden />
        {progress === undefined ? 'Upload file' : `Uploading… ${Math.round(progress * 100)}%`}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".geojson,.json,.parquet,.geoparquet,.zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />
      {error ? <p className="ttx-options__empty">{error}</p> : <p className="ttx-options__empty">GeoJSON, GeoParquet or a zipped shapefile, at most {maxMb('data')} MB.</p>}
    </div>
  )
}
