# Plan 024: turn plugins on or off for a board

## Context

Each board loads 16 headless plugins (`packages/plugins/src/plugins.ts`) and their UI (`apps/web/src/plugins.ts`).
Facilitators want to remove some of them from an exercise, for example openEO, code cells or notebooks. Then the
toolbar, the palette and the agents must not offer them.

Decisions:
- **The setting is per board.** It is in the board doc, so all people on the board and the room's agent see the
  same setting. A per-person setting cannot stop the room's agent. A per-deployment setting gives no menu.
- **Objects stay.** When a plugin is off, nobody can add new objects of its types. Objects that are already on the
  board show and work as before.

## Design

### Stored setting

- `meta.disabledPlugins` in the board doc: the ids of the plugins that are off. `Board.disabledPlugins` reads it.
- Only the core op `board.setPlugins` writes it, through `BoardTx.setDisabledPlugins`. The op is hidden, so agents
  and MCP cannot run it. Undo does not cover it, as for the board title.

### Which plugins can be off

- `Plugin.optional: true` marks a plugin that a board can turn off. `Plugin.description` is one line for Settings.
- Optional: events, notebooks, reliefweb, hapi, history, images, openeo, pdfs, inputs, templates, reports, code,
  agent and mcp (see Agents).
- Always on: core, map, links. Many plugins depend on map; making map optional is a later step.
- `Registry.disabled(ids)` gives the optional plugins in `ids` and each optional plugin that depends on one of them.

### What "off" removes

- `Registry` keeps the owner plugin of each op and object type. A `<type>.add` op belongs to the plugin of its type.
- `Registry.opEnabled(op, disabled)` is false for an op of a plugin that is off. It is also false for an op whose
  `OpDef.adds` names a type of a plugin that is off.
- Templates set `adds` to the types of their nodes. The templates plugin now depends only on core, map and links.
  Thus "reliefweb off" removes the situation report template and keeps the conflict template.
- `Runtime.availableOps` leaves out these ops. `Runtime.callTool` refuses them. This covers the palette, the room's
  agent, the browser agent and MCP.
- `Runtime.dispatch` and `Runtime.invoke` do not check the setting. Thus the UI of existing objects keeps working.
- `ToolDef.plugin` names the owner plugin of a read-only tool. `readToolsOn` (agent loop) removes the tools of
  plugins that are off. Skills need their tools (`requires`), so a skill goes away with its tools.
- Ops still use all tools in `prepare` (`OpContext.tools`), and maps still draw all layers.

### Web app

- `board/plugins.ts`: `usePluginsOff(runtime)` (updates when the setting changes), `typeOn` and `templatesOn`.
- The toolbar, the tool keys, file drops, the map's Add layer sections (events, HDX HAPI, notebooks), Add to report
  and the event card's ReliefWeb button check the setting.
- `chrome/SettingsDialog.tsx`: the gear in the user menu opens Settings. Its Plugins tab has a checkbox for each
  optional plugin; its JupyterHub tab has the person's own hub login, which was a button in the user menu before.
  A plugin that is off because a plugin it needs is off has a disabled checkbox and the text "Needs …".

### Agents

- **Agent** (`agent`): the board's agent in the chat, in the room's Durable Object or on a person's own key. When it
  is off, `Agent` replies `AGENT_OFF` to each message and calls no model. The app shows no chat panel, no "describe
  in words" on a map, no "Ask agent to fix" on a code cell, and on the phone no Ask tab.
- **External agents (MCP)** (`mcp`, a plugin with no ops): when it is off, the MCP executor gives an empty manifest
  and refuses each call, snapshot and undo (`MCP_OFF`). The user menu shows no MCP light.
- The two are separate, so a board can turn off the chat agent and keep a person's own Claude or Codex, or turn off
  both.

## Limits

- The MCP companion gets the tool list when it connects. After a change, it shows old tools until it connects again.
  `callTool` refuses their calls in the meantime.
- A code cell's "Show output on" menu can still make a new image or map when images are off. The cell is an existing
  object, and the op belongs to the code plugin.
- Tabs on older code ignore the setting until they reload.
- No access control: all people with the link can change the setting, as they can make all other edits.

## Verification

- `packages/plugins/test/pluginsOff.test.ts`: the dependency closure, the palette, refused tool calls, existing
  objects, agents cannot change the setting, templates, agent tools and skills.
- By hand, in two browsers: turn off Events in Settings. In both browsers, the Event button goes away and the
  palette has no "Add event". Ask the room's agent to add an event; it cannot. An event card already on the board
  still loads.
