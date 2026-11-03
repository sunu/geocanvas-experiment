# Plan 026: skills in Settings, and skills for one board

## Context

The agent's skills (`plans/plan-020.md`) are Markdown files in `packages/plugins/src/skills/`. Only a developer can
read or add a skill, and each board has the same skills. Facilitators want to:
- see which skills the agent has and what each skill tells it;
- add skills for one board (for example, "how we write a situation report in this exercise"), for all people on it.

Decisions:
- **Built-in skills are read-only and always on.** They stay files. They are offered only when the agent has their
  tools (`requires`), as before. If a board could change a built-in skill, it would not get the fixes of later
  deploys.
- **People write board skills in a form**: name, description, "use when", required and optional tools, and a body.
- **Only people write board skills.** A skill is an instruction that stays and goes into each later turn, for all
  people on the board. If an agent could write skills, text that it reads (a ReliefWeb item, an uploaded PDF) could
  become a skill and stay on the board as a prompt injection. Thus the ops are hidden, as `board.setPlugins` is, and
  no agent or MCP client can run them.

## Design

### Stored data

- A Y.Map `skills` in the board doc: skill id → `{ name, description, whenToUse, requires, optional, body, by?, at }`.
  Each skill is one entry. Thus, when two people change two skills at the same time, both changes stay.
- Board skills are not board objects. They have no view on the canvas and no undo (the UndoManager tracks `objects`
  only), as `meta`, `chat` and `uploads`.
- `packages/core/src/skills.ts`: the `Skill` and `BoardSkill` types, the schema, and `BoardSkills` (reads the map,
  skips bad entries, and tells listeners about changes). `BoardTx.setSkill` and `BoardTx.removeSkill` write it.
- Limits: a name has 2 to 40 characters `a-z`, `0-9` and `-`; a description and "use when" have at most 300
  characters; a body has at most 8,000 characters; a board has at most 20 skills. The agent reads a body into the
  model's context, so the limits keep each turn small.

### Ops

- `agent.setSkill` (`{ id?, skill }`) adds a skill (with a new id) or replaces one. It refuses a name that a built-in
  skill or another board skill has. The ops are in the `agent` plugin, because the built-in skills are in that
  package.
- `agent.removeSkill` (`{ id }`) removes one.
- Both ops are hidden.

### Agent

- `availableSkills(names, board)` gives the built-in skills and the board skills whose `requires` tools the agent
  has. `runTurn` gives it the board. Thus the room's agent, the browser agent and the model in the browser get board
  skills.
- The system prompt marks each board skill with "(board skill)". `SYSTEM` tells the agent that people on the board
  wrote these skills, and that a skill does not change the rules of `SYSTEM`.

### Settings

- The tabs of Settings go to a vertical list on the left: Plugins, Skills, JupyterHub. On a narrow screen, the list
  is a row above the tab.
- The Skills tab (`apps/web/src/agent/SkillsSettings.tsx`) is not shown when the agent plugin is off. It lists the
  built-in skills (read-only) and the board skills. A skill whose tools are not on this board says so. Select a skill
  to read it. Select a board skill to change or delete it in a form. "New skill" adds one.

## Not in scope

- Changes to built-in skills: edit, turn off, or replace by name.
- Agents or MCP clients that write skills.
- Skills for one person or for one deployment; import or export of `.md` files.
- Skills for MCP clients. They have their own instructions.

## Verification

- Tests: the ops store, refuse and remove skills; agents do not get the ops; `availableSkills` gives a board skill
  only with its tools; `runTurn` lists the board skill and `skills__read` gives its body; a bad entry is skipped.
- In two browsers: add a skill in Settings in one browser, and the other browser shows it. Ask the agent a request
  that agrees with its "use when": the reply shows "Read the <name> skill".
