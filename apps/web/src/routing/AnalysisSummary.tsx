import { ROUTE_COLORS, type MapAnalysis } from '@ttx/plugins'
import { addedByWhatIfs, facilitiesBy, type ExposureState } from '../exposure/useExposure'
import { detour, formatDuration, formatKm, signedKm, type RouteState } from './useRoutes'

const count = (n: number) => n.toLocaleString('en-US')

/** "+3,140", "−20". */
export const signedCount = (n: number) => `${n < 0 ? '−' : '+'}${count(Math.abs(n))}`

/**
 * What an analysis map found (plans/plan-030.md), on the map itself at its top left, on the canvas too: a route map's
 * routes with their length, what the closures add and their time; a flood exposure map's buildings and facilities in
 * its flood areas, what the what-ifs add, and with a flood its damage. So the map carries its answer, also into
 * reports, without opening it. When there is nothing yet, it says what to do.
 */
export function AnalysisSummary({ analysis, routes, exposure }: { analysis: MapAnalysis; routes: RouteState[]; exposure?: ExposureState }) {
  return (
    <ul className="ttx-routelegend" aria-label={analysis === 'routes' ? 'Routes' : 'Exposure'}>
      {analysis === 'routes' ? <Routes routes={routes} /> : <Exposure exposure={exposure} />}
    </ul>
  )
}

function Routes({ routes }: { routes: RouteState[] }) {
  if (!routes.length) return <li className="ttx-routelegend__empty">No routes yet: double-click the map, then the route tool</li>
  return (
    <>
      {routes.map((s) => {
        const extra = detour(s)
        return (
          <li key={s.route.id}>
            <i style={{ background: ROUTE_COLORS[s.route.color] }} aria-hidden />
            <span className="ttx-routelegend__title">{s.route.title}</span>
            <span className="ttx-routelegend__time">
              {s.error ? 'failed' : !s.result ? '…' : s.result.ok ? `${formatKm(s.result.meters)} · ${formatDuration(s.result.seconds)}` : 'no route'}
            </span>
            {extra && <span className="ttx-routelegend__extra">{signedKm(extra.meters)}</span>}
          </li>
        )
      })}
    </>
  )
}

function Exposure({ exposure: e }: { exposure?: ExposureState }) {
  if (!e || e.noAreas) return <li className="ttx-routelegend__empty">No flood areas yet: tick affected areas, or close an area on the map</li>
  if (e.error) return <li className="ttx-routelegend__empty">Could not count: {e.error}</li>
  const r = e.result
  if (!r) return <li className="ttx-routelegend__empty">Counting buildings…</li>
  const added = addedByWhatIfs(e)
  const flood = r.inundation
  return (
    <>
      <li>
        <i className="ttx-routelegend__flood" aria-hidden />
        <span className="ttx-routelegend__title">Buildings in flood areas</span>
        <span className="ttx-routelegend__time">{count(r.buildings)}</span>
        {!!added && <span className="ttx-routelegend__extra">{signedCount(added)}</span>}
      </li>
      {!r.facilitiesError && (
        <li>
          <i aria-hidden />
          <span className="ttx-routelegend__title">Health facilities · schools</span>
          <span className="ttx-routelegend__time">
            {facilitiesBy(r, 'health').length} · {facilitiesBy(r, 'education').length}
          </span>
        </li>
      )}
      {flood && (
        <li>
          <i className="ttx-routelegend__depth" aria-hidden />
          <span className="ttx-routelegend__title">{flood.returnPeriod}-year flood: under water · destroyed, about</span>
          <span className="ttx-routelegend__time">
            {count(flood.flooded)} · {count(Math.round(flood.destroyed))}
          </span>
        </li>
      )}
    </>
  )
}
