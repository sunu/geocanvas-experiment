# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository. Humans are welcome to read it too.

## Project overview

**humanitarian-ttx** is a Humanitarian Table Top Exercise (TTX) for data exploration and response, built by Development Seed. The project is based on IFRC's Montandon project for data https://montandondata.org/. It's multiplayer canvas where users work on different aspects to developing a situation report after an event. It inludes finding related past events, current datasets, map visualizations, analysis ingests, etc.

At a high-level:
1. Users can start a new board and select an event from Montandon. This will do initial board setup. Showing the event data, map, and related events in that geography.
2. There are widgets for data selectors, map, charts, sticky notes, on our own infinite canvas.
3. There are agents running entirely in the browser to do specific actions. Create new components, run analysis etc.
4. Data comes from Montandon via Duckdb. Additional data like OSM, Overture (buildings/infra) comes as geoparquet too.
5. There's a way to ingest analysis run from Jupyternotebooks from a different project called Notebook Factory
6. There are programmable actions and flow control in the advanced mode
7. It is possible to create reports and export them


## Shared working agreement

This file is the source of truth for repository-wide agent guidance. `CLAUDE.md` imports it; keep shared rules here.

- Contributors may use different editors, agents, and development methods. Agree on behavior, scope, and verification; leave personal workflow choices to the contributor unless the task specifies one.
- Follow repository configuration and documented decisions, then the conventions in the code being changed. Keep personal preferences out of unrelated code and shared tooling.
- Read `README.md` for setup and layout, and package scripts for available checks. Consult relevant plans and decisions for the task; distinguish planned work from implemented behavior.
- Update this file when a change introduces a shared workflow requirement that cannot be discovered from configuration. Keep machine-specific setup and personal agent instructions out of it.

## Repository layout

npm workspaces monorepo (TypeScript, ESM). Design docs go in `plans/`.

```
apps/
  web/           React app (Vite): our own infinite canvas
    src/board/     the shared board (Yjs) and the connection to the Worker
    src/canvas/    camera, input, selection, toolbar, side panel
    src/objects/   object types: one definition per type (box, text, map, event) and the registry that lists them
    src/map/       the map widget, its place search and data layers
    src/events/    the event widget: search Montandon, show one event across its sources
    src/tools/     the tool registry: typed, read-only capabilities that widgets (and later agents) run
    src/data/      data tools and their sources (geocoding, population, countries, buildings, health facilities)
  worker/        Cloudflare Worker: serves the built web app; one Durable Object per room relays and stores the board;
                 /monty/search and /tools/geocode proxy Montandon and OpenCage with their keys
```

