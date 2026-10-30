# Plan 020: a place's disaster history from Montandon

What has happened here before: a country's disasters since 1900, and the local losses of past disasters in an area,
from Montandon's EM-DAT and DesInventar collections. Two parts: a widget for a country, and a map layer for an area.

Status: built on `feat/area-history`.

## Spike (2026-10-30, Montandon staging)

| Source | Query | Nepal | Time | Notes |
| --- | --- | --- | --- | --- |
| EM-DAT events | by `monty:country_codes`, without geometry | 212 events, 1954–2026 | 0.8 s, 333 KB | with geometry 5.5 s and 5 MB (country outlines) |
| EM-DAT events | by shape (a district's bbox) | 1,382 events | 122 s | catches every event whose region touches the box: unusable |
| EM-DAT impacts | by country, without geometry | 551 items | 1.4 s | deaths, affected, injured, cost, displaced |
| DesInventar impacts | by country | over 12,000 items, still going | over 22 s | too many to read whole |
| DesInventar impacts | by shape (Chitwan, 0.4 deg²) | 1,775 items, 1971–2013 | 5 s | 553 flood, 413 fire, 272 landslide items; 1,465 deaths |
| GDACS, IFRC, USGS, IDMC events | by shape | 10, 72, 3, 4 | under 4 s | points, or country and province outlines |

- **EM-DAT items join by the id in their item id.** `emdat-event-2015-0114-NPL` and
  `emdat-impact-2015-0114-NPL-total_deaths`: most items have no `monty:src_event_id` (only recent ones do), so a join
  on it gave losses to 2026's events only.
- **Hazards group by EM-DAT's classification code**, which every EM-DAT and DesInventar item carries in
  `monty:hazard_codes` (`nat-hyd-flo-riv`, `nat-geo-ear-gro`): its first three parts. EM-DAT also records transport and
  other technological accidents (`tec-…`; 78 of Nepal's 212 events), kept apart.
- **DesInventar is one item per record, place and loss**: `desinventar-impact-<record>-<type>`, the place a simplified
  polygon (a ward, a municipality) and named only in the title ("FLOOD in Ward no. 8 on 2013-12-30 …"), inconsistently
  ("Ward No. 2", "Ward no 8", "None" for 835 of Chitwan's 1,775). No P-codes. So records are shown where they are, not
  grouped by place name.
- **DesInventar coverage**: 31 of 50 countries probed (Nepal, India, Mozambique, Kenya, Uganda, Ethiopia, Madagascar,
  Malawi, Zambia, Senegal, Nigeria, Tunisia, Myanmar, Timor-Leste, Jamaica and most of Latin America); not Pakistan,
  Bangladesh, Sri Lanka, Indonesia or the Philippines. Mostly up to about 2013.
- Paging works through the Worker's proxy: Montandon's next link is a POST body with a token.

## Built

- **Disaster history widget** (`history` type, `packages/plugins/src/history.ts`; view in `apps/web/src/history/`):
  for a country (the HDX widgets' frame and country picker; op `history.setCountry`), EM-DAT's natural hazard
  disasters since its first record: totals, disasters per decade stacked by hazard family, the five deadliest, and
  events and deaths by family; a hazard filter shared on the board (`hazard`, op `history.setHazard`, `''` for every
  natural hazard). Technological events are left out and counted. In the toolbar's event menu, the palette
  (`history.add`) and for the agent.
- **Past disasters (DesInventar)** map layer (`DATA_LAYERS.desinventar`, browser tool `history.desinventar`): for an
  area up to 1 deg², one point per record at the center of its place's polygon, with its hazard family, DesInventar's
  event type, place, date and losses (deaths, missing, injured, affected, relocated, evacuated, houses destroyed and
  damaged), colored by hazard family. At most 10,000 impact items, then truncated. Where DesInventar has nothing,
  the layer says so.

Measured in headless Chrome: Nepal's widget in 1.1 s (134 natural hazard disasters 1954–2026, 29.6K deaths, 43.5M
people affected; deadliest the 2015 earthquake, 8.8K); Chitwan's DesInventar layer in 3 s (894 records). Many records
share a ward's polygon, so they share a point: 894 records draw as about 100 dots.

## Later

- The layer's span and totals in the layer list ("1971–2013 · 553 floods · 1,465 deaths"), and records spread or sized
  by deaths where they share a place.
- Past events near an event (GDACS, IFRC, USGS points), and a link from an event on the board to its country's
  history filtered to its hazard.
- DesInventar by province: its places carry no P-codes, so they would be joined to COD-AB by location.
