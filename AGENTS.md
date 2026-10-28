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
packages/
  core/          @ttx/core, no React: the board (reads), BoardTx (the only writes), the op runtime,
                 the plugin registry, tool export, the builtin 'core' plugin (box, text, object and view ops),
                 and the board's agent chat (chat.ts)
  plugins/       @ttx/plugins, no React: the headless plugins every board loads (map, events, agent), which the
                 web app and the Worker's agent both use, and the Montandon client (src/monty/, imported as
                 '@ttx/plugins/monty/<file>')
apps/
  web/           React app (Vite): our own infinite canvas
    src/plugins.ts the plugins every board loads (@ttx/plugins), and their UI
    src/board/     typed board objects, the connection to the Worker, and presence (who selected what)
    src/canvas/    camera, input, selection, toolbar, object views, the UI registry (registry.ts)
    src/palette/   the command palette (⌘K) and forms made from op schemas
    src/map/       the map widget (its plugin is in @ttx/plugins)
    src/events/    the event widget: search Montandon, show one event across its sources
    src/agent/     the agent chat sidebar
  worker/        Cloudflare Worker: serves the built web app; one Durable Object per room relays and stores the board
                 and runs the board's agent (src/agent/); /monty/search proxies Montandon with the token
```

- **Our own canvas, no tldraw.** tldraw needs a paid license off localhost, and the canvas we need is small. The design follows vsticky: a DOM "world" layer moved by one CSS transform. The camera is local to each person and never synced.
- **The board is a Yjs doc** (`packages/core/src/doc/board.ts`): one map of objects (box, text, map, event), each a Y.Map of plain fields. Layer order is a float `z` per object, ties broken by id. The object type sets where a new object goes (`layer`): texts and events on top, boxes and maps at the bottom, since they are mostly backgrounds. Text is stored as plain strings, with no encryption. The doc also has an `oplog` array (see ops below).
- **Ops are the only write path** (`plans/plan-007.md`). The UI, the palette and agents do not write the doc. They dispatch an op on the `Runtime` (`packages/core/src/ops/runtime.ts`). An op has a zod `args` schema, an optional read-only `prepare`, and a sync `apply` that writes through `BoardTx` in one transaction. `BoardTx` checks every add and update against the object type's schema. Use `runtime.dispatch` (sync) for gestures and typing, and `runtime.invoke` (async) for the palette and tools. Undo and redo cover only your own edits, one step per gesture: call `runtime.beginGesture()` when a gesture starts (a press, a key, a button). An op with `gesture: true` (drag, typing) writes one op log entry per gesture, not one per frame. If `apply` throws after a write, that write stays (Yjs has no rollback), so check input before the first write.
- **Plugins** add object types and ops (`definePlugin`). Each object type gets a `<type>.add` op. Core uses the same API (`packages/core/src/plugins/core.ts`). To add a type: write a headless plugin in `packages/plugins` (zod fields, ops) and list it there, then add its UI with `registerObjectUI` (view, tool, edit behavior) and, for special form fields, `registerWidget`, imported from `apps/web/src/plugins.ts`. Never change a stored type name or field: old boards use them.
- **Tools:** `exportTools(runtime.availableOps(target))` gives JSON Schema tool definitions with input `{ ids, args }`. `runtime.callTool(name, input, actor)` runs one. Hidden ops are not tools, and an op with `risk: 'high'` runs only for a user actor. `summarizeBoard` gives an LLM a short text of the board. In dev, `window.runtime` is in the console.
- **The board agent** (`plans/plan-008.md`) runs in each room's Durable Object, as a headless `Runtime` with the actor `{ kind: 'agent' }` on the doc the room holds (`apps/worker/src/agent/`). People talk to it in the chat sidebar. The chat is a `chat` array in the board doc, one shared thread per board (`packages/core/src/chat.ts`). Each message stores the ids its sender had selected, and the agent acts on those ids only, never on a live selection. The agent answers one message at a time with a plain tool loop on OpenRouter (`AGENT_MODEL` in `wrangler.jsonc`), at most 8 model calls per turn and 20 turns per room per hour. The agent may not add an object larger than 4× its type's default size (low-cost models sometimes send junk sizes such as `h: 4000`); the model is told to leave out `w` and `h`. Each reply stores what undoing it needs; its Undo button runs the hidden op `agent.undoTurn`. Read-only agent tools are not ops (`apps/worker/src/agent/tools.ts`): `board__get`; `geocode__search` (place name to area, with the public Photon server at photon.komoot.io, which asks for fair use), which the agent uses before `map.showArea`; and `events__search` (Montandon, when `MONTANDON_TOKEN` is set), which it uses before `event.add`. Each message also stores the center of the sender's view (`ViewController.center`): an add without `x` and `y` goes in the middle of it, as from the palette, and each further add in the same turn goes to the right of the last one. The request gives the agent the asker's person id and what they see on each map. The agent runs each tool call as `{ kind: 'agent', onBehalfOf: <asker's person id> }`, so ops that act on "my" things act on the asker's (`map.showArea` without `for` changes the asker's view), and the op log shows whom each agent write was for. Without `OPENROUTER_API_KEY`, the agent answers that it is not configured. The Durable Object also sets the agent's presence while it works; its awareness origin is then `'local'`, not a socket.
- **Multiplayer runs on our own Cloudflare Worker.** `/connect/<room>` goes to that room's Durable Object, which speaks the standard y-websocket protocol, keeps the doc in memory and appends every update to its SQLite (compacted into one row when there are more than 500, on load and while the room runs). Cloudflare caps a SQLite row at 2 MB, so larger updates are split across rows (`apps/worker/src/updateLog.ts`). Websockets use Cloudflare's Hibernation API (`ctx.acceptWebSocket`): the room leaves memory between messages, so open but idle tabs cost no Durable Object time. With `socket.accept()` a room is billed for as long as any tab is connected, which used up the free plan's daily allowance (13,000 GB-s, reset at 00:00 UTC) and took every board offline. Presence (awareness) is kept in memory only: it starts empty after a wake and browsers re-send theirs every 15 s; which presence ids a socket controls is kept on the socket (`serializeAttachment`). The browser uses y-websocket's `WebsocketProvider`. Tabs of one browser also sync with each other directly (BroadcastChannel), so test multiplayer from two origins or two browsers, or the server is not involved.
- **Input:** drag on empty canvas to select; shift+drag selects from anywhere, even over a map or box, and adds to the selection; shift+click toggles one object; scroll pans; pinch or ⌘+scroll zooms; space+drag pans. Tools: V select, R box, T text, M map, E event (each object type's UI registers its tool). ⌘K opens the command palette. `]` / `[` bring to front / send to back, with ⌘ one step. Delete removes. Double-click edits a text, lets a map take the pointer, or opens an event's search; Esc gives it back. The left panel sets the color of selected boxes and texts, and A+ / A− the text size (`canvas/style.ts`: colors are stored by name). A text's height follows its content; only the person who changed it refits it.
- **Icons:** Phosphor (`@phosphor-icons/react`, regular weight, imported as `<Name>Icon`; only imported icons are bundled). Icon-only buttons carry a `title` and an `aria-label`. For hazard and humanitarian-sector symbols, which Phosphor lacks (earthquake, volcano, displacement, clusters), consider the OCHA Humanitarian Icons; check their license first.
- **Map widget** (`apps/web/src/map/`): a live MapLibre map in a box. The basemap is shared board state. **Map views are per person, in the doc:** the `views` map (person id → object id → center, zoom, bearing, `at`; `packages/core/src/views.ts`), so nobody's pan moves another person's map, but the agent can read and change a person's view, and one person can later follow another. A person's pans are written directly, 1 s after the map stops, with no op log entry and no undo. Ops change views through `BoardTx.setView`: `map.showArea` moves the views of given people, of everyone, or of the runner (for an agent: the person it acts for). A person with no view of a map starts at the latest view anyone saved. Deleting an object deletes its views. A person is one browser: the id, name and color are in localStorage (`connect.ts`), so two tabs of one person share views; undo is still per tab, because each tab has its own runtime.
- **MapLibre 6.** It draws right-to-left labels (Arabic, Hebrew) itself, with no RTL plugin. It is ES modules only, and under Vite its worker must be imported as `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and passed to `setWorkerUrl` (a plain `?url` import draws nothing in dev).
- **deck.gl runs in overlay mode** (`MapboxOverlay({ interleaved: false })`): deck.gl 9.4's interleaved mode throws on every frame with MapLibre 6. Overlay costs a second WebGL context per map, and deck.gl layers draw above the map's labels. Revisit interleaved mode when deck.gl supports MapLibre 6.
- **Event widget** (`apps/web/src/events/`): a disaster event from the Montandon STAC API. The board stores only `eventId`; each browser fetches the details (`apps/web/src/events/monty.ts`, one shared client with a cache). The client is in `packages/plugins/src/monty/`, so the agent can search too. Search text is read as country, hazard type, year and source (`search.ts`), turned into a CQL2 filter, and the leftover words rank by name. Hazard types use the UNDRR-ISC 2025 codes with their GLIDE and EM-DAT equivalents (`hazards.ts`; add a type only with its rows from the upstream table). Sources record one event under different `monty:corr_id`s, so an event's other sources are found by hazard, country and time, as upstream's correlation algorithm does.
- **Montandon needs a bearer token, which never reaches the browser.** The browser posts STAC search bodies to `/monty/search`; the Worker adds `MONTANDON_TOKEN` and forwards them to `MONTANDON_BASE_URL` (`apps/worker/src/monty.ts`, standard `fetch` only, so it can move to another server). The room's agent searches with the same token, without the proxy (`stacSearch`). The base URL is a var in `wrangler.jsonc`: the staging API, as `agent-docs/features.md` scopes. Without the token, `/monty/search` answers 503. Anyone with a deployed URL can run searches through the token, as anyone can edit its boards.
- **Rooms:** one board per `#room=<id>`. Opening the app without one, or pressing New board, starts a board with a random 16-character id (`board/room.ts`); the URL is the link to share. There is no access control: anyone with the link can edit, so keep real exercise data off the preview.

The first prototype is on the `experiment` branch: a headless op runtime, typed data links, a disasters plugin on Montandon, and a natural-language command pipeline. It is a reference, not a base. Read it before rebuilding a part it covered, in particular:
- `apps/web/src/nodes/MapView.tsx` and `plans/plan-005.md`: maps inside a canvas (edit and focus modes, WebGL context limits, pixel ratio at canvas zoom).
- `packages/plugin-disasters/src/montyProvider.ts`: the Montandon queries that `packages/plugins/src/monty/client.ts` has not taken over yet: related events near an event, impact tables, and event footprints.

## Setup and commands

Node 22 or later.

```sh
npm install
echo 'MONTANDON_TOKEN=<token>' > apps/worker/.dev.vars   # once; git-ignored. Needed for event search
echo 'OPENROUTER_API_KEY=<key>' >> apps/worker/.dev.vars # needed for the board agent
npm run sync        # Worker + Durable Objects locally (wrangler dev), http://localhost:8787
npm run dev         # web app with hot reload, http://localhost:5173 (proxies /connect and /monty to :8787)
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

Repository secrets: `CLOUDFLARE_API_TOKEN` (a token limited to editing Workers), `CLOUDFLARE_ACCOUNT_ID`, `MONTANDON_TOKEN` and `OPENROUTER_API_KEY`. Cloudflare keeps secrets per Worker and each branch is its own Worker, so the workflow uploads `MONTANDON_TOKEN` and `OPENROUTER_API_KEY` with every deploy (`--secrets-file`). Without them, deploys still pass; event search answers 503 and the agent answers that it is not configured.

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
