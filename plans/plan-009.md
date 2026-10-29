# Plan 009 — Bring your own key: a browser agent beside the room agent

Date: 2026-10-28. Status: implemented on `feat/byok-agent`.

## 1. Why

Plan 008 put the board agent in the room Durable Object. It uses the server's `OPENROUTER_API_KEY`, and each room has 20 turns per hour. We want a second option: a person gives their own LLM key, and the agent runs in their browser. Later, only internal users will use the room agent (section 5). Everyone else will use their own key.

The key must not go to our Worker. It must not go into the board doc, the chat or presence. The browser sends it only to the LLM provider.

## 2. One agent, two places

The agent code is now in `@ttx/plugins` (`packages/plugins/src/agent/`): `Agent`, the tool loop (`runTurn`) and the model client (`chatCompletions`). It uses only standard `fetch`, so the Worker and the browser run the same code.

- The room Durable Object runs one `Agent` on the server's key, with `turnsPerHour: 20` (`apps/worker/src/worker.ts`).
- Each browser tab runs one `Agent` on the person's key, with no turn limit, because the person pays (`apps/web/src/agent/browserAgent.ts`).

`Agent` has an `accepts(message)` option. Each agent answers only the pending messages that it accepts. The "Interrupted. Please ask again." pass at start also uses `accepts`.

## 3. Each message says which agent answers it

A `UserMessage` has an optional field `browserTab`:

- Absent: the room agent answers. Messages on old boards do not have the field, so they stay room messages.
- Present: only the browser tab with this id answers. Each page load makes a new random tab id (`TAB_ID`).

Thus one agent only answers each message. A reload makes a new tab id, so a reload never runs an old turn again. The message holds the tab id only. It does not hold the key, the model or the URL.

If the tab closes during a turn, nothing answers the message. The chat panel then shows "No answer: the sender's tab closed." for a browser message that has no reply after 2 minutes while nobody is thinking. The panel only shows this text. It does not write it to the doc.

## 4. The browser agent

- It has its own headless `Runtime` on the tab's doc, with the actor `AGENT`, as on the server. Its writes have a different transaction origin from the person's runtime. Thus they are not in the person's ⌘Z stack. They sync through the provider like all other writes. Each tool call runs as `{ kind: 'agent', onBehalfOf: <person id> }`, so `map.showArea` and the op log work as on the server. The Undo button (`agent.undoTurn`) works the same.
- Its read-only tools are the same as the room agent's tools: `board.get`, the browser's geocoding tools (through `/tools/geocode`), and `events.search` (through `/monty/search`). These proxies use the server's OpenCage and Montandon keys. They do not use the LLM key.
- While it works, it sets `status: 'thinking'` on the person's presence. Everyone then sees "Agent is thinking…".
- Each model call reads the key again from localStorage. Thus a saved or forgotten key applies to the next call.

### Key settings

The chat panel has a switch: **Board agent** (the room agent) or **My key** (this browser's agent). The gear button opens a form: provider, base URL, model and key. Save and Forget key are below it.

- Providers: OpenRouter, or an OpenAI-compatible base URL (OpenAI, a local Ollama or LM Studio). The client sends `<url>/chat/completions` in the OpenAI format.
- The key is in localStorage (`ttx-agent-key`), like the person (`ttx-person`). Forget key removes it. The mode is in `ttx-agent-mode`.
- `chatCompletions` sends `x-title` only to OpenRouter, and `authorization` only when there is a key. An unknown header can make a CORS preflight fail on other servers.

### CORS

The browser calls the provider directly, so the provider must allow CORS. OpenRouter and OpenAI allow it. Ollama allows only the origins in `OLLAMA_ORIGINS`. Set it to the app's origin (for example `OLLAMA_ORIGINS=http://localhost:5173`).

### Risks

- A script that runs on the app's origin can read localStorage, and thus the key. The app loads no third-party scripts at run time. A Content Security Policy with a `connect-src` list would decrease this risk more, but it would also block OpenAI-compatible URLs that we do not know. We did not add one.
- A person's own agent has no turn limit. `MAX_STEPS` (12 model calls per turn) still applies.

## 5. Next step: the room agent for internal users only

The doc is shared, so a chat entry cannot prove who wrote it. But the Durable Object knows which socket sent each update: `readSyncMessage(..., socket)` makes the socket the transaction origin.

1. When a socket connects, the Worker marks it as internal or not (a passcode secret on `/connect`, or a Cloudflare Access JWT). It keeps the mark in `serializeAttachment`.
2. The room `Agent` observes the chat with the transaction origin. It keeps in memory the ids of room messages that came from internal sockets. `accepts` checks this set. Other room messages get the reply "The board agent is for internal users. Use your own key."
3. The chat panel starts in "My key" mode when the socket is not internal.

After a wake the set is empty. But the agent answers all pending room messages with "Interrupted" at a wake, so it does not lose a message silently.
