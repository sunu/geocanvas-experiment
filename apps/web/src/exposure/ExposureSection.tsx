import { CircleNotchIcon, XIcon } from '@phosphor-icons/react'
import { RETURN_PERIODS, type ReturnPeriod } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FacilityCategory } from '../data/layercake'
import { DAMAGE_BANDS, DEPTH_CLASSES } from '../inundation/damage'
import type { Inundation } from '../inundation/estimate'
import { signedCount } from '../routing/RouteLegend'
import { MAX_AREA_DEG2 } from './areas'
import type { Exposure } from './exposure'
import { addedByWhatIfs, DEPTH_COLORS, FACILITY_COLORS, facilitiesBy, type ExposureState } from './useExposure'

const FACILITY_LABEL: Record<FacilityCategory, string> = { health: 'Health facilities', education: 'Schools and colleges' }
/** Names listed per category; the rest are counted. */
const NAMES_SHOWN = 4
/** The damage bands, light to severe. */
const DAMAGE_COLORS = ['#fde68a', '#f59e0b', '#ea580c', '#b91c1c']

const count = (n: number) => n.toLocaleString('en-US')
const metres = (d: number) => `${d < 10 ? d.toFixed(1) : Math.round(d)} m`

/**
 * The Scenario panel's exposure: a button to count the buildings in the flood areas (the affected areas from data that
 * are on and the closed areas), then the count, what the what-ifs add, and the OpenStreetMap health facilities and
 * schools among them. With a flood chosen (a GloFAS return period), also how deep that flood would be at them and the
 * damage it would do (plans/plan-016.md). Estimates, and the panel says so.
 */
export function ExposureSection({
  exposure: s,
  returnPeriod,
  onSet,
}: {
  exposure: ExposureState | undefined
  returnPeriod: ReturnPeriod | undefined
  onSet(on: boolean, returnPeriod?: ReturnPeriod): void
}) {
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
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Flood depth
            <Select value={String(returnPeriod ?? 'none')} onValueChange={(v) => onSet(true, v === 'none' ? undefined : (Number(v) as ReturnPeriod))}>
              <SelectTrigger size="sm" className="h-7 flex-1 px-2 text-xs" aria-label="Flood depth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  None: count only
                </SelectItem>
                {RETURN_PERIODS.map((r) => (
                  <SelectItem key={r} value={String(r)} className="text-xs">
                    {r}-year river flood
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
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
      {r.inundation && <Flood flood={r.inundation} buildings={r.buildings} baseline={s.baseline?.inundation} />}
      {(['health', 'education'] as const).map((c) => (
        <Facilities key={c} category={c} facilities={facilitiesBy(r, c)} unknown={!!r.facilitiesError} withDepth={!!r.inundation} />
      ))}
      {r.facilitiesError && <p className="text-xs/4 text-muted-foreground">{r.facilitiesError}</p>}
      <p className="text-xs/4 text-muted-foreground">
        {r.inundation
          ? `Estimates: depth from GloFAS's model of a ${r.inundation.returnPeriod}-year river flood (90 m; no flash or coastal floods), not this event's water; damage from JRC's average curves for the continent. Buildings by the center of their outline.`
          : "Exposure, not damage: buildings whose center is in a flood area. Satellite flood areas are often coarse outlines, and Overture's buildings miss some places."}
      </p>
    </>
  )
}

/** A flood's depth and damage at the buildings: flooded by depth class, by damage band, and the shares summed. */
function Flood({ flood: f, buildings, baseline }: { flood: Inundation; buildings: number; baseline?: Inundation }) {
  const extra = baseline ? f.destroyed - baseline.destroyed : 0
  return (
    <div className="flex flex-col gap-1.5 border-t pt-2 text-xs/4">
      <p>
        In a {f.returnPeriod}-year river flood, <span className="font-medium">{count(f.flooded)}</span> of them ({buildings ? Math.round((100 * f.flooded) / buildings) : 0}%)
        would be under water.
      </p>
      <Bar values={f.byDepth} colors={DEPTH_COLORS} labels={DEPTH_CLASSES.map((c) => c.label)} title="Depth" />
      <Bar values={f.byDamage} colors={DAMAGE_COLORS} labels={DAMAGE_BANDS.map((b) => b.label.toLowerCase())} title="Damage" />
      <p className="flex items-baseline gap-2">
        <span>
          About <span className="font-semibold tabular-nums">{count(Math.round(f.destroyed))}</span> buildings' worth destroyed
        </span>
        {Math.round(extra) > 0 && (
          <span className="rounded-sm bg-destructive/10 px-1.5 font-medium text-destructive" title="What the what-ifs add to the areas from data">
            {signedCount(Math.round(extra))} from what-ifs
          </span>
        )}
      </p>
    </div>
  )
}

/** Counts by class as one stacked bar, with a legend of the classes that have any. */
function Bar({ values, colors, labels, title }: { values: number[]; colors: string[]; labels: string[]; title: string }) {
  const total = values.reduce((a, b) => a + b, 0)
  if (!total) return null
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-sm" role="img" aria-label={`${title}: ${labels.map((l, i) => `${count(values[i]!)} ${l}`).join(', ')}`}>
        {values.map((v, i) => (v ? <i key={i} style={{ width: `${(100 * v) / total}%`, background: colors[i] }} /> : null))}
      </div>
      <p className="mt-0.5 flex flex-wrap gap-x-2 text-muted-foreground">
        <span>{title}:</span>
        {values.map((v, i) =>
          v ? (
            <span key={i} className="inline-flex items-center gap-1">
              <i className="size-2 rounded-[2px]" style={{ background: colors[i] }} aria-hidden />
              {count(v)} {labels[i]}
            </span>
          ) : null,
        )}
      </p>
    </div>
  )
}

/** The facilities of a category: how many, and their names; with a flood, how many it would reach, deepest first. */
function Facilities({ category, facilities, unknown, withDepth }: { category: FacilityCategory; facilities: Exposure['facilities']; unknown: boolean; withDepth: boolean }) {
  const flooded = withDepth ? facilities.filter((f) => (f.properties.depth ?? 0) > 0).sort((a, b) => b.properties.depth! - a.properties.depth!) : []
  const listed = withDepth ? flooded : facilities
  const named = listed.filter((f) => !!f.properties.name)
  return (
    <div className="text-xs/4">
      <p className="flex items-center gap-2">
        <i className="size-2.5 shrink-0 rounded-full" style={{ background: FACILITY_COLORS[category] }} aria-hidden />
        <span className="flex-1">{FACILITY_LABEL[category]}</span>
        <span className="font-medium tabular-nums">
          {unknown ? '?' : withDepth ? `${count(flooded.length)} of ${count(facilities.length)} flooded` : count(facilities.length)}
        </span>
      </p>
      {named.length > 0 && (
        <p className="pl-[18px] text-muted-foreground">
          {named
            .slice(0, NAMES_SHOWN)
            .map((f) => (withDepth ? `${f.properties.name} (${metres(f.properties.depth!)})` : f.properties.name))
            .join(', ')}
          {listed.length > NAMES_SHOWN && `, and ${count(listed.length - Math.min(NAMES_SHOWN, named.length))} more`}
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
