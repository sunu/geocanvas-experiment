# Plan 010 — Bring your own agent to the local canvas through MCP

Date: 2026-10-28. Status: delivery steps 1–3 implemented on `feat/local-mcp` (section 11); steps 4–5 not started.

## 1. Outcome

Let a person use their own Claude or Codex to work on the app's free-form infinite canvas and maps. They run the app locally, keep its browser tabs open, and connect their assistant through a small local companion process. One connection can manage several boards, identified by their local links.

The primary workflow starts in the person's chosen agent: connect it, give it a board link, and ask it to operate the existing app. The assistant reads structured state and uses the same capabilities as the existing UI and built-in agent. New registered app capabilities should become available without writing another MCP implementation. Connecting an external agent must preserve normal use of the UI and built-in agent.

An additional workflow lets the assistant respond to an explicit handoff from the canvas or reconsider the board after the person pauses editing. Keep this earlier requirement, but deliver it independently of basic tool access. Disaster data remains an available plugin capability, not the organizing principle of this integration.

Example: a person supplies two local board links, asks their assistant to arrange notes and map several places, then edits one board by hand. The assistant can read the new state and continue working on that board without confusing it with the other one.

## 2. Decisions from the interview

| Question | Decision |
| --- | --- |
| Product scope | General infinite canvas and maps; expose existing capabilities. |
| Where it runs | Local app and a small local companion process. Hosted integration is out of scope. |
| Browser lifetime | The app must stay open. No execution against a closed board tab. |
| Clients | Target Claude Code, Claude Desktop, Codex CLI, and Codex desktop. Verify each separately. |
| Boards | Multiple boards per connection, supplied by link. No accounts, ownership, or workspace directory. |
| Agent context | Structured state first. No screenshots or rendered-map inspection in this version. |
| Direction | Agent-to-canvas tools and canvas-to-agent handoffs/change updates. |
| Triggers | Explicit handoff or a timeout after editing settles. Avoid a model invocation per event. |
| What the agent does | Infer useful action from edits and current state; no prior assignment required. |
| Act versus propose | Leave the decision to the model for now. The detailed policy is parked. |
| Tool evolution | New registered app capabilities must carry through without per-tool MCP code. |
| Coexistence | Preserve the built-in agent and normal UI use; do not route one request to both agents. Concurrent editing policy is still being clarified. |

The remainder is a proposed implementation, not additional product decisions already approved in the interview. Multiple boards do not imply a requirement for several people's autonomous agents to coordinate on one board.

### 2.1 Assumptions checked against the code

| Assumption | Finding | Consequence |
| --- | --- | --- |
| Exporting the registries exposes everything in the UI. | Partly true. Board ops are registered, but some UI reads/workflows are not. Notebook run search calls `NotebookFactory.listRuns` directly. | Close specific parity gaps in the app's shared capabilities; do not implement them only in MCP. |
| Every new tool will appear automatically. | Only if it is registered in the connected execution environment, can be described/returned over the bridge, and the client refreshes discovery. | Define the registration and refresh contract, and test it with previously unknown capabilities. |
| Separate chat queues make two agents conflict-free. | They prevent duplicate requests, but both agents still edit the same objects. Map layers are replaced as a whole, and built-in turn Undo restores whole objects. | Treat routing, concurrent edits, and undo interference as separate requirements. |
| Basic MCP access needs a background agent runner. | The existing execution path can serve an agent's tool requests without starting a model itself. | Make the basic integration runnable without provider SDKs, model keys, or a companion-owned conversation. |
| Running locally means operating offline. | The app still uses external basemaps, datasets, geocoding, and optional service credentials. | Reuse existing service setup and failures. Local execution is not an offline-data promise. |

Recommended delivery split: first ship the ordinary agent-driven workflow and tool inheritance; then add canvas-originated handoffs and background reactions. This changes sequencing, not the earlier product requirements.

## 3. Existing implementation to reuse

