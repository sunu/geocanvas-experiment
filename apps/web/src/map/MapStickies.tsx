import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { XIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { MapSticky } from '@ttx/plugins'

/**
 * A map's sticky notes, each pinned to its place with a MapLibre marker: it stays on that place as the map
 * pans and zooms, at the same size on screen. They are DOM, not deck.gl, so their text is sharp and editable,
 * and they sit above the data layers. While the map is edited, drag a note to move it, double-click it to
 * write, and remove it with its ×.
 */
export function MapStickies({
  runtime,
  map,
  mapId,
  stickies,
  editable,
  writing,
  onWrite,
}: {
  runtime: Runtime
  map: MapLibreMap
  mapId: string
  stickies: MapSticky[]
  editable: boolean
  /** The note being written in, e.g. the one just added. */
  writing: string | undefined
  onWrite(id: string | undefined): void
}) {
  const op = (opId: string, args: Record<string, unknown>) => runtime.dispatch(opId, { kind: 'objects', ids: [mapId] }, args)
  return (
    <>
      {stickies.map((s) => (
        <StickyMarker
          key={s.id}
          map={map}
          sticky={s}
          editable={editable}
          writing={editable && writing === s.id}
          onWrite={(on) => {
            // Typing is one undo step per time someone writes in a note.
            if (on) runtime.beginGesture()
            onWrite(on ? s.id : undefined)
          }}
          onMove={([lng, lat]) => {
            runtime.beginGesture()
            op('map.moveAnnotation', { annotationId: s.id, lng, lat })
          }}
          onText={(text) => op('map.setStickyText', { annotationId: s.id, text })}
          onRemove={() => {
            runtime.beginGesture()
            op('map.removeAnnotation', { annotationId: s.id })
          }}
        />
      ))}
    </>
  )
}

interface MarkerProps {
  map: MapLibreMap
  sticky: MapSticky
  editable: boolean
  writing: boolean
  onWrite(on: boolean): void
  onMove(lngLat: [number, number]): void
  onText(text: string): void
  onRemove(): void
}

function StickyMarker({ map, sticky, editable, writing, onWrite, onMove, onText, onRemove }: MarkerProps) {
  const [el] = useState(() => {
    const div = document.createElement('div')
    div.className = 'ttx-mapsticky'
    return div
  })
  const markerRef = useRef<Marker>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  // MapLibre and native listeners call the latest props.
  const props = useRef({ onWrite, onMove, writing })
  props.current = { onWrite, onMove, writing }
  const [lng, lat] = sticky.lngLat

  useEffect(() => {
    // The element's bottom left corner, where the note's tail points, is on the place.
    const marker = new Marker({ element: el, anchor: 'bottom-left' }).setLngLat([lng, lat]).addTo(map)
    marker.on('dragend', () => {
      const p = marker.getLngLat().wrap()
      props.current.onMove([p.lng, p.lat])
    })
    // MapLibre listens on its canvas container, which the note is in: it would zoom on a double-click in the note,
    // and pan on a press in its text box. React's own handlers run later, at the root, so these are native.
    const onDblClick = (e: MouseEvent) => {
      if (!marker.isDraggable() && !props.current.writing) return
      e.stopPropagation()
      props.current.onWrite(true)
    }
    const onDown = (e: MouseEvent) => {
      if (props.current.writing) e.stopPropagation()
    }
    el.addEventListener('dblclick', onDblClick)
    el.addEventListener('mousedown', onDown)
    markerRef.current = marker
    return () => {
      el.removeEventListener('dblclick', onDblClick)
      el.removeEventListener('mousedown', onDown)
      marker.remove()
      markerRef.current = null
    }
    // Made once per note; its place and dragging follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el])

  useEffect(() => {
    markerRef.current?.setLngLat([lng, lat])
  }, [lng, lat])

  // Not autoFocus: the text box is rendered before the marker puts the note in the page, and a detached element
  // cannot take focus.
  useEffect(() => {
    if (writing) textRef.current?.focus()
  }, [writing])

  useEffect(() => {
    markerRef.current?.setDraggable(editable && !writing)
    el.classList.toggle('is-editable', editable)
  }, [el, editable, writing])

  return createPortal(
    <div className="ttx-mapsticky__note">
      {writing ? (
        <textarea
          ref={textRef}
          className="ttx-mapsticky__text ttx-mapsticky__text--edit"
          aria-label="Sticky note text"
          value={sticky.text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onText(e.target.value)}
        />
      ) : (
        <div className="ttx-mapsticky__text" title={editable ? 'Drag to move, double-click to write' : undefined}>
          {sticky.text || <span className="ttx-mapsticky__empty">Empty note</span>}
        </div>
      )}
      {editable && !writing && (
        <button type="button" className="ttx-mapsticky__remove" title="Remove note" aria-label="Remove note" onClick={onRemove}>
          <XIcon size={10} weight="bold" />
        </button>
      )}
    </div>,
    el,
  )
}
