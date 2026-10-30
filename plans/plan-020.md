# Plan 020: code cells on JupyterHub


## Context

The board can show data only through ops and tools that we wrote (layers, footprints, openEO). Some requests have no op, for example "put a 10 km buffer around Kathmandu on a map" or "find Sentinel-2 scenes over this area with a STAC query". We want the agent, and people, to write a short Python snippet for such a request. The snippet runs on a JupyterHub, the result goes on the canvas, and the code that made the result stays visible, editable and re-runnable.

Decisions from the user:
- The agent can run code without approval. Guards: a time limit, output size caps, runs per hour per room, and the hub's own resource limits.
- **Each person runs code as themselves**, on their own hub login. The hub token stays in that person's browser, as "My key" does (plan-009). Execution therefore happens in a browser, as in MyST/thebe: kernel REST and WebSocket go from the tab to the person's single-user server.
- In-place editing uses CodeMirror 6, a new dependency (approved). It loads lazily.

The result is board state, not execution state. **Any person can see outputs, and read and edit code. Only a person with a hub login can run code.**

## Core idea: one `code` object, typed output, followers

```
  code cell (root)                      followers (optional projections)
  ┌────────────────────────┐   link     ┌──────────────┐
  │ title, source (python) │──────────▶ │ map layer     │ geo.features
  │ output: kind + ref     │──────────▶ │ input (AOI)   │ geo.features → area
  │ run: ok | error, log   │──────────▶ │ image         │ image.png
  └────────────────────────┘──────────▶ │ text / sticky │ text, number
```

- The **cell always shows its own output**. Every kind (text, number, table, JSON, image, geometry preview) therefore has a home, and followers are optional. This is how the workflow is generalized beyond maps.
- **Output kinds** reuse the tool output vocabulary: `geo.features`, `geo.raster` (a COG URL), `image.png`, `table`, `text`, `json`.
- **Followers declare the kind they accept.** A follower renders only when the cell's output kind matches its kind.

## Data model (`packages/plugins/src/code.ts`, new `code` plugin)

`code` object type (layer `top`, default size about 420×300):
- `title: string`, `language: 'python'`, `source: string`
- `output?`: `{ kind, uploadId?, value?, summary, at, by, sourceHash }`. This is the **last good output**. A failed run does not change it.
  - `geo.features` and `image.png` go to R2 through the existing `POST /uploads` and are stored by `uploadId`. GeoJSON and PNG are already in `UPLOAD_TYPES`, so the gallery, `GET /uploads/<id>` and `data.uploadFeatures` work unchanged.
  - `text`, `number`, `json` and `table` (columns + rows) are stored inline in `value`, with a 64 KB cap. A larger output is truncated and flagged.
  - `summary` is a short text for `summarize` and for the agent: the feature count and bbox, the columns and row count, or the first 200 characters.
- `run?`: `{ status: 'ok' | 'error', at, by, ms, sourceHash, stdout? (capped 8 KB), error?: { ename, evalue, traceback } }`. This is the **latest attempt**.
- Optional `stale` is not stored. The UI derives it (see "When the code changes").

Map layers get one new optional field in `mapLayer` (`mapLayers.ts`): `from?: string`, the id of the code cell that made the layer. A map can hold many code layers and still keep its own object `link` (from an event, through a template), so map provenance is per layer. Example: `{ id, tool: 'data.uploadFeatures', input: { fileId }, title, from: cellId }`.

Other followers (`image`, `text`, `sticky`, `input`) use the existing object `link` (plan-013). This requires these changes:
- Add `'code'` to `ROOT_TYPES` (`links/roots.ts`), and a `factsOf` branch: `{ name: title, area: bbox of a geo output, code: output }`.
- Add new recipes in `links/recipes.ts`: `codeArea` (input), `codeImage` (image `imageId`), `codeText` (text and sticky). A recipe writes `link.args.renderedAt = output.at`.
- **A code recipe returns no change when the kind does not match.** It does not blank the follower. This is different from event recipes. The follower keeps the last good result, and the UI marks it stale (see below).

## Ops (all in the `code` plugin, so palette, agent and MCP list them)