- [Runtime](../packages/core/src/ops/runtime.ts) validates and executes ops through `BoardTx`. `callTool` refuses hidden ops and high-risk ops for agent actors. These checks must remain authoritative.
- [Tool export](../packages/core/src/ops/tools.ts) already generates JSON Schema from ops and read-only tools. Adapt this schema to MCP; do not maintain a second handwritten catalog.
- [Browser connection](../apps/web/src/board/connect.ts) owns the live Yjs doc, person identity, runtime, and room connection. Local persistence still uses the existing local Worker/Durable Object setup.
- [Browser tools](../apps/web/src/tools/registry.ts) include browser-only data access and caching. Keep those implementations in the browser.
- [Canvas](../apps/web/src/canvas/Canvas.tsx) owns selection and the local camera. It installs a `ViewController` on the runtime.
- [Board reads](../packages/plugins/src/agentTools.ts) currently return a text summary. MCP needs a structured snapshot in addition to this existing capability.
- [Agent loop](../packages/plugins/src/agent/loop.ts) contains placement defaults, size limits, actor attribution, and turn undo bookkeeping. Some safeguards are outside `Runtime`; simply calling `Runtime.callTool` would omit them.

The built-in model loop runs in the room Durable Object, and, since plan 009, also in a browser tab on the person's own key. The proposed browser executor runs tools, not an additional model loop.

## 4. Proposed architecture

```text
Claude / Codex MCP client
            |
       local MCP transport
            |
Local companion -------- optional runner (later milestone)
            |
 authenticated loopback bridge
            |
Open browser tab(s)
  structured context + agent Runtime + browser ToolRunner
            |
  existing Yjs room connection
            |
Local Worker / Durable Object persistence
```

### 4.1 One browser execution module

Add a module under `apps/web/src/mcp/` that accepts validated requests, reads the current board, executes a capability, and returns its result. The transport must not manipulate DOM controls or write Yjs fields directly.

Use an agent runtime on the tab's existing doc, with a distinct actor and undo history. Set `onBehalfOf` to that tab's person so map view ops affect the intended person. Connect supported view ops to the tab's existing camera controller. Preserve the user's own undo history.

The person keeps their chosen agent's conversation, model, and approvals. Basic MCP calls execute directly through this module; they do not ask the built-in agent to interpret another prompt. The companion must not require a separate model session just to serve tools.

Extract only the placement, size checking, and execution bookkeeping that both the built-in loop and this executor need into an appropriate headless module. Keep OpenRouter prompting and the model loop out of it. Preserve the built-in agent's behavior while making the shared rules testable through execution.

Map layers continue to fetch and render through the browser. Adding a layer means its recipe was accepted; it does not mean the asynchronous data fetch or rendering succeeded. Return layer readiness/errors separately when available.

### 4.2 Local companion and transports

Propose a Node workspace under `apps/mcp/`. One companion owns browser registration, request routing, and pending handoffs. It does not maintain a second editable copy of the board or host model credentials supplied through TTX.

Use a loopback bridge for tab connections. Provide a local stdio MCP entry point for clients that launch a server command; separate client processes forward to the same companion. Add loopback Streamable HTTP only where the client compatibility spike demonstrates a need. The process lifecycle must avoid two instances competing for one port.

Bind to loopback, validate browser origins/Host, and use a per-run pairing credential. This is local process pairing, not a user account system. Reject arbitrary origins and nonlocal board URLs; “any link” means any valid board link in the local app. Do not turn a supplied URL into unrestricted fetching or shell execution.

Evaluate the official MCP SDK during the spike. Adding it or a WebSocket dependency needs the repository's dependency approval before implementation. This plan adds no dependency.

### 4.3 Board and tab identity

Identify a board by normalized local origin plus room id, and each registered tab by an ephemeral connection id. Every board operation carries an explicit board handle. Never use a process-global “current board.”

A connection can list registered open boards and resolve a supplied local link. If a link has no live tab, return `board_not_open` and the link to open. Creating a board should reuse room-id generation and return its local link; execution starts only after a tab registers. Do not assume a browser will allow script-created tabs without a user gesture.

If two tabs show the same board, bind interactive context to one selected tab and report it. Do not broadcast the same mutation to both tabs. On disconnect, suspend that binding rather than silently switching the person's selection or view to a different tab.

## 5. MCP capabilities and structured context

Use the existing schema generators for ordinary board tools, adding the explicit board handle to their inputs. Keep op names and their `{ ids, args }` semantics recognizable. A small set of integration tools covers open-board discovery, link attachment, snapshots, and change retrieval; exact names follow the spike.

The capability inventory must compare UI commands, built-in agent tools, and browser read tools. “Parity” means equivalent supported outcomes, not exposing hidden gesture primitives or lifting high-risk restrictions. Include object creation/editing/layout/deletion, styles, maps, place search, basemaps, layers, and existing event capabilities. Register browser equivalents of worker-only read tools where needed, using existing local proxies and clients.

