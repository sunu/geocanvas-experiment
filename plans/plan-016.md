# Plan 016: flood depth and damage estimates in Scenario mode

What a flood of a given size would do to the buildings in a scenario's flood areas: how deep the water would be at
each building, and how damaged the buildings would be. It extends exposure (plan-015): the same flood areas (the
affected areas that are ticked and the closed areas), the same buildings (Overture, by the center of their bbox), the
same OpenStreetMap health facilities and schools, now with a depth and a damage estimate each. Fully in the browser,
apart from a Worker proxy for the depth maps.

Status: built, in `main` (PR #79). Not done: applying GloFAS's `Spurious_Depths` mask.

## Depth: GloFAS return-period maps, not the event

Montandon's flood items have no depth: GDACS gives an alert level and a severity score, CEMS simplified hazard areas
and their extent in km², EM-DAT, PDC and GLIDE scores or nothing (checked on Nepal's flood of August 2026, 20 hazard
items). So depth comes from a model of floods of a given size, not from this event:

- **JRC / CEMS GloFAS global river flood hazard maps, v2.1.2**: river flood water depth in metres at 3 arc seconds
  (about 90 m), for return periods of 10, 20, 50, 75, 100, 200 and 500 years, from LISFLOOD and LISFLOOD-FP. Global
  land, in 271 tiles of 10° (`tile_extents.geojson`, 90 KB; a tile's name is its top left corner, e.g. `N30_E80`).
- Each tile is a GeoTIFF of about 60 MB: float32, deflate, 256 px internal tiles, no overviews, nodata -9999. The JRC
  server answers range requests but sends no CORS headers, so browsers read it through the Worker
  (`/floodmaps/<path>`, GET only, the tile index and depth tiles only, the Range header passed on).
- Read with our own reader (`apps/web/src/inundation/glofas.ts`, about 150 lines, no dependency): the header (64 KB),
  then only the internal tiles that hold the places asked, decompressed with the browser's `DecompressionStream`.
  `@developmentseed/geotiff` is installed (through deck.gl-geotiff) but would be a new direct dependency.

What it is not: this event's water. It is modelled river flooding only (no flash floods from rain, no coastal
flooding), at 90 m, and the README warns of unrealistic depths in places (small channels, tile edges, DEM sinks). The
panel says so.

## Damage: JRC global depth-damage functions

Huizinga, de Moel and Szewczyk (2017), *Global flood depth-damage functions*, EUR 28552 EN, doi:10.2760/16510: the
share of a building's value damaged at 0 to 6 m of water, by continent (Europe, North America, Central and South
America, Asia, Africa, Oceania, and a global average) and class (residential, commercial, industrial, and others not
used here). Embedded as a small table (`inundation/damage.ts`), interpolated linearly between depths. Each building
uses its continent's curve for its class: commercial or industrial when Overture says so, residential otherwise (almost
all buildings outside cities have no type); where a continent has no curve for a class, the global one. The continent
comes from the building's coordinates (coarse boxes, tested), since the flood areas need not be in one country.

Reported: buildings flooded (depth above 0) by depth class (GloFAS's: under 1 m, 1–3 m, 3–10 m, over 10 m); by damage
band (light under 25%, moderate 25–50%, heavy 50–75%, severe 75% or more); and the sum of the damage shares, as "about
N buildings' worth destroyed". The health facilities and schools with their depth. Money (the workbook's replacement
costs per m² by country, times floor area) is later: it needs building shapes, about 6 times the bytes.

## Spike (2026-10-29)

Node, reading JRC directly, the tile N30_E80 (ID192), Bharatpur's CEMS area (84.35–84.44° E, 27.68–27.72° N, 4,500
points on a 0.0009° grid) and a transect across the Narayani at 27.70° N:

| Return period | Requests | Read | Time | Wet points | Median / p90 / max depth | Floodplain west of the river |
| --- | --- | --- | --- | --- | --- | --- |
| 10 years | 3 | 0.09 MB | 0.3 s | 18% | 3.3 / 5.8 / 7.5 m | dry |
| 100 years | 3 | 0.09 MB | 0.2 s | 24% | 4.7 / 8.3 / 10.1 m | 0.6–1.4 m |
| 500 years | 3 | 0.09 MB | 0.1 s | 26% | 5.1 / 9.1 / 11.0 m | 1.5–2.3 m |

The header and two internal tiles cover the area; the river channel is 3.5–9.6 m deep across return periods. Depth is
read once per internal tile (about 30 KB compressed), so reading is not the cost; the buildings are (plan-015).

## Design

- **Board**: `scenario.exposure.returnPeriod` (optional; one of the seven), set with `map.setExposure`. Without it,
  exposure counts as before.
- **Worker**: the exposure worker keeps the center and class of each exposed building while counting, then reads the
  depth at each (grouped by GloFAS tile) and sums depth classes, damage bands and shares. A second request reads the
  depth at the facilities. The flooded buildings come back as positions and depth classes, at most 200,000.
- **Map**: the flooded buildings as dots colored by depth class, under the facilities. Not the depth raster itself:
  the maps have no overviews, so a zoomed-out view would read whole 60 MB tiles.
- **Panel**: a "Flood" select in the Exposure section (no depth, then 10 to 500 years); the depth classes, damage bands,
  "about N buildings' worth destroyed", facilities with depth, and the caveats. The map's legend gets the damage line.

## Built (2026-10-29)

As designed above. In headless Chrome on Nepal's flood footprint (GDACS's region and the 10 CEMS areas ticked, 77,003
buildings), a 100-year river flood: depth and damage in 3 s once the buildings were read; 3,575 buildings (5%) under
water (732 under 1 m, 1,625 at 1–3 m, 1,080 at 3–10 m, 138 at 10 m or more); 170 light, 1,099 moderate, 639 heavy and
1,667 severe; about 2,444 buildings' worth destroyed; 3 of 51 health facilities (Balkumari Maternity Hospital at 1.3 m)
and 1 of 147 schools flooded.

The 138 buildings at 10 m or more are mostly in narrow Himalayan valleys (the Trishuli), where GloFAS warns that depths
over 10 m in small channels are spurious; it publishes a mask of them (`Spurious_Depths/`), not applied yet.

## Later

- Apply GloFAS's spurious depth mask, or cap depths in its areas.

- Money, from replacement costs and floor areas.
- Depth for an event, from a detailed flood extent and elevation (water surface at the extent's edge minus ground);
  needs a proxy for Copernicus DEM, which sends no CORS headers either.
- People affected, from WorldPop under the flooded pixels.
- The depth raster on the map, from a source with overviews or at close zoom only.
