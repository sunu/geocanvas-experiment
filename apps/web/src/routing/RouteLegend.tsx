import { ROUTE_COLORS } from '@ttx/plugins'
import { addedByWhatIfs, type ExposureState } from '../exposure/useExposure'
import { detour, formatKm, signedKm, type RouteState } from './useRoutes'

/**
 * A scenario's results on the map itself, at its top left: each route's color, name and length, and the length the
 * closures add; and the buildings in the flood areas, and how many the what-ifs add. So a map on the canvas shows the
 * scenario's result without opening it.
 */
export function RouteLegend({ routes, exposure }: { routes: RouteState[]; exposure?: ExposureState }) {
  if (!routes.length && !exposure) return null
  const added = exposure && addedByWhatIfs(exposure)
  return (
    <ul className="ttx-routelegend" aria-label="Scenario">
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
      {exposure && (
        <li>
          <i className="ttx-routelegend__flood" aria-hidden />
          <span className="ttx-routelegend__title">Buildings in flood areas</span>
          <span className="ttx-routelegend__time">
            {exposure.noAreas ? 'no areas' : exposure.error ? 'failed' : !exposure.result ? '…' : exposure.result.buildings.toLocaleString('en-US')}
          </span>
          {!!added && <span className="ttx-routelegend__extra">{signedCount(added)}</span>}
        </li>
      )}
      {exposure?.result?.inundation && (
        <li>
          <i className="ttx-routelegend__depth" aria-hidden />
          <span className="ttx-routelegend__title">{exposure.result.inundation.returnPeriod}-year flood: destroyed, about</span>
          <span className="ttx-routelegend__time">{Math.round(exposure.result.inundation.destroyed).toLocaleString('en-US')}</span>
        </li>
      )}
    </ul>
  )
}

/** "+3,140", "−20". */
export const signedCount = (n: number) => `${n < 0 ? '−' : '+'}${Math.abs(n).toLocaleString('en-US')}`
