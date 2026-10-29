import { createPortal } from 'react-dom'
import { UploadSimpleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { maxMb } from './upload'
import { removePending, usePending } from './pending'

/** Files uploading from this tab, each as a box on the board where its object will go (in world units). */
export function PendingUploads() {
  const pending = usePending()
  return pending.map((p) => (
    <div
      key={p.key}
      className={`ttx-pending ${p.error ? 'is-error' : ''}`}
      style={{ left: p.rect.x, top: p.rect.y, width: p.rect.w, height: p.rect.h }}
      // Not a board object: pressing it neither selects nor drags.
      onPointerDown={(e) => e.stopPropagation()}
      role="status"
    >
      {p.error ? <WarningCircleIcon size={28} aria-hidden /> : <span className="ttx-pending__spinner" aria-hidden />}
      <div className="ttx-pending__name" title={p.name}>
        {p.name}
      </div>
      {p.error ? (
        <>
          <div className="ttx-pending__status">Could not add it: {p.error}</div>
          <button type="button" onClick={() => removePending(p.key)}>
            Dismiss
          </button>
        </>
      ) : (
        <>
          <div className="ttx-pending__bar">
            <div style={{ width: `${Math.round(p.progress * 100)}%` }} />
          </div>
          <div className="ttx-pending__status">{p.progress < 1 ? `Uploading… ${Math.round(p.progress * 100)}%` : 'Adding to the board…'}</div>
        </>
      )}
    </div>
  ))
}

/** Over the whole page while files are dragged onto it, above the board's panels and toolbar. */
export function DropOverlay() {
  return createPortal(
    <div className="ttx-dropzone" aria-hidden>
      <div className="ttx-dropzone__card">
        <UploadSimpleIcon size={32} />
        <div className="ttx-dropzone__title">Drop to add to the board</div>
        <div className="ttx-dropzone__sub">
          Images up to {maxMb('media')} MB · PDFs up to {maxMb('document')} MB
        </div>
      </div>
    </div>,
    document.body,
  )
}
