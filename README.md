# Geo Canvas

Multiplayer infinite canvas for geospatial work. All changes are typed ops. Plugins add node types, ops, data functions, and templates. The first plugin is `disasters`, with a situation report template.

Spec: `plans/plan-001.md`. Status and changes: `plans/plan-002.md`.

## Run

```
npm install
npm run sync      # sync server on ws://localhost:1234
npm run dev       # web app on http://localhost:5173/#room=demo
npm run nl        # NL gateway on http://localhost:8787 (needs OPENROUTER_KEY in .env)
```

Open the same room in two windows to see multiplayer.

NL commands: copy `.env.example` to `.env` and set `OPENROUTER_KEY`. In the palette (⌘K), type a request in plain words and press Enter on "✨ Ask". Start with `?` to skip the command list.

## Test

```
npm test
npm run typecheck
npm run nl:eval -- --config jev       # NL eval with Jev (needs the key)
npm run nl:eval -- --config lexical   # offline baseline
```

## Layout

| Path | Contents |
|---|---|
| `packages/core` | Doc model, op runtime, undo, plugin registry, reactivity engine, templates. No UI. |
| `packages/plugin-core` | Map, chart, text, and sticky node types and their ops. |
| `packages/plugin-disasters` | Disaster event node, related-events group, mock data provider, sitrep template. |
| `packages/nl` | NL pipeline: contracts, parsers, backends (Jev, embedder, LLM fallback, lexical), eval set and runner. |
| `apps/nl-gateway` | Holds the OpenRouter key. Proxies decide, extract, embed. Writes the NL log. |
| `apps/web` | React app: tldraw bridge, deck.gl maps, Vega-Lite charts, command palette. |
| `apps/sync-server` | y-websocket compatible server with file persistence. |

## Keys

| Key | Action |
|---|---|
| ⌘K | Command palette for the selection, or for the canvas |
| ⌘Z / ⇧⌘Z | Undo / redo your own ops |
| Delete | Delete the selected nodes |
| Double-click a node | Work inside it (pan the map, edit a sticky) |
| Click an output port, then an input port | Make a data link |
