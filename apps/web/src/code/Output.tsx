import { useEffect, useState } from 'react'
import { uploadUrl } from '@ttx/core'
import type { CodeOutput, TableValue } from '@ttx/plugins'
import { useReportLoading } from '../canvas/loading'

/** Rows a cell draws; the rest are in the output (up to its cap) but not on the card. */
const SHOWN_ROWS = 100

/** A code cell's output, drawn by its kind. */
export function Output({ output }: { output: CodeOutput }) {
  switch (output.kind) {
    case 'geo.features':
      return <FeaturesPreview output={output} />
    case 'image.png':
      return <img className="ttx-code__image" src={uploadUrl(output.uploadId!)} alt="" draggable={false} />
    case 'table':
      return <Table table={output.value as TableValue} />
    case 'number':
      return <div className="ttx-code__number">{String(output.value)}</div>
    case 'json':
      return <pre className="ttx-code__text">{JSON.stringify(output.value, null, 2)}</pre>
    default:
      return <pre className="ttx-code__text">{String(output.value ?? '')}</pre>
  }
}

function Table({ table }: { table: TableValue }) {
  return (
    <div className="ttx-code__table">
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, SHOWN_ROWS).map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type Geometry = { type: string; coordinates?: unknown; geometries?: Geometry[] }

/** The outline of every feature, drawn flat (longitude, latitude) in its box: a glance at the shape, not a map. */
function FeaturesPreview({ output }: { output: CodeOutput }) {
  const [paths, setPaths] = useState<{ d: string; points: [number, number][] }>()
  useReportLoading(!paths)
  useEffect(() => {
    let current = true
    fetch(uploadUrl(output.uploadId!))
      .then((r) => r.json() as Promise<{ features?: { geometry: Geometry | null }[] }>)
      .then((fc) => current && setPaths(outline(fc.features?.map((f) => f.geometry) ?? [], output.bbox)))
      .catch(() => current && setPaths({ d: '', points: [] }))
    return () => {
      current = false
    }
  }, [output.uploadId])
  return (
    <div className="ttx-code__geo">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden>
        {paths && <path d={paths.d} />}
        {paths?.points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.2} />)}
      </svg>
      <span>{output.summary}</span>
    </div>
  )
}

/** SVG path data for lines and polygons, and the points, in a 100 × 100 box around `bbox`. */
function outline(geometries: (Geometry | null)[], bbox: CodeOutput['bbox']): { d: string; points: [number, number][] } {
  if (!bbox) return { d: '', points: [] }
  const [w, s, e, n] = bbox
  const span = Math.max(e - w, n - s) || 1
  const x = (lon: number) => 5 + ((lon - w) / span) * 90 + (90 - ((e - w) / span) * 90) / 2
  const y = (lat: number) => 5 + ((n - lat) / span) * 90 + (90 - ((n - s) / span) * 90) / 2
  const parts: string[] = []
  const points: [number, number][] = []
  const ring = (r: number[][], close: boolean) => parts.push(r.map(([lon, lat], i) => `${i ? 'L' : 'M'}${x(lon!).toFixed(2)} ${y(lat!).toFixed(2)}`).join('') + (close ? 'Z' : ''))
  const draw = (g: Geometry | null) => {
    if (!g) return
    const c = g.coordinates as never
    if (g.type === 'Point') points.push([x((c as number[])[0]!), y((c as number[])[1]!)])
    else if (g.type === 'MultiPoint') (c as number[][]).forEach((p) => points.push([x(p[0]!), y(p[1]!)]))
    else if (g.type === 'LineString') ring(c, false)
    else if (g.type === 'MultiLineString' || g.type === 'Polygon') (c as number[][][]).forEach((r) => ring(r, g.type === 'Polygon'))
    else if (g.type === 'MultiPolygon') (c as number[][][][]).forEach((p) => p.forEach((r) => ring(r, true)))
    else if (g.type === 'GeometryCollection') g.geometries?.forEach(draw)
  }
  geometries.forEach(draw)
  return { d: parts.join(''), points }
}
