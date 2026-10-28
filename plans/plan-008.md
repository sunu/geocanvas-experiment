# Plan 008 — A board agent: chat sidebar, selection snapshot, agent in the room Durable Object

Date: 2026-10-28. Status: implemented on `feat/agent`.

## 1. Context

Plan 007 made every board write an op, and every op that is not hidden a tool. This plan adds an AI agent that uses these tools. The agent is one more user on the board.

Happy path: a person selects objects, opens the chat sidebar, and asks "delete these" or "duplicate this". The agent does it, and everyone in the room sees the request and the result.

Next path: "put a card for the recent flood in Nepal". The agent searches Montandon, then adds an event object (section 3.6).

## 2. Decisions

### 2.1 The agent runs in the room Durable Object

The room Durable Object (`apps/worker/src/worker.ts`) already holds the board doc in memory. The agent is a headless `Runtime` from `@ttx/core` on that doc, with the actor `{ kind: 'agent', id: 'agent', name: 'Agent' }`. Its writes go to the update log and to every socket, as a person's writes do.

We do not use a separate Node service, for these reasons:
- There is no new server to host. Each branch preview gets its own agent, because each branch is its own Worker.
- The OpenRouter key is a Worker secret, the same as `MONTANDON_TOKEN`. It never gets to the browser.
- The agent can call the Montandon proxy code directly (section 3.6).

Cost: a Durable Object is billed for wall time while it is in memory. An agent turn keeps the room in memory while it waits for the model. This is a few seconds for each turn.

### 2.2 A plain tool loop, with no framework

The loop sends the chat completions request to OpenRouter with the tools, runs the tool calls, and sends the results back. It stops when the model makes no tool call, or after 8 steps. This is approximately 100 lines with `fetch`, and it adds no dependency. If we need graphs, checkpoints or many agents later, we can move to LangGraph JS or the Vercel AI SDK.

The model is the `AGENT_MODEL` var in `wrangler.jsonc`. Use a low-cost model that can call tools.

### 2.3 One shared chat for each board, stored in the doc

The chat is a `chat` Y.Array in the board doc, beside `oplog`. Its entries are plain objects that are only appended. Everyone in the room sees all requests and all replies. No new API is necessary: the browser appends a message, and the Durable Object sees it.

The chat does not go through ops, because it is not board objects. `oplog` is written the same way. No undo manager tracks it.

### 2.4 The agent acts on a snapshot of ids, not on the live selection

Selection is local to each person. Many people can select different objects at the same time. Thus each chat message stores:
- `actor`: the id, name and color of the sender.
- `selection`: the ids that the sender had selected when they sent the message.

The prompt gives the agent these ids, each with a short summary. "These" or "this" means these ids only. A change to the selection after the message, or the selection of another person, cannot change what the agent acts on. `Runtime.callTool` refuses ids that do not exist.

People also publish their selection to awareness (presence), so each person sees what the others selected. The agent does not use awareness for its decisions.

### 2.5 Undo an agent turn

The agent acts immediately. It does not ask for approval. Each agent reply has an **Undo** button.

`⌘Z` cannot undo the agent's work, because each runtime undoes only its own writes. Also, the agent's `Y.UndoManager` is lost when the room leaves memory, which can occur between any two messages. Thus each agent reply stores the data to undo it:
- `created`: the ids that the turn added.
- `before`: each object that the turn changed or deleted, as it was before its first change.

The hidden op `agent.undoTurn` removes the created objects, writes the old fields back, and adds the deleted objects again with their old ids. The browser of the person who clicks Undo dispatches it as a user op, so that person can undo the undo with `⌘Z`.

Limit: Undo writes the old fields back. If another person changed one of these objects after the turn, Undo overwrites that change.

### 2.6 Read tools are not ops

Ops write the board. A search or a board summary writes nothing, so these are agent tools in the Worker, not ops:
- `board__get`: a new summary of the board. The board can change during a turn.
- `events__search` (section 3.6).

