# Geo Canvas — Spec and Phased Plan

## Context

We want to build a multiplayer infinite canvas for geospatial work. The canvas holds maps, charts, text, stickies, and node types that plugins add. All changes go through typed **ops** (actions). Ops give us multiplayer sync, undo/redo, an op log, a command palette, and later a natural-language (NL) mode and an AI agent that acts as one more multiplayer user.

The happy path is a **disaster situation report (sitrep)**. The user picks the sitrep template, selects a disaster, and the canvas fills with linked nodes: an affected-area map, a people-affected chart, an estimated-damage chart, a summary text, and a "related disasters" group. When the user changes the seed disaster or the map AOI, the linked nodes update.

Decisions taken:
- Canvas: **tldraw** (rendering and interaction only).
- Sync: **yjs + y-websocket** server with persistence.
- Data: **mock data** behind provider interfaces. Real APIs (GDACS, ReliefWeb, USGS) come later.
- Output now: spec and plan. No code in this session.

The directory `/Users/sunu/Work/temp/canvas-experiment` is empty. This is a new project.

---

## 1. Design principles

1. **Ops are the only write path.** No UI, template, reactive rule, or agent writes to the shared doc directly. Each one dispatches an op. (Certainty: 95% that this is correct for your goals.)
2. **Core uses its own plugin API.** Map, chart, text, and sticky live in a `core` plugin. They use the same API as the `disasters` plugin. This stops hidden hardcoding.
3. **Everything is a schema.** Node props, op args, port types, and template inputs are zod schemas. One schema gives validation, the palette form, and the LLM tool definition.
4. **Derived data is a cache, not state.** A value that comes from inputs (chart rows, impact numbers) is computed again when the inputs change. We do not store it in undo history.
5. **The runtime has no UI dependency.** The same core package runs in the browser and in a headless Node agent.

---

## 2. Architecture

```
apps/web  ──┐                         ┌── apps/agent (later, headless Node)
            │   packages/core          │
            ├── (doc model, op runtime, reactivity, plugins, templates)
            │                          │
packages/canvas-tldraw   packages/palette (cmdk + schema forms + NL mode)
            │
packages/plugin-core   packages/plugin-disasters
            │
apps/sync-server (y-websocket + persistence)
```

Stack: TypeScript, pnpm workspaces, Vite + React, tldraw, yjs, y-websocket, zod v4 (has built-in JSON Schema export), cmdk, MapLibre GL, Vega-Lite (JSON chart spec, easy for an LLM to read and write), turf.js, ulid, Vitest.

### 2.1 Shared doc layout (Y.Doc)

```
meta      Y.Map   schemaVersion, enabledPlugins[], templateRef
nodes     Y.Map   id -> Y.Map { type, props: Y.Map, layout: {x,y,w,h,z}, parentId? }
links     Y.Map   id -> { from: {nodeId, port}, to: {nodeId, port}, kind: 'visual'|'data' }
oplog     Y.Array append-only InvocationRecord[]
proposals Y.Map   id -> InvocationRecord (status 'proposed'; from NL mode or the agent)
```

- The undo scope is `meta`, `nodes`, `links`. It does not include `oplog` or `proposals`.
- Awareness (not the doc) holds cursors, selection, live drag previews, and the actor identity (`user` or `agent`).

### 2.2 tldraw is a projection

- The Y.Doc is the source of truth. tldraw shows it.
- **Doc → tldraw:** a bridge watches `nodes` and `links`. It writes tldraw records with source `remote`.
- **tldraw → doc:** a gesture bridge listens to user changes in the tldraw store. At gesture end (pointer up), it dispatches one op (`core.node.move`, `core.node.resize`, `core.link.create`). During the drag, the local store moves freely and awareness shows the preview to peers.
- Each node type has one generic `TLShapeUtil`. It renders the React component from the node type definition.
- tldraw arrows with bindings map to `links`.
- Risk: the gesture bridge is the most complex part of the bridge. (Certainty: 75% that tldraw store listeners plus side effects are enough. Fallback: use custom tools that dispatch ops directly.)
- Note: tldraw needs a commercial license for production use without the watermark.

