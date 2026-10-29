import { useEffect, useRef, useState } from 'react'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import type { Runtime } from '@ttx/core'
import { ROUTE_COLORS, type ScenarioRoute } from '@ttx/plugins'

/**
 * The ends of a scenario's routes, A and B in each route's color, as MapLibre markers above the data layers. In
 * Scenario mode, drag an end to move it: the route is found again from there, for everyone.
 */
export function RouteMarkers({ runtime, map, mapId, routes, editable }: { runtime: Runtime; map: MapLibreMap; mapId: string; routes: ScenarioRoute[]; editable: boolean }) {
  const move = (routeId: string, end: 'from' | 'to', [lng, lat]: [number, number]) => {
    runtime.beginGesture()
    runtime.dispatch('map.setRoute', { kind: 'objects', ids: [mapId] }, { routeId, [end]: { lng, lat } })
  }
  return (
    <>
      {routes.flatMap((r) => [
        <EndMarker key={`${r.id}:from`} map={map} lngLat={r.from} label="A" color={ROUTE_COLORS[r.color]} title={r.title} draggable={editable} onMove={(p) => move(r.id, 'from', p)} />,
        <EndMarker key={`${r.id}:to`} map={map} lngLat={r.to} label="B" color={ROUTE_COLORS[r.color]} title={r.title} draggable={editable} onMove={(p) => move(r.id, 'to', p)} />,
      ])}
    </>
  )
}

/** One end of a route, or the start of one being placed. */
export function EndMarker({
  map,
  lngLat: [lng, lat],
  label,
  color,
  title,
  draggable,
  onMove,
}: {
  map: MapLibreMap
  lngLat: [number, number]
  label: string
  color: string
  /** The route's name, in the tooltip. */
  title?: string
  draggable: boolean
  onMove?(p: [number, number]): void
}) {
  const [el] = useState(() => {
    const div = document.createElement('div')
    div.className = 'ttx-routeend'
    return div
  })
  const markerRef = useRef<Marker>(null)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  useEffect(() => {
    const marker = new Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map)
    marker.on('dragend', () => {
      const p = marker.getLngLat().wrap()
      onMoveRef.current?.([p.lng, p.lat])
    })
    markerRef.current = marker
    return () => {
      marker.remove()
      markerRef.current = null
    }
    // Made once per end; its place, label and dragging follow below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el])

  useEffect(() => {
    markerRef.current?.setLngLat([lng, lat])
  }, [lng, lat])

  useEffect(() => {
    el.textContent = label
    el.style.background = color
  }, [el, label, color])

  const movable = draggable && !!onMove
  useEffect(() => {
    markerRef.current?.setDraggable(movable)
    el.classList.toggle('is-draggable', movable)
    el.title = [title, movable && 'Drag to move this end of the route'].filter(Boolean).join(': ')
  }, [el, movable, title])

  return null
}
