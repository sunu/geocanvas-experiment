# Plan 015: flood exposure of buildings in Scenario mode

How many buildings are in a flood area, and how a what-if changes that: "if the river covers this area, how many
houses are in the water, and are there schools or health facilities among them?" This is exposure (what is in the
water), not damage or risk: no depth, no vulnerability. It runs fully in the browser, like routing (plan-014), and
joins a map's Scenario mode as plan-014 planned: a new optional field of `scenario`, a recipe each browser computes.

Status: built on `feat/flood-exposure` (on `scenario-planning`, now in main); the spike's measurements are below, and what changed while building is under Decisions made while building.

## What it works on

- **Flood areas are the scenario's affected areas.** The polygons of the layers marked `blocks` (an event footprint, an
  uploaded GeoJSON file, a notebook result) and the Polygon closures that are on. One set of areas drives both
  analyses: switching a what-if off changes the routes and the exposure together. Points and lines do not count.
- **Buildings from Overture**, read with `readOverture` (`data/overtureRead.ts`, shared with buildings and routing),
  only the columns `bbox`, `subtype` and `class`, never `geometry`. A building is exposed when the center of its bbox
  is inside a flood polygon.
- **Kinds of buildings from OpenStreetMap, not Overture.** Overture's `subtype` is empty for almost every building
  outside cities (below), so it cannot say how many schools or clinics are in the water. Health facilities already
  come from Layercake's `pois` (`data/health.ts`); schools are in the same file. Count those POIs inside the flood
  areas, and give Overture's subtype only as "of which tagged residential, …" when it is there.

## Spike: reading the light columns (Overture 2026-10-21.0)

Measured in headless Chrome on the dev server, with a throwaway module imported in the page (not committed): flood polygons from
Montandon, the Overture files and footers they touch, the row groups whose `bbox` statistics meet the polygon (not
only its bbox), then the light columns of those row groups, 4 at a time, counting buildings in the polygons.

| Flood polygon | Bbox (deg²) | Row groups: bbox / polygon | Rows read | Light / geometry / all columns | Read | Buildings: bbox / polygon |
| --- | --- | --- | --- | --- | --- | --- |
| CEMS EMSR857 aoi12, Mozambique | 0.004 | 2 / 2 | 43k | 0.6 / 2.7 / 4.6 MB | 9.2 s (cold) | 10,376 / 7,633 |
| CEMS EMSR927 aoi05, Nepal | 0.012 | 2 / 2 | 72k | 0.9 / 4.2 / 7.3 MB | 3.4 s | 26,274 / 9,271 |
| GDACS 1104124 (MultiPolygon), Nepal | 3.6 | 95 / 10 | 379k | 4.8 / 22 / 39 MB | 11.8 s | 216,658 / 20,920 |
| CEMS EMSR838 aoi08, Pakistan | 0.48 | 34 / 17 | 680k | 7.5 / 45 / 71 MB | 7.5–12.3 s | 489,650 / 259,736 |
| GFD 4439, Mozambique | 54 | 826 / 826 | 17.3M | 237 / 1,223 / 1,982 MB | not read | |
| GDACS 1104136-2, Pakistan | 38 | 1,294 / 836 | 32.4M | 363 / 2,072 / 3,330 MB | not read | |

Footers: 0.7–3.2 MB (1–5 files) for the first four; 7 MB (6 files, 18 s) and 9.5 MB (15 files, 41 s) for the
country-scale two, before any row is read.

What it shows:

- **The light columns are 10–13% of the bytes** (geometry alone is about 60%). Exposure needs no shapes.
- **Testing row groups against the polygon, not its bbox, matters**: 95 to 10 row groups for Nepal's GDACS area, 34
  to 17 for Pakistan's CEMS area. And within them, counting in the polygon instead of its bbox: 216,658 to 20,920.
- **Counting is cheap**: 80 ms for 680k rows (point in polygon, no index). The time is round trips: each range request
  to Overture's S3 (us-west-2) took 0.4–0.6 s from here, and hyparquet makes 3 per row group for these columns.
  17 requests in flight instead of 4 gave 7.5 s instead of 8.8 s, so concurrency is not the lever; fewer, larger
  requests might be (one range per row group spanning the three columns, if the columns between them are small).
- **Country-scale polygons are out of reach**: GFD and the larger GDACS areas are country envelopes (19 to 56
  vertices over 38–54 deg²), 17–32 million buildings and 240–360 MB of light columns. They need a cap with a clear
  message, not a longer wait.
- **Overture's `subtype` is nearly empty there**: 98–100% of exposed buildings have none (Pakistan: 46 of 259,736
  have one). Hence the OpenStreetMap POIs above.
- **Montandon's flood polygons are coarse.** CEMS items are titled "… flash flood hazard area" with 8–139 vertices,
  simplified areas rather than mapped water; GDACS gives regions; GFD gives country envelopes. Counts over them are
  "buildings in the hazard area", and the UI must say so. Drawn and uploaded areas can be as precise as people make
  them.

