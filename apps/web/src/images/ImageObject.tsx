import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowSquareOutIcon, ImageIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { uploadUrl } from '@ttx/core'
import type { ImageBoardObject } from '@ttx/plugins'
import { roomFromHash } from '../board/room'
import type { ObjectViewProps } from '../canvas/registry'
import { CopyLinkButton } from '../uploads/CopyLinkButton'
import { fileLink, frameHeight, kindOf, maxMb, typesOf, uploadFile } from '../uploads/upload'
import { ObjectHeader } from '../canvas/ObjectHeader'

/**
 * An uploaded picture. The board stores the upload's id; the file is served by the Worker at its link,
 * which the header copies. A new image opens the file chooser; double-click to replace the picture, or
 * drop a file on it. Every upload is also listed in the board's uploads gallery.
 */
export function ImageObject({ runtime, object: o, editing, onDone }: ObjectViewProps<ImageBoardObject>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()

  // Editing means choosing a file: the click that drew the image, or the double-click, lets the chooser open.
  // Closing the chooser ends editing (React has no onCancel for inputs).
  useEffect(() => {
    const input = inputRef.current
    if (!editing || !input) return
    input.addEventListener('cancel', onDone)
    input.click()
    return () => input.removeEventListener('cancel', onDone)
  }, [editing])

  const upload = async (file: File) => {
    const room = roomFromHash(location.hash)
    if (!room) return
    setError(undefined)
    setUploading(true)
    try {
      const [imageId, size] = await Promise.all([uploadFile(file, room, runtime.actor.id), naturalSize(file)])
      // Someone may have moved, resized or deleted it during the upload.
      const now = runtime.board.get(o.id)
      if (!now) return
      runtime.beginGesture()
      runtime.dispatch('image.setImage', { kind: 'objects', ids: [o.id] }, { imageId, name: file.name })
      // Keep the width and fit the height to the picture.
      if (size) runtime.dispatch('core.object.setRect', { kind: 'objects', ids: [o.id] }, { rects: { [o.id]: { h: frameHeight(now.w, size) } } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const link = o.imageId && fileLink(o.imageId)

  // Only a picture replaces this one; any other file falls through to the canvas, which places it on its own.
  const onDrop = (e: DragEvent) => {
    const file = e.dataTransfer.files[0]
    if (!file || kindOf(file) !== 'media') return
    e.preventDefault()
    void upload(file)
  }

  return (
    <div className="ttx-image" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDrop}>
      <ObjectHeader icon={<ImageIcon size={14} aria-hidden />} title={o.name ?? 'Image'}>
        {link && (
          <>
            <CopyLinkButton link={link} />
            <a href={link} target="_blank" rel="noopener noreferrer" title="Open the image" aria-label="Open the image">
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </ObjectHeader>
      <div className="ttx-image__body">
        {o.imageId && !uploading ? (
          <img className="ttx-image__img" src={uploadUrl(o.imageId)} alt={o.name ?? ''} draggable={false} />
        ) : (
          <div className="ttx-image__empty">
            {uploading ? (
              'Uploading…'
            ) : (
              <>
                <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => inputRef.current?.click()}>
                  <UploadSimpleIcon size={14} aria-hidden />
                  Choose image
                </button>
                <span>
                  or drop one here. PNG, JPEG, GIF or WebP, up to {maxMb('media')} MB
                </span>
              </>
            )}
          </div>
        )}
        {error && <div className="ttx-image__error">{error}</div>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={typesOf('media').join(',')}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          onDone()
          if (file) void upload(file)
        }}
      />
    </div>
  )
}

/** The picture's size in pixels, or undefined if the browser cannot decode it. */
export async function naturalSize(file: Blob): Promise<{ w: number; h: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { w: bitmap.width, h: bitmap.height }
    bitmap.close()
    return size.w && size.h ? size : undefined
  } catch {
    return undefined
  }
}
