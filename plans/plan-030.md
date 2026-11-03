# Plan 030: maps made for an analysis

Scenario mode (plan-014, plan-015, plan-016) put the analyses of a map in a Scenario tab of the map in focus: routes,
closures, affected areas, exposure, flood depth and damage. Their answers showed only there or in a small legend, every
map carried the tab whether it was for routes or not, and comparing two scenarios meant switching things off and on.

A first try (`feat/route-widget`, not merged) made each analysis a separate widget linked to its map. It worked but was
clunky: two objects and an arrow for one question, the map picked by hand, the answer on one object and the tools on
another. This plan instead makes the analysis what the map is for.

Status: built on `feat/map-analysis`.

## Decisions

- **One map type with an `analysis` field** (`routes` or `exposure`; none for a plain map), not new types: every map
  feature (layers, notes, drawings, basemap, views, snapshots, reports) works on all of them, and the scenario data
  (`scenario.routes`, `closures`, `exposure`) stays where it was. Set when the map is added, or later with
  `map.setAnalysis` (the scenario stays).
- **Presented as separate maps**: the toolbar has Map, **Routes** (a route map) and **Exposure** (a flood exposure
  map), the header names it, and the agent reads "route map" in the board summary. A toolbar tool's variant
  (`map:routes`) sets the type's `variantField` (`analysis`; `shape` for boxes).
- **One analysis per map.** A route map can hold several routes. Comparing scenarios is duplicating a map and changing
  one thing (with and without the bridge, 100 against 500 years).
- **The answer is on the map, on the canvas**: its summary at the top left (`routing/AnalysisSummary.tsx`, which
  replaces the route legend): a route map's routes with length, time and what closures add; a flood exposure map's
  buildings and facilities, what the what-ifs add, and with a flood the buildings under water and destroyed. It says
  what to do when there is nothing yet. Snapshots on the canvas show it; report pictures do not yet.
- **The tools are on the map while it is edited** (a double-click on the canvas), not only in focus: a route map has
  route, close a road, close an area, import; a flood exposure map close an area and import (`ScenarioToolbar`'s
  `tools`). A plain map has the drawing box in focus, as before.
- **Options in focus**: a plain map has its Map options only (no Scenario tab); an analysis map has two tabs, its
  analysis first (Routes or Exposure: only that analysis's sections), then Map (`map/mode.ts`; the pick is
  forgotten when the map leaves focus).
- **A flood exposure map always counts** (no start or stop button); a flood is picked in its Exposure section.
- **Maps from before** keep working: one with routes is taken as a route map, one with exposure counted as a flood
  exposure map (`analysisOf`), so they keep their tab and summary.

Measured in headless Chrome: a route map over Beira (Port → Hospital by truck, 2.4 km, 4 min, summary on the canvas)
and a flood exposure map over Bharatpur with a what-if area (59,764 buildings, 121 health facilities, 128 schools; a
100-year flood: 388 under water, about 209 destroyed); double-clicking the exposure map on the canvas showed its two
tools.

## Next steps

- Population exposure on flood exposure maps (WorldPop 2020 in the flood areas, by depth class): WorldPop's files are
  BigTIFF, which the GloFAS reader (plan-016) does not read yet.
- The summary in report pictures at print resolution (reports draw maps as pictures).
- Duplicate as "compare": a button that duplicates an analysis map beside it.