## Design

- **Board:** `scenario.exposure?: { buildings: true }`, written by an op (`map.setExposure`), so the agent can switch it
  on and undo covers it. A recipe only: no counts on the board.
- **Tool:** a browser tool `exposure.buildings` (output kind `exposure.counts`), input the flood polygons (as
  `routing.route` takes closures), run in a worker (`exposure/exposure.worker.ts`) on `readOverture`. The tool runner
  caches results by input, so a what-if switched off and on again costs nothing. Row groups are chosen by testing
  their `bbox` statistics against the polygons (a new helper beside `rowGroupsInBbox` in `data/wkb.ts`, tested in
  Node).
- **Caps, checked before reading rows:** at most 8 files and 64 row groups (about 30 MB of light columns, roughly
  30 s here); beyond that the panel says the area is too large to count in the browser and suggests a smaller area.
  Also a cap on files, since footers alone took 41 s for 15 files.
- **Baseline:** like routes, exposure is also counted for the areas from data alone, without the what-ifs, so the
  panel shows what the what-ifs add.
- **Panel:** an "Exposure" section in the Scenario tab: buildings in flood areas, health facilities and schools among
  them (from OpenStreetMap), what the what-ifs add, and the caveats (exposure, not damage; the hazard area's source;
  Overture's coverage). Loading while the first read runs; errors as the routes show them.
- **Map:** exposed health facilities and schools as points; buildings as a count, not drawn (hundreds of thousands).
  A line in the map's legend (`routing/RouteLegend.tsx`), so snapshots carry the figure into a situation report.
- **Agent:** `summarize` says exposure is on; browser and MCP agents can run `exposure.buildings`; the room's agent
  cannot see results, as with routes.

## Decisions made while building

- **Country outlines are left out, by name.** A Montandon event footprint is not only flood areas: Nepal's flood
  (gdacs-event-1104124-1) has 14 polygons, among them EM-DAT's hazard and event areas and IFRC's event area, each the
  whole of Nepal (80–88° E). One of them made the count refuse (9 files). A single area larger than 4 deg² (about
  200 × 200 km; `MAX_AREA_DEG2` in `exposure/areas.ts`) is left out, and the panel names it; GDACS's 3.6 deg² area and
  the CEMS areas still count. Routing still treats those outlines as closures (it closes every road in Nepal): a
  question for plan-014.
- **Two columns, not three**: `bbox` and `subtype`. `class` was only for kinds of buildings, which come from
  OpenStreetMap; one request fewer per row group.
- **Facilities from the health facilities' Layercake worker** (`LayercakeHealth.facilities`, pick `facilities`):
  health first, then `amenity` school, kindergarten, college or university. One worker, so the 5 MB footer is read
  once per page. If they cannot be read (more than 12 row groups), the building count stands and the panel says why.
- **The flood polygons are indexed** in a 64 × 64 grid over their bounds (`Flood`): an uploaded flood extent can have
  thousands of polygons.
- **A footprint comes into a scenario by source** (after PR #67 split footprints into a layer per source's area):
  only the hazard areas up to 4 deg² are ticked as affected areas (`affectedByDefault`). For Nepal that is GDACS's
  region and the 10 CEMS areas; EM-DAT's hazard area (all of Nepal), the IFRC and EM-DAT event areas and the points
  come unticked. So routes no longer find every road in Nepal closed, and the count is 77,003 buildings, 51 health
  facilities and 147 schools, with nothing left out.
- **Facilities are drawn on live maps only**, as rose (health) and teal (education) dots; the legend line is on
  snapshots too.

Measured end to end (headless Chrome, dev server): the Nepal footprint plus a 0.07° × 0.06° what-if at Bharatpur,
30 s for the first count: 119,605 buildings, 137 health facilities and 229 schools, of which the what-if adds 42,602
buildings. Switching the what-if off gave 77,003 (the baseline) at once, from the tool cache.

## Steps (done)

1. Pure code, tested in Node: point in polygon over the polygons (with holes), row groups meeting polygons, counting
   rows, and the POI counts.
2. The worker, the tool and its caps; reuse `readOverture`. Try one range per row group for the three columns.
3. `scenario.exposure`, `map.setExposure`, tests beside `mapScenario.test.ts`.
4. The panel section, the POI points, the legend line; check in headless Chrome with the polygons above.
5. AGENTS.md.

## Later


- **People exposed**: sum WorldPop (already a COG layer, `data.population`) in the polygons, reading pixels rather
  than drawing them.
- **Depth and return periods**: counts by depth class from flood hazard maps would turn exposure into a first step
  of risk. Candidates (JRC global river flood hazard maps, WRI Aqueduct) are not checked yet for COG and CORS.
- **By district**: counts by COD-AB area need the boundary polygons in the tool, which are vector tiles today.
- **Larger areas**: a precomputed building count grid would make country-scale areas possible; not looked for yet.
