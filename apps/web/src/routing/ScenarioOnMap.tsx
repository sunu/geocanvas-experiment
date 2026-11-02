import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import type { Runtime } from '@ttx/core'
import { analysisOf, type MapAnalysis, type MapBoardObject, type MapLayer } from '@ttx/plugins'
import { exposureLayers, floodedLayers, useExposure, type ExposureState } from '../exposure/useExposure'
import { drawShape } from '../map/draw'
import type { LayerState } from '../map/layers'
import { isGeoJsonFile } from '../uploads/upload'
import { importAffectedAreas } from './importArea'
import { routing } from './routing'
import { EndMarker, RouteMarkers } from './RouteMarkers'
import { AnalysisSummary } from './AnalysisSummary'
import { ScenarioToolbar, type ScenarioTool } from './ScenarioToolbar'
import { routingLayers, useClosures, useRoutes, type RouteState } from './useRoutes'

/** A flood exposure map needs no routes or closed roads: only areas that flood, drawn or imported. */
const EXPOSURE_TOOLS: ScenarioTool[] = ['closeArea']

/** The red of closures (useRoutes.ts), for the area being drawn. */
const CLOSURE_RED = '#dc2626'

/** How far from a click, on screen, a road counts as the one clicked. */
const PICK_PX = 15

/** Metres per screen pixel at the map's zoom and a latitude (MapLibre's 512 px tiles). */
const metersPerPixel = (map: MapLibreMap, lat: number) => (40_075_016.7 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())

/**
 * A map's scenario as the map shows it: its routes and its exposure counts, found in this browser, and the deck.gl
 * layers that draw them and the closures. Every map runs it, in any mode and on the canvas, so a map shows its
 * scenario's result everywhere; its Options panel runs it too, and the tool runner shares the runs.
 */
export function useScenario(o: MapBoardObject, layers: MapLayer[], states: LayerState[]) {
  const { all, fromLayers, closures } = useClosures(o.scenario, layers, states)
  const routes = useRoutes(o.scenario?.routes ?? [], all)
  const blocking = new Set(layers.flatMap((l) => (l.blocks ? [l.id] : [])))
  const exposure = useExposure(o.scenario, closures, fromLayers, states.some((s) => blocking.has(s.id) && s.loading), analysisOf(o) === 'exposure')
  const deck = useMemo(() => [...floodedLayers(exposure), ...routingLayers(routes, closures), ...exposureLayers(exposure)], [routes, closures, exposure])
  return { routes, closures, exposure, deck }
}

export type Scenario = ReturnType<typeof useScenario>

/**
 * What a map draws for its scenario with React: the ends of its routes and its legend, always; and in Scenario mode
 * (in focus), the scenario toolbar, its tools on the map, and the drop of a GeoJSON file of affected areas.
 */
