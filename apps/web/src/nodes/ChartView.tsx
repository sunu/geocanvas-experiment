import { useEffect, useRef } from 'react'
import embed, { type Result } from 'vega-embed'
import type { Table } from '@geo-canvas/plugin-core'
import type { NodeViewProps } from '../ui/registry'

export function ChartView({ node, derived, width, height }: NodeViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const table = (derived?.result?.data as { table?: Table } | undefined)?.table
  const empty = (derived?.result?.data as { empty?: string } | undefined)?.empty

  useEffect(() => {
    if (!ref.current || !table) return
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const mark = String(node.props.mark)
    const horizontal = mark === 'bar'
    const enc =
      mark === 'arc'
        ? { theta: { field: table.y, type: 'quantitative' }, color: { field: table.x, type: 'nominal', legend: { labelLimit: 120 } } }
        : horizontal
          ? {
              y: { field: table.x, type: 'nominal', sort: null, title: null, axis: { labelLimit: 110 } },
              x: { field: table.y, type: 'quantitative', title: table.unit ?? null },
            }
          : {
              x: { field: table.x, type: 'nominal', sort: null, title: null },
              y: { field: table.y, type: 'quantitative', title: table.unit ?? null },
            }
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      width: 'container' as const,
      height: Math.max(60, height - 50),
      autosize: { type: 'fit' as const, contains: 'padding' as const },
      background: 'transparent',
      data: { values: table.rows },
      mark: { type: mark, tooltip: true, color: mark === 'arc' ? undefined : '#1971c2', cornerRadiusEnd: horizontal ? 2 : undefined },
      encoding: enc,
      config: { view: { stroke: null }, axis: { labelColor: dark ? '#ccc' : '#444', titleColor: dark ? '#ccc' : '#444', gridColor: dark ? '#333' : '#eee' }, legend: { labelColor: dark ? '#ccc' : '#444' } },
      ...((node.props.spec as object) ?? {}),
    }
    let result: Result | undefined
    let cancelled = false
    embed(ref.current, spec as never, { actions: false, renderer: 'svg' }).then((r) => {
      if (cancelled) r.finalize()
      else result = r
    })
    return () => {
      cancelled = true
      result?.finalize()
    }
  }, [table, node.props.mark, node.props.spec, width, height])

  return (
    <div className="gc-chart">
      {table && <div className="gc-chart__total">Total: {table.total?.toLocaleString('en-US')} {table.unit}</div>}
      {table ? <div ref={ref} className="gc-chart__plot" /> : <div className="gc-muted gc-center">{empty ?? 'Waiting for data…'}</div>}
    </div>
  )
}
