# Plan 023: the room's agent runs code through the asker's tab

## Context

A person asked the board's shared agent ("Model on backend") to "write some code to make a 10 km buffer around
Kathmandu, show it on a map". The agent runs in the room's Durable Object, which has no JupyterHub login. So it had
no `code.execute`, no code ops and no `run-code` skill (`OpDef.tools`). It improvised: it put the code in a text box
and drew the area itself, and it did not say it could not run code.

Plan 021 named the fix: a **tab relay**. The room's agent asks the asker's open tab to run the tool, and that tab
uses its own hub login. Then the shared agent makes a real, linked code cell, as the agent on a person's own key does.
Hub tokens never leave the browser.

## Design

### Transport: a custom message on the board's socket

The y-websocket protocol uses message types 0 to 3. Add **`RELAY_MESSAGE = 100`**: a varuint type, then one JSON
string (lib0 `writeVarString`).

- Request (Durable Object → one tab): `{ id, messageId, tool, input }`.
- Reply (tab → Durable Object): `{ id, result }` or `{ id, error }`.
- It is never broadcast, and nothing is stored in the doc. The Durable Object is awake for the whole agent turn
  (`keepAlive`), so its pending calls live in memory.

### Which tab runs it

- A tab with a working hub login sets **`hub: true`** on its presence. This is only a flag, never the URL or token.
- The Durable Object maps each socket to its presence states (`presenceIds`, already kept on the socket), and picks a
  socket whose state has `user.id === message.actor.id` and `hub === true`. With several, it picks the last one.
- With no such tab, the turn gets no relayed tools. The agent then has no code ops, as today.

### Safety in the tab

The tab runs a relayed call only if all of these hold:

1. `tool` is on its allowlist: `code.execute` only, for now.
2. `messageId` is a chat message **this tab sent**. The tab keeps a local Set filled when it sends. Without this, a
   chat message with a spoofed person id could make someone else's tab run code on their hub. There are no accounts
   yet, so the person id in a message is only what a browser claims.
3. Its hub login is ready.

Anything else gets an error reply.

### Tools for one turn: `Agent`

Add the option `toolsFor?(message): ToolDef[]` to `Agent` (`packages/plugins/src/agent/agent.ts`).

- For a turn with extra tools, `drain` builds a runner of `[...base tools, ...extra]` and sets `runtime.tools` to it
  for the turn, because ops' prepare uses `ctx.tools`. Then it restores the base runner.
- Turns run one at a time, so the swap is safe.
- Without extra tools, it uses the base runner and its cache, as now.
- `OpDef.tools` and `availableSkills` then offer `code.add`, `code.run` and the `run-code` skill only on those turns.

### Shared definition of `code.execute`

Move the tool's id, title, description and input schema from `apps/web/src/code/execute.ts` to
`packages/plugins/src/code.ts` as `codeExecuteSpec`. Then the browser tool (`{ ...codeExecuteSpec, run }`) and the
relayed tool are the same tool to the model.

### Relay helpers: `packages/plugins/src/agent/relay.ts` (new, no I/O)

- `RELAY_MESSAGE`, the request and reply types, `encodeRelay` / `decodeRelay` (lib0).
- `class RelayCalls`: `call(send, req, signal, timeoutMs)` returns a promise. `settle(reply)` resolves it. On a timeout
  or abort, it rejects with "The asker's tab did not answer: run this from a tab signed in to JupyterHub."
- `relayedTool(spec, call)`: a `ToolDef` whose `run` forwards the input.
- Timeout: 150 s. The first run may start the person's server (up to about 1 to 2 minutes), and each run is at most
  60 s.

### Worker: `apps/worker/src/worker.ts`

- In `Room`, a `RelayCalls`. `receive()` handles `RELAY_MESSAGE` replies (`relay.settle`).
- `hubSocket(personId)` finds the asker's tab, as above.
- Pass `toolsFor: (m) => { const s = this.hubSocket(m.actor.id); return s ? [relayedTool(codeExecuteSpec, (input,
  signal) => relay.call(bytes => s.send(bytes), { tool, input, messageId: m.id }, signal))] : [] }` to the `Agent`.

### Browser: `apps/web/src/code/relay.ts` (new), started from `App.tsx`

- `provider.messageHandlers[RELAY_MESSAGE]`: decode the request, check it (as in "Safety in the tab"), run
  `tools.run(tool, input)` from the tool registry, and reply with `provider.ws.send(encodeRelay(reply))`. The handler
  writes nothing into y-websocket's encoder.
- `trackSent(chat)` records the ids of the messages this tab sends: one wrapper around `chat.send`, for the panel and
  for `askAgent`.
- It keeps `hub: true/false` on presence in step with `useHub` state (a hub.ts subscription).
- `Peer` / presence docs: note the `hub` field.

### The skill

No change. `run-code` already says to test with `code__execute`, then `code__add` with `showOn`.

## Critical files

- New:
  - `packages/plugins/src/agent/relay.ts`
  - `apps/web/src/code/relay.ts`
  - tests in `packages/plugins/test/relay.test.ts`
- Changed:
  - `packages/plugins/src/agent/agent.ts` (`toolsFor`)
  - `packages/plugins/src/code.ts` (`codeExecuteSpec`)
  - `apps/web/src/code/execute.ts`
  - `apps/worker/src/worker.ts`
  - `apps/web/src/App.tsx`
  - `apps/web/src/board/presence.ts` (doc of `hub`)
  - AGENTS.md
- Reuse:
  - `presenceIds(socket)` and `this.awareness.getStates()` (worker.ts)
  - `tools` (apps/web/src/tools/registry.ts)
  - `hubState` and `useHub` (code/hub.ts)
  - `forRoom` and `runTurn` (agent)

## Verification

- `npm test`:
  - Encode and decode round trips.
  - `RelayCalls`: it resolves on `settle`, rejects on timeout and abort, and ignores unknown ids.
  - `Agent` with `toolsFor`: a scripted model gets `code__add` and the `run-code` skill on a turn with the relayed
    tool, and not on one without. The op's prepare goes through the relayed tool (runtime.tools swapped), and the base
    runner comes back after the turn.
  - The tab's handler, as a pure function: it refuses a tool not on the allowlist, a message it did not send, and a
    missing hub login; it runs an allowed call.
- `npm run typecheck` and `npm run build`. Also bundle the Worker (`wrangler deploy --dry-run`), since it imports the
  new code.
- End to end, on my own stack (a hub on :8100, a Worker on :8797, Vite on :5185; not your processes):
  1. In the chat panel's "Model on backend" mode, with the hub connected, send "write some code to make a 10 km
     buffer around Kathmandu, show it on a map". This makes a real model call on the Worker's
     `OPENROUTER_API_KEY` from `apps/worker/.dev.vars`, as the room's agent always does.
  2. Expect a code cell linked to a map with the layer and the footnote, and no text box.
  3. Then disconnect the hub and ask again: the agent should have no code tools, and there should be no stuck turn.

## Status (2026-10-30)

Built. End to end against a local JupyterHub, with the room's agent on its configured model: "write some code to make
a 10km buffer around kathmandu, show it on a map" gave a code cell (run by the agent through the asker's tab, in
25 s) and a map with its layer, linked; no text box.

A tab with no hub login gives the room's agent no code tools, and no turn waits for a tab. The agent then still does
what it can without code: in the test it put the code in a text box and drew an approximate circle. A stand-in
code.execute that fails with "connect JupyterHub" would make it say so instead; not built.

The relay message is one type byte and then the JSON, not lib0's varstring: @ttx/plugins does not depend on lib0, and
both sides read it without it.
