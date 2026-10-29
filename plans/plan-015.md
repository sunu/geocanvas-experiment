# Plan 015: agent skills and deferred tools

The board agent (`packages/plugins/src/agent/loop.ts`) sent every op and read-only tool with each model call: 81 tools,
about 76,000 characters (about 22,000 tokens), up to 12 calls per turn. Its system prompt had every domain rule, also
when the request was "add a sticky note". This plan makes two changes. Skills keep the domain rules out of the prompt
until a request needs them. Deferred tools keep most schemas out of the call until a skill or a search loads them.

## Skills

The design follows wri/project-zeno (`src/agent/skills/`).

- A skill is a Markdown file in `packages/plugins/src/skills/`. Its frontmatter has `name`, `description`,
  `when_to_use`, `requires` and `optional` (op or tool ids, separated by commas). The body is the workflow.
- `skills/index.ts` imports each file and parses it (`parseSkill`). To add a skill, write its file and add one import
  line. Automatic discovery (`import.meta.glob`) works in Vite, but not in Wrangler.
- The system prompt lists `- <name>: <description> (use when: <when_to_use>)` for each skill whose `requires` tools the
  agent has. Example: with no `MONTANDON_TOKEN`, the agent has no `events.search`, and the prompt does not list
  `add-event`.
- The tool `skills__read` gives the body. It also loads the `requires` and `optional` tools that the agent has, for the
  rest of the turn.
- The first four skills contain the rules that were in the system prompt before. Their text did not change:
  `add-event`, `show-place`, `map-data` and `satellite-imagery`.
- `test/skills.test.ts` makes sure that each `requires` and `optional` id is a real op or tool.

### Markdown as text

Three bundlers build the same source. Each one must import a `.md` file as a string:

- Wrangler: a `Text` rule for `**/*.md` in `apps/worker/wrangler.jsonc`. The Worker bundle has each skill as a
  module of its own.
- Vite and Vitest: the plugin `mdText` (`packages/plugins/mdText.ts`), in `apps/web/vite.config.ts` and in the root
  `vitest.config.ts`.
- TypeScript: `skills/markdown.d.ts`, referenced from `skills/index.ts`, so that each program that imports the skills
  knows the type.

## Deferred tools

- These tools go with every call: the ops of the `core` plugin, each `<type>.add` op, `board__get`, `tools__search`
  and `skills__read` (`coreToolNames`). The first call has 31 tools, about 26,500 characters (about 7,600 tokens).
- `skills__read` loads the tools of a skill. `tools__search` (`{ query }`) gives the 5 deferred tools that best match
  the words of the query in their name and description, and loads them (`searchTools`). A word in the name counts
  twice. The search uses no embeddings, so the Worker bundle stays small.
- Loaded tools stay loaded until the turn ends. The next turn starts again from the core set.
- When the model calls a deferred tool by its correct name, the tool runs: `runTool` finds tools in the full list.
- `skills__read` and `tools__search` are not ToolDefs, because they change the state of the turn. `runTurn` handles
  them, so the room agent and the browser agent ("My key") both get them, and the MCP companion does not.
- Cost: a request that needs a deferred tool needs one more model call. When the tool list changes, the provider's
  prompt cache cannot be used for the rest of the turn.

## Not done

- More skills, for example a sitrep workflow with templates, reports and ReliefWeb. Add one skill per change.
- Skills for the MCP companion. Claude and Codex have their own skills and tool search.
- A check with real models: whether low-cost models read the correct skill, and use `tools__search` when no tool that
  they have does the work.