- **Our own canvas, no tldraw.** tldraw needs a paid license off localhost, and the canvas we need is small. The design follows vsticky: a DOM "world" layer moved by one CSS transform. The camera is local to each person and never synced.
- **The board is a Yjs doc** (`board/board.ts`): one map of objects, each a Y.Map of plain fields. Each object type declares its fields and behaviour in `objects/` (see "Adding an object type"). Layer order is a float `z` per object, ties broken by id; each type says whether new ones go on top (texts, events) or to the bottom (boxes, maps: mostly backgrounds). Undo and redo cover only your own edits, one step per gesture (`undo.stopCapturing()` when a gesture starts). Text is stored as plain strings, with no encryption.
- **Multiplayer runs on our own Cloudflare Worker.** `/connect/<room>` goes to that room's Durable Object, which speaks the standard y-websocket protocol, keeps the doc in memory and appends every update to its SQLite (compacted on load when there are many). Cloudflare caps a SQLite row at 2 MB, so larger updates are split across rows (`apps/worker/src/updateLog.ts`). Websockets use Cloudflare's Hibernation API (`ctx.acceptWebSocket`): the room leaves memory between messages, so open but idle tabs cost no Durable Object time. With `socket.accept()` a room is billed for as long as any tab is connected, which used up the free plan's daily allowance (13,000 GB-s, reset at 00:00 UTC) and took every board offline. Presence (awareness) is kept in memory only: it starts empty after a wake and browsers re-send theirs every 15 s; which presence ids a socket controls is kept on the socket (`serializeAttachment`). Presence carries each person's name and color (random, kept in localStorage), cursor in world coordinates and selected ids (`board/presence.ts`); `canvas/Peers.tsx` draws others' cursors and selection outlines. Cursor updates are capped at 10 per second, since each one wakes the room. The browser uses y-websocket's `WebsocketProvider`. Tabs of one browser also sync with each other directly (BroadcastChannel), so test multiplayer from two origins or two browsers, or the server is not involved.
- **Input:** drag on empty canvas to select; shift+drag selects from anywhere, even over a map or box, and adds to the selection; shift+click toggles one object; scroll pans; pinch or ⌘+scroll zooms; space+drag pans. Tools: V select, R box, T text, M map, E event. `]` / `[` bring to front / send to back, with ⌘ one step. Delete removes. Double-click edits a text, lets a map take the pointer, or opens an event's search; Esc gives it back. The left panel sets the color of selected boxes and texts, and A+ / A− the text size (`canvas/style.ts`: colors are stored by name). A text's height follows its content; only the person who changed it refits it.
- **Icons:** Phosphor (`@phosphor-icons/react`, regular weight, imported as `<Name>Icon`; only imported icons are bundled). Icon-only buttons carry a `title` and an `aria-label`. For hazard and humanitarian-sector symbols, which Phosphor lacks (earthquake, volcano, displacement, clusters), consider the OCHA Humanitarian Icons; check their license first.
- **Map widget** (`apps/web/src/map/`): a live MapLibre map in a box. The basemap is shared board state. **Map views are per person:** the camera of a map is not in the board; each person's view is kept in their browser (`localView.ts`), so nobody's map moves under them. "Go to place" in the header geocodes (`data.geocode`) and moves only your own view; its pin also marks the place for everyone, as a data layer.
- **Tools** (`apps/web/src/tools/`, design in `plans/plan-006.md` on `feat/tools-registry`): a tool is a typed, read-only, async capability (`defineTool`: zod input, an `output` kind such as `geo.features`, `run`). Tools never write the board. All tools are listed in `tools/registry.ts` and run through one `ToolRunner`, which validates the input, caches results per browser by (id, parsed input) in an LRU, shares concurrent calls, and does not keep failures. Why the cache: every person's map runs its layers' tools, and services are slow or rate limited (OpenCage's free tier: 1 request/s). A tool can call another through `ctx.tool`.
- **Map data layers** (`map/layers.ts`): a map's `layers` (an optional field declared in `objects/map.tsx`) holds recipes (`{ id, tool, input, title }`), not data; each browser runs the tool and draws the result in the deck.gl overlay, chosen by the tool's `output`: `geo.features` as a `GeoJsonLayer`, `geo.raster` (a COG url, value range and color ramp) with deck.gl-geotiff's `COGLayer` (`map/raster.ts`), below features. One failing layer does not stop the others; the layer list shows errors and a result's `attribution`. A tool that works on an area (`data/area.ts`: a bbox) gets the area at add time, from the adder's view, so everyone sees the same data although views are per person; the layer list's crosshair resets it to your view, for everyone. The map header's "Add layer" menu lists these layers (`AREA_LAYERS`). `layers` is replaced as a whole, so two people adding a layer at the same moment keep only one.
- **Population** (`data/population.ts`): `data.population` reverse geocodes the area's center (rounded to 0.1°, so nearby areas reuse the cached answer) to find the country, then uses that country's WorldPop 2020 COG on Source Cooperative (public, CORS open, read by range request; never downloaded whole). An area across a border shows one country. `map/raster.ts` uploads each tile as a float texture and colors it in one shader step: nodata and values at or below the range minimum are not drawn, and the ramp uses the square root of the value so sparse areas stay visible. `vite build` needs `worker: { format: 'es' }` for the library's decoding worker.
- **Countries and buildings** read GeoParquet in the browser with hyparquet, each in its own Web Worker (`data/*.worker.ts`, started on the first query, so the main bundle does not grow). Pure helpers (`wkb.ts`, with the shared row-group selection, `worldBank.ts`, `overture.ts`, `layercake.ts`) are tested in Node; the workers only fetch and call them.
  - `data.adminBoundaries` (`data/boundaries.ts`): World Bank admin 0 on Source Cooperative (CC BY 4.0). The geometry column is one ~51 MB page, so the first query in a browser downloads it once (about 10 s) and keeps it in the Cache API; later page loads read ~0.5 MB and decode for about 4 s. Countries are matched by the bbox of each polygon part, so large neighbours appear. Admin 0 only.
  - `data.overture` (`data/buildings.ts`): Overture buildings, found through the Overture STAC catalog, reading only the row groups whose `bbox` statistics match (a Beira district: ~18 MB, ~7 s). The area must be at most 0.01 deg² (about 11 × 11 km), checked before any download; at most 100,000 buildings, then `truncated` and the layer list says so. ODbL attribution.
  - `data.healthFacilities` (`data/health.ts`): OpenStreetMap health facilities (`healthcare=*`, or `amenity` hospital, clinic, doctors, dentist, pharmacy) from Layercake's `pois` layer (OpenStreetMap US; one 4.7 GB planet file, spatially sorted, `bbox` statistics per row group, no page index). It reads only the small columns of the row groups that match, never `geometry` (~11 MB per row group), and puts each facility at the center of its `bbox`. Mozambique: 7 row groups, ~16 MB, ~7 s, 3,404 facilities; Beira: 1 row group, ~2 MB. More than 12 row groups fails before any download (a country works, a continent does not). The footer (~5 MB) is read once per page. Layercake answers `OPTIONS` with 403, so reads must be plain single-range GETs (CORS-safelisted, no preflight). ODbL attribution.
- **MapLibre 6.** It draws right-to-left labels (Arabic, Hebrew) itself, with no RTL plugin. It is ES modules only, and under Vite its worker must be imported as `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and passed to `setWorkerUrl` (a plain `?url` import draws nothing in dev).
- **deck.gl runs in overlay mode** (`MapboxOverlay({ interleaved: false })`): deck.gl 9.4's interleaved mode throws on every frame with MapLibre 6. Overlay costs a second WebGL context per map, and deck.gl layers draw above the map's labels. deck.gl's canvas sits in MapLibre's top-left control container (z-index 2), so `.ttx-map__gl` isolates MapLibre's stacking; without it, data layers paint over the map's hint and layer list. Revisit interleaved mode when deck.gl supports MapLibre 6.
- **Event widget** (`apps/web/src/events/`): a disaster event from the Montandon STAC API. The board stores only `eventId`; each browser fetches the details (`monty.ts`, one shared client with a cache). Search text is read as country, hazard type, year and source (`search.ts`), turned into a CQL2 filter, and the leftover words rank by name. Hazard types use the UNDRR-ISC 2025 codes with their GLIDE and EM-DAT equivalents (`hazards.ts`; add a type only with its rows from the upstream table). Sources record one event under different `monty:corr_id`s, so an event's other sources are found by hazard, country and time, as upstream's correlation algorithm does.
- **Montandon needs a bearer token, which never reaches the browser.** The browser posts STAC search bodies to `/monty/search`; the Worker adds `MONTANDON_TOKEN` and forwards them to `MONTANDON_BASE_URL` (`apps/worker/src/monty.ts`, standard `fetch` only, so it can move to another server). The base URL is a var in `wrangler.jsonc`: the staging API, as `agent-docs/features.md` scopes. Without the token, `/monty/search` answers 503. Anyone with a deployed URL can run searches through the token, as anyone can edit its boards. `/tools/geocode` works the same way for OpenCage (`apps/worker/src/geocode.ts`): it passes only `q, limit, countrycode, bounds, language`, adds `OPENCAGE_API_KEY`, and masks the key in any answer. OpenCage's public test key `6d0e711d72d74daeb2b0bfd2a5cdfdba` always answers with one place in Münster: use it to check the wiring without a real key.
- **Rooms:** one board per `#room=<id>`. Opening the app without one, or pressing New board, starts a board with a random 16-character id (`board/room.ts`); the URL is the link to share. There is no access control: anyone with the link can edit, so keep real exercise data off the preview.

### Adding an object type

Each type is one file in `apps/web/src/objects/`, listed in `objects/registry.ts`. The canvas, toolbar and side panel read everything from there, so a new type needs no changes elsewhere.

1. Declare its stored fields by adding them to `ObjectFields` from the type's file (`declare module '../board/board'`). The `BoardObject` union and the update types follow from it. A field added later, when objects of that type already exist on boards, must be optional, with a default where it is read.
2. Export an `ObjectTypeDef` (`objects/types.ts`): label, tool key (one lowercase letter, not `v`), Phosphor icon, size when placed with a click, `layer` (`top` for content, `bottom` for backgrounds), `create` with the fields' starting values, and a `View` component. Then the behaviour it needs: `editable` (double-click), `editOnCreate`, `widthOnly`, `defaultColor` and `textSize` (side panel), `isEmpty` (removed when left empty).
3. Add it to `OBJECT_TYPES` in `objects/registry.ts`; its position is its place in the toolbar. A type with fields but no entry there does not compile.
4. Store references to data (an event id, a tool recipe), not the data itself: each browser fetches what it shows.

Older tabs show a placeholder for a type they do not know, so a board stays usable while people reload after a deploy.

The first prototype is on the `experiment` branch: a headless op runtime, typed data links, a disasters plugin on Montandon, and a natural-language command pipeline. It is a reference, not a base. Read it before rebuilding a part it covered, in particular:
- `apps/web/src/nodes/MapView.tsx` and `plans/plan-005.md`: maps inside a canvas (edit and focus modes, WebGL context limits, pixel ratio at canvas zoom).
- `packages/plugin-disasters/src/montyProvider.ts`: the Montandon queries that `apps/web/src/events/monty.ts` has not taken over yet: related events near an event, impact tables, and event footprints.
- `feat/tools-registry` (`plans/plan-006.md`): the measured sizes and timings behind the data tools, and the admin boundary sources that were tried and dropped (COD-AB, Overture divisions, geoBoundaries).

## Setup and commands

Node 22 or later.

```sh
npm install
printf 'MONTANDON_TOKEN=<token>\nOPENCAGE_API_KEY=<key>\n' > apps/worker/.dev.vars   # once; git-ignored. Event search, place search
npm run sync        # Worker + Durable Objects locally (wrangler dev), http://localhost:8787
npm run dev         # web app with hot reload, http://localhost:5173 (proxies /connect, /monty and /tools to :8787)
npm test            # vitest
npm run typecheck
npm run build
npm run deploy      # build the web app and deploy the Worker (needs `npx wrangler login` once)
```

`npm run sync` also serves the last `npm run build` at :8787, the same way the deployed Worker does. Local room state is in `apps/worker/.wrangler/`.

## Deploys

GitHub Actions deploy every push to Cloudflare (`.github/workflows/deploy.yml`), after typecheck and tests pass:
- `main` deploys to the `humanitarian-ttx` Worker.
- Every other branch deploys to its own Worker, `humanitarian-ttx-<branch>` (naming rule in `.github/scripts/worker-name.sh`), with its own rooms. A branch that changes the board format cannot break `main`'s boards.
- Deleting a branch deletes its Worker and its rooms (`delete-branch-worker.yml`).
- The deployed URL is in each run's summary, and on the branch's pull request as one comment that each deploy updates (`.github/scripts/pr-preview-comment.sh`). A pull request opened after the branch deployed gets the link from `pr-preview-link.yml`.

Repository secrets: `CLOUDFLARE_API_TOKEN` (a token limited to editing Workers), `CLOUDFLARE_ACCOUNT_ID`, `MONTANDON_TOKEN` and `OPENCAGE_API_KEY`. Cloudflare keeps secrets per Worker and each branch is its own Worker, so the workflow uploads the API keys the repository has with every deploy (`--secrets-file`). A missing key does not fail the deploy; its route answers 503 (event search, place search).

## Before editing

- Identify the requested outcome and how to verify it. For substantial or ambiguous work, state the scope and assumptions before implementing. Ask when uncertainty would change behavior or a shared contract; resolve routine implementation choices using existing conventions.
- Inspect the working tree and relevant code, tests, and callers. Search for an existing implementation before generating a new one.
- Treat existing uncommitted changes as another contributor's work. Preserve them, stage only your own changes, and ask before overwriting overlapping work. Re-read files before editing if they may have changed during the task.
- Keep independent tasks on separate branches or worktrees. Coordinate overlapping changes to shared interfaces, configuration, and lockfiles; do not silently broaden the task to accommodate another task's work.

## During code generation

Apply these rules while choosing an implementation and again when reviewing the diff:

- **YAGNI:** Implement the current requirement and its necessary correctness safeguards. Every new option, dependency, abstraction, and fallback must serve that requirement or an established contract. Defer speculative extension points, unused helpers, and features for hypothetical future callers.
- **DRY:** Keep each business rule and invariant in one authoritative place. Reuse existing code when its semantics match. Extract shared code when callers represent the same concept and should change together; similar syntax alone is not enough. Small duplication is preferable to coupling unrelated behavior through a configurable abstraction.
- **Simplicity:** Choose the smallest clear design that satisfies the requirement. Prefer explicit control flow and existing building blocks. Add indirection only when it reduces demonstrated complexity; avoid broad cleanup, renaming, or formatting outside the task.
- **Compatibility:** Inspect affected callers before changing shared interfaces or data formats. Preserve established behavior outside the requested change, and document intentional compatibility changes and any migration needed.
- **Maintainability:** Use names and boundaries that make intent clear to the next contributor. Comments should explain constraints or reasoning that the code cannot express. Record consequential shared design decisions in the repository rather than leaving them only in chat.
- New frameworks or dependencies require a plan, ADR, or ticket as well as the human approval described below.

## Verification and handoff

- Verify observable behavior against the requested outcome. Add or update tests for changed behavior and bug regressions; choose the test level that catches the failure without binding the test to implementation details. Test-first and implementation-first workflows are both acceptable.
- Run the relevant available tests, type checks, and linters before requesting review. For documentation-only changes, check accuracy, links, and the diff. Report checks that failed or could not run, including known pre-existing failures; never imply an unrun check passed.
- Review the final diff for scope, accidental changes, unnecessary abstractions, and duplicated rules. Account for every changed file before handing off.
- Summarize the resulting behavior, why it changed, verification performed, and any remaining limitations or follow-up work. Give reviewers enough context without requiring access to the agent conversation.

## Git and PRs

- Start new work from `main` on a task branch; continue an existing task on its branch. Integrate through a reviewed PR, subject to the publishing approval below; never push directly to `main`.
- Keep each PR focused on one coherent change. Separate unrelated cleanup so other contributors can review, merge, and revert changes independently.
- Write clear commit messages describing *why*, not just *what*.
- Resolve conflicts by preserving the intent of both changes and rerun affected checks. Ask when those intents conflict instead of choosing one contributor's version by default.

## Ask before

Agents should check with a human before:

- Adding or upgrading dependencies
- Changing scenario content or exercise logic in ways facilitators rely on
- Deleting files, rewriting history, or force-pushing
- Anything that publishes or sends data outside the repo
