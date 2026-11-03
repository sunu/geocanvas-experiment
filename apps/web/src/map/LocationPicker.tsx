import { useEffect, useState } from 'react'
import { SelectionPlusIcon } from '@phosphor-icons/react'
import type { MapArea } from '@ttx/plugins'
import type { Runtime } from '@ttx/core'
import { askAgent, useAgentCanGeocode } from '../agent/ask'
import { usePluginsOff } from '../board/plugins'
import { drawBox } from './draw'
import { liveMap } from './live'
import { areaAround, parseLatLon } from './location'

/**
 * Where a map looks, for everyone: drag an area on the map, type a point, or describe it to the agent.
 * Each moves everyone's view through map.showArea; in focus that is on the draft, so others see it once shared.
 */
export function LocationPicker({ runtime, mapId }: { runtime: Runtime; mapId: string }) {
  const [drawing, setDrawing] = useState<() => void>()
  const [point, setPoint] = useState('')
  const [words, setWords] = useState('')
  const [asked, setAsked] = useState(false)
  // Both hooks run on every render: `&&` would skip the second while the first is still false.
  const canGeocode = useAgentCanGeocode()
  const agentOff = usePluginsOff(runtime).has('agent')
  const canAsk = canGeocode && !agentOff

  // Leaving focus, or this map going away, ends a drawing in progress.
  useEffect(() => () => drawing?.(), [drawing])

  const showArea = (area: MapArea) => {
    runtime.beginGesture()
    runtime.dispatch('map.showArea', { kind: 'objects', ids: [mapId] }, { ...area, for: 'everyone' })
  }

  const startDrawing = () => {
    const m = liveMap(mapId)
    if (!m || drawing) return
    const cancel = drawBox(m, (area) => {
      setDrawing(undefined)
      if (area) showArea(area)
    })
    setDrawing(() => cancel)
  }

  const typedPoint = parseLatLon(point)

  return (
    <section className="ttx-options__section">
      <h3>Location</h3>
      <div className="ttx-location">
        <button type="button" className={drawing ? 'is-active' : ''} aria-pressed={!!drawing} onClick={() => (drawing ? drawing() : startDrawing())}>
          <SelectionPlusIcon size={14} />
          {drawing ? 'Drag on the map… (Esc cancels)' : 'Draw the area on the map'}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (typedPoint) showArea(areaAround(typedPoint))
          }}
        >
          <input aria-label="Latitude, longitude" placeholder="lat, lon  e.g. -19.84, 34.84" value={point} onChange={(e) => setPoint(e.target.value)} aria-invalid={!!point.trim() && !typedPoint} />
          <button type="submit" disabled={!typedPoint}>
            Go
          </button>
        </form>
        {canAsk && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const text = words.trim()
              if (!text) return
              const sent = askAgent(runtime.actor, `Show this on the selected map, for everyone (geocode it, then map.showArea with for: 'everyone'): ${text}`, [mapId])
              if (sent) {
                setWords('')
                setAsked(true)
              }
            }}
          >
            <input aria-label="Describe the area in words" placeholder="Describe it, e.g. the coast south of Beira" value={words} onChange={(e) => setWords(e.target.value)} />
            <button type="submit" disabled={!words.trim()}>
              Ask
            </button>
          </form>
        )}
        {asked && <p className="ttx-options__empty">Asked the agent; its answer is in the chat. Everyone's view moves when it is done.</p>}
      </div>
    </section>
  )
}
