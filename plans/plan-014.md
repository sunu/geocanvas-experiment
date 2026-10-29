# Plan 014: scenario routing on maps

Routes on a map, found in the browser, that go around closed roads, so people can ask: "if this bridge is out and this
area is flooded, how do trucks get from the port to the hospital, and how much longer does it take?" Implemented in
`apps/web/src/routing/` (engine, worker, tool, UI), the map plugin (`packages/plugins/src/mapScenario.ts`, `blocks` on
layers, ops in `map.ts`) and GeoJSON uploads (`data` kind in `packages/core/src/uploads.ts`).

## Scenario mode

Planning is a mode of the map, not a widget of its own: what it works on is already on the map (event footprints,
flood extents, notebook results, and later health facilities), and duplicating a map gives two scenarios side by
side. In focus the Options panel has two tabs, Map and Scenario (`map/mode.ts`, per tab, never on the board), and the
tab picks the toolbar on the map too: the drawing box (notes and shapes) in Map mode, the scenario toolbar in Scenario
mode. So a polygon drawn to point at something never closes roads by accident.

- **Toolbar** (`routing/ScenarioToolbar.tsx`): Route (a click for each end), Close a road (snaps to the stretch
  between two junctions nearest the click, within 15 px, and names it after the road; a point closure when no road is
  near), Close an area (a polygon, drawn with the drawing box's `drawShape`), Import (a GeoJSON file; or drop it on the
  map).
- **Panel** (`routing/ScenarioPanel.tsx`): each route with its color, name (edited in place), vehicle, time and
  length, what the closures add, and the roads it takes; affected areas from data (every feature layer, each with a
  "blocks roads" checkbox; import a file; add an event's footprint); and what-ifs (drawn closures, each switched on or
  off with a note). Switching things off and on is how people compare: the route is found again in milliseconds.
- **On the canvas**: routes, closures and a legend (each route's time and what the closures add) show on every map,
  also outside focus and in snapshots, so a map summarizes its scenario for a situation report.
- **Real and hypothetical**: affected areas from data are what is known (imported or live layers); what-ifs are what
  people try. In focus both are on the person's draft until shared.

## Data model and how it grows

`scenario` is one optional field of the map, written whole by ops, like `layers`:
`{ routes: [{ id, title, from, to, profile, color }], closures: [{ id, geometry, note?, off? }] }`, plus `blocks` on
layers. Closures are not annotations: notes and shapes are drawings, closures change what routing does. Planned
analyses join as new optional fields of `scenario`, each a recipe the browser computes, as routes are:

- **Facilities**: a layer of the map (e.g. health facilities from OpenStreetMap, or an imported list) marked as
  destinations.
- **Access**: from hotspots (an event footprint's points, a layer, or places people pick) to the nearest facility, with
  travel time, in the same graph and around the same closures (one Dijkstra from many sources).
- **Reach**: the area within N minutes of each facility (Dijkstra up to a cost), drawn as a layer.
- **Comparison**: the same analyses with and without closures, as routes already are.

## Decisions

- **Our own A\*, not OSRM.** OSRM has no maintained WebAssembly build, and its speed comes from preprocessing
  (contraction hierarchies, or MLD partitions) done on a server per region. A closure changes the graph, so it would
  mean preprocessing again; contraction-hierarchy-js reports about 16 minutes for 135k nodes. Valhalla and GraphHopper
  have the same constraint and no current browser build. At city scale plain A\* over typed arrays is fast enough
  (measured below), and a closure only marks pieces in a mask. No new dependency.
- **Overture transportation segments, not Layercake's OSM highways.** Overture connects segments only through shared
  connectors (`connectors`: connector id and `at`, 0-1 along the segment), so a bridge over a road does not meet it.
  Layercake's `highways.parquet` has OSM tags but no node ids: topology would be guessed from shared coordinates. We
  read the segments with the Overture reader buildings use (`data/overtureRead.ts`), and need no connectors file.
- **Routes are recipes, like layers.** The board stores each route's ends, vehicle, name and color, and the
  closures (`scenario` on the map), and which layers block roads (`blocks`). Each browser finds the path. The
  road network is read for an area derived from the route's ends alone (`routing/area.ts`: padded, snapped to a
  0.05° grid), so every browser reads the same roads and finds the same path.
- **Personal what-ifs are focus mode.** In focus, a map's changes are on the person's draft until they share or
  discard them, so trying closures needs nothing new.
- **Closures**: a Point closes the roads within 25 m (a collapsed bridge; also what the "Close road" tool places), a
  LineString the roads that run along it (at least half their length, or 40 m, within 10 m), not those that cross it,
  a Polygon every road with a point inside it. Features of a blocking layer count the same way. Pieces between
  connectors are the unit closed, so a closure never closes a whole long road.
- **Affected areas from files**: a GeoJSON file is uploaded to the board like an image (a `data` upload, recognized by
  the Worker from its first 4 KB and served as `application/geo+json`, sandboxed), and shown as a layer whose recipe
  keeps the file's id (`data.uploadFeatures`). Dropped on a map in Scenario mode it blocks roads and is drawn in red;
  dropped on the canvas it becomes a new map.
- **Profiles** (`routing/profiles.ts`): car and truck, speeds by road class below most limits, capped by
  `speed_limits`. Access rules apply in order, the last matching one wins; rules with conditions we cannot know
  (`using`, `recognized`, `during`, vehicle dimensions) are left out, so private roads stay closed. Trucks keep tracks
  (at 10 km/h): in many response areas the last kilometres are on them. Under construction and abandoned parts are
  closed.

## Measured (Overture 2026-10-21.0)

| Area, 50 × 50 km | Row groups | Download | Read and decode | Road segments | Graph | Build | A\* (median / max) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Beira | 6 | 44 MB | 18 s | 16k | | | |
| Kathmandu | 9 | 61 MB | 26 s | 84k | 76k nodes, 89k pieces | 193 ms | 2.5 / 46 ms |

Geometry is 43 of Kathmandu's 61 MB, so reading fewer columns would not help much. Closing a 2 km disc there took
1.4 ms and routing again 2.9 ms. A route of a few km in Beira reads its area (0.2° × 0.15°) in about 10 s. Decoded
rows take several hundred MB as objects, so the worker builds the graph one row group at a time
(`GraphBuilder`) and keeps only the typed arrays.

## Limits and next steps

- Routes are at most 40 km between ends (`MAX_ROUTE_KM`), and an area may read at most 16 row groups.
- The first route in an area waits for its roads (10–30 s); they are kept in memory for the page only. Keeping row
  groups in the Cache API, as the World Bank boundaries do, would make reloads fast.
- The room's agent can add routes and closures (ops) but cannot see results: the route tool needs the browser.
  Browser agents (own key) and MCP clients can run `routing.route`. A tool to find a road by name, so the agent can
  close "the N6 bridge", is not built (the worker's `nearRoad` finds one by place).
- No turn restrictions (`prohibited_transitions`), and no time-dependent rules.
