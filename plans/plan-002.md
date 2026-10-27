# Plan 002 — Status after phases 0–7, and changes to plan 001

Date: 2026-10-27. This file updates `plan-001.md`. Plan 001 stays as the original spec.

## 1. Status

| Phase | Status | Proof |
|---|---|---|
| 0 Scaffold | Done | npm workspaces, Vite app, sync server, Vitest |
| 1 Core runtime | Done | `packages/core/test/runtime.test.ts` |
| 2 tldraw bridge | Done | Browser test: drag in tab A gives one `core.node.setLayout` op; tab B follows; Cmd+Z reverts |
| 3 Command palette | Done | Palette lists ops for the selection; form comes from the zod schema; Preview shows the plan |
| 4 Plugins + map/chart | Done | Plugin toggle in the top bar; `core.plugin.enable` changes the registry on all clients |
| 5 Links + reactivity | Done | `packages/core/test/reactivity.test.ts` |
| 6 Disasters plugin | Done | `packages/plugin-disasters/test/sitrep.test.ts` |
| 7 Templates + sitrep | Done | Browser test: template fill, seed change in tab A updates tab B, 30-year regenerate from tab B, undo in tab A |
| 8 NL mode | Not started | Tool export and canvas summary exist (`packages/core/src/ops/toolExport.ts`) |
| 9 Agent peer | Not started | Proposals map, approve and reject, and the Proposals panel exist |

Tests: 21 unit tests pass. Typecheck passes.

## 2. Changes to plan 001

1. **Package manager: npm workspaces, not pnpm.** pnpm is not installed on this machine. The layout is the same.
2. **Map: deck.gl on MapLibre, not plain MapLibre.** The user asked for this.
   - `MapboxOverlay` in interleaved mode. One WebGL context for each map node.
   - Layers come from a UI registry keyed by port type (`apps/web/src/nodes/mapLayers.ts`). A plugin can add a factory for its own port type.
   - **MapLibre is pinned to v5.** deck.gl 9.4 interleaved mode reads `map.transform.height`. MapLibre 6 does not have it. Remove the pin when deck.gl supports MapLibre 6.
   - Basemaps need no API key: OpenFreeMap vector styles and Esri imagery. CARTO raster tiles now need a key.
3. **Sync server: own small server on `y-protocols`, not `@y/websocket-server`.** `@y/websocket-server` needs a yjs 14 prerelease. Two yjs copies break sync. The server speaks the y-websocket protocol. Persistence is one snapshot file for each room in `apps/sync-server/data/`. LevelDB was dropped because its native install script is blocked.
4. **UI code is in `apps/web`, not in `packages/canvas-tldraw` and `packages/palette`.** This is simpler for the MVP. Move it to packages when a second app needs it.
5. **Plugin UI is separate from plugin logic.** Headless plugin definitions (`packages/plugin-*`) have no React code. The agent can load them in Node. UI parts register by node type and by widget name (`apps/web/src/ui/registry.ts`).
6. **Template ops.** Each template also gets its own palette op `<templateId>.create`. Its args are the template inputs.
7. **Orphan cleanup.** Undo of a template removes the group, but cascade children are not on the undo stack. The originator client removes orphan nodes and dangling links after a local transaction (`CanvasRuntime.collectGarbage`).
8. **Reactions run after compute.** The op that a reaction dispatches reads fresh derived state (for example, the seed event of the group).
9. **Parent groups recompute when a child changes.** The engine marks the parent dirty.
10. **User identity is per tab** (`sessionStorage`), so two tabs act as two users.

## 3. Known issues

- tldraw shows a "Get a license for production" watermark. A production deploy needs a tldraw license.
- Mock data reuses cyclone names across regions. All numbers are synthetic.
- Link curves can loop back when an input port is to the left of its source. The sitrep layout puts most inputs to the right.
- A manual edit of a child in an auto-sync group is lost on the next cascade (plan 001, section 5.4). The `autoSync` toggle is in the group header. Automatic switch-off on a manual edit is not done.
- The tldraw drag preview is local only. Peers see the cursor and the selection, and the new position after pointer up.
- The op log grows without limit (plan 001, section 12.3).

## 4. Next steps

### Phase 8: NL mode
1. Add `packages/nl` with a `ModelAdapter` interface: `propose({ text, selection, canvasSummary, tools }) -> { opId, target, args }`.
2. Context: `summarizeCanvas` plus node `summarize()` plus `exportTools(runtime.availableOps(target))`.
3. Palette: when the text matches no op, show "Ask: <text>". The result opens the args form, prefilled, with a note. The user runs it.
4. Eval set: about 20 prompts with expected op id and args. Example: "regenerate related disasters for the last 30 years" gives `disasters.relatedEvents.regenerate` with `yearRange: 30`.
5. **Decision needed:** model provider and how the browser gets a key (direct key in dev, or a small server proxy).

### Phase 9: Agent peer
1. `apps/agent`: Node process. It joins a room with `y-websocket` and loads the headless plugins.
2. It sets awareness (`kind: 'agent'`), a cursor, and a selection.
3. It writes proposals with `runtime.propose`. Users approve them in the Proposals panel. The panel and `runtime.approve` exist already.

## 5. How to run

```
npm install
npm run sync      # ws://localhost:1234
npm run dev       # http://localhost:5173/#room=demo
npm test
npm run typecheck
```
