import { ROUTE_COLORS } from '@ttx/plugins'
import { extraSeconds, formatDuration, type RouteState } from './useRoutes'

/**
 * A scenario's routes on the map itself, at its top left: each route's color, name and time, and what the closures
 * add. So a map on the canvas shows the scenario's result without opening it.
 */
export function RouteLegend({ routes }: { routes: RouteState[] }) {
  if (!routes.length) return null
  return (
    <ul className="ttx-routelegend" aria-label="Routes">
      {routes.map((s) => {
        const extra = extraSeconds(s)
        return (
          <li key={s.route.id}>
            <i style={{ background: ROUTE_COLORS[s.route.color] }} aria-hidden />
            <span className="ttx-routelegend__title">{s.route.title}</span>
            <span className="ttx-routelegend__time">
              {s.error ? 'failed' : !s.result ? '…' : s.result.ok ? formatDuration(s.result.seconds) : 'no route'}
            </span>
            {extra !== undefined && <span className="ttx-routelegend__extra">+{formatDuration(extra)}</span>}
          </li>
        )
      })}
    </ul>
  )
}