If the palette needs queries later, we can add a query kind to core.

### 2.7 Limits on cost and abuse

Anyone with the link to a room can use its agent, as anyone can edit its board. Limits:
- 8 tool steps or fewer in each turn.
- One turn at a time in each room. Other messages wait.
- 20 turns or fewer in each hour in each room, counted in the memory of the Durable Object.

## 3. Design

### 3.1 Headless plugins: `packages/plugins` (`@ttx/plugins`)

`apps/web/src/plugins.ts` imports UI files, so the Worker cannot load it. The headless plugin files move to a new workspace package:
- `map.ts`: the map plugin and its basemaps.
- `events.ts`: the event plugin.
- `index.ts`: `plugins = [corePlugin, mapPlugin, eventsPlugin, agentPlugin]`.

The web app imports the list from `@ttx/plugins` and keeps the UI imports. No stored type or field name changes.

### 3.2 Chat: `packages/core/src/chat.ts`

```ts
type ChatEntry =
  | { kind: 'user'; id; actor; text; selection: string[]; at }
  | { kind: 'agent'; id; replyTo; text; calls: ToolCallRecord[]; undo?: { created: string[]; before: Record<string, AnyObject> }; at }
```

The `Chat` class has `send`, `reply`, `list`, `subscribe`, and `pending` (user messages that have no reply).

### 3.3 Presence in the browser

Each tab has an actor with a generated name and color, kept in `localStorage`. Awareness is `{ user: { id, name, color }, selection: string[] }`. The canvas draws the selection of each other person as an outline in that person's color.

### 3.4 The agent: `apps/worker/src/agent/`

- `Room` makes the agent runtime and a `Chat`. It watches `chat`. For each user message without a reply, it queues one turn.
- `loop.ts`:
  - The tools are `exportTools` of all ops that are not hidden and are not view ops, plus the read tools.
  - The system prompt gives the rules and the board summary. The user message gives the sender's name, the text, and the selection ids with summaries.
  - Each tool call runs through `runtime.callTool(name, input, agentActor)`. The tool result is the invocation record: status, error and created ids.
- While the agent works, the Durable Object sets its own awareness state to `{ user: { name: 'Agent' }, status: 'thinking' }`.
- When the room comes back into memory, the agent replies "Interrupted. Please ask again." to each user message that has no reply. It does not start these turns again.
- Without `OPENROUTER_API_KEY`, the agent replies "The agent is not configured".

### 3.5 Chat sidebar: `apps/web/src/agent/ChatPanel.tsx`

A panel on the right, opened from the board bar. It shows the messages, the selection that each message had ("2 selected"), the tool calls of each reply, the Undo button, and "Agent is thinking…".

### 3.6 Event search as a tool

- The Montandon client and the files that it imports are in `packages/plugins/src/monty/`. `MontyClient` takes a search function. The browser gives the `/monty/search` function. The Durable Object gives a function that calls Montandon with the token.
- The read tool `events__search { text, limit }` returns short summaries. The agent then calls `event__add`.
- Each user message also stores the center of the sender's view, so that the agent can put new objects where the person looks.

## 4. Configuration

| Name | Kind | Where |
|---|---|---|
| `OPENROUTER_API_KEY` | secret | `apps/worker/.dev.vars` locally. The repository secret is uploaded with each deploy, as `MONTANDON_TOKEN` is. |
| `AGENT_MODEL` | var | `apps/worker/wrangler.jsonc` |

## 5. Verification

- Tests: the chat, `agent.undoTurn`, `BoardTx.add` with an id, and the loop with a fake OpenRouter that gives tool calls in a set sequence. A delete acts only on the ids in the snapshot.
- Manual, with two browsers: A selects two boxes and asks "delete these". B selects a different box. Only the boxes of A go. Undo puts them back with the same ids.
