# Task: in-focus mode widgets

Date: 2026-10-28. Status: planned, not started. Scope from `agent-docs/features.md` and `agent-docs/architect.md`.

## 1. Requirements

From `features.md`:
- New widgets: **Table**, **Chart**, **Jupyter Notebook**. The **Map** exists; change it as needed. Stretch: **Input** (date or place).
- **In-focus mode:**
  - A button click turns it on.
  - It zooms the widget in until it fills the app (full screen in the app, not the browser's full screen).
  - It shows an **Options panel** with the widget's contextual tools.
- **Changes made in focus are not shared** until you leave focus. A separate **Share** button in focus shares them earlier, and leaving focus asks whether to share or discard (§4).
- **Full-screen view toggle:** the in-focus button itself. There is no browser full screen (Fullscreen API).
- Every widget: dark mode; added, removed and edited by hand and by agents.
- Canvas FPS stays at 30 or more. No small-screen layout.

From `architect.md`:
- In-focus widgets **extend the current widget**.
- Tabular and geospatial data goes into **DuckDB-wasm**.
- Uploaded files are stored on Cloudflare, with the same behaviour locally.

## 2. Where this lands in the current code

- A type is a headless `ObjectTypeDef` in `packages/plugins` (zod `fields`, ops) plus its UI from `registerObjectUI` (`apps/web/src/canvas/registry.ts`).
- **Ops are the only write path** (`Runtime.dispatch` and `invoke`). Undo is one step per gesture, through `Y.UndoManager` on the doc's `objects` map. The op log is the doc's `oplog` array.
- View ops (`core.view.*`) change only the local camera, through `ViewController` (`applyView`).
- A `Runtime` is built on any `Y.Doc` (`new Runtime({ doc, plugins, actor, view })`). Private focus edits (§4) rely on this.
- Map views are per person in the doc's `views` map. Pans are written directly, with no op and no undo.

## 3. Extending the current widget

Widgets are definitions, not classes, so "extended class" is an extended `ObjectUI` interface:

```ts
// apps/web/src/canvas/registry.ts
export interface ObjectViewProps<O> { …; focused: boolean }   // false outside focus

export interface FocusableObjectUI<O extends BoardObject = BoardObject> extends ObjectUI<O> {
  /** The Options panel shown beside the widget in focus. Each control dispatches an op on `runtime`. */
  Options: ComponentType<ObjectViewProps<O>>
}
export const isFocusable = (ui: ObjectUI | undefined): ui is FocusableObjectUI => !!ui && 'Options' in ui
```

- `registerObjectUI` takes either kind.
- Box, text, sticky and event stay plain `ObjectUI`; Map, Table, Chart and Notebook register a `FocusableObjectUI`.
- The headless type in `packages/plugins` does not change: focus is UI only, and agents edit widgets through ops either way.

## 4. Private edits in focus: a draft doc

Requirement: "changes in in-focus mode are not shared to other people unless you quit the focus mode."

**Design: focus works on a local fork of the board doc, merged back on exit.**

1. **Enter.** Make a draft `Y.Doc`, not connected to the provider, from `Y.encodeStateAsUpdate(mainDoc)`. Build a **draft `Runtime`** on it, with the same plugins and actor.
2. **During focus:**
   - The focused widget and its Options panel get the draft runtime as their `runtime` prop. Their ops, undo (⌘Z) and map view writes all land in the draft, and nobody else sees them.
   - Updates to the main doc (other people, the agent) are applied to the draft as they arrive, so the widget stays live with everyone else's changes.
   - Nothing goes from the draft to the main doc.
3. **Share** (its own button in the focus header): merge the draft into the main doc now, and stay in focus.
   - `draftRuntime.flush()`.
   - `update = Y.encodeStateAsUpdate(draftDoc, Y.encodeStateVector(mainDoc))`. This holds only the draft's own changes not yet in main: everything from main is already there, and earlier shares are too.
   - A new `Runtime.applyDraft(update)` applies it in one transaction under the runtime's own origin, after `beginGesture()`. So **each share is one undo step**, and the draft's op log entries arrive with it.
   - For a map, Share also shares **your view**: everyone's view of that map moves to yours (`map.showArea` for everyone, in the same step). Map views are per person, so merging the draft alone would not move other people's maps.
   - The draft keeps going after a share; the next share sends only what changed since.
4. **Exit (Esc, ⤡, a click on the backdrop):**
   - With no unshared changes, focus just ends.
   - Otherwise an in-app dialog (not the browser's `confirm()`) asks **Share**, **Discard** or **Keep editing**:
     - Share merges as in 3, then exits.
     - Discard drops the draft doc; nothing is sent.
     - Keep editing stays in focus.
   - "Unshared changes" means the draft had a transaction of its own (not one copied from main) since the last share (`hasUnshared()` in `ops/draft.ts`). A state vector would miss deletions, which add no clock.
5. **Conflicts** use Yjs rules, as for any two concurrent edits:
   - A change someone made after it reached your draft is overwritten by your later change.
   - Truly concurrent sets of one field resolve by client id.
   - If someone deletes the focused object, the deletion reaches the draft, focus ends, and a notice says so.

**Why a doc fork and not a local patch of fields:**
- Every op, its zod check and its `apply` run unchanged on the draft.
- Undo inside focus works as usual.
- Concurrent edits merge with Yjs, not with code of our own.
- `packages/core` has no React, so the fork and merge (`packages/core/src/ops/draft.ts`) are tested in Node.

**Costs and limits:**
- Copying the doc on enter costs as much as loading the board. Boards hold recipes, not data, so this is small.
- While you are in focus, the agent and `summarizeBoard` see the shared board, not your draft.

**Undo of a share** (checked in step 1, `packages/core/test/draft.test.ts`): `Y.UndoManager` tracks a merged update applied under the runtime's origin, so one undo takes back the whole share, and redo brings it back.

## 5. Focus mode on the canvas

### 5.1 Ways in and out
- **In:** the ⤢ button in the widget header, `F` on one selected focusable widget, or the palette.
- **Out:** Esc, ⤡, or the backdrop. With unshared changes, the Share / Discard / Keep editing dialog opens (§4).
- **Share** button in the focus header: shares changes (and a map's view) without leaving focus (§4).
- **Op:** `core.view.focus` (target: one object), a view op with `applyView`; `ViewController` gains `focus(id)`, which throws for a type without focus mode.
  - There is no exit op: in focus the palette is off, and the only keys are Esc and undo.
  - The room's agent has no `ViewController`, so it can never change what a person sees.

### 5.2 Rendering

1. **Enter:** save the camera. Animate the camera for about 250 ms until the widget fills the area left of the Options panel. The widget keeps its stored size during the animation, so nothing relays out per frame.
2. **Swap:** at the end, set the camera to `z = 1` and give the widget a **local size override** equal to that area. It is never written, to the draft or to the board. The box looks the same; its content relays out once at native pixels.
   - Maps are sharp, with no `pixelRatio` fix as on the `experiment` branch.
   - Tables show more rows.
3. **During focus:**
   - The widget is in `editing` mode, so it has the pointer and the wheel. Canvas pan and zoom are off.
   - Every other object gets `visibility: hidden`, so the canvas draws only the focused widget (FPS).
4. **Exit:** drop the override at the same screen size, then animate back to the saved camera.

### 5.3 What peers see

- Focus is local, like the camera.
- Peers see your cursor and selection, but not your draft edits until you press Share or exit with Share.
- In focus, you do not see others' cursors and outlines: they are drawn at stored positions and sizes, which the focused layout does not match.
- Peers get no sign of unshared edits: no presence field.

### 5.4 Keeping the widget mounted

Switching the widget's `runtime` prop between main and draft must not remount it. A remount would rebuild a MapLibre map and its two WebGL contexts.

`MapObject` creates its map in an effect keyed on `[runtime, o.id]`. Split it: create the map on `o.id` only, and subscribe to views in a separate effect keyed on the runtime. The same rule applies to every focusable widget.

### 5.5 Files

| File | Change |
|---|---|
| `packages/core/src/ops/draft.ts` (new, step 1 done) | Fork, forward main updates, encode the draft's unshared changes, `hasUnshared()` |
| `packages/core/src/ops/runtime.ts` | `applyDraft(update)`: one undo step per share |
| `packages/core/src/ops/types.ts`, `plugins/core.ts` | `ViewController.focus`; the `core.view.focus` op (step 2 done) |
| `apps/web/src/canvas/focus.ts` (new) | Local focus state (id, saved camera, draft), animation, enter, share, exit, discard |
| `apps/web/src/canvas/OptionsPanel.tsx` (new) | Panel shell (title, Share, exit) rendering `ui.Options` with the draft runtime; the Share / Discard / Keep editing dialog |
| `apps/web/src/canvas/registry.ts` | `FocusableObjectUI`, `isFocusable`, `focused` prop |
| `apps/web/src/canvas/Canvas.tsx`, `ObjectView.tsx` | Size override, hiding others, `F` key, wheel off, ⌘Z to the draft during focus |
| `apps/web/src/map/MapObject.tsx`, `map/ui.ts`, `map/MapOptions.tsx` (new), `map/live.ts` (new) | Split the effect (§5.4); header controls move to the Map's `Options`, which reaches the live map through `live.ts` (step 2 done) |

Later milestones add `packages/plugins/src/table.ts`, `apps/web/src/table/`, and `apps/web/src/data/query.ts` with `duckdb.worker.ts` (steps 8–10).

## 6. Widgets

Each one is a plugin type with its ops, plus a `FocusableObjectUI`. The Options panel dispatches the type's ops, so the same edits are agent tools.

| Widget | Fields (zod) | Ops | Compact view | Options panel |
|---|---|---|---|---|
| **Map** (changes) | adds `annotations?`, and a `filter?` and `style?` per layer | `map.setLayerFilter`, `map.setLayerStyle`, `map.addAnnotation`, `map.removeAnnotation`; layers from a URL through `map.addLayer` | **Snapshot image** when zoomed out, live map when zoomed in | Place search, layers (built-in and from a URL), basemap, legend, attributes, filters, drawing (marker, polygon, circle); location selection when added |
| **Table** | `source?`, `columns?`, `filters?`, `sort?` | `table.add`, `table.setSource`, `table.setColumns`, `table.setFilters`, `table.setSort` | Header, first ~20 rows, row count | Source (upload, URL, STAC), columns, filters, sort; full scrollable table |
| **Chart** | `source?`, `chartType` (`bar`, `stackedBar`, `donut`, `line`, `stat`, `rankedList`), `encoding` (x, y, color, aggregation), `filters?`, `annotations?` | `chart.add`, `chart.setSource`, `chart.setType`, `chart.setEncoding`, `chart.setFilters`, `chart.addAnnotation`, `chart.removeAnnotation` | The chart | Source, type, columns, filters, markers, provenance (source, query, time, attribution) |
| **Notebook** | `source?` (upload or `.ipynb` URL) | `notebook.add`, `notebook.setSource` | Title and outline | Contents, show/hide code, source. Read-only: no code runs |

- New fields on the existing map type are optional, read with defaults, as AGENTS.md requires.
- Each new type has `summarize` for the agent.
- **Shared data:**
  - A `DataSource` recipe on the widget: `{ kind: 'upload', key } | { kind: 'url', url } | { kind: 'stac', search }`.
  - DuckDB-wasm runs in a Web Worker started on first use, behind a browser tool `data.query`. The `ToolRunner` caches and shares its results.
  - Widget filters and sort become SQL, built by a pure, tested function.
  - Uploads go to a Worker route `PUT/GET /files/<room>/<key>` on R2, which `wrangler dev` emulates locally. The R2 setup is decided later (§8), so URL and STAC sources come first.
- **Notebook security:** render it in an `<iframe sandbox srcdoc>` without `allow-scripts`, because outputs can carry HTML and scripts.
- **Map live-map cap:** each live map uses two WebGL contexts (MapLibre plus the deck.gl overlay), and browsers keep about 16. Show snapshots beyond a cap of live maps (`plans/plan-005.md` §2.4 on `experiment`).

## 7. Steps (one PR each)

**Map first.** The Map exists already, so it is the first in-focus widget. Every piece of focus mode is built and checked on it, then the Map's own features from `features.md` are finished, before any new widget starts.

Milestone 1 adds no dependencies and no new object type. It is also where the hardest parts get checked: keeping a WebGL map mounted while its runtime switches (§5.4), and the sharpness of a map at `z = 1`.

### Milestone 1: Map with in-focus mode

1. **Draft doc** in `packages/core`: fork, forward, merge, `hasUnshared`, `applyDraft`. No UI. Node tests:
   - edits in the draft do not reach main; main edits reach the draft
   - each merge is one undo step; a second share sends only the newer changes
   - the draft's op log entries arrive, and map views written in the draft arrive with the share
   - `hasUnshared` is false after a share and after only remote changes
   - deleting the object during a draft
2. **Focus mode, with the Map as the first `FocusableObjectUI`:**
   - Everything in §5.
   - Split `MapObject`'s effect (§5.4).
   - The Map's `Options` takes today's header controls: place search and pin, layers and "Add layer", basemap. The compact header keeps the title and the ⤢ button.
   - Share also moves everyone's view of the map to yours.
   - Browser check from two browsers:
     - enter and exit; Esc restores the camera
     - the map is sharp in focus and is not rebuilt (no flicker, no tile reload) on enter, share or exit
     - a basemap change or a new layer in focus is invisible to the other browser until Share, then appears
     - Share moves the other browser's view of the map to yours
     - exiting with changes asks Share / Discard / Keep editing; Discard sends nothing
     - ⌘Z inside focus undoes in the draft; ⌘Z after a share undoes that share
     - a layer the agent adds while you are in focus shows in your focused map
     - FPS logged during the animation and while panning in focus

### Milestone 2: the Map's features

Each of these is an Options panel tool, written through map ops, so the agent can use them too. New map fields are optional (AGENTS.md).

3. **Location selection when a map is added:**
   - Draw an area on a minimap, type lat/lon, or type a bbox. Each moves everyone's view through `map.showArea`.
   - "Describe it in words" goes to the agent when it is configured (it geocodes, then runs `map.showArea`), and is hidden otherwise.
4. **Data from a URL, and a legend:**
   - A layer from a URL: GeoJSON, GeoParquet (hyparquet, already used), COG (the existing raster path), XYZ raster tiles, shapefile (`shpjs`).
   - Each is a tool recipe like today's layers, e.g. `{ tool: 'data.fromUrl', input: { url, format } }`.
   - The layer list shows a legend for each layer: color for features, the color ramp and range for rasters.
5. **Attributes, filters and legend formatting:**
   - The attribute panel lists a layer's properties.
   - Each layer gets an optional `filter` (property, operator, value) and `style` (color, by-property coloring, opacity).
   - Ops `map.setLayerFilter`, `map.setLayerStyle`.
   - Filters run on the loaded features in the browser; DuckDB is not needed for the Map.
6. **Annotations:**
   - Draw a marker, polygon or circle in focus.
   - Stored in the map's `annotations?` field as GeoJSON with a label, through `map.addAnnotation` and `map.removeAnnotation`; drawn as a deck.gl layer above data layers.
7. **Snapshots and the live-map cap:**
   - A map that is zoomed out on the canvas, too small, off screen, or beyond the cap shows a snapshot image; a focused map is always live.
   - One shared hidden renderer makes the snapshots (`plans/plan-005.md` §2.4 on `experiment`).
   - Check: 12 maps on a board use at most (cap × 2) + 1 WebGL contexts, and canvas FPS stays at 30 or more.

### Milestone 3: Table

8. **Table data:**
   - `@duckdb/duckdb-wasm` in a Web Worker started on the first query.
   - A browser tool `data.query`: input a `DataSource` (`{ kind: 'url', url }` for now) plus columns, filters, sort, `limit` and `offset`. Output the rows, the column names and types, and the total row count.
   - The SQL is built by a pure function, unit tested: column names quoted, filter values passed as parameters, never pasted in.
   - The URL must allow CORS; a proxy is out of scope.
   - Record the bundle size and first-query time in the PR.
9. **Table widget:**
   - Plugin type `table` with fields `source?`, `columns?`, `filters?`, `sort?`.
   - Ops `table.add`, `table.setSource`, `table.setColumns`, `table.setFilters`, `table.setSort`, with `summarize`.
   - Compact view: header, the first ~20 rows, the row count, the source's name.
10. **Table in focus:**
    - `Options`: source URL, column picker (show, hide, order), filters (column, operator, value), sort.
    - In focus the table scrolls through all rows, one `data.query` page at a time, with only visible rows in the DOM.
    - Check: FPS while scrolling 100,000 rows.

### Then

11. **Dark mode:** `--ttx-*` tokens for `prefers-color-scheme`, plus an app setting. Until then, new CSS uses only the `--ttx-*` tokens, so this step changes the tokens and nothing else.
12. **Uploads** for Map layers and Tables, once R2 is decided (§8). Local development is described in §8.
13. **Table, more sources:** STAC, and xlsx (SheetJS only if DuckDB-wasm cannot read it).
14. **Chart.**
15. **Notebook.**
16. *(Stretch)* **Input** widget.

Each step: `npm test`, `npm run typecheck`, and a browser check from two browsers.

## 8. Decisions

Made (2026-10-28):
1. **Full screen** is the in-focus button itself. No browser Fullscreen API.
2. **Sharing** is a separate Share button in focus. It shares the changes and, for a map, the view. Peers get no sign of unshared edits.
3. **Exit** with unshared changes asks Share, Discard or Keep editing.
4. **New dependencies are approved.** Add each in the step that needs it:
   - `shpjs` for shapefiles (step 4). Added to the list with the Map-first order: confirm.
   - `@duckdb/duckdb-wasm` (step 8)
   - SheetJS only if DuckDB-wasm cannot read xlsx (step 13)
   - Observable Plot, `@observablehq/plot` (step 14)
   - a Markdown renderer and a sanitizer for notebooks (step 15)

   Their size and loading belong in each step's PR.
5. **Map first** (2026-10-28): the Map is the first in-focus widget and is finished before the Table.

Open:
6. **Upload storage: R2** (in progress), not the room's Durable Object storage.
   - Durable Object SQLite caps a row at 2 MB, so files would be split across rows.
   - It has no range reads; DuckDB-wasm and GeoParquet reads rely on them.
   - Every read would wake the room and bill Durable Object time.
   - R2 stores files whole, answers `Range` requests, and does not wake the room.

   Still to decide: the bucket names, and limits on file size and on the number of files per room.

**Local development of uploads, with no R2 account needed:**
- `npm run sync` runs `wrangler dev`, which stands in for an R2 binding with a local bucket (Miniflare). It supports `put`, `get` with `range`, `head` and `delete`.
- Files are kept in `apps/worker/.wrangler/state/v3/r2/`, beside the rooms' state. Delete the folder to start clean.
- Nothing reaches Cloudflare unless the binding sets `"remote": true` or `wrangler dev --remote` is used; do neither.
- Wiring the upload step needs:
  - `"r2_buckets": [{ "binding": "FILES", "bucket_name": "<name>" }]` in `wrangler.jsonc`; the real bucket has to exist only for deploys
  - `/files/*` in `run_worker_first`, and in the Vite dev proxy beside `/connect`, `/monty` and `/tools`
- Tests:
  - Key checks, size limits and `Range` parsing are pure functions, tested with vitest.
  - The route itself is checked against `wrangler dev`.
  - `@cloudflare/vitest-pool-workers` is not needed.
- **Branch previews share one bucket**, but deleting a branch deletes only its Worker and rooms (`delete-branch-worker.yml`). Choose one of these, so files from deleted branches do not stay:
  - prefix keys with the Worker's name and have that workflow delete the prefix, or
  - use a separate preview bucket with an expiry rule.