### 5.1 New capabilities without MCP-specific implementations

The open app publishes a capability manifest derived from its loaded op registry and environment's `ToolRunner`. The companion consumes those descriptions and forwards calls generically; it must not import a second hardcoded plugin list or switch on each app tool name. Keep transport-specific discovery/attachment tools separate from this generated catalog.

The extension contract is:

1. A new board action is registered as an op, and a new read capability as a `ToolDef`, in the app. Preserve the distinction between writes and reads.
2. Descriptions, input schemas, defaults, restrictions, and implementation remain with that capability. Common agent execution rules serve both agents where their environments support the operation.
3. A compatible capability becomes discoverable and callable through the generic bridge after the app loads it and the MCP client refreshes its catalog. No new companion handler is required.
4. Browser-only capabilities execute in the browser; this does not imply they also run in the Worker. Report environment/credential limitations explicitly.
5. A genuinely new output representation or browser interaction may require shared app integration. Do not claim arbitrary new React UI code becomes agent-accessible automatically.

Concrete existing gap: [notebook UI](../apps/web/src/notebooks/NotebookObject.tsx) searches and reads run metadata through [NotebookFactory](../apps/web/src/notebooks/api.ts), while the browser tool registry exposes only artifact reads. An agent can set a run id but cannot discover suitable runs through that registry alone. Register the missing reads around the existing client and have the UI reuse them. Inventory composed actions such as “Show on a new map” for equivalent op/tool sequences or a shared app action; do not duplicate their behavior in the companion.

Attach a manifest version/fingerprint to tab registration. Require compatible schemas across attached tabs; report a reload requirement for incompatible app versions rather than choosing one schema silently. Tool execution must still validate against the target tab's live registry. Tool discovery should not depend on the most recently selected object or a mutable current board.

Use the negotiated MCP version's tool-list change mechanism where supported, and document client refresh/reconnect as the baseline. Hot reload in every client is not a promise. The [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) defines discovery and change notifications; verify client behavior in the compatibility spike. Keep the advertised catalog coherent across clients and report target-board availability separately.

Acceptance test: register a new fixture object type/op and a new read tool in the app without changing the companion, then discover, invoke, and read their results through MCP. Repeat after a schema change and with an incompatible older tab. Passing this test is the evidence for future tool support.

### 5.2 Context for equivalent behavior

A structured snapshot should include:

- Board handle, tab connection, snapshot generation/revision, and person id.
- Objects with stable ids, types, geometry, z order, text, styles, and stored plugin fields.
- Selection ids and canvas viewport context, with canvas coordinate conventions.
- Each map's stored layers and the person's view, including bounds where available.
- Known loading/error state and attribution for data layers, without claiming to understand rendered pixels.
- Available capabilities and actionable reasons when a capability is unavailable.

Large reads need bounded results, object-id filtering, and explicit truncation. Keep layer recipes distinct from fetched datasets. Reuse browser tool caches; do not send entire building datasets or raster bytes just to describe a map.

Selection, camera, and view context must be captured for each handoff. “These” means that captured selection, even if the person later selects something else. A snapshot is not a lock: revalidate target ids at execution and report stale/missing targets.

## 6. Coexistence with the built-in agent

“Does not conflict” needs observable guarantees:

- **Separate requests:** ordinary MCP calls and external handoffs never enter the built-in agent's pending chat queue. Existing chat requests still go to the built-in agent. Connecting MCP must not disable or replace it.
- **Shared app behavior:** both agents use the same op definitions and common execution rules, with environment-specific tool bindings. Avoid two independently maintained implementations of placement, limits, and editing semantics.
- **Distinct attribution:** give external sessions their own actor ids and visible activity. Do not reuse the built-in actor id `agent`, its presence identity, or its request/reply records.
- **No agent feedback loop:** later background triggers must exclude writes by either agent, not just external-agent writes. System updates and unattributed synchronization events must not automatically be labeled human activity.
- **Undo protection:** separate undo stacks are necessary but insufficient. Built-in `agent.undoTurn` currently restores whole objects and can overwrite later external or human changes. Coexistence requires detecting such overlap and refusing or resolving the stale undo explicitly; test both undo directions, including edited objects created by an earlier turn. Choose the smallest protection against the demonstrated failure before changing the shared undo contract.

Concurrent editing policy (decided 2026-10-28): both agents may write at once. Undo, of either agent, refuses when an object it would put back was changed after the change it undoes (section 11). A single-writer lock was not chosen: it would need coordination that both browser execution and the Worker agent honor, and a mutex inside the companion or a presence/busy indicator cannot enforce it.

