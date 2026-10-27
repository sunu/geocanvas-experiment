# Plan 005 — Map view in the doc, focus mode, pinned nodes, efficient maps

Date: 2026-10-27.

## 1. Context

The user wants to:
1. **Focus** on a map node: the map fills the viewport, and the user works inside it. Esc goes back.
2. **Share the map view.** The center and zoom of each map are doc state, changed by ops. All users and the agent see the same view.
3. **Pin nodes to a place.** A sticky, chart, or text sits "in" a map, anchored to a lon/lat. When the map pans or zooms, the node moves with that place. It stays a normal node: ops, links, undo, sync.
4. **Keep many maps efficient.** Ten maps on a canvas must not use ten WebGL contexts or freeze the canvas.

Decisions taken (user): pinned to a place (not fixed in a frame); focus mode; map view in the doc.

## 2. Design

### 2.1 Map view in the doc

- New prop on `core.map`: `view?: { center: [lon, lat]; zoom: number; bearing?: number; pitch?: number }`.
- New op `core.map.setView` (target: one map). The map UI dispatches it at the end of a user pan or zoom (`moveend`, after a 300 ms pause). This is the same pattern as the gesture bridge for drags.
- **Undo merge.** Many small pans must not make many undo steps. New optional field on `OpDef`: `mergeKey?(target, args): string`. If the last local invocation has the same merge key and is less than 2 s old, the runtime does not call `stopCapturing()`. Then the yjs undo manager merges the two changes into one undo step.
- **Remote change:** the map moves to the new view (`easeTo`), unless the local user is interacting with that map at that moment.
- **Fit to AOI becomes a reaction.** Today each client fits the map to the AOI locally. With a shared view, that would make every client write a view. Instead, `core.map` gets `onInputsChanged: { op: 'core.map.fitToAoi', enabledProp: 'autoFit' }`. Only the client that made the change runs it (the originator rule), as a `system` cascade, like the related-events regenerate. New prop `autoFit` (default true). A manual `setView` does not turn it off. A new AOI fits again.
- **No view yet** (a new map): the UI computes a view from the AOI, locally, with no write. The first pan writes a view.

### 2.2 Focus mode (generic, any node)

- New view op `core.view.enterFocus` (target: one node) and `core.view.exitFocus`. View ops are local: not in the doc, not in undo.
- **Enter:** save the camera, then animate the canvas camera so that the node fills the viewport (with a margin). Then put the node in edit mode (a map becomes interactive) and dim the rest of the canvas.
- **Exit:** Esc, a "⤡" button, or a click outside the node. Restore the saved camera.
- **Ways in:** a "⤢" button in the node header, the `F` key on a selected node, and the palette ("Focus on map").
- **Sharp rendering.** In focus mode the canvas zoom can be 3× or more, and the map canvas gets blurry. The map uses `pixelRatio = devicePixelRatio × canvasZoom` (with a cap of 4096 px on each side) and redraws when the zoom settles.
- **Peers:** focus is local. Peers see your cursor and selection as usual.

### 2.3 Pinned nodes

**Model (core, generic):**
- A node can have `anchor?: { kind: 'geo'; lngLat: [lon, lat] }`, plus `parentId = <map node id>`.
- For a pinned node, `layout.x` and `layout.y` are **not** the source of truth. The position comes from projecting `anchor.lngLat` with the parent map's `view` and size. `layout.w` and `layout.h` stay as they are: a pinned card keeps its size in screen pixels when the map zooms, like a marker.
- The projection is a pure Web Mercator function in `plugin-core` (`geo/project.ts`): `project(view, mapSize, lngLat) -> {x, y}` and `unproject`. It needs no MapLibre, so the agent and tests can use it too.

**Ops:**
- `core.node.pinToMap { mapId, lngLat }`: set the anchor and parent. Target: one or more nodes.
- `core.node.unpin { x, y }`: remove the anchor, set a canvas position.
- `core.node.moveAnchor { lngLat }`: move a pinned node to a new place.

**Rendering (web):**
- The bridge parents a pinned node's tldraw shape to the map shape. It computes the shape position from `project(view, size, lngLat)`. The point is the card's bottom-center, so the card sits above the place, with a small pointer to it.
- **Live pan:** while the local user pans the map (before `setView` is committed), a local store holds the live camera of that map. The bridge reprojects only that map's pinned children on each animation frame.
- **Clipping:** the map shape util returns a clip path (`getClipPath`, as tldraw frames do), so pins outside the map's visible area do not show. Later, an edge indicator can show where they are.
- The map also draws a small dot layer (deck.gl) at each pin's exact lon/lat.

**Gestures:**
- **Drop onto a map:** at the end of a drag, if the pointer is inside a map node, the gesture bridge dispatches `core.node.pinToMap` with `unproject(drop point)`, not `setLayout`.
- **Drag a pinned node within its map:** `core.node.moveAnchor`.
- **Drag a pinned node out of its map:** `core.node.unpin`.
- **Add while a map is in focus:** the add bar and the palette add ops pin the new node at the map center (or at the double-click point), in one op. The `<type>.add` ops get an optional `pin: { mapId, lngLat }` arg (advanced). It is the same op and the same `createNode` path.

