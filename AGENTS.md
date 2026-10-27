# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository. Humans are welcome to read it too.

## Project overview

**humanitarian-ttx** is a Humanitarian Table Top Exercise (TTX) for data exploration and response, built by Development Seed. The project is based on IFRC's Montandon project for data https://montandondata.org/. It's multiplayer canvas where users work on different aspects to developing a situation report after an event. It inludes finding related past events, current datasets, map visualizations, analysis ingests, etc.

At a high-level:
1. Users can start a new board and select an event from Montandon. This will do initial board setup. Showing the event data, map, and related events in that geography.
2. There are widgets for data selectors, map, charts, sticky notes. This is currently built on top of tldraw.
3. There are agents running entirely in the browser to do specific actions. Create new components, run analysis etc.
4. Data comes from Montandon via Duckdb. Additional data like OSM, Overture (buildings/infra) comes as geoparquet too.
5. There's a way to ingest analysis run from Jupyternotebooks from a different project called Notebook Factory
6. There are programmable actions and flow control in the advanced mode
7. It is possible to create reports and export them

We will build an abstraction for creating custom tldraw plugins so tldraw can be swapped out later.


## Shared working agreement

This file is the source of truth for repository-wide agent guidance. `CLAUDE.md` imports it; keep shared rules here.

- Contributors may use different editors, agents, and development methods. Agree on behavior, scope, and verification; leave personal workflow choices to the contributor unless the task specifies one.
- Follow repository configuration and documented decisions, then the conventions in the code being changed. Keep personal preferences out of unrelated code and shared tooling.
- Read `README.md` for setup and layout, and package scripts for available checks. Consult relevant plans and decisions for the task; distinguish planned work from implemented behavior.
- Update this file when a change introduces a shared workflow requirement that cannot be discovered from configuration. Keep machine-specific setup and personal agent instructions out of it.

## Repository layout

npm workspaces monorepo (TypeScript, ESM). Packages are headless and have no React code; the apps put them together. Design docs live in `plans/`: `plan-001.md` is the original spec, and later numbered plans update it. Add components and schematic as we are building into plans.

```
packages/
  core/               doc model, op runtime, plugin registry, reactivity, templates
  plugin-core/        map, chart, text, sticky, number, table nodes and their ops
  plugin-disasters/   disaster event + related events nodes, Monty/mock providers, sitrep template
  nl/                 natural-language command pipeline and backends
apps/
  web/                React + tldraw app (Vite)
  sync-server/        y-websocket server for multiplayer
  nl-gateway/         server-side proxy that holds API keys (OpenRouter, Montandon)
```

### Components

**`packages/core`** is the engine and doesn't depend on tldraw or React.
- **Doc model** (`doc/schema.ts`): one Y.Doc per board (room) with `meta`, `nodes`, `links`, `oplog`, and `proposals`. A node has a `type`, `props`, `layout`, an optional `parentId` (groups) and an optional `anchor` (pinned to a map). A link is either `visual` or `data`.
- **DocTx** (`doc/tx.ts`): the only write API. Ops get a `DocTx`, and every write goes through it inside one yjs transaction.
- **Ops** (`ops/`): every change is a typed op, defined with `defineOp` and identified as `<plugin>.<area>.<verb>`. `prepare` is async and read-only (it fetches data and builds a plan); `apply` is sync and is the only step that writes. A `doc` op writes the shared doc; a `view` op only moves the local camera.
- **CanvasRuntime** (`ops/runtime.ts`): one per client (browser tab or agent). It owns the registry, a per-user undo manager and the reactivity engine. Users and agents dispatch with an `InvocationOrigin` (undoable); system cascades use `SystemOrigin` (not undoable).
- **Tool export** (`ops/toolExport.ts`): turns ops into JSON Schema tool definitions and summarizes the canvas, for use by LLMs and agents.
- **Plugin API** (`plugins/`): a plugin registers port types, node types, ops, data providers and templates. A node type can declare input and output ports, a `compute` function, and an `onInputsChanged` reaction.
- **Reactivity** (`reactivity/`): computes node outputs along data links in topological order and rejects links that would create cycles. Computed values are a local cache and never go into the Y.Doc. Under the originator rule, only the client that caused a change runs the reactions.
- **Templates** (`templates/`): build a set of nodes and links from a template definition. Each template becomes a palette op.