---

## 3. Op model

### 3.1 Op definition

```ts
interface OpDef<Args, Plan = Args> {
  id: string                    // 'core.node.move', 'disasters.relatedEvents.regenerate'
  title: string                 // palette label
  description: string           // palette help text and LLM tool description
  scope: 'doc' | 'view'         // view ops (zoom, focus) change only local camera
  target: TargetSpec            // { kind:'canvas' } | { kind:'node', types:[...] } | { kind:'selection', min, max }
  args: ZodType<Args>
  defaults?(ctx, target): Partial<Args>   // e.g. yearRange from the group params
  when?(ctx, target): boolean             // show in palette only if true
  prepare?(ctx, target, args): Promise<Plan>  // async, read-only: fetch data, compute
  apply(tx: DocTx, target, plan: Plan): void  // sync, the only place that writes
  risk?: 'low' | 'high'          // agent ops with 'high' always need approval
}
```

- `prepare` is async and cannot write. `apply` is sync and runs in one yjs transaction. This gives:
  - one undo step per invocation,
  - a preview step. The palette and NL mode can show the plan before the user runs it.
- `DocTx` is the only write API: `createNode`, `updateProps`, `setLayout`, `deleteNode`, `createLink`, `deleteLink`, `setMeta`. It validates props against the node type schema.
- Composite ops (for example template instantiation) call `tx.run(childOpId, target, plan)` inside the same transaction.

### 3.2 Invocation record

```ts
interface InvocationRecord {
  id: string                      // ulid
  opId: string
  actor: { kind: 'user' | 'agent' | 'system'; id: string }
  target: TargetRef
  args: unknown
  parentId?: string               // set for cascade ops
  status: 'proposed' | 'applied' | 'failed' | 'undone' | 'redone'
  at: number
  error?: string
}
```

### 3.3 Dispatch pipeline

`dispatch(opId, target, args, actor)`:
1. Find the op in the registry. Validate the target and the args.
2. Run `prepare` (with an AbortSignal).
3. Run `doc.transact(() => apply(...), origin = { actor, invocationId })`.
4. Append the record to `oplog`.
5. The reactivity engine sees the changes and schedules downstream work (section 5).

### 3.4 Undo and redo

- Each client has one `Y.UndoManager` with `trackedOrigins` = its own actor origins. Each user undoes only their own changes. This is standard yjs behavior.
- `captureTimeout: 0`. Each invocation is one stack item.
- Cascade writes from reactivity use a `system` origin. The undo manager does not track them. When a user undoes a seed change, reactivity runs again and makes the old outputs again. (Certainty: 80%. Edge case: section 5.4.)
- Undo and redo append `undone` / `redone` records to the op log.

### 3.5 Core ops (first set)

| Target | Ops |
|---|---|
| canvas | `node.create`, `link.create`, `template.instantiate`, `plugin.enable`, `plugin.disable` |
| any node | `node.delete`, `node.move`, `node.resize`, `node.duplicate`, `node.updateProps`, `link.delete` |
| view | `view.zoomTo`, `view.focusNode`, `view.fitAll` |
| map | `map.setAoi`, `map.addLayer`, `map.setBasemap` |
| chart | `chart.setSpec`, `chart.setSource` |
| text | `text.setContent` |

---

## 4. Plugin system

