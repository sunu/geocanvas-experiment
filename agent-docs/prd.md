# humanitarian-ttx — PRD and feature list

Oct 29, 2026 · @Lane

For Claude Code and other contributors. Read in this order: `AGENTS.md` for how the code works, this PRD for what to build and in what state it is, then `agent-docs/tasks/*` for how a feature is built. `agent-docs/features.md` is the agreed scope. Where the longer design spec differs from the code, the code and this PRD win.

## 1. Product

A multiplayer infinite canvas for humanitarian tabletop activities and data exploration. Policymakers and disaster analysts pick an event from Montandon, pull hazard, impact and context data onto a shared board, explore it with maps and widgets, and work toward a situation report. An agent in the browser can add, remove and edit widgets for them.

- **Live:** https://humanitarian-ttx.development-seed.workers.dev
- **Users:** policymakers, disaster analysts, humanitarian response teams. No roles: everyone can do everything.
- **Core jobs:** set up a board around an event; explore and compare data on maps and widgets; ask the agent to build or change things; produce a report.

## 2. Rules every feature follows

- **Ops are the only write path.** UI, palette, agent and MCP all dispatch ops on the `Runtime`. Each op has a zod schema and writes through `BoardTx`.
- **Agent parity comes free.** If a widget change is an op, the agent can do it. Don't build UI-only writes.
- **Store recipes, not data.** Objects hold ids and tool recipes; each browser fetches what it shows.
- **Never rename stored types or fields.** New fields on existing types are optional, with defaults where read.
- **A widget is a plugin plus its UI.** Headless `ObjectTypeDef` in `packages/plugins`, then `registerObjectUI` in the web app. Focusable widgets register a `FocusableObjectUI` with an `Options` panel.
- **Secrets stay in the Worker.** Montandon, OpenCage, OpenRouter and HAPI keys are added by Worker proxies, never sent to browsers.
- **Styling.** Chrome (bars, panels, menus) uses shadcn/ui, Geist, rounded corners and a small shadow. Canvas objects are square, flat, no shadows.
- **Who is who** (plan-011). You are cyan, other people get one of six colors, the agent is violet and dashed. Color is never the only signal.
- **Per-person map views.** Nobody's pan moves another person's map. Share in focus moves everyone's view on purpose.
- **No access control yet.** Anyone with a link can edit. Keep real exercise data off previews.

## 3. Status key

**Built** is in `main`. **Planned (step N)** follows the step numbers in `agent-docs/tasks/in-focus-widgets.md`. **Not sequenced** is agreed scope with no step yet. **Stretch** is optional. **Out** is not in current scope.

## 4. Features

### 4.1 Board and canvas

| Feature | Status | Notes |
| --- | --- | --- |
| Own infinite canvas: pan, zoom, select, layer order | Built | vsticky-style DOM world layer. Camera is local, never synced. |
| Rooms by link, New board | Built | `#room=<id>` |
| Real-time sync | Built | Yjs over y-websocket to one Durable Object per room, Hibernation API. |
| Presence: cursors, selections, names, colors | Built | Collaborator avatar list is not built. |
| Command palette (⌘K) with forms from op schemas | Built |  |
| Undo and redo of your own edits, one step per gesture | Built |  |
| Uploads to R2 and the uploads gallery | Built | Images up to 10 MB, PDFs up to 25 MB. Geospatial and tabular uploads: step 12. |
| Dark mode: system setting plus app toggle | Planned (step 11) | New CSS uses `--ttx-*` tokens only, so this step changes tokens and nothing else. |

### 4.2 Focus mode

| Feature | Status | Notes |
| --- | --- | --- |
| Enter with ⤢, `F` or palette; widget fills the app; Options panel beside it | Built | Map, Notebook and PDF. Every new widget registers as focusable. |
| Private draft: edits in focus are not shared | Built | Local fork of the board doc (`ops/draft.ts`). Main-doc updates still flow in. |
| Share button: merge the draft now, stay in focus | Built | One undo step per share. A map also shares your view. |
| Exit dialog: Share, Discard, Keep editing | Built | Only when there are unshared changes. |
| Focused object deleted by someone else | Built | Focus ends with a notice. |
| Full-screen view | Built | Decided: the focus button is the full-screen view. No browser Fullscreen API. |
| Live-map cap and snapshots when zoomed out | Planned (step 7) | Each live map uses two WebGL contexts; browsers keep about 16. |

### 4.3 Widgets

| Widget | Status | Focus | Next work |
| --- | --- | --- | --- |
| **Map** | Built | Yes | Step 3: location on add (draw AOI, lat/lon, bbox, or describe it to the agent). Step 4: layers from a URL (GeoJSON, GeoParquet, COG, XYZ tiles, shapefile) and a legend per layer. Step 5: attributes, filters, legend formatting (`map.setLayerFilter`, `map.setLayerStyle`). Step 6: annotations, marker, polygon, circle. Step 7: snapshots and live-map cap. |
| **Event** (Montandon) | Built | No | Related events near an event and impact tables are still on the `experiment` branch. |
| **Notebook** | Built | Yes | Today: a published Notebook Factory run in a sandboxed iframe. Step 15: render any `.ipynb` from upload or URL, outputs included, never executed, sandboxed without scripts. |
| **Table** | Planned (steps 8–10, 13) | Yes | CSV, Parquet, XLSX into a compact table. Source: upload, URL or STAC. Columns, filters, sort. Scrolls 100,000 rows in focus. |
| **Chart** | Planned (step 14) | Yes | Types: bar, stacked bar, donut, line, stat, ranked list. Source, encoding, filters, markers, provenance. Observable Plot is approved. |
| **Input** (date or location) | Stretch (step 16) | — | Feeds a map's location or a chart's data fetch. |
| ReliefWeb feed | Built | No | Added beside an event with GLIDE numbers. |
| Country context, Who's where, Conflict (HDX HAPI) | Built | No | Province and district tables are not built. |
| Image, PDF | Built | PDF yes | From drops and the uploads gallery. |
| Box, text, sticky note | Built | No |  |