| op | what it does |
|---|---|
| `code.add` `{ title, source, showOn?: objectId }` | Adds a cell. With `source`, it runs the code first (async `prepare`). With `showOn`, it also adds the follower: a layer on a map, a link on another object. |
| `code.setSource` `{ source }` | `gesture: true`, as sticky typing is. It does not run the code. |
| `code.run` | Async `prepare` executes the code through the tool `code.execute`. `apply` writes `run`. If the run is ok, it also writes `output`, updates the layers whose `from` is the cell (`fileId`) and runs `applyLinks`. Everything is in one transaction, so one ⌘Z takes back the run and its effects on the followers. |
| `code.show` `{ on: objectId }` | Adds a follower for an existing cell. It fails if the kinds do not match ("map needs geo.features; the cell returns a table"). |

Error policy, which depends on the actor:
- **Agent actor:** an execution error, a timeout or a kind mismatch with `showOn` **throws in `prepare`**. Nothing is written. The agent gets the error and the last 30 traceback lines (at most 2 KB) through `OpCall.error`, then fixes the code and calls again. It has 12 model calls per turn.
- **User actor:** the error is recorded on the cell (`run.status = 'error'`). Followers do not change.

## Execution: browser-side Jupyter client (`apps/web/src/code/`)

- `hub.ts`: the person's hub URL and token in localStorage, as `agent/keys.ts` stores them, and never sent to the Worker, the doc, chat or presence. Phase 1: the person pastes a token from the hub's `/hub/token` page. Phase 2: JupyterHub OAuth (register TTX as a hub OAuth client and use PKCE). The client starts the server if it is not running (`POST /hub/api/users/{name}/server`, then poll progress), and shows the status in the user menu ("JupyterHub: connected as …").
- `kernel.ts`: our own minimal client for the Jupyter messaging protocol, about 200 lines. **No `@jupyterlab/services`**, which is large. It does these steps:
  1. Start one kernel per person per board (`POST /api/kernels`).
  2. Open the WebSocket at `/api/kernels/<id>/channels`.
  3. Send `execute_request` and collect `stream`, `display_data`, `execute_result` and `error` until `execute_reply` and status `idle`.
  4. On timeout (60 s), `POST …/interrupt`.
- **Preamble** (`ttx.py`, sent once per kernel):
  - `ttx.show(obj, kind=None)` sends `display_data` with MIME `application/vnd.ttx.output+json`.
  - It converts shapely geometries, GeoDataFrames and GeoJSON dicts to `geo.features` (reprojected to EPSG:4326), DataFrames to `table`, matplotlib figures to `image.png`, and str and numbers to `text` and `number`.
  - Without `ttx.show`, the cell's last expression is the output.
  - Each run executes in a **fresh namespace** (`ttx._run(src)`). The kernel stays warm, so imports are fast, but a re-run does not depend on other cells. This keeps the code reproducible.
- `execute.ts`: the browser tool `code.execute` (`defineTool`, `cache: false`, output `code.result`). It returns `{ ok, output?, error?, stdout, ms }` and does not write the board. Before it returns, it uploads geo and PNG outputs. The op's `prepare` calls it through `ctx.tools`. A small in-tab memo by `sourceHash` (5 min) lets the agent run a scratch test and then call `code.add` without a second execution.
- Guards: at most 60 s per run, 50 MB per upload (`MAX_UPLOAD_BYTES`), and 64 KB per inline value. The hub's server limits (CPU, memory, idle culling) do the rest. Document the hub config: `c.Spawner.args` CORS `allow_origin` for the board origin, and hub `tornado_settings` headers.
- **The hub must allow CORS from the board's origin.** This is the same constraint as for URL layers.

## Who can run code: the agent paths

- **Browser agent ("My key") and MCP:** they run their tools in the tab, so `code.execute` and the ops work natively when the tab has a hub login.
- **Room agent (Durable Object):** it has no hub token. Add a **tab relay**: the DO sends the tool call to the asker's socket in a custom y-websocket message type, the tab runs it in its `ToolRunner` (only for tools that are marked `relay: true`), and the tab sends the answer back. The timeout is the run limit + 10 s.
  - The DO offers `code__execute` and the `code.*` ops only when the asker's presence says `hub: true`.
  - With no tab or a closed tab, the tool fails: "Run this from a tab signed in to JupyterHub."
  - The relay is generic. Later it can also give the room agent `routing.route` and `exposure.buildings`, which it cannot see today.
- **Skill** `packages/plugins/src/skills/run-code.md` (requires `code__execute`). It says:
  - Use an op first if one exists. Use code only for what ops cannot do.
  - Describe the `ttx.show` API and the output kinds.
  - Buffer in metres, not degrees: `gdf.to_crs(gdf.estimate_utm_crs()).buffer(10_000).to_crs(4326)`.
  - For STAC, use `pystac-client` and return a GeoDataFrame of item footprints or a table.
  - Test with `code__execute`, then call `code.add` with `showOn`.
  - Keep code short and self-contained, with no hidden state.

