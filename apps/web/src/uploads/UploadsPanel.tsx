import { useState, useSyncExternalStore } from 'react'
import { ArrowSquareOutIcon, FilePdfIcon, FolderOpenIcon, MapTrifoldIcon, PlusIcon, XIcon, type Icon } from '@phosphor-icons/react'
import { uploadUrl, type Runtime, type Upload, type Uploads, type UploadKind } from '@ttx/core'
import { CopyLinkButton } from './CopyLinkButton'
import { placeUpload } from './drop'
import { fileLink } from './upload'

const TABS: { kind: UploadKind; label: string; empty: string }[] = [
  { kind: 'media', label: 'Media', empty: 'Images uploaded to this board show here, also after they are deleted from it.' },
  { kind: 'document', label: 'Documents', empty: 'PDFs dropped on this board show here, also after they are deleted from it.' },
  { kind: 'data', label: 'Data', empty: 'Map data uploaded to this board shows here: GeoJSON, GeoParquet and zipped shapefiles.' },
]

/**
 * Everything uploaded to this board (@ttx/core uploads.ts), newest first, whether or not it is still on the
 * board: put a deleted image back, or copy a file's link.
 */
export function UploadsPanel({ runtime, uploads, onClose }: { runtime: Runtime; uploads: Uploads; onClose: () => void }) {
  const all = useSyncExternalStore(uploads.subscribe, uploads.list)
  const [tab, setTab] = useState<UploadKind>('media')
  const shown = all.filter((u) => u.kind === tab).reverse()

  /** The upload as a new object in the middle of this person's view, fitted to the picture if it has loaded. */
  const addToBoard = (upload: Upload, picture?: { w: number; h: number }) => void placeUpload(runtime, upload, runtime.view?.center() ?? { x: 0, y: 0 }, picture)

  return (
    <aside className="ttx-chat ttx-uploads" aria-label="Uploads">
      <header className="ttx-chat__head">
        <FolderOpenIcon size={18} />
        <span>Uploads</span>
        <button className="ttx-chat__close" title="Close uploads" aria-label="Close uploads" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </header>
      <div className="ttx-uploads__tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.kind} type="button" role="tab" aria-selected={tab === t.kind} className={tab === t.kind ? 'is-on' : ''} onClick={() => setTab(t.kind)}>
            {t.label} <span className="ttx-uploads__count">{all.filter((u) => u.kind === t.kind).length}</span>
          </button>
        ))}
      </div>
      <div className={`ttx-uploads__list ttx-uploads__list--${tab}`}>
        {!shown.length && <p className="ttx-chat__empty">{TABS.find((t) => t.kind === tab)!.empty}</p>}
        {shown.map((u) => (tab === 'media' ? <MediaItem key={u.id} upload={u} onAdd={(picture) => addToBoard(u, picture)} /> : <FileItem key={u.id} upload={u} onAdd={canPlace(u) ? () => addToBoard(u) : undefined} />))}
      </div>
    </aside>
  )
}

function MediaItem({ upload, onAdd }: { upload: Upload; onAdd(picture?: { w: number; h: number }): void }) {
  const [picture, setPicture] = useState<{ w: number; h: number }>()
  return (
    <figure className="ttx-uploads__media">
      <img
        src={uploadUrl(upload.id)}
        alt={upload.name}
        loading="lazy"
        draggable={false}
        onLoad={(e) => setPicture({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      <figcaption>
        <span className="ttx-uploads__name" title={upload.name}>
          {upload.name}
        </span>
        <span className="ttx-uploads__actions">
          <button type="button" onClick={() => onAdd(picture)} title="Add to the board" aria-label="Add to the board">
            <PlusIcon size={14} />
          </button>
          <Links upload={upload} />
        </span>
      </figcaption>
    </figure>
  )
}

/** Data goes on a new map only as GeoJSON (data.uploadFeatures); GeoParquet and shapefiles are added from a map's Options, by link. */
const canPlace = (u: Upload) => u.kind !== 'data' || u.contentType === 'application/geo+json'

/** A file's icon by kind: a PDF, or data that goes on a map. */
const FILE_ICON: Partial<Record<UploadKind, Icon>> = { document: FilePdfIcon, data: MapTrifoldIcon }

function FileItem({ upload, onAdd }: { upload: Upload; onAdd?(): void }) {
  const FileIcon = FILE_ICON[upload.kind] ?? FilePdfIcon
  const add = upload.kind === 'data' ? 'Add to the board on a new map' : 'Add to the board'
  return (
    <div className="ttx-uploads__doc">
      <FileIcon size={16} aria-hidden />
      <span className="ttx-uploads__name" title={upload.name}>
        {upload.name}
      </span>
      <span className="ttx-uploads__meta">{formatSize(upload.size)}</span>
      <span className="ttx-uploads__actions">
        {onAdd && (
          <button type="button" onClick={onAdd} title={add} aria-label={add}>
            <PlusIcon size={14} />
          </button>
        )}
        <Links upload={upload} />
      </span>
    </div>
  )
}

function Links({ upload }: { upload: Upload }) {
  return (
    <>
      <CopyLinkButton link={fileLink(upload.id)} />
      <a href={uploadUrl(upload.id)} target="_blank" rel="noopener noreferrer" title="Open" aria-label="Open">
        <ArrowSquareOutIcon size={14} />
      </a>
    </>
  )
}

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
