import { useEffect, useRef, useState } from 'react'
import { CircleNotchIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import { ROUTE_COLORS, ROUTE_PROFILES, type MapBoardObject, type MapLayer, type RouteProfile, type ScenarioClosure } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Board } from '../board/board'
import { useLayerStates, type LayerState } from '../map/layers'
import { useBoardEvents } from '../map/MapOptions'
import { importAffectedAreas } from './importArea'
import { extraSeconds, formatDuration, formatKm, useClosures, useRoutes, type RouteState } from './useRoutes'

const PROFILE_LABEL: Record<RouteProfile, string> = { car: 'Car', truck: 'Truck' }
const NO_LAYERS: MapLayer[] = []

/** A map op as its own undo step. In focus, `runtime` is the draft: others see it once shared. */
function op(runtime: Runtime, mapId: string, id: string, args: Record<string, unknown>) {
  runtime.beginGesture()
  return runtime.dispatch(id, { kind: 'objects', ids: [mapId] }, args)
}

/**
 * A map's Options in Scenario mode: its routes with their times and what the closures add, and what closes roads,
 * from data (layers that block roads: imported files, event footprints, notebook results) and from what-ifs (closures
 * drawn with the scenario toolbar). Each can be switched off and on to compare. In focus all of it is on the draft.
 */