Even serialized agent turns cannot guarantee that a plan based on an old snapshot remains appropriate after human edits. Revalidate at execution and reject known stale assumptions where the operation depends on previously read fields. Do not claim that Yjs convergence, target-id validation, or independent undo stacks solve conflicting intentions. The spike must demonstrate overlapping layer edits and undo behavior before claiming coexistence is complete.

## 7. Bidirectional interaction without event noise

### 7.1 Explicit handoff

Provide an action in the local app to send a request and captured context to a connected assistant runner. Associate it with a request id and board handle. Show pending, running, completed, failed, and disconnected states. If only an MCP client is connected and there is no supported runner, retain the handoff for retrieval and explain that it has not started a model turn.

Keep this routing separate from the built-in agent's chat queue: the existing `Agent` consumes every pending user chat message. Reusing that queue unchanged would cause duplicate execution or “not configured” replies. Store/display external requests without making them requests to OpenRouter.

### 7.2 Pause after editing

While background participation is enabled, coalesce human edits into one change batch per board after a trailing inactivity interval. Start with a tunable implementation default, provisionally five seconds; this duration is not an interview decision.

Track final changed fields/objects, deletions, and relevant view context rather than every drag frame, keystroke, cursor movement, or presence heartbeat. Selection and camera can inform context without each becoming an independent wake trigger. Use structured board changes as well as op metadata: the op log alone omits some view writes and delays gesture entries.

Pass the batch and current state to the model and let it decide whether to act, propose, or do nothing. Do not require a prior assignment or add a mandatory proposal gate. Keep the detailed decision policy parked.

Prevent feedback loops by excluding both built-in and external-agent writes as new human wake triggers. Run at most one background turn per board and honor the coexistence policy; accumulate human edits made during that turn into the next batch. An unchanged board must not repeatedly invoke the model. Explicit handoff bypasses the inactivity delay.

### 7.3 Change delivery and failure handling

Use a session-scoped generation and monotonic revision for change retrieval. If a tab reloads or the bounded change buffer expires, require a fresh snapshot rather than inventing missing changes. Stop scheduling when the tab disconnects; background-tab throttling must be tested and reflected in connection status.

Give mutating requests unique ids and retain their outcomes for the live session so a transport retry does not duplicate an add. If a tab disappears after applying a write but before returning the result, report an uncertain outcome and require reconciliation. Do not promise exactly-once writes across reloads or replay uncertain mutations automatically.

Expose results and an undo path for external edits. Initially use the distinct browser agent runtime's undo while its tab lives; describe that lifetime honestly. Group undo by a runner turn when the runner provides a turn id, otherwise by invocation. Do not silently reuse the built-in snapshot undo's overwrite semantics for later human edits.

## 8. Client compatibility and waking the model

MCP tools and a mechanism to start a model turn are separate interfaces. Supporting a client's MCP connection does not establish that an arbitrary idle desktop conversation can be resumed from a browser event.

| Target | Proposed tool connection | Background/handoff execution to validate |
| --- | --- | --- |
| Claude Code | Local stdio MCP | Programmatic CLI with an explicitly retained session id. |
| Claude Desktop | Local MCP configuration/extension | Verify a documented mechanism; otherwise use a companion-owned Claude Code session and disclose that it is a separate session. |
| Codex CLI | Local stdio MCP | Codex App Server session controlled by the companion. |
| Codex desktop | Local MCP configuration | Validate desktop configuration and session interoperability; do not assume the companion can take over an open chat. |

All four remain targets. Record installed versions and test tool access and background behavior independently. Basic MCP support is an independently usable milestone; do not gate it on waking existing desktop chats. If a client needs a separate runner session, establish whether that experience meets the requirement before calling its background integration complete. Preserve client tool approvals and report requests requiring user input.

Use the person's existing supported Claude/Codex login and execution path where available. Do not assume desktop subscription access automatically authorizes SDK/API usage; verify runner authentication and billing during the spike. TTX itself should not require a model API key for MCP tool access.

