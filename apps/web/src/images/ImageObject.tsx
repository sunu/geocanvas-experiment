import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowSquareOutIcon, CheckIcon, ImageIcon, LinkIcon, UploadSimpleIcon } from '@phosphor-icons/react'
import { imageUrl, type ImageBoardObject } from '@ttx/plugins'
import { roomFromHash } from '../board/room'
import type { ObjectViewProps } from '../canvas/registry'
import { IMAGE_TYPES, MAX_IMAGE_MB, uploadImage } from './upload'

/** The header's height (world units), added to the picture's when the frame is fitted to it. */
const HEADER_PX = 32

/** How long "Copied" shows after copying the link. */
const COPIED_MS = 1500

/**
 * An uploaded picture. The board stores the image's id; the file is served by the Worker at its link,
 * which the header copies. A new image opens the file chooser; double-click to replace the picture, or
 * drop a file on it.
 */
export function ImageObject({ runtime, object: o, editing, onDone }: ObjectViewProps<ImageBoardObject>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

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
      const [imageId, size] = await Promise.all([uploadImage(file, room, runtime.actor.id), naturalSize(file)])
      // Someone may have moved, resized or deleted it during the upload.
      const now = runtime.board.get(o.id)
      if (!now) return
      runtime.beginGesture()
      runtime.dispatch('image.setImage', { kind: 'objects', ids: [o.id] }, { imageId, name: file.name })
      // Keep the width and fit the height to the picture.
      if (size) runtime.dispatch('core.object.setRect', { kind: 'objects', ids: [o.id] }, { rects: { [o.id]: { h: Math.round((now.w * size.h) / size.w) + HEADER_PX } } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const link = o.imageId && new URL(imageUrl(o.imageId), location.origin).href
  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // No clipboard access (e.g. denied, or an insecure origin): show the link to copy by hand.
      prompt('Link to this image', link)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_MS)
  }

  const onDrop = (e: DragEvent) => {
    const file = e.dataTransfer.files[0]
    if (!file) return
    e.preventDefault()
    void upload(file)
  }

  return (
    <div className="ttx-image" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDrop}>
      {/* The header takes the pointer without double-clicking: its buttons must not start a drag. */}
      <div className="ttx-image__header" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <ImageIcon size={14} aria-hidden />
        <span className="ttx-image__title">{o.name ?? 'Image'}</span>
        {link && (
          <>
            <button type="button" onClick={copyLink} title="Copy link to the image" aria-label="Copy link to the image">
              {copied ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
            </button>
            <a href={link} target="_blank" rel="noopener noreferrer" title="Open the image" aria-label="Open the image">
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </div>
      <div className="ttx-image__body">
        {o.imageId && !uploading ? (
          <img className="ttx-image__img" src={imageUrl(o.imageId)} alt={o.name ?? ''} draggable={false} />
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
                  or drop one here. PNG, JPEG, GIF or WebP, up to {MAX_IMAGE_MB} MB
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
        accept={IMAGE_TYPES.join(',')}
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
async function naturalSize(file: Blob): Promise<{ w: number; h: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { w: bitmap.width, h: bitmap.height }
    bitmap.close()
    return size.w && size.h ? size : undefined
  } catch {
    return undefined
  }
}
