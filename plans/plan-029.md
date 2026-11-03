# Plan 029: names follow a rename

## Context

A person renames themselves with the name button (`rename` in `apps/web/src/board/person.ts`). Presence is live, so
cursors and selection outlines showed the new name at once. But some records in the doc keep a copy of the name:
- Chat messages keep their sender (`UserMessage.actor`, with name and color).
- Code runs keep the runner's name (`CodeRun.by`), with no id.

So after a rename, the chat and the code cells showed the old name. The agent's history also named one person in two
ways, so the agent could take them for two people.

Changing the old records is not reliable. `chat` is an append-only Y.Array, and a changed entry is a delete and an
insert, which conflicts with entries added at the same time.

## Design

The doc has a `people` map: person id → `{ name, color, at }` (`People` in `packages/core/src/people.ts`). Each
browser writes only its own person's entry: after the board syncs, and when its own presence changes (a rename or a
new color; `connect.ts`). `People.set` writes only when the name or color changed. This entry is like `views`: a plain
doc map, not an op, with no undo.

Each place that shows a record looks up the name by person id, and uses the kept name when the map has no entry
(boards from before this change, people who did not come back):
- The chat (`usePeopleNames` in `apps/web/src/board/people.ts`): messages, "→ asker", "For X", "Chat compacted by X".
- The agent's request (`chatLines` and `request` in `packages/plugins/src/agent/loop.ts`).
- Code runs: a person's run also keeps `byId` (optional). An agent's run stays "Agent".

Person ids are claimed, not proven, until there are accounts. A browser could write another person's entry, as it can
already send chat messages with any name.

## Not changed

- Op log entries keep the actor, but no UI shows their names.
- Uploads keep only the uploader's id.
- `CodeOutput.by` is not shown, so it has no `byId`.