References checked on 2026-10-28:

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): local stdio and Streamable HTTP configuration.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): explicit thread lifecycle and starting/resuming turns.
- [Claude Code programmatic execution](https://code.claude.com/docs/en/headless): noninteractive execution, structured output, and resuming a specific session.
- [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp): remote connectors originate from Anthropic infrastructure; local Desktop MCP configuration is a separate mechanism. A localhost-only app cannot rely on the remote connector route.

## 9. Delivery steps and verification

1. **Basic compatibility spike and capability inventory.** Demonstrate one structured read and one ordinary op through each target client's local MCP setup, using the person's existing conversation. Inventory parity gaps and document whether refresh is automatic or requires reconnecting. No background runner is needed for this test.
2. **Browser executor, companion, and tool inheritance.** Implement board registration, explicit routing, snapshots, generated tools, and connection errors. Verify two open boards, duplicate tabs, captured context, map views, browser data tools, high-risk refusal, and independent user/agent undo. Prove that new app ops and read tools work without companion changes.
3. **Coexistence and usable first release.** Resolve the concurrent editing policy and stale-undo protection. Verify that external requests never wake the built-in agent, built-in requests still work, attribution stays separate, and overlapping edits/undos follow the chosen policy. Exercise disconnect/reload, stale schemas/ids, uncertain write outcomes, missing data-service keys, rejected origins, and bounded large-board responses. Document local startup and each client's setup. This release must work with no TTX model key when the built-in agent is unconfigured.
4. **Runner spike and explicit handoff.** Verify programmatic turn start/resume, authentication, approvals, and whether a separate session is needed for each runner. Then connect the app's handoff UI and report progress. Verify that one handoff runs once and never enters the built-in request queue.
5. **Inactivity batches.** Add coalescing, change cursors, background participation controls, and loop suppression. Verify that many human edits yield one wake, no edits yield none, neither agent's writes trigger another turn, and human edits during a turn are preserved. Exercise sleeping/background tabs and companion restart.

Use unit/integration tests for routing, coalescing, retries, and runtime safeguards; use actual browser/client smoke tests for capabilities and client compatibility. Run the repository's `npm test`, `npm run typecheck`, and `npm run build` for implementation changes. No runtime checks are claimed by this documentation-only draft.

## 10. Deferred or unresolved

- Exact policy for acting versus proposing, explicitly parked by the user.
- Exact inactivity duration and which view-only changes should count as activity.
- Existing desktop conversation reuse versus a companion-owned runner session.
- Full parity inventory, especially UI-only view actions and data-result inspection.
- Concurrent writing by the two agents, and the minimal shared coordination needed for the selected policy.
- Conflict detection for built-in turn Undo; this is a coexistence acceptance gap, not a claim that current Undo is safe.
- Undo after tab reload; no durable external turn history is promised initially.
- Screenshots, hosted MCP, accounts, public plugin distribution, and unattended execution with closed tabs are outside this version.

No scenario content, stored object names, production deployment, or existing room-sharing semantics change as part of this plan.

## 11. Implementation (steps 1–3)

Built on `feat/local-mcp`, from `main` after plan 009. The MCP SDK (`@modelcontextprotocol/sdk`) is the only new dependency; the browser bridge uses `node:http` and `fetch`, with no WebSocket library.

### What runs where

- **Companion** (`apps/mcp/`, `npm run mcp`): one process on `127.0.0.1:8790` (`TTX_MCP_PORT`). MCP clients use Streamable HTTP at `/mcp`. Clients that start a command (Claude Desktop) run `node apps/mcp/src/stdio.ts`, which forwards stdio to `/mcp`, and starts the companion in its own process when none runs. Paired tabs connect at `/bridge/*`. The companion runs no model and keeps no board.
- **Browser executor** (`apps/web/src/mcp/executor.ts`): its own `Runtime` on the tab's doc, with the actor `{ kind: 'agent', id: 'mcp' }`, named after the MCP client (e.g. `claude-code`), and `onBehalfOf` the tab's person. Its writes stay out of the person's ⌘Z. View ops use the tab's camera.
- **Bridge** (`apps/web/src/mcp/bridge.ts`): a streaming `POST /bridge/connect` carries requests to the tab as JSON lines; the tab answers each with `POST /bridge/reply`. It reconnects with backoff. The board bar shows an "MCP" badge while the tab is paired.

### Pairing and security

- The companion makes a random token on its first run and keeps it in `~/.config/ttx-mcp/token` (mode 600, `apps/mcp/src/pairing.ts`), so paired tabs reconnect after a restart. Deleting the file unpairs every browser: tabs with the old token get 401, forget it, and stop. Links from `ttx_open_board` and `ttx_new_board` carry it: `#room=<id>&mcp=<port>:<token>`. Opening one pairs the browser: the tab removes the token from the URL and keeps it in localStorage, so the person's other local tabs connect too.
- Under `npm run dev` no link is needed: the dev server answers `GET /__ttx-mcp` with the port and saved token (`apps/web/vite.config.ts`), and a tab asks for it on load. It answers only requests with `Sec-Fetch-Site: same-origin`, which the browser sets and a page cannot, so another site on localhost cannot read the token. A tab opened before the companion's first run pairs on reload. The built app (`npm run sync`, port 8787) still needs a link.
- Every request must have a local `Host` (DNS rebinding). Any `Origin` must be local. `/bridge` needs a local `Origin` and the token. The bridge runs only on a local hostname, so deployed boards never connect.

### Tools

- The companion's own tools: `ttx_boards`, `ttx_open_board`, `ttx_new_board`, `ttx_snapshot`, `ttx_undo`.
- Every other tool comes from the tab's manifest: `exportTools` of every op that is not hidden and not `risk: 'high'`, and `exportToolDefs` of the browser's read-only tools (with `readOnlyHint`), each with a required `board` (the board link). The companion has no per-tool code. When a tab registers a manifest with a new fingerprint, it becomes the catalog and clients get `notifications/tools/list_changed`. A tab with another fingerprint answers `reload_required`.
- Parity gap closed: `notebooks.runs` (`apps/web/src/notebooks/runs.ts`) searches Notebook Factory runs, so an agent can find a run id. The notebook card's own search still calls `listRuns` directly; it needs the full run, not the tool's short form.
- Read results longer than 20,000 characters of JSON are cut. A FeatureCollection becomes its count and the properties of 5 features.

### Shared agent rules

`callOp` and `TurnLog` (`packages/plugins/src/agent/call.ts`) hold the size limit, the placement of adds without `x` and `y`, and the undo bookkeeping. The board's agent (`runTurn`) and the executor both use them. The executor makes each call its own undo step. An add goes to the right of the agent's last add if that add was less than 60 s ago; else it goes in the middle of the person's view.

### Undo between two agents and people

- `TurnUndo` has an optional `after`: each object as the turn left it (null if deleted). `agent.undoTurn` and the new hidden `agent.revert` (the executor's undo) refuse the whole undo when any of those objects has changed since, and name them. Replies stored before `after` existed undo as before. The chat panel shows the reason when Undo is refused.
- Not changed: `BoardTx.restore` replaces the whole object. After any agent undo, a person's ⌘Z steps for that object do nothing.

### Boards and tabs

A board is its normalized link (`<origin>/#room=<id>`). Each board is served by one tab, by tab key (sessionStorage), so a reload serves it again. Another tab of the same board is never used silently: when the serving tab closes, calls answer `tab_closed` with the open tabs, and `ttx_open_board` with `tab` picks one. A write in flight when its tab closes or times out (120 s) answers `uncertain`; it is never sent again.

### Verification (2026-10-28)

- `npm test` (319 tests: `apps/mcp/test/companion.test.ts`, `apps/web/test/mcpExecutor.test.ts` and the undo tests in `packages/plugins/test/agentLoop.test.ts` are new), `npm run typecheck`, `npm run build`.
- The companion tests use a fixture op and read tool that the companion has never seen. They cover discovery, calls on two boards, `list_changed`, `reload_required`, `uncertain`, binding and reload, and refused tokens and origins.
- Manual, with `npm run sync`, `npm run dev`, `npm run mcp` and a real browser tab: Claude Code 2.x (`claude -p` with an HTTP MCP config) added a sticky note and a map and read a snapshot. A scripted client set a color; a person then moved the note, and `ttx_undo` refused. The tab kept its board across a reload. The stdio shim listed all 53 tools and read a snapshot.
- Not verified: Codex CLI 0.149 connected, but its ChatGPT login refused every model tried (`model_not_found`), so no tool was called. Claude Desktop and Codex desktop were not tried.

### Left for later

- Steps 4–5: canvas handoffs, inactivity batches, change cursors and runner sessions.
- Retaining request outcomes so that a retried write is not applied twice. The bridge never retries, so a lost answer is reported as `uncertain` instead.
- Map layer loading and error state in snapshots. Layers fetch in each browser's map view, so the executor cannot see it.
- Visible activity beyond the op log. The external agent sets no presence.
- When tabs of two app versions reconnect in a different order, the catalog follows the last one to register.