### 4.4 Data

| Feature | Status | Notes |
| --- | --- | --- |
| Montandon STAC search through the Worker proxy | Built | Staging API, as `features.md` scopes. Needs `MONTANDON_TOKEN`. |
| Analysis data tools: population, admin 0, buildings, health facilities, COD-AB boundaries and choropleths, geocoding | Built | Read-only tools in a cached `ToolRunner`. |
| `DataSource` recipe: upload, URL, STAC | Planned (step 8) | Shared by Table, Chart and Map layers. |
| DuckDB-wasm `data.query` tool | Planned (step 8) | Web Worker on first use. SQL built by a pure, tested function with parameters, never pasted values. |
| XLSX | Planned (step 13) | SheetJS only if DuckDB-wasm can't read it. |

### 4.5 Agent

| Feature | Status | Notes |
| --- | --- | --- |
| Room agent in the Durable Object | Built | OpenRouter tool loop, 8 model calls per turn, 20 turns per room per hour. Undo per turn. |
| Bring your own key in the browser | Built | Key stays in localStorage and goes only to the provider. |
| External agents through the MCP companion | Built | Local only. Tools are the tab's ops and read-only tools. |
| Add, remove and edit every widget | Ongoing rule | Holds as long as every change is an op. Check it for each new widget. |
| Summarize the board into a report | Not sequenced | `summarizeBoard` exists for prompts. Needs the report feature (4.6). |
| LLM behavior | Rule | Follow the LLM parts of `agents.md` on the `experiment` branch only. |

### 4.6 Templates and reports

| Feature | Status | Notes |
| --- | --- | --- |
| Start a board from an event | Partial | Picking an event sets up the board with its data and a ReliefWeb feed. |
| Templates that prepopulate widgets (SitRep first) | Not sequenced | Needs a template schema: layout, widgets, data recipes. |
| Create and export reports | Not sequenced | Modeled on OCHA humanitarian snapshots. Design proposal in the design spec (reports and SitRep sections). |

### 4.7 Non-functional requirements

| Requirement | How it's held |
| --- | --- |
| Canvas never below 30 FPS | Hide other objects in focus; snapshots and live-map cap (step 7). Log FPS in PRs that touch rendering. |
| Desktop only | No small-screen layouts. |
| Dark mode | Step 11. |
| Cost-safe multiplayer | Hibernation API; cursor updates capped at 10 per second. |

## 5. Build order

1. **Milestone 1, Map in focus:** done.
2. **Milestone 2, Map features:** steps 3–7.
3. **Milestone 3, Table:** steps 8–10.
4. **Then:** dark mode (11), uploads for layers and tables (12), more table sources (13), Chart (14), Notebook `.ipynb` (15), Input (16, stretch).
5. **Not sequenced yet:** templates, reports, agent board summary.

One PR per step.

## 6. Definition of done

- Writes are ops with zod schemas. New types have `summarize`.
- The agent can do it through tools, and the MCP manifest picks it up with no companion change.
- Focusable widgets keep their WebGL or heavy view mounted when the runtime switches between main and draft.
- `npm test` and `npm run typecheck` pass. A browser check from two browsers, or two origins.
- New CSS uses `--ttx-*` tokens.
- PRs that add a dependency record bundle size and load time. New dependencies need human approval, except those already approved in the task doc.
- `AGENTS.md` is updated when a change adds a shared workflow rule.

## 7. Open decisions

- **Uploads on R2:** bucket names, file size and count limits, cleanup for deleted branch previews.
- **Live-map cap:** how many live maps at once.
- **Legend visibility:** focus only, always, toggle, or by zoom.
- **Reports:** a widget, a mode, or both; how report blocks stay in sync with canvas widgets.
- **Templates:** the schema, and which templates follow SitRep.
- **Collaboration scope:** comments, mentions and an avatar list are not in `features.md`. In or out?
- **Design-spec proposals:** frame context, explicit links between widgets, version history and the docked accordion options panel are design proposals, not code. Ticket them before building.

## 8. References

- `AGENTS.md`: architecture, conventions, setup, deploys.
- `agent-docs/features.md`: agreed scope.
- `agent-docs/architect.md`: focus widgets extend the current widget; data in DuckDB-wasm; uploads on Cloudflare.
- `agent-docs/tasks/in-focus-widgets.md`: focus mode design, widget fields and ops, steps 1–16, decisions.
- `plans/plan-007.md` ops, `plan-008.md` board agent, `plan-009.md` bring your own key, `plan-010.md` MCP, `plan-011.md` who is who.
- Figma "Atlantis Pod Week Hack - AHD TTX": source of truth for chrome; wireframes for every feature.
