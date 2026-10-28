# Plan 007 — Op runtime, plugins, tools and command palette on our own canvas

Date: 2026-10-28. Status: implemented on `feat/ops-runtime`.

## 1. Context

On the `experiment` branch (plans 001–005), every change to the board was a typed **op**. Ops came from plugins. They gave one undo step per invocation, an op log, a ⌘K palette with forms made from schemas, and JSON Schema tool definitions for NL mode and agents. That branch used tldraw.

Main replaced tldraw with our own canvas and a `Board` class. The UI wrote the Yjs doc directly, so agents had no single write path to call as tools.

This plan brings the op primitives back. Main's canvas, UI and board format stay as the base.

Scope: the op runtime, builtin and plugin object types, tool calls, and the palette. Later plans add links and reactivity, templates (sitrep), NL "Ask" in the palette, agent proposals, and an op log panel. They use the same runtime.

Decisions: zod v4 for schemas, cmdk for the palette, and a new `packages/core` workspace (`@ttx/core`).

## 2. Board format: no change

The doc keeps the `objects` Y.Map, with one flat Y.Map per object (`type, x, y, w, h, z, …fields`). The type names `box`, `text`, `map` and `event` do not change. Boards made before this plan open and edit with no migration (`apps/web/test/board.test.ts`). The experiment's `nodes/props/layout` layout is not used.

New in the doc: `oplog`, a Y.Array with one entry for each invocation, undo or redo. It is not in the undo scope.

## 3. Design

### 3.1 Core package (`packages/core`)

| File | Contents |
|---|---|
| `doc/board.ts` | `Board`: reads only (`subscribe`, `snapshot`, `list`, `get`). |
| `doc/tx.ts` | `BoardTx`: the only writes (`add`, `update`, `remove`, layer order). It checks each add and update against the object type's schema. An unknown field is an error. |
| `ops/types.ts` | `OpDef`, `TargetSpec`/`TargetRef`, `Actor`, `InvocationRecord`, `OplogEntry`, `ViewController`. |
| `ops/runtime.ts` | `Runtime`: `dispatch`, `invoke`, `preview`, `beginGesture`, `undo`/`redo`, the op log, `availableOps`, `defaultsFor`, `callTool`. |
| `ops/addOp.ts` | The `<type>.add` op for each object type. |
| `ops/tools.ts` | `exportTools`, `summarizeBoard`, tool names. |
| `plugins/` | `Plugin`, `ObjectTypeDef`, `Registry`, and the `core` plugin. |
| `style.ts` | Color names and text sizes (the schemas use them). |

An `ObjectTypeDef` has `type`, `title`, `description`, `fields` (a zod object), `defaultSize`, `layer` (`'top'` or `'bottom'`, for new objects), `addable` and `summarize`.

An `OpDef` has `id`, `title`, `description`, `target`, `args` (zod), and these optional parts: `defaults`, `when`, `prepare` (read-only), `apply` (sync, writes through `BoardTx`), `applyView` (view ops), `describePlan`, `hidden`, `risk`, `gesture` and `nl`.

### 3.2 Runtime

- `dispatch` is sync. The canvas uses it for gestures and typing. A controlled textarea needs the write in the same tick. If an op has an async `prepare`, `dispatch` fails, and the caller must use `invoke`.
- `invoke` is async and runs every op. Each `invoke` is its own undo step. The palette and `callTool` use it.
- A bad target, bad args or a schema error gives a `failed` record and no write. Errors from zod read as plain text (`z.prettifyError`).
- Limit: Yjs cannot roll a transaction back. If `apply` throws after a write, that write stays. Each `BoardTx` call checks its input before it writes, so an op that makes one call writes all or nothing.
- Undo: one `Y.UndoManager` per runtime. It tracks only this runtime's own origin class, so it does not undo writes from remote peers or from other tabs. `captureTimeout` is infinite. `beginGesture()` (on a press, a key or a button) starts a new undo step.

### 3.3 Gestures and the op log

Drags sync live, as before: the canvas dispatches `core.object.setRect` on each pointer move.

