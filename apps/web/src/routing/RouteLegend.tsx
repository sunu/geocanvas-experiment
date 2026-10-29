import { ROUTE_COLORS } from '@ttx/plugins'
import { detour, formatKm, signedKm, type RouteState } from './useRoutes'

/**
 * A scenario's routes on the map itself, at its top left: each route's color, name and length, and the length the
 * closures add. So a map on the canvas shows the scenario's result without opening it.
 */
export function RouteLegend({ routes }: { routes: RouteState[] }) {
  if (!routes.length) return null
  return (
    <ul className="ttx-routelegend" aria-label="Routes">
      {routes.map((s) => {
        const extra = detour(s)
        return (
          <li key={s.route.id}>
            <i style={{ background: ROUTE_COLORS[s.route.color] }} aria-hidden />
            <span className="ttx-routelegend__title">{s.route.title}</span>
            <span className="ttx-routelegend__time">
              {s.error ? 'failed' : !s.result ? '…' : s.result.ok ? formatKm(s.result.meters) : 'no route'}
            </span>
            {extra && <span className="ttx-routelegend__extra">{signedKm(extra.meters)}</span>}
          </li>
        )
      })}
    </ul>
  )
}