Example (Kathmandu): the agent calls `data__geocode` and gets the point. It writes the snippet and tests it with `code__execute`, which returns `geo.features` with 1 polygon. Then it calls `code.add { title: 'Kathmandu 10 km buffer', source, showOn: <map> }`. The cell appears beside the map, the map gets the layer with `from = cell`, and the link arrow is drawn.

## UI

**Code cell widget** (`apps/web/src/code/CodeObject.tsx`, registered with `registerObjectUI`, tool key `C`):
- Header: title, language chip, a Run button (disabled with a tooltip "Sign in to JupyterHub to run" when there is no login), and a status (ran 2 min ago by Agent, 1.2 s).
- Body: the code (read-only highlighted on the canvas; CodeMirror when edited or in focus) above the output, which is rendered by kind: a table grid, text, an image, a geometry preview (a small static SVG of the features with the feature count and bbox), or collapsed JSON.
- Error state: a red strip with `ename: evalue`, an expandable traceback, stdout, and **"Ask agent to fix"**, which posts to the chat with the cell selected ("Fix the error in this code").
- Running state: a local busy overlay (`useReportLoading`), and presence `activity: 'Running <title>'` so that others see who runs it.
- In focus (F): a large editor, the full output and the run history. The run history is not a new field; it comes from the op log.

**Provenance footnote on followers** (`apps/web/src/code/Provenance.tsx`):
- Objects with a `link` to a code cell show a footnote under their frame: "‹/› Generated by code · Kathmandu 10 km buffer · 2 min ago". Click to expand it:
  - The snippet, read-only with highlighting.
  - **Edit**, which opens CodeMirror in place. It edits the **cell's** `source` through `code.setSource`, so it is the same text as in the cell.
  - **Run**, then **Go to cell** and **Unlink** (`link.remove`).
- Map layers: in the layer list, a layer with `from` gets the same "‹/›" badge and expander, and the map's credits get "Generated by code".
- Reports later: frozen items keep the source as a caption.

**Link arrows** already draw root to follower (`canvas/Links.tsx`). Extend them to code roots, and draw a dotted arrow from a cell to each map that has a layer with `from`.

## When the code changes: errors and kind changes