**Links:** links to and from pinned nodes work as usual. The link layer reads positions from tldraw, so it follows pins.

### 2.4 Many maps: a live-map budget

Problem: each live map is one MapLibre instance with one WebGL context (deck.gl shares it), plus a tile cache and workers. Browsers keep about 16 contexts and drop the oldest. Memory and frame time grow with each map.

Design: a `MapPool` in the web app decides which map nodes get a live instance.

1. **Priority:** focused or editing map → selected → visible on screen and large → visible and small → off screen.
2. **Budget:** at most `N = 4` live instances (a setting). A map that is less than 160 px on screen, or off screen, is never live.
3. **Snapshot for the rest:** a map that is not live shows an `<img>` of its last frame. The key is `(mapId, view, size, basemap, layersHash)`. The pool keeps an in-memory LRU of about 50 snapshots.
4. **One shared snapshot renderer:** a single hidden MapLibre + deck.gl instance renders missing snapshots one at a time (set style, view, and layers; wait for `idle`; capture in the `render` callback). That is one more WebGL context for all thumbnails, not one per map.
5. **Instance reuse:** a demoted live instance goes back to the pool. Its container element moves to the next map node that needs a live map (`appendChild` + `resize`). This avoids loading the style again.
6. **Pinned nodes** do not need a live map. Their positions come from the doc view and the pure projection, so they work on snapshots too.

## 3. Steps

| # | Step | Main files | Verification |
|---|---|---|---|
| 1 | `mergeKey` undo merge in the runtime | `core/src/ops/runtime.ts`, `ops/types.ts` | Unit test: 5 `setView` ops in 1 s give 1 undo step |
| 2 | Map view in the doc: `view` prop, `setView`, `fitToAoi` reaction, `autoFit` | `plugin-core/src/nodes.ts`, `ops.ts`; `web/nodes/MapView.tsx` | Unit tests for the reaction and the originator rule. Browser: pan in tab A, tab B follows. A new AOI fits on both. |
| 3 | Focus mode + sharp rendering | `core/src/ops/builtin.ts` (view ops), `web/canvas/focus.ts`, `NodeFrame.tsx`, `MapView.tsx` | Browser: F on a map, map fills the screen, pan works, Esc restores the camera. Screenshot: no blur at 3×. |
| 4 | Projection utils | `plugin-core/src/geo/project.ts` | Unit tests: project/unproject round trip; matches MapLibre `map.project()` within 0.5 px |
| 5 | Anchor model + pin ops | `core/src/doc/schema.ts`, `doc/tx.ts`; `plugin-core/src/ops.ts` | Unit tests: pin, move, unpin, undo; delete the map removes pins (existing child cleanup) |
| 6 | Pinned node rendering, live reprojection, clipping, pin dots | `web/canvas/bridge.ts`, `NodeShapeUtil.tsx`, `MapView.tsx`, `nodes/mapLayers.ts` | Browser: a pinned sticky stays on its village during pan and zoom, in both tabs |
| 7 | Gestures: drop to pin, move within, drag out to unpin; add into the focused map | `web/canvas/bridge.ts`, `ui/AddBar.tsx`, `palette/Palette.tsx` | Browser tests for each gesture. Op log shows one op for each gesture. |
| 8 | MapPool: budget, snapshots, shared renderer, instance reuse | `web/nodes/mapPool.ts`, `MapView.tsx` | Perf test: 12 maps on a canvas. WebGL contexts ≤ N + 1. Canvas pan stays smooth (frame time logged). Memory logged before and after. |
| 9 | NL hints and eval cases for the new ops | op `nl` hints; `eval/cases.jsonl` | e.g. "focus on the map", "zoom the map to Beira" (needs geocoding: later), "pin this note to the map" |

Steps 1–3 are independent of pins. Steps 4–7 need step 2 (the view in the doc). Step 8 can go after step 3 or at the end. Pins work on snapshots because they use the doc view.

## 4. Risks and open points

1. **tldraw clip path for a non-frame parent:** `getClipPath` exists on `ShapeUtil`. Frames use it. I expect it to work for our generic shape. (Certainty: 75%.) Fallback: draw the pins in an overlay layer clipped to the map bounds, not as tldraw children.
2. **Snapshot capture without `preserveDrawingBuffer`:** capture in the MapLibre `render` callback. (Certainty: 70%.) Fallback: turn on `preserveDrawingBuffer` only for the shared snapshot renderer.
3. **Undo of a view change in a shared map:** user B can see a map jump when user A undoes A's pan. This is consistent with "undo your own ops", but it can surprise. Option: make `setView` not undoable. **Decision needed.** My suggestion: undoable, merged per 2 s.
4. **Same place, different map sizes:** a pinned node's position depends on the map node size. A resize of the map keeps the pins on their places, because the projection uses the size.
5. **Map rotation and pitch:** the projection supports bearing. Pitch (3D tilt) is out of scope for pins. Pins hide when pitch > 0.
6. **Pins in data flow:** later, a pinned node could output its lon/lat as a `geo.point` port (e.g. a "point of interest" feeding a chart). Not in this plan.
