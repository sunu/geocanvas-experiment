import { useEffect, useRef, useState } from 'react'
import { CrosshairIcon } from '@phosphor-icons/react'
import type { InputBoardObject } from '@ttx/plugins'
import { ObjectHeader } from '../canvas/ObjectHeader'
import type { ObjectViewProps } from '../canvas/registry'
import { AreaPicker } from './AreaPicker'

/**
 * An area of interest that other objects follow (plans/plan-013.md). Double-click to change it; the objects
 * linked to it re-render in the same step (input.setArea), so one undo takes both back.
 */
export function InputObject({ runtime, object: o, editing, onDone }: ObjectViewProps<InputBoardObject>) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // While editing, the wheel scrolls the place list, not the canvas camera.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !editing) return
    const stop = (e: WheelEvent) => e.stopPropagation()
    el.addEventListener('wheel', stop, { passive: true })
    return () => el.removeEventListener('wheel', stop)
  }, [editing])

  const pick = async (area: unknown) => {
    setBusy(true)
    const r = await runtime.invoke('input.setArea', { kind: 'objects', ids: [o.id] }, { area })
    setBusy(false)
    setError(r.status === 'failed' ? r.error : undefined)
    if (r.status === 'applied') onDone()
  }

  return (
    <div className="ttx-country">
      <ObjectHeader icon={<CrosshairIcon size={14} aria-hidden />} title="Area of interest" />
      <div ref={bodyRef} className="ttx-country__body">
        {editing ? (
          <AreaPicker value={undefined} onChange={(v) => void pick(v)} pickOnly />
        ) : (
          <div className="ttx-country__note">
            {busy ? 'Updating…' : o.value ? (o.value.name ?? 'An area on the map') : 'Double-click to pick an area'}
            {error && <div className="ttx-input__error">{error}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