**`packages/plugin-core`** is always enabled and uses the same plugin API as every other plugin.
- Node types: `core.map`, `core.chart`, `core.text`, `core.sticky`, `core.number`, `core.table`.
- Port types: `geo.aoi` (polygon feature), `geo.features`, and tables.
- Ops: setting map view, AOI and basemap; chart source and mark; text content; sticky color; pinning, unpinning and moving pins on a map.

**`packages/plugin-disasters`** is the first domain plugin.
- Node types: `disasters.event` and `disasters.relatedEvents` (a group of past events near the selected one).
- Data functions: `disasters.peopleAffected` and `disasters.estimatedDamage`.
- Template: `disasters.sitrep`, the initial setup of a situation report board.
- `DisasterProvider` interface with two implementations: `MontyDisasterProvider`, which queries the Montandon STAC API through the gateway (`/monty/search`), and `MockDisasterProvider` (synthetic and offline).

**`packages/nl`** turns natural-language commands into op invocations (see `plans/plan-003.md` and `plan-004.md`).
- The pipeline turns an utterance into one proposed invocation: retrieve candidate ops, choose the op and scope, then fill each argument. The proposal is shown to the user before it applies.
- Each step goes through a swappable interface (`Decider`, `Embedder`, `Extractor`). Backends: `rules` and `lexical` (offline), and `remote`/`openrouter` (Jev decider, LLM extractor fallback, embedder).
- `eval/` holds a labeled eval set and runner (`npm run nl:eval`).

**`apps/web`** is the React app.
- `canvas/bridge.ts`: two-way binding between tldraw and the runtime. The Y.Doc is the source of truth and tldraw only displays it; a user gesture becomes one op when it ends.
- `canvas/NodeShapeUtil.tsx`: a single generic tldraw shape for every node type. Content comes from the UI registry.
- `canvas/pins.ts` and `focus.ts`: cards pinned to maps (they scale with zoom), and focus mode.
- `ui/registry.ts`: plugins register their React node views and widgets here, keeping the plugin packages headless.
- `nodes/`: views for each node type. Maps use deck.gl with maplibre (maplibre is pinned to v5) and charts use Vega-Lite.
- `palette/`: the ⌘K command palette, a form generated from each op's schema, and NL ("✨ Ask").
- `plugins.ts`: chooses the Monty provider or the mock (`VITE_DISASTER_DATA=mock`).
- The Vite dev server proxies `/nl` and `/monty` to the gateway on `:8787`.

**`apps/sync-server`**: a minimal y-websocket–compatible server. It keeps one Y.Doc per room, persisted as a snapshot file. Peers share live cursors and drags through awareness, not the doc.

**`apps/nl-gateway`**: a small Node HTTP server that holds the secrets so the browser never sees them.
- `/nl/decide`, `/nl/extract`, `/nl/embed`: proxied to OpenRouter.
- `/nl/log`: appends to the NL log.
- `/monty/search`: proxied to Montandon with the bearer token added.
- `/nl/health`: status check.

### Not built yet

These are from the overview above and don't exist in code yet: in-browser agents, DuckDB/GeoParquet data (OSM, Overture), Notebook Factory ingest, advanced-mode flow control, report export, and the abstraction that lets tldraw be swapped out. Check `plans/` before starting on any of them.

## Setup and commands

```sh
npm install
cp .env.example .env   # set OPENROUTER_KEY and MONTANDON_TOKEN
npm run sync           # sync server, ws://localhost:1234
npm run nl             # gateway, http://localhost:8787 (required for real Monty data and NL)
npm run dev            # web app, http://localhost:5173/#room=demo
npm test               # vitest
npm run typecheck
```

If `/monty/search` returns a 502 with an empty body, the gateway isn't running: that's Vite's proxy error, not Montandon's. To work offline, use `VITE_DISASTER_DATA=mock npm run dev`.

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
