import { ArrowUpRightIcon, CircleIcon, LineSegmentIcon, NoteIcon, PolygonIcon, ScribbleIcon, SquareIcon, type Icon } from '@phosphor-icons/react'
import { SHAPE_COLORS, type Shape, type ShapeColor } from '@ttx/plugins'

/** What the next press on the map does: place a sticky note, or draw a shape. */
export type DrawTool = 'note' | Shape

const TOOLS: { tool: DrawTool; label: string; hint: string; Icon: Icon }[] = [
  { tool: 'note', label: 'Sticky note', hint: 'Click on the map to place the note', Icon: NoteIcon },
  { tool: 'arrow', label: 'Arrow', hint: 'Drag from where the arrow starts to where it points', Icon: ArrowUpRightIcon },
  { tool: 'line', label: 'Line', hint: 'Drag from one end to the other', Icon: LineSegmentIcon },
  { tool: 'rectangle', label: 'Rectangle', hint: 'Drag from one corner to the opposite one', Icon: SquareIcon },
  { tool: 'circle', label: 'Circle', hint: 'Drag from the center to the edge', Icon: CircleIcon },
  { tool: 'polygon', label: 'Polygon', hint: 'Click each corner; double-click or Enter to finish', Icon: PolygonIcon },
  { tool: 'freehand', label: 'Pen', hint: 'Drag to draw', Icon: ScribbleIcon },
]

/**
 * The map's drawing box, in focus: a sticky note and the default shapes, and the color of the next shape. One tool
 * at a time; it ends after one note or shape, or with Esc, and a second press on it puts it away.
 */
export function DrawingBox({ tool, color, onTool, onColor }: { tool: DrawTool | undefined; color: ShapeColor; onTool(t: DrawTool | undefined): void; onColor(c: ShapeColor): void }) {
  const active = TOOLS.find((t) => t.tool === tool)
  return (
    <div className="ttx-map__tools" role="toolbar" aria-label="Draw on the map" onPointerDown={(e) => e.stopPropagation()}>
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
      </div>
      <div className="ttx-map__toolrow" role="group" aria-label="Shape color">
        {(Object.keys(SHAPE_COLORS) as ShapeColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`ttx-map__swatch ${color === c ? 'is-current' : ''}`}
            title={c}
            aria-label={`Color ${c}`}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
          >
            <i style={{ background: SHAPE_COLORS[c] }} />
          </button>
        ))}
      </div>
      {active && active.tool !== 'note' && <div className="ttx-map__toolhint">{active.hint} · Esc cancels</div>}
    </div>
  )
}