The UI derives `stale` for each follower. It compares what the follower shows (the layer's `fileId`, or `link.args.renderedAt`) with `cell.output`:

| situation | cell | follower | footnote says / offers |
|---|---|---|---|
| Run ok, same kind | new output | updated in the same transaction | — |
| Run failed | shows error, keeps last good output | unchanged | "Latest run failed. Showing the result from 10:42." · Go to cell · Ask agent to fix |
| Run ok, **kind changed** (now a table, not geometry) | shows the table | **unchanged, marked stale** (layer greyed in the list) | "The code now returns a table, not features. Showing the earlier result." · Undo edit (⌘Z) · Unlink · Remove layer |
| Source edited, not run | "edited, not run" chip | unchanged | "Code changed since this was made." · Run |
| Cell deleted | — | keeps its data | Footnote reads "Generated by code (deleted)". The layer keeps `fileId`, and the upload stays in R2. |

The run is never refused for a kind change: the person may want the new kind. The follower is never silently blanked either. The agent's `code.run` and `code.add` get the mismatch in `OpCall.summary`, so they can tell the asker.

## Phases

1. **Run code by hand.** Hub login (pasted token), kernel client, preamble, the `code` plugin (type and ops without followers), the cell widget with CodeMirror (lazy), and outputs of every kind. Tests: the preamble's MIME-to-kind conversion and the ops' error policy, in Node.
2. **Followers.** Layer `from`, the code recipes, the `code.show` op, the provenance footnote with edit in place, stale states and link arrows.
3. **Agent.** The skill and `code__execute` for BYOK and MCP, then the room-agent tab relay.
4. **Later, not planned now:** hub OAuth; cell `inputs` from board objects (for example the map's area as `aoi`); long jobs over 60 s (queued and done by a hub-side service, as openEO does); export a cell as `.ipynb` or a Notebook Factory template.

Step 0 of implementation: copy this plan into `plans/plan-020.md` and add a line about it to `AGENTS.md`.

## Critical files

- New: `packages/plugins/src/code.ts` (plugin, type, ops), `packages/plugins/src/codeOutput.ts` (kinds, caps, `summary`), `packages/plugins/src/skills/run-code.md`, `apps/web/src/code/{hub,kernel,execute,ttx.py,CodeObject,Provenance,ui}.tsx|ts`.
- Changed:
  - `packages/plugins/src/mapLayers.ts` (`from?`)
  - `packages/plugins/src/links/{roots,recipes}.ts`
  - `packages/plugins/src/index.ts` and `plugins.ts` (list the plugin)
  - `apps/web/src/plugins.ts`
  - `apps/web/src/tools/registry.ts` (`code.execute`)
  - `apps/web/src/map/` layer list (badge, stale)
  - `apps/web/src/canvas/Links.tsx`
  - `apps/web/src/board/presence.ts` (`hub`)
  - `apps/worker/src/worker.ts` (relay, phase 3)
  - `skills/index.ts`
- Reuse: `POST /uploads` and `data.uploadFeatures` (`apps/web/src/data/fromUrl.ts`), `planLinks` and `applyLinks` (`links/propagate.ts`), the async `prepare` pattern (`event.setEvent`, `map.addForecast`), the key storage of `agent/keys.ts`, `useReportLoading` (`canvas/loading.ts`), and the agent `callOp` placement (`agent/call.ts`).

## Verification

- `npm test`:
  - Kernel client against a fake WebSocket server that replays recorded Jupyter messages (ok, error, stream, display_data, timeout).
  - Output conversion and caps.
  - `code.run` writes `output` and updates the `from` layers and linked followers in one transaction, and one undo reverts all of them.
  - An agent actor's failing run throws and writes nothing. A user actor's failing run records the error.
  - A kind mismatch leaves followers unchanged.
  - The stale derivation table.
- `npm run typecheck`, `npm run build`.
- Manual: a local JupyterHub run with `uvx` (the user's setup: DummyAuthenticator, SimpleLocalProcessSpawner, `geopandas`, `pystac-client`, CORS for `localhost:5173`). Document the config in `plans/plan-020.md`.
  1. Paste a token and run a cell by hand.
  2. Ask the BYOK agent "put a 10 km buffer around Kathmandu on a map", and check the layer, the footnote and the arrow.
  3. Edit the buffer to 20 km in the footnote and run. The map updates.
  4. Change the code to return a DataFrame. The cell shows the table, and the map is marked stale.
  5. Break the code. The cell shows the error, and "Ask agent to fix" repairs it.
  6. A second browser with no hub login sees everything, and Run is disabled.
  7. Phase 3: the same flow through the room agent with the asker's tab open, then with it closed (clear error).

## Status (2026-10-30)

Built and tested against a local JupyterHub 5 (uvx, DummyAuthenticator, SimpleLocalProcessSpawner) in Chrome:

- Phase 1: the hub login, the kernel client, the preamble, the `code` plugin and the cell widget, with every output kind.
- Phase 2: map layers with `from`, the `code.<type>` link recipes, `code.show`, the footnote with edit in place, the stale states, the arrows.
- Phase 3, part: the `run-code` skill and `code.execute` for the browser agent and MCP. `OpDef.tools` keeps the code ops away from agents that cannot run code.

Not built yet: the room agent's tab relay (phase 3), and phase 4.

Changes from the plan:

- A cell on the canvas shows its code as plain text. CodeMirror (with highlighting) loads only to edit.
- The person's presence does not say "Running <title>" yet: a run shows as busy only in the runner's tab.

## Hub setup

A local hub for tests: `extras/jupyterhub/` (configuration and how to start it).

The hub must allow CORS from the board's origin:

```python
c.JupyterHub.tornado_settings = {'headers': {'Access-Control-Allow-Origin': 'https://<board origin>', 'Access-Control-Allow-Headers': 'Authorization, Content-Type'}}
c.Spawner.args = ['--ServerApp.allow_origin=https://<board origin>']
```

The kernel's WebSocket carries the token in its URL, since a browser cannot set headers on a WebSocket. JupyterHub 5+ takes it only with `Sec-Fetch-Mode: websocket`, and browsers send that header only to secure hosts. A plain-HTTP hub (local tests) needs `c.Spawner.environment = {'JUPYTERHUB_ALLOW_TOKEN_IN_URL': '1'}`, or the socket is refused with 403. An HTTPS hub should not need it; this is not tested yet.

The single-user image needs `geopandas`, `shapely`, `pandas` and `pystac-client` for the skill's examples, and `matplotlib` for images.