```ts
interface Plugin {
  id: string; version: string
  dependsOn?: string[]
  portTypes?: PortTypeDef[]       // 'geo.aoi', 'disasters.event', 'core.table', 'core.timeRange'
  nodeTypes?: NodeTypeDef[]
  groupTypes?: GroupTypeDef[]
  ops?: OpDef[]
  dataFunctions?: DataFunctionDef[]   // typed functions that charts and maps can call
  providers?: ProviderDef[]           // data access, e.g. DisasterProvider
  templates?: TemplateDef[]
}

interface NodeTypeDef {
  type: string                     // 'disasters.event'
  props: ZodType                   // authored state
  inputs?: Record<string, PortSpec>    // typed input ports
  outputs?: Record<string, PortSpec>   // typed output ports
  compute?(inputs, props, ctx): Promise<Derived>  // derived values (cache only)
  render: React.FC<NodeRenderProps>     // web only; the agent ignores it
  summarize?(node, derived): string     // short text for the LLM canvas context
  defaultSize: { w; h }
}

interface GroupTypeDef extends NodeTypeDef {
  childType: string                // 'disasters.event'
  params: ZodType                  // e.g. { yearRange, sameType, radiusKm, autoSync }
  layout: 'grid' | 'list' | 'timeline'
}
```

- `meta.enabledPlugins` lists the plugins for each doc. All clients and the agent load the same set.
- Plugins are built in for now (static imports and a registry). Dynamic loading comes later.
- Op IDs, node types, and port types use the plugin ID as a namespace.
- The registry exports all ops as JSON Schema tool definitions. The palette, NL mode, and the agent use this export.

---

## 5. Links and reactivity

### 5.1 Ports and links

- A `data` link connects an output port to an input port. `link.create` checks that the port types match and that the graph has no cycle. If one check fails, the op fails.
- A `visual` link is only an arrow. It has no data flow.

### 5.2 Engine

- The engine builds a DAG from `data` links.
- When authored props of a node change, the engine marks the downstream nodes as dirty. It then runs `compute` in topological order.
- Features: debounce, AbortController to cancel stale runs, a result cache keyed by a hash of the inputs, and status per node (`idle | computing | error | stale`).
- Derived values stay in a local cache. They do not go into the Y.Doc. Each runtime (browser or agent) computes them with the same code. This is safe because the data functions are deterministic for the same inputs. (Certainty: 70%. If real APIs make this costly, move compute to a server worker that writes to a `derived` Y.Map.)

### 5.3 Materialized outputs (groups)

- Some outputs are real nodes, not values. Example: the children of the "related disasters" group. The user can move or delete them.
- When the input of a group changes and `params.autoSync` is true, the engine dispatches the op of the group (for example `regenerate`) as a `system` actor op. `parentId` is the triggering invocation.
- **Originator rule:** only the client that made the triggering op runs the cascade op. This stops two clients from writing the same children. If that client disconnects, the group shows `stale`. Any user can then run `regenerate`.

### 5.4 Edge case

If a user edits a child node by hand and the cascade then regenerates the group, the edit is lost. Mitigation: a manual edit sets `autoSync: false` on the group (with a visible badge). The user can turn it on again.

---

## 6. Command palette

1. The user selects nodes and presses Cmd+K.
2. The palette lists ops whose `target` matches the selection and whose `when` is true. Fuzzy search works on the title and description.
3. The user picks an op. A form appears. The form is made from the zod schema, with `defaults(ctx)` filled in.
4. Custom widgets by schema metadata: AOI picker (draw on a map node), node picker (click on canvas), date and year range, enum chips.
5. "Preview" runs `prepare` and shows the plan (for example "adds 7 events, removes 3"). "Run" dispatches.

The palette writes no special code for any op. A new op in a plugin shows up in the palette with no palette change.

## 7. NL mode (later stage, designed now)

1. The user types text in the palette, for example "regenerate related disasters for the last 30 years".
2. The client builds the context:
   - the selection and its summaries (`summarize()`),
   - a short canvas summary (node types, labels, links),
   - the ops that apply to the selection, as tool definitions (JSON Schema from zod).
3. A small model returns one tool call. The interface is model-agnostic: `ModelAdapter.propose(context) -> InvocationDraft`.
4. The palette opens the same form as in section 6, prefilled from the draft. The user edits, previews, and runs.
5. The draft is a `proposed` InvocationRecord. Nothing runs without user approval.

Because tool definitions come from the op registry, NL mode needs no per-op code.

