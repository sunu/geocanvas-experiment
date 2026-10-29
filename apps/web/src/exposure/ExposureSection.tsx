import { CircleNotchIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { FacilityCategory } from '../data/layercake'
import { signedCount } from '../routing/RouteLegend'
import { MAX_AREA_DEG2 } from './areas'
import { addedByWhatIfs, FACILITY_COLORS, facilitiesBy, type ExposureState } from './useExposure'

const FACILITY_LABEL: Record<FacilityCategory, string> = { health: 'Health facilities', education: 'Schools and colleges' }
/** Names listed per category; the rest are counted. */
const NAMES_SHOWN = 4

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The Scenario panel's exposure: a button to count the buildings in the flood areas (the affected areas from data that
 * are on and the closed areas), then the count, what the what-ifs add, and the OpenStreetMap health facilities and
 * schools among them. Exposure, not damage, and the panel says so.
 */
export function ExposureSection({ exposure: s, onSet }: { exposure: ExposureState | undefined; onSet(on: boolean): void }) {
  return (
    <section className="ttx-options__section">
      <h3>Exposure</h3>
      {!s ? (
        <>
          <p className="text-xs/4 text-muted-foreground">How many buildings are in the flood areas: the affected areas from data that block roads, and the areas closed as what-ifs.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => onSet(true)}>
            Count buildings in flood areas
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium">Buildings in flood areas</span>
            <Button variant="ghost" size="icon-xs" className="text-muted-foreground" title="Stop counting" aria-label="Stop counting buildings" onClick={() => onSet(false)}>
              <XIcon />
            </Button>
          </div>
          <ExposureBody s={s} />
          {s.leftOut.length > 0 && (
            <p className="text-xs/4 text-muted-foreground" title={`Each larger than ${MAX_AREA_DEG2} square degrees (about 200 × 200 km)`}>
              Left out as too large to count, e.g. a whole country's outline: {s.leftOut.join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function ExposureBody({ s }: { s: ExposureState }) {
  if (s.noAreas) return <p className="text-xs/4 text-muted-foreground">No flood areas to count: tick an affected area from data, or close an area on the map.</p>
  if (s.waiting) return <Loading text="Waiting for the affected areas to load…" />
  if (s.error) return <p className="text-xs/4 text-destructive">{s.error}</p>
  const r = s.result
  if (!r) return <Loading text="Counting buildings. The first count in an area reads Overture's buildings (5–30 s)." />
  const added = addedByWhatIfs(s)
  const tagged = Object.entries(r.bySubtype).sort((a, b) => b[1] - a[1])
  return (
    <>
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{count(r.buildings)}</span>
        {!!added && (
          <span className="rounded-sm bg-destructive/10 px-1.5 text-xs font-medium text-destructive" title="The buildings the what-ifs add to the areas from data">
            {signedCount(added)} from what-ifs
          </span>
        )}
      </p>
      {tagged.length > 0 && (
        <p className="text-xs/4 text-muted-foreground">
          Overture gives a type for {count(tagged.reduce((n, [, v]) => n + v, 0))}: {tagged.slice(0, 4).map(([k, v]) => `${count(v)} ${k}`).join(', ')}
        </p>
      )}
      {(['health', 'education'] as const).map((c) => (
        <Facilities key={c} category={c} names={facilitiesBy(r, c).map((f) => f.properties.name)} unknown={!!r.facilitiesError} />
      ))}
      {r.facilitiesError && <p className="text-xs/4 text-muted-foreground">{r.facilitiesError}</p>}
      <p className="text-xs/4 text-muted-foreground">
        Exposure, not damage: buildings whose center is in a flood area. Satellite flood areas are often coarse outlines, and Overture's buildings miss some
        places.
      </p>
    </>
  )
}

function Facilities({ category, names, unknown }: { category: FacilityCategory; names: (string | null)[]; unknown: boolean }) {
  const named = names.filter((n): n is string => !!n)
  return (
    <div className="text-xs/4">
      <p className="flex items-center gap-2">
        <i className="size-2.5 shrink-0 rounded-full" style={{ background: FACILITY_COLORS[category] }} aria-hidden />
        <span className="flex-1">{FACILITY_LABEL[category]}</span>
        <span className="font-medium tabular-nums">{unknown ? '?' : count(names.length)}</span>
      </p>
      {named.length > 0 && (
        <p className="pl-[18px] text-muted-foreground">
          {named.slice(0, NAMES_SHOWN).join(', ')}
          {names.length > NAMES_SHOWN && `, and ${count(names.length - Math.min(NAMES_SHOWN, named.length))} more`}
        </p>
      )}
    </div>
  )
}

function Loading({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs/4 text-muted-foreground">
      <CircleNotchIcon className="size-3 shrink-0 animate-spin" aria-hidden />
      {text}
    </p>
  )
}