export function ScenarioOnMap({
  runtime,
  map,
  mapId,
  routes,
  exposure,
  analysis,
  active,
}: {
  runtime: Runtime
  /** The live map; without one, only the legend. */
  map: MapLibreMap | undefined
  mapId: string
  routes: RouteState[]
  exposure: ExposureState | undefined
  /** What the map is for: its summary at the top left, and the tools it needs. */
  analysis: MapAnalysis | undefined
  /** Scenario mode: the toolbar and its tools. */
  active: boolean
}) {
  const [tool, setTool] = useState<ScenarioTool>()
  /** Where the route being placed starts, before its end is clicked. */
  const [routeStart, setRouteStart] = useState<[number, number]>()
  /** An import under way, or why a tool failed. */
  const [status, setStatus] = useState<{ text: string; error?: boolean }>()
  const [dropping, setDropping] = useState(false)

  // Leaving Scenario mode puts the tool away.
  useEffect(() => {
    if (!active) setTool(undefined)
  }, [active])

  // A new tool starts afresh.
  useEffect(() => {
    setRouteStart(undefined)
    if (tool) setStatus(undefined)
  }, [tool])

  /**
   * Close the road clicked: the stretch between two junctions nearest the click, named after the road, so routes avoid
   * exactly that stretch. With no road near, the roads within 25 m of the point.
   */
  const closeRoadAt = (at: [number, number], maxMeters: number) => {
    setStatus({ text: 'Finding the road… (the first time, this reads the roads of the area)' })
    routing.nearRoad(at, maxMeters).then(
      (road) => {
        runtime.beginGesture()
        const geometry = road ? { type: 'LineString', coordinates: road.line } : { type: 'Point', coordinates: at }
        runtime.dispatch('map.addClosure', { kind: 'objects', ids: [mapId] }, { geometry, ...(road?.name && { note: road.name }) })
        setStatus(road ? undefined : { text: 'No road there: closed the roads within 25 m of the point' })
      },
      (err: Error) => setStatus({ text: err.message, error: true }),
    )
  }
  const closeRoadRef = useRef(closeRoadAt)
  closeRoadRef.current = closeRoadAt

  // Route and closed road act on clicks: a route takes one for its start and one for its end, a closed road one.
  useEffect(() => {
    if (!map || (tool !== 'route' && tool !== 'closeRoad')) return
    const target = { kind: 'objects' as const, ids: [mapId] }
    const onClick = (e: MapMouseEvent) => {
      const p = e.lngLat.wrap()
      const here: [number, number] = [p.lng, p.lat]
      if (tool === 'route' && !routeStart) return setRouteStart(here)
      setTool(undefined)
      if (tool === 'closeRoad') return closeRoadRef.current(here, PICK_PX * metersPerPixel(map, here[1]))
      runtime.beginGesture()
      const res = runtime.dispatch('map.addRoute', target, { from: { lng: routeStart![0], lat: routeStart![1] }, to: { lng: here[0], lat: here[1] } })
      if (res.status === 'failed') setStatus({ text: res.error ?? 'That did not work', error: true })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Before the canvas sees it, which would leave focus.
      e.stopImmediatePropagation()
      setTool(undefined)
    }
    map.getCanvas().style.cursor = 'crosshair'
    map.on('click', onClick)
    window.addEventListener('keydown', onKey, true)
    return () => {
      map.getCanvas().style.cursor = ''
      map.off('click', onClick)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [map, tool, routeStart, mapId, runtime])

  // A closed area: a polygon drawn as the drawing box draws one (map/draw.ts), in the closures' red.
  useEffect(() => {
    if (!map || tool !== 'closeArea') return
    return drawShape(map, 'polygon', CLOSURE_RED, (points) => {
      setTool(undefined)
      if (!points || points.length < 3) return
      runtime.beginGesture()
      runtime.dispatch('map.addClosure', { kind: 'objects', ids: [mapId] }, { geometry: { type: 'Polygon', coordinates: [[...points, points[0]!]] } })
    })
  }, [map, tool, mapId, runtime])

  const importFile = (file: File) => {
    setTool(undefined)
    setStatus({ text: `Importing ${file.name}…` })
    importAffectedAreas(runtime, mapId, file, (sent) => setStatus({ text: `Importing ${file.name}… ${Math.round(sent * 100)}%` })).then(
      () => setStatus(undefined),
      (err: Error) => setStatus({ text: err.message, error: true }),
    )
  }
  const importRef = useRef(importFile)
  importRef.current = importFile

  // In Scenario mode a file dropped on the map is imported into it. Native listeners on the map's own element: an
  // element laid over the map to take drops would also take the pointer from it. (The canvas places files on the
  // board only outside focus.)
  useEffect(() => {
    if (!map || !active) return
    const el = map.getContainer()
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const onOver = (e: DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      setDropping(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setDropping(false)
    }
    const onDrop = (e: DragEvent) => {
      setDropping(false)
      const file = e.dataTransfer?.files[0]
      if (!isFiles(e) || !file) return
      e.preventDefault()
      if (isGeoJsonFile(file)) importRef.current(file)
      else setStatus({ text: `${file.name} is not a GeoJSON file`, error: true })
    }
    el.addEventListener('dragover', onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragover', onOver)
      el.removeEventListener('dragleave', onLeave)
      el.removeEventListener('drop', onDrop)
      setDropping(false)
    }
  }, [map, active])

  return (
    <>
      {dropping && <div className="ttx-map__dropnote">Drop a GeoJSON file of affected areas: its features close the roads they cover</div>}
      {map && <RouteMarkers runtime={runtime} map={map} mapId={mapId} routes={routes.map((s) => s.route)} editable={active} />}
      {map && routeStart && <EndMarker map={map} lngLat={routeStart} label="A" color="#71717a" draggable={false} />}
      {analysis && <AnalysisSummary analysis={analysis} routes={routes} exposure={exposure} />}
      {active && <ScenarioToolbar tools={analysis === 'exposure' ? EXPOSURE_TOOLS : undefined} tool={tool} onTool={setTool} onImport={importFile} status={routeStart && tool === 'route' ? { text: 'Now click where the route ends · Esc cancels' } : status} />}
    </>
  )
}
