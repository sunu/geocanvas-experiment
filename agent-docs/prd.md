# humanitarian-ttx — PRD and feature list

Oct 30, 2026 · @Lane

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
- **Who is who** (plan-011). You are cyan, each other person gets a color no one else on the board has, the agent is violet and dashed. Color is never the only signal.
- **Per-person map views.** Nobody's pan moves another person's map. Share in focus moves everyone's view on purpose.
- **No access control yet.** Anyone with a link can edit. Keep real exercise data off previews.

## 3. Status key

**Built** is in `main`. **In review (#N)** is an open pull request, not in `main`. **Experiment** is in `main` but not yet a committed feature. **Planned (step N)** follows the step numbers in `agent-docs/tasks/in-focus-widgets.md`. **Next** is the work being started now. **To do** is agreed work with no step yet, smaller than a feature. **Needs refinement** is built and usable, but its flow or details need more work. **Not sequenced** is agreed scope with no step yet. **Stretch** is optional. **Out** is not in current scope.

## 4. Features

### 4.1 Board and canvas

| Feature | Status | Notes |
| --- | --- | --- |
| Own infinite canvas: pan, zoom, select, layer order | Built | vsticky-style DOM world layer. Camera is local, never synced. |
| Rooms by link, New board | Built | `#room=<id>` |
| Landing page: boards this browser opened, New board dialog, board title | Built | Per browser until accounts exist. `agent-docs/tasks/board-templates.md`. |
| Real-time sync | Built | Yjs over y-websocket to one Durable Object per room, Hibernation API. |
| Presence: cursors, selections, names, colors, avatars | Built | Each person has a color of their own on the board (PR #100); the others show as avatars in the user menu. Cursors use the Figma pointer. |
| Command palette (⌘K) with forms from op schemas | Built |  |
| Right-click menu, rename a widget by its name, frames | Built | Frames group objects; dragging a frame moves what is in it. |
| Cards from pasted links: GitHub issues and pull requests, IFRC GO emergencies | In review (#90) |  |
| Undo and redo of your own edits, one step per gesture | Built |  |
| Uploads to R2 and the uploads gallery | Built | Images up to 10 MB, PDFs up to 25 MB, map data (GeoJSON, GeoParquet, zipped shapefile) up to 50 MB. One bucket per Worker. Tabular uploads come with the Table (step 12). Deleting a branch does not delete its bucket yet. |
| Dark mode: system setting plus app toggle | Planned (step 11) | New CSS uses `--ttx-*` tokens only, so this step changes tokens and nothing else. |

### 4.2 Focus mode

| Feature | Status | Notes |
| --- | --- | --- |
| Enter with ⤢, `F` or palette; widget fills the app; Options panel beside it | Built | Map, Notebook, PDF and Report. Every new widget registers as focusable. |
| Private draft: edits in focus are not shared | Built | Local fork of the board doc (`ops/draft.ts`). Main-doc updates still flow in. A type can be live instead (no draft), as reports are. |
| Share button: merge the draft now, stay in focus | Built | One undo step per share. A map also shares your view. |
| Exit dialog: Share, Discard, Keep editing | Built | Only when there are unshared changes. |
| Focused object deleted by someone else | Built | Focus ends with a notice. |
| Full-screen view | Built | Decided: the focus button is the full-screen view. No browser Fullscreen API. |
| Live-map cap and snapshots when zoomed out | Built (step 7) | Each live map uses two WebGL contexts; browsers keep about 16. At most 4 maps are live; the others show a snapshot. |

### 4.3 Widgets

| Widget | Status | Focus | Next work |
| --- | --- | --- | --- |
| **Map** | Built | Yes | Steps 3–7 are built: location on add, layers from a URL, filters and styles, annotations (sticky notes and drawn shapes), snapshots and the live-map cap. What is left is under **Map to-dos** below. |
| **Event** (Montandon) | Built | No | Its footprint goes on maps as a layer per source. Related events near an event and impact tables are still on the `experiment` branch. An event timeline with injects is designed in #88. |
| **Notebook** | Built | Yes | Today: a published Notebook Factory run in a sandboxed iframe. Step 15: render any `.ipynb` from upload or URL, outputs included, never executed, sandboxed without scripts. Running code through JupyterHub is in review (#86); `features.md` says notebooks do not execute code, so that needs a scope decision (§7). |
| **Table** | Planned (steps 8–10, 13) | Yes | CSV, Parquet, XLSX into a compact table. Source: upload, URL or STAC. Columns, filters, sort. Scrolls 100,000 rows in focus. |
| **Chart** | Planned (step 14) | Yes | Types: bar, stacked bar, donut, line, stat, ranked list. Source, encoding, filters, markers, provenance. Observable Plot is approved. |
| **Input** (date or location) | Stretch (step 16) | — | Feeds a map's location or a chart's data fetch. |
| ReliefWeb feed | Built | No | Added beside an event with GLIDE numbers. |
| Country context, Who's where, Conflict (HDX HAPI) | Built | No | Province and district tables are not built. |
| Disaster history (EM-DAT, through Montandon) | Built | No | A country's disasters since 1900 (plan-020). Past disasters in an area (DesInventar) is a map layer. |
| **Report** | Built (steps 2–5 of 10) | Yes (live) | See 4.6. |
| openEO layer card | Built | No | An agent proposes a Sentinel-1/-2/-3 layer; a person approves it. |
| Image, PDF | Built | PDF yes | From drops and the uploads gallery. |
| Box, text, sticky note | Built | No |  |

**Map to-dos.** Built features that need work, and what is missing:

| To-do | Status | Notes |
| --- | --- | --- |
| Legend on the map | To do | Today each layer's colors are shown only in the layer list of the Options panel, so a map on the canvas has no key. Depends on the open decision on legend visibility (§7). |
| Organize the Options panel by category | To do | Issue #71: the side panel of the map and the other focusable widgets, grouped as in the Figma wireframe. |
| Adding data by upload | Built, needs refinement | Upload GeoJSON, GeoParquet or a zipped shapefile to a map (PR #70). Refine the flow. |
| Annotations | Built, needs refinement | Sticky notes and the drawing box (arrow, line, rectangle, circle, polygon, pen). Not built: labels on shapes, selecting a shape to move or delete it, stroke widths. |
| Scenario planning on the map | Built, needs refinement | Routes around road closures and affected areas (plan-014), exposure of buildings and facilities (plan-015), flood depth and damage from GloFAS (plan-016). Not built: the GloFAS spurious-depth mask, people exposed, counts by district, larger areas. |
| Weather forecast layers | Built | GFS rain and wind (`agent-docs/tasks/weather-forecast.md`). Not built: point forecasts, hover values, other models, refreshing to a newer run. |
| Time scrubber on maps | In review (#88) | With the design for the event timeline and injects. |

### 4.4 Data

| Feature | Status | Notes |
| --- | --- | --- |
| Montandon STAC search through the Worker proxy | Built | Staging API, as `features.md` scopes. Needs `MONTANDON_TOKEN`. |
| Analysis data tools: population, admin 0, buildings, health facilities, COD-AB boundaries and choropleths, geocoding, weather, flood depth, disaster history | Built | Read-only tools in a cached `ToolRunner`. |
| `DataSource` recipe: upload, URL, STAC | Planned (step 8) | Shared by Table, Chart and Map layers. |
| DuckDB-wasm `data.query` tool | Planned (step 8) | Web Worker on first use. SQL built by a pure, tested function with parameters, never pasted values. |
| XLSX | Planned (step 13) | SheetJS only if DuckDB-wasm can't read it. |

### 4.5 Agent

| Feature | Status | Notes |
| --- | --- | --- |
| Room agent in the Durable Object | Built | OpenRouter tool loop, 12 model calls per turn, 20 turns per room per hour. Undo per turn. Its adds are kept off what is already there. |
| Skills and deferred tools | Built | Domain rules load as skills when a request needs them; most tool schemas load on demand (plan-017). |
| The agent at work: its cursor, current step and busy widgets | Built | Drawn by each browser from the op log, at no model cost. |
| Ambient agent: a summary and next moves for a frame, outside the chat | In review (#63) |  |
| Evaluation: Nepal 2026 flash flood | In review (#20) |  |
| Bring your own key in the browser | Built | Key stays in localStorage and goes only to the provider. |
| Phone layout: Ask, the board as a list, widgets full screen, reports; installable (PWA) | Experiment (plan-018) | Same ops, widgets and focus drafts as the canvas. Not yet checked on real phones. Not in `features.md` scope ("no small screens"): keep it apart from desktop work. |
| External agents through the MCP companion | Built | Local only. Tools are the tab's ops and read-only tools. Plan-010 steps 4–5 (handoff to an external runner, waking it on inactivity) are not started. |
| Add, remove and edit every widget | Ongoing rule | Holds as long as every change is an op. Check it for each new widget. |
| Summarize the board into a report | Next (with reports) | `summarizeBoard` exists for prompts. Step 10 of `agent-docs/tasks/reports.md`. |
| LLM behavior | Rule | Follow the LLM parts of `agents.md` on the `experiment` branch only. |

### 4.6 Templates and reports

| Feature | Status | Notes |
| --- | --- | --- |
| Start a board from an event | Built | New board → Situation report with the event (`agent-docs/tasks/board-templates.md`). Picking an event on an event card also adds its ReliefWeb feed. Related events in its geography are not built. |
| Templates that prepopulate widgets (SitRep first) | Built (plan-012, plan-013) | Situation report (seed: an event) and conflict explorer (seed: an area). Each template is an op, `template.<id>`; the New board dialog, the Templates button, ⌘K and the agent run it. Every seed is optional: one left out gives an empty root and blank widgets. Its objects follow the seed's root (the event card, an area input) and sit in a frame: change the root and they update. Next: a historical hazard explorer, now that disaster history is built (plan-020). |
| Create and export reports | Next (steps 2 to 6 of 10 built, and print) | Built: a report widget on the canvas and report mode (live, full screen, the chat as an overlay): two columns, A4 or Letter, headings, rich text (Tiptap, with a formatting toolbar and pasted markdown formatted), images, dividers, page breaks, text that goes on over pages, items added from the board (menus, drops, the toolbar), drag to reorder, every block in the Options panel; print and save as PDF through the browser's dialog, with maps at print resolution. To do: live and frozen renderers for maps and data widgets (7; plan-019 may replace it with synced and detached items), a PDF download with no dialog (8, option 2: Workers paid plan), the report URL (9), the agent drafting a report (10). Spec: `agent-docs/tasks/reports.md`. |

### 4.7 Non-functional requirements

| Requirement | How it's held |
| --- | --- |
| Canvas never below 30 FPS | Hide other objects in focus; snapshots and the live-map cap (step 7, built). Log FPS in PRs that touch rendering. |
| Desktop first | The phone layout is an experiment (plan-018); desktop work does not wait on it. |
| Dark mode | Step 11. |
| Cost-safe multiplayer | Hibernation API; cursor updates capped at 10 per second. |

## 5. Build order

1. **Milestone 1, Map in focus:** done.
2. **Milestone 2, Map features:** steps 3–7 done, and scenario planning, weather and flood layers beyond them. The map to-dos (4.3) remain: legend on the map, Options panel organization (#71), and refining uploads, annotations and scenario planning.
3. **Now: reports** (4.6): steps 2–6 are done (rich text with a formatting toolbar and pasted markdown), and print and save as PDF. Next the agent's report draft (10, unblocked), live and frozen items (7, after a decision on plan-019), a PDF download with no dialog (8, a cost decision) and the report URL (9).
4. **Open pull requests to review:** cards from links (#90), the map time scrubber and event timeline design (#88), JupyterHub execution (#86), the ambient agent (#63), the Nepal evaluation (#20).
5. **Milestone 3, Table:** steps 8–10.
6. **Then:** dark mode (11), uploads for tables (12; uploads for map layers are built), more table sources (13), Chart (14), Notebook `.ipynb` (15), Input (16, stretch).
7. **Not sequenced yet:** more templates (plan-012), starting with the historical hazard explorer.

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

- **Uploads on R2:** a bucket per Worker and size limits by kind are built. Still open: a limit on the number of files per board, and deleting a branch's bucket with its Worker.
- **Live-map cap:** 4 live maps at once is built (`LIVE_MAPS`); confirm on lower-end machines.
- **Legend visibility:** focus only, always, toggle, or by zoom.
- **Reports:** decided: both a widget and a mode, with live or frozen items. Still open: the PDF approach (a spike decides), rich text storage, the report URL's expiry and permissions, and the others in `agent-docs/tasks/reports.md` §10. Under discussion: `plans/plan-019.md` proposes synced and detached items in place of live and frozen.
- **Templates:** which templates follow the situation report and conflict explorer, and when templates become data that facilitators can edit (plan-012).
- **Collaboration scope:** comments and mentions are not in `features.md`. In or out? (The avatar list is built.)
- **Notebook execution:** `features.md` says notebooks do not execute code; #86 runs code through JupyterHub. Decide before merging.
- **Phone layout:** keep the plan-018 experiment, and if so whether it becomes a supported layout.
- **Design-spec proposals:** frame context, version history and the docked accordion options panel are design proposals, not code. Ticket them before building. Frames and links between widgets are built for templates (plan-013); links that people draw by hand are not.

## 8. References

- `AGENTS.md`: architecture, conventions, setup, deploys.
- `agent-docs/features.md`: agreed scope.
- `agent-docs/architect.md`: focus widgets extend the current widget; data in DuckDB-wasm; uploads on Cloudflare.
- `agent-docs/tasks/in-focus-widgets.md`: focus mode design, widget fields and ops, steps 1–16, decisions.
- `agent-docs/tasks/reports.md`: reports: the widget, report mode, live and frozen items, PDF export options, the report URL, steps 1–10.
- `agent-docs/tasks/board-templates.md`: landing page and New board. `agent-docs/tasks/weather-forecast.md`: forecast layers.
- `plans/plan-007.md` ops, `plan-008.md` board agent, `plan-009.md` bring your own key, `plan-010.md` MCP, `plan-011.md` who is who, `plan-012.md` templates, `plan-013.md` links and frames, `plan-014.md` scenario routing, `plan-015.md` flood exposure, `plan-016.md` flood depth and damage, `plan-017.md` agent skills, `plan-018.md` phone layout (experiment), `plan-019.md` synced and detached report items (proposal), `plan-020.md` disaster history.
- Figma "Atlantis Pod Week Hack - AHD TTX": source of truth for chrome; wireframes for every feature.