export function ScenarioPanel({ runtime, object: o }: { runtime: Runtime; object: MapBoardObject }) {
  const layers = o.layers ?? NO_LAYERS
  // The map runs the same tools; the tool runner shares the runs and caches the results.
  const states = useLayerStates(layers)
  const { all, closures } = useClosures(o.scenario, layers, states)
  const routes = useRoutes(o.scenario?.routes ?? [], all)
  const mapOp = (id: string, args: Record<string, unknown>) => op(runtime, o.id, id, args)

  return (
    <div className="ttx-ui">
      <p className="mt-3 text-xs/4 text-muted-foreground">Routes go around the affected areas that are on. Try what-ifs here: others see them once you share.</p>
      <section className="ttx-options__section">
        <h3>Routes</h3>
        {!routes.length && <p className="text-xs/4 text-muted-foreground">Use the route tool on the map: a click where a route starts, one where it ends.</p>}
        <div className="flex flex-col gap-2">
          {routes.map((s) => (
            <RouteCard
              key={s.route.id}
              state={s}
              onTitle={(title) => mapOp('map.setRoute', { routeId: s.route.id, title })}
              onProfile={(profile) => mapOp('map.setRoute', { routeId: s.route.id, profile })}
              onRemove={() => mapOp('map.removeRoute', { routeId: s.route.id })}
            />
          ))}
        </div>
      </section>
      <FromData runtime={runtime} mapId={o.id} layers={layers} states={states} onBlocks={(layerId, blocks) => mapOp('map.setLayerBlocks', { layerId, blocks })} />
      <section className="ttx-options__section">
        <h3>What-ifs</h3>
        {!closures.length && <p className="text-xs/4 text-muted-foreground">Close a road or an area with the tools on the map.</p>}
        <div className="flex flex-col">
          {closures.map((c) => (
            <ClosureRow
              key={c.id}
              closure={c}
              onOn={(on) => mapOp('map.setClosure', { closureId: c.id, off: !on })}
              onNote={(note) => mapOp('map.setClosure', { closureId: c.id, note })}
              onRemove={() => mapOp('map.removeClosure', { closureId: c.id })}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function RouteCard({ state: s, onTitle, onProfile, onRemove }: { state: RouteState; onTitle(t: string): void; onProfile(p: RouteProfile): void; onRemove(): void }) {
  const r = s.result
  const extra = extraSeconds(s)
  return (
    <div className="flex flex-col gap-1 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <i className="size-3 shrink-0 rounded-[2px]" style={{ background: ROUTE_COLORS[s.route.color] }} aria-hidden />
        <EditableText value={s.route.title} label="Route name" className="text-sm font-medium" onChange={onTitle} />
        <Select value={s.route.profile} onValueChange={(v) => onProfile(v as RouteProfile)}>
          <SelectTrigger size="sm" className="h-7 w-[84px] shrink-0 px-2 text-xs" aria-label="Vehicle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROUTE_PROFILES.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {PROFILE_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground" title="Remove route" aria-label={`Remove ${s.route.title}`} onClick={onRemove}>
          <XIcon />
        </Button>
      </div>
      {s.error ? (
        <p className="text-xs/4 text-destructive">{s.error}</p>
      ) : !r ? (
        <p className="flex items-center gap-1.5 text-xs/4 text-muted-foreground">
          <CircleNotchIcon className="size-3 animate-spin" aria-hidden />
          Finding the route. The first in an area reads its roads (up to 30 s).
        </p>
      ) : !r.ok ? (
        <p className="text-xs/4 text-destructive">{r.reason}</p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-xs/4 text-muted-foreground">
            <span>
              {formatDuration(r.seconds)} · {formatKm(r.meters)}
            </span>
            {extra !== undefined && (
              <span className="rounded-sm bg-destructive/10 px-1.5 font-medium text-destructive" title="What the closures add">
                +{formatDuration(extra)}
              </span>
            )}
          </p>
          {r.roads.length > 0 && <p className="truncate text-xs/4 text-muted-foreground">Via {r.roads.slice(0, 3).map((x) => x.name).join(', ')}</p>}
          {r.offRoad.some((m) => m > 500) && <p className="text-xs/4 text-muted-foreground">Starts or ends {formatKm(Math.max(...r.offRoad))} from the nearest open road</p>}
        </>
      )}
    </div>
  )
}

/** The map's feature layers, each of which can close the roads its features cover; import a file or add an event's footprint. */
function FromData({
  runtime,
  mapId,
  layers,
  states,
  onBlocks,
}: {
  runtime: Runtime
  mapId: string
  layers: MapLayer[]
  states: LayerState[]
  onBlocks(layerId: string, blocks: boolean): void
}) {
  const events = useBoardEvents(runtime.board as Board)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<{ name: string; error?: string }>()
  const features = states.filter((s) => s.output === 'geo.features')

  const importFile = (file: File) => {
    setImporting({ name: file.name })
    importAffectedAreas(runtime, mapId, file).then(
      () => setImporting(undefined),
      (err: Error) => setImporting({ name: file.name, error: err.message }),
    )
  }

  /** An event's footprint as a layer that blocks roads. */
  const addFootprint = (eventId: string, title: string) => {
    const before = new Set(layers.map((l) => l.id))
    op(runtime, mapId, 'map.addEventLayer', { eventId, title })
    const added = (runtime.board.get(mapId) as MapBoardObject | undefined)?.layers?.find((l) => !before.has(l.id))
    if (added) runtime.dispatch('map.setLayerBlocks', { kind: 'objects', ids: [mapId] }, { layerId: added.id, blocks: true })
  }

  return (
    <section className="ttx-options__section">
      <h3>Affected areas from data</h3>
      {!features.length && <p className="text-xs/4 text-muted-foreground">Import a GeoJSON file of affected areas, e.g. a flood extent, or add an event's footprint.</p>}
      <div className="flex flex-col">
        {features.map((s) => {
          const blocks = !!layers.find((l) => l.id === s.id)?.blocks
          return (
            <label key={s.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
              <Checkbox checked={blocks} onCheckedChange={(on) => onBlocks(s.id, on === true)} aria-label={`${s.title} blocks roads`} />
              <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
              <span className={cn('shrink-0 text-xs', s.error ? 'text-destructive' : 'text-muted-foreground')}>{s.error ? 'failed' : s.loading ? '…' : blocks ? 'blocks roads' : 'off'}</span>
            </label>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!!importing && !importing.error}>
          <UploadSimpleIcon />
          Import GeoJSON…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) importFile(file)
          }}
        />
      </div>
      {importing && <p className={cn('mt-1 text-xs/4', importing.error ? 'text-destructive' : 'text-muted-foreground')}>{importing.error ?? `Importing ${importing.name}…`}</p>}
      {events.length > 0 && (
        <>
          <p className="mt-3 mb-1 text-xs/4 text-muted-foreground">Footprints of the events on this board</p>
          <div className="flex flex-col gap-1">
            {events.map((e) => (
              <Button key={e.id} variant="ghost" size="sm" className="justify-start truncate" title={e.id} onClick={() => addFootprint(e.id, e.name)}>
                {e.name}
              </Button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

const CLOSURE_LABEL: Record<ScenarioClosure['geometry']['type'], string> = { Point: 'Closed road', LineString: 'Closed road', Polygon: 'Closed area' }

function ClosureRow({ closure: c, onOn, onNote, onRemove }: { closure: ScenarioClosure; onOn(on: boolean): void; onNote(note: string): void; onRemove(): void }) {
  const label = CLOSURE_LABEL[c.geometry.type]
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
      <Checkbox checked={!c.off} onCheckedChange={(on) => onOn(on === true)} aria-label={`${label} is on`} />
      <div className={cn('flex min-w-0 flex-1 flex-col', c.off && 'opacity-60')}>
        <span className="text-sm">{label}</span>
        <EditableText value={c.note ?? ''} placeholder="Why? e.g. bridge down" label={`Note on ${label.toLowerCase()}`} className="text-xs text-muted-foreground" onChange={onNote} />
      </div>
      <Button variant="ghost" size="icon-xs" className="text-muted-foreground" title="Open again" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  )
}

/** Text edited in place: written when the person leaves it or presses Enter, as one undo step. */
function EditableText({ value, placeholder, label, className, onChange }: { value: string; placeholder?: string; label: string; className?: string; onChange(v: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const v = draft.trim()
    if (v === value || (!v && !placeholder)) return setDraft(value)
    onChange(v)
  }
  return (
    <input
      className={cn('min-w-0 flex-1 truncate rounded-sm border-0 bg-transparent px-0.5 outline-none hover:bg-background focus:bg-background focus:ring-1 focus:ring-ring', className)}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          e.stopPropagation()
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