An op with `gesture: true` (`core.object.setRect`, `text.setText`) keeps one pending log entry per op and target, with the latest args. The runtime writes pending entries on the next `beginGesture()`, after 1 s with no dispatch, on `invoke`, on undo or redo, and on `pagehide`. So one drag gives one log entry. Failed gesture dispatches also merge, so a drag that keeps failing does not fill the log. View ops do not go in the shared log.

### 3.4 Plugins, types and ops

| Plugin | File | Types | Ops |
|---|---|---|---|
| `core` | `packages/core/src/plugins/core.ts` | `box`, `text` | `core.object.setRect` (hidden), `move`, `delete`, `duplicate`, `bringToFront`, `sendToBack`, `bringForward`, `sendBackward`, `setColor`; `text.setText` (hidden), `text.setFontSize`, `text.larger`, `text.smaller`; `core.view.fitAll`, `zoomToSelection`, `resetZoom` |
| `map` | `apps/web/src/map/plugin.ts` | `map` | `map.setBasemap` |
| `events` | `apps/web/src/events/plugin.ts` | `event` | `event.setEvent` (event search widget) |

The registry also adds `box.add`, `text.add`, `map.add` and `event.add`. All plugins are always on (`apps/web/src/plugins.ts`). Per-board plugin enabling comes back with the first optional plugin.

### 3.5 Web

- `board/connect.ts` makes the `Runtime`. Each tab is one user (`sessionStorage`).
- `canvas/registry.ts` holds the UI that plugins register: the object view, the frame style, the toolbar tool and the edit behavior for each type, and form widgets (`color`, `event`). `ObjectView` and the toolbar do not list types.
- The canvas gives the runtime this person's camera (`ViewController`) for view ops.
- In dev, `window.runtime` is in the console.

### 3.6 Tools

`exportTools(ops)` gives `{ name, description, input_schema }`. The input is `{ ids, args }`; only ops on objects have `ids`. `callTool(name, input, actor)` runs one tool call. It refuses hidden ops, and it refuses `risk: 'high'` ops from actors that are not users. `summarizeBoard` gives an LLM one line per object.

### 3.7 Palette (`apps/web/src/palette/`)

⌘K (or the toolbar button) opens the palette. It has two groups: ops for the selection, and ops for the canvas. An op with no main fields runs at once. An op with fields opens a form made from its args schema; the form focuses its first field, so Enter runs the op. For an `<type>.add` op, the new object goes to the middle of the view, and the canvas selects it. Escape closes the palette.

## 4. Changes from the approved plan

1. `NodeTypeDef` is named `ObjectTypeDef` (`objectTypes` on a plugin), as main says "objects".
2. No `PluginCatalog`. All plugins are on, so a `Registry` of the plugin list is enough.
3. Layer order is four ops (`bringToFront`, `sendToBack`, `bringForward`, `sendBackward`), not one `step` op with a direction. Text size is `text.larger` and `text.smaller`, not `text.stepFontSize`. Separate ops read better in the palette and as tools.
4. Only ops with `gesture: true` merge in the op log. If all ops merged, two adds in a row would lose the first add's record.
5. `OpDef` has no `scope` field. An op with `applyView` is a view op.

## 5. Verification

- `npm test`: `packages/core/test/runtime.test.ts` covers layer order, schema checks, failed dispatches with no write, sync between two docs, undo of your own edits only, one undo step and one log entry per gesture, view ops, the registry, tool export and `callTool`. `apps/web/test/board.test.ts` covers the app plugins and boards made before this plan.
- `npm run typecheck` and `npm run build` pass.
- Browser check with two Chrome contexts on one room through the local Worker (Playwright, outside the repo). Results: drawing, live drag for the peer, one log entry per drag, undo of your own edits only, typing with height fit, the palette groups and forms (Set color, Duplicate), an agent tool call, a hidden op refused, Zoom to fit on one view only, and Delete from the other browser. All pass. The only console error is a 404 for `/favicon.ico`, which main also has.

## 6. Risks and next steps

- The op log grows without limit (plan-001 §12.3). Merging gestures keeps it small. Compaction is a next step.
- An agent's `text.add` does not fit the text's height until a person edits it, because only the browser that made a change fits the height.
- Next plans: an op log panel, links and reactivity, templates, NL "Ask" in the palette, and agent proposals with approval.