## 8. Agent as a multiplayer user (later stage)

- `apps/agent` is a headless Node process. It connects to y-websocket like a browser client. It loads `packages/core` and the enabled plugins without renderers.
- It sets awareness: name, color, a cursor at the node it works on, and its selection.
- It writes `proposed` records to `proposals`. All users see them on the canvas and can approve or reject them. Ops with `risk: 'low'` can run directly if the doc settings allow it.
- It uses the same `dispatch` path and its own undo manager. Users see its ops in the op log with `actor.kind = 'agent'`.

---

## 9. Templates

```ts
interface TemplateDef {
  id: string                     // 'disasters.sitrep'
  title: string
  inputs: ZodType                // { event: NodeRef<'disasters.event'> | EventId }
  build(inputs): TemplateGraph   // declarative: nodes (with relative layout), links, params
}
```

- `template.instantiate` is one composite op. Its `prepare` resolves the inputs and calls `build`. Its `apply` creates all nodes and links in one transaction. The result is one undo step.
- A template is data. Later the agent can write templates or change them.

---

## 10. Happy path: disasters plugin

### 10.1 Plugin contents (`packages/plugin-disasters`)

- **Port type** `disasters.event`: `{ id, type, name, start, end, footprint: GeoJSON, severity }`.
- **Node** `disasters.event`: a card that shows the event. Prop: `eventId`. Output ports: `event`, `footprint` (type `geo.aoi`). Op: `disasters.event.change` (pick another event).
- **Group** `disasters.relatedEvents`: child type `disasters.event`. Params: `yearRange`, `sameType`, `radiusKm`, `autoSync`. Input: `event`. Op: `disasters.relatedEvents.regenerate(yearRange?, sameType?, radiusKm?)`.
- **Data functions**: `disasters.peopleAffected(aoi, event) -> Table`, `disasters.estimatedDamage(aoi, event) -> Table`.
- **Provider** `DisasterProvider`: `getEvent`, `searchEvents({ bbox, types, timeRange })`, `getImpact(aoi, eventId)`. The first implementation is `MockDisasterProvider` with fixtures (about 20 events with GeoJSON footprints and admin-level impact tables).
- **Template** `disasters.sitrep`.

### 10.2 Core nodes used (`packages/plugin-core`)

- `core.map`: input `aoi` (`geo.aoi`). Props: `aoiOverride?`, `layers[]`, `basemap`. Output `aoi` = the override if set, else the input. So the user can edit the AOI on the map, and the charts follow.
- `core.chart`: input ports from props `source: { fn: 'disasters.peopleAffected', bind: {...} }`. Props: `spec` (Vega-Lite). It calls the data function in `compute`.
- `core.text`: content with bindings such as `{{event.name}}`. Bindings resolve from inputs.
- `core.sticky`: plain note. No ports.

### 10.3 Sitrep graph

```
[disasters.event (seed)] --event--> [core.map "Affected area"] --aoi--> [core.chart "People affected"]
        |                                         \-----------aoi--> [core.chart "Estimated damage"]
        |--event--> [core.text "Summary"]
        |--event--> [disasters.relatedEvents "Related disasters"]
        \--event--> (both charts, for the event ID)
```

### 10.4 Happy path flows

1. **Create:** the user runs `template.instantiate` with `disasters.sitrep` from the palette. The form asks for an event (event picker widget). One op creates 6 nodes and their links.
2. **Change seed:** the user selects the seed node and runs `disasters.event.change`. The map footprint, both charts, the summary, and the related group update. The group update is a `system` cascade op, run by the originator.
3. **Change AOI:** the user runs `map.setAoi` (or draws on the map). Both charts compute again.
4. **Command:** the user selects the related group and runs `regenerate` with `yearRange = 30`.
5. **NL (later):** "regenerate related disasters for the last 30 years" gives the same prefilled form as step 4.
6. **Undo:** undo of step 2 restores the old event ID. The engine computes the old outputs again.

---

## 11. Implementation phases

