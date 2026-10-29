# Plan 011 — Templates: a set of nodes from a few seeds

Date: 2026-10-29. Status: phase 1 implemented on `feat/templates` (framework, sit rep, conflict explorer). Phase 2 (linking) not started.

## 1. Outcome

Many exercises start with the same set of nodes. A template puts a set of nodes on the canvas from one or more seeds. A seed is a typed input: an event, an area of interest, a country, a hazard type or a time range. A template is not tied to events.

Examples:

- **Situation report.** Seed: an event.
- **Conflict explorer.** Seed: an area of interest.
- **Historical hazard explorer.** Seeds: an area of interest, a hazard type and a year range. Not built yet.

In phase 1, the template fills its nodes one time from the seeds. The nodes do not stay linked to the seeds.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Area across a border | One country: the country at the center of the area. |
| How to give an area | A place name (geocoded), or "my view": the area of your most recent map view on the board. |
| Selection | A selected event card gives the event seed its value. The template always adds a full new set. |
| Who writes templates | Developers, in code. Keep the definition simple, so that it can become data (JSON) later. |
| First delivery | The framework, the seed kinds `event` and `area`, the sit rep and the conflict explorer. |
| Where to start a template | The command palette, and the Templates button in the toolbar (the palette with templates only). In the palette, "Insert template…" opens the list of templates. A template shows in the full palette only when you search for it. |
| Data access in an op | An optional `tools` (`ToolRunner`) on `OpContext`. Approved change to a shared contract. |
| Text as a seed | Each seed also accepts `{ "text": "…" }`. The form shows candidates. The op uses the best match and tells which match it used. |
| One text box for a full template | No. The chat agent does this with text seeds. |

## 3. Design

```
seeds ──lookup──▶ seed values ──resolve──▶ facts ──build──▶ nodes, layout
"Nepal floods 2026"  events.search   eventId    events.get   name, country, glides, area
"Beira"              data.geocode    bbox       reverse geocode   area, country, name
```

### 3.1 A template is an op

`defineTemplate` (`packages/plugins/src/templates/define.ts`) makes one op, `template.<id>`, on the canvas:

- `args`: the seeds, plus optional `x` and `y`, the middle of the set.
- `prepare` (async, read-only): resolve each seed to facts, complete the facts, keep the nodes whose `needs` are known, and lay them out. It checks each node against its type before the first write.
- `apply`: add all nodes and a gray frame `box` under them, in one transaction. It also sets the runner's view of each new map to the area. Because the view is in the same transaction, it is there before the map shows.
- `describePlan`: "Situation report for Flood in Nepal (gdacs-event-…)". `Runtime.invoke` puts this text in `InvocationRecord.summary`. The agent and the MCP companion get it in the result of the call.

Thus, the palette, the agent and the MCP companion get each template with no more code. One undo step removes the full set. No new stored object type is necessary.

### 3.2 Seeds and facts

`packages/plugins/src/templates/seeds.ts`. Facts are one flat record: `eventId`, `name`, `start`, `end`, `country`, `glides`, `area`. When two seeds give the same fact, the first seed in the template wins.

| Kind | Value | Form widget | Facts |
| --- | --- | --- | --- |
| `event` | event id, or `{ text }` | `event` (the event picker) | eventId, name, start, end, country, glides, area (bbox of the hazard areas) |
| `area` | `{ west, south, east, north, name? }`, `{ text }`, or `"my view"` | `area` (`apps/web/src/templates/`) | area, name, country |

After the seeds, `complete` adds the facts that follow from other facts. An area without a country gets the country at its center (`data.reverseGeocode`). A country without an area gets the country's bbox (`data.geocode`). Areas smaller than 0.2° grow to 0.2°, so that a point does not zoom a map in fully.

A node with a fact in `needs` that is not known is not added. An empty list is not known (an event with no GLIDE numbers gets no ReliefWeb feed). Without `tools`, the only facts are the ones in the seed values. For example, an event id gives the event card and its map, but no country context.

### 3.3 Tools

New read-only tool `events.get` (`packages/plugins/src/agentTools.ts`). It gives one event's name, dates, country, GLIDE numbers and the bbox of its hazard areas. The browser registry, the room's agent and the MCP executor give their `ToolRunner` to their runtime. The browser registry now has `events.search` and `events.get`, so the app no longer adds `eventsSearch` separately.

### 3.4 Layout and placement

There is a heading text at the top. Below it are columns from left to right, and the nodes of a column stack from top to bottom. The gap is 24 canvas units. Placement:

- Palette: the middle of the view.
- Agent: the middle of the asker's view (`callOp` sets `x` and `y` for `template.*` ops).
- No `x` or `y`: to the right of all objects on the board.

## 4. Templates in this delivery

- **Situation report** (`template.sitrep`): heading, event card, country context, map with the event footprint, ReliefWeb feed, and notes "Key figures", "Needs", "Gaps".
- **Conflict explorer** (`template.conflict`): heading, map with a choropleth of political violence events by province, the Conflict widget, Who's where, country context, and notes "Hotspots", "Access constraints".

## 5. Not built

- The historical hazard explorer. It needs a Montandon query for events in an area and a time range (see `packages/plugin-disasters/src/montyProvider.ts` on `experiment`), and maybe an event list node.
- Seed kinds `country`, `hazard` and `years`.
- Phase 2, linking: the frame becomes a `template` object with the template id, the seeds and the node ids. A change to a seed resolves the facts again and updates the nodes that people did not change. `needs` already tells which nodes use which facts.
- Templates as data, and "save this board as a template".
- The event widget does not send typed text as `{ text }`. You must select an event in the list.

## 6. Verification

- `packages/plugins/test/templates.test.ts`: each template with fake tools, from text and from values; one undo step; frame under and around the nodes; the runner's map view; no feed without GLIDE numbers; no tools; no match fails before a write; placement; the agent's placement and summary.
- Manually, with `npm run sync` and `npm run dev`: Templates button → Situation report → "nepal flood"; Conflict explorer → "Cabo Delgado". Ask the agent for each.
