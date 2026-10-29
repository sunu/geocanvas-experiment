import { useRef } from 'react'
import { BarricadeIcon, PathIcon, PolygonIcon, UploadSimpleIcon, type Icon } from '@phosphor-icons/react'

/** What the next press on the map does in Scenario mode. */
export type ScenarioTool = 'route' | 'closeRoad' | 'closeArea'

const TOOLS: { tool: ScenarioTool; label: string; hint: string; Icon: Icon }[] = [
  { tool: 'route', label: 'Route', hint: 'Click where the route starts, then where it ends', Icon: PathIcon },
  { tool: 'closeRoad', label: 'Close a road', hint: 'Click on a road to close it from one junction to the next', Icon: BarricadeIcon },
  { tool: 'closeArea', label: 'Close an area', hint: 'Click each corner of the area; double-click or Enter to finish', Icon: PolygonIcon },
]

/** Files the import takes: the room checks that they are GeoJSON. */
const ACCEPT = '.geojson,.json,application/geo+json,application/json'

/**
 * The map's tools in Scenario mode, where the drawing box (map/DrawingBox.tsx) is in Map mode: add a route, close a road or an area,
 * and import affected areas from a GeoJSON file (also dropped on the map). One tool at a time; Esc cancels.
 */
export function ScenarioToolbar({
  tool,
  onTool,
  onImport,
  status,
}: {
  tool: ScenarioTool | undefined
  onTool(t: ScenarioTool | undefined): void
  onImport(file: File): void
  /** What the tool expects next, an import's progress, or why something failed. */
  status?: { text: string; error?: boolean }
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const active = TOOLS.find((t) => t.tool === tool)
  const hint = status ?? (active && { text: `${active.hint} · Esc cancels` })
  return (
    <div className="ttx-map__tools" role="toolbar" aria-label="Scenario tools" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ttx-map__toolrow">
        {TOOLS.map(({ tool: t, label, hint, Icon }) => (
          <button
            key={t}
            type="button"
            className={tool === t ? 'is-on' : undefined}
            title={tool === t ? hint : label}
            aria-label={label}
            aria-pressed={tool === t}
            onClick={() => onTool(tool === t ? undefined : t)}
          >
            <Icon size={16} />
          </button>
        ))}
        <span className="ttx-map__toolsep" aria-hidden />
        <button type="button" title="Import affected areas: a GeoJSON file, e.g. a flood extent (or drop it on the map)" aria-label="Import affected areas" onClick={() => fileRef.current?.click()}>
          <UploadSimpleIcon size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onImport(file)
          }}
        />
      </div>
      {hint && <div className={`ttx-map__toolhint ${hint.error ? 'is-error' : ''}`}>{hint.text}</div>}
    </div>
  )
}