Each phase ends with a working demo and tests.

| # | Phase | Main output | Verification |
|---|---|---|---|
| 0 | Scaffold | pnpm monorepo, Vite app, sync server, Vitest, lint | `pnpm dev` starts the web app and the server |
| 1 | Core runtime (headless) | doc layout, `DocTx`, op registry, dispatch, undo, op log | Vitest: two Y.Docs synced in memory. Dispatch on A shows on B. Undo on A reverts only A's ops. |
| 2 | tldraw bridge | doc→tldraw projection, gesture→op bridge, `core.text` and `core.sticky`, awareness cursors | Two browser tabs: create, move, delete in one tab shows in the other. Cmd+Z undoes one gesture. |
| 3 | Command palette | cmdk palette, target filtering, zod→form, preview | Select a sticky, Cmd+K, run `node.updateProps`. Op appears in the op log panel. |
| 4 | Plugin system + map/chart | plugin loader, `meta.enabledPlugins`, `core.map` (MapLibre), `core.chart` (Vega-Lite) | Enable or disable a test plugin. Its node types and ops appear or go away in the palette. |
| 5 | Links + reactivity | port types, `link.create` checks, DAG engine, compute cache, node status | Unit tests: cycle rejected, type mismatch rejected, topo order, stale run cancelled. Demo: map AOI → chart. |
| 6 | Disasters plugin | event node, related group, mock provider and fixtures, `regenerate`, data functions | Change seed → map and charts update. Run `regenerate` with a new year range. |
| 7 | Templates + sitrep | `template.instantiate`, sitrep template, event picker widget | Full happy path flows 1–4 and 6 in two tabs. One undo removes the whole template. |
| 8 | NL mode | context builder, tool export, `ModelAdapter`, proposal → prefilled form | Fixture prompts map to the expected op ID and args (eval set of about 20 prompts). |
| 9 | Agent peer | headless client, awareness, `proposals` map, approve/reject UI | Agent joins the room, shows a cursor, proposes `regenerate`. A user approves it. Op log shows `actor.kind = 'agent'`. |

Phases 1–7 are the MVP. Phases 8–9 build on the same registry and dispatch path. They need no change to the core.

### Planned file layout

```
apps/web/                       Vite + React shell, panels (op log, proposals)
apps/sync-server/               y-websocket + LevelDB persistence
apps/agent/                     (phase 9)
packages/core/src/
  doc/         schema.ts, tx.ts
  ops/         registry.ts, dispatch.ts, undo.ts, oplog.ts, toolExport.ts
  reactivity/  graph.ts, engine.ts, cache.ts
  plugins/     types.ts, loader.ts
  templates/   instantiate.ts
packages/canvas-tldraw/src/     projection.ts, gestureBridge.ts, NodeShapeUtil.tsx, presence.ts
packages/palette/src/           Palette.tsx, SchemaForm.tsx, widgets/, nl/ (phase 8)
packages/plugin-core/src/       map/, chart/, text/, sticky/, ops/
packages/plugin-disasters/src/  event/, relatedEvents/, provider/mock.ts, fixtures/, templates/sitrep.ts
```

---

## 12. Open questions and risks

1. **Gesture bridge** (section 2.2): 75% certain the tldraw store listeners are enough. We test this first in phase 2.
2. **Derived data location** (section 5.2): local compute is simplest for mock data. Real APIs may need a server worker. Decide before we connect real APIs.
3. **Op log growth:** the `oplog` Y.Array grows without limit. Later: compact old records, or move them to the server.
4. **Plugin version skew:** two clients with different plugin versions can disagree on schemas. Phase 4 adds a version check against `meta.enabledPlugins`.
5. **Agent permissions:** which ops the agent can run without approval. Default: none. All agent ops are proposals.
6. **Model choice for NL mode:** we choose it in phase 8 through the `ModelAdapter` interface.

Overall certainty that this architecture supports your listed goals without major rework: about 80%. The two items most likely to change are the gesture bridge and the derived-data location.
