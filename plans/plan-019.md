# Plan 019 — Proposal: synced and detached report items

Date: 2026-10-30. Status: **proposed, for feedback.** Not decided, not scheduled, nothing built. Today's behavior (live and frozen items, `agent-docs/tasks/reports.md` §3.3) is unchanged until this is agreed.

## 1. Why

A report item is **live** or **frozen** today. A frozen item keeps only a text, a picture upload or some data (`Frozen` in `packages/plugins/src/reports.ts`). Three problems follow:
- **A frozen item shows as a small text card, not as the thing itself.** A sticky note is no longer a sticky note, and a map would be a bare picture.
- **Most widgets cannot be frozen at all.** A map, an event or a country widget would need the browser to make its picture, so report mode disables the switch for them.
- **"Frozen" reads as a lock,** not as a relationship to the board.

## 2. The proposal

Two ways for an item to relate to the object on the board it came from:
- **Synced.** The item is linked to its object on the board, the original. It always shows that object as it is now. People can see the link, and change the object on the board, not in the report.
- **Detached.** The item started as an object on the board but no longer follows it. It is the report's own copy, editable to a small extent in the report. People can see where it came from.

**Either way, the item is visible in full:** a detached sticky note is still a sticky note in its color, and a detached map still shows its picture. A report always reads complete, on screen and in print.

### 2.1 A detached item keeps a copy of its object, not a picture

- **The copy:** `{ type, fields, view?, at }`, the object's own fields at the moment it was detached. These are recipes and references (a map's layers, an event's id, a sticky note's text and color), with `w` and `h` for its proportions, but without `id`, `x`, `y`, `z` or `link`. A map's copy also keeps the view of the person who detached it.
- **The same renderers:** the report draws a detached item from its copy, exactly as it draws a synced one from the board. It looks as the object did.
- **No browser step:** detaching is a plain op. It copies the fields and, for a map, the runner's saved view (`Views`). The agent can detach anything, maps included.
- **Detached from the board, not frozen in time:** a detached event card still fetches its event's details from Montandon, and a detached country widget fetches today's figures. Pinning external data "as of" a date would be a separate option. It matters most for a shared report link or a PDF (§4).

### 2.2 What people see

- **In report mode, each item's caption row has a status chip:**
  - **Synced:** a link icon. Tooltip: "Shows *name* on the board as it is now. Edit it on the board."
  - **Detached:** a broken-link icon. Tooltip: "A copy of *name*, made *date*. It no longer follows the board."
- **On the canvas,** the preview stays compact, with no chips.
- **The Options panel's item row:**
  - **Synced / Detached:** a select, for every type.
  - **Go to source,** while the source exists.
  - **Remove.**
  - **A detached item's row also has:**
    - its **Caption**, its own title in the report
    - for a sticky note or a text, its **Text**
    - **Sync again:** back to the board, which drops the copy and its edits, after a confirmation
    - **Replace with the board's version:** detach again from the source as it is now, also after a confirmation

  Editing on the page itself would come with the report's page tools (step 5b).
- **Deleting a synced item's source:** the item says "The source object was removed", with Remove. A detached item keeps showing its copy.

### 2.3 First edits on a detached item

Small at first: the **text** of a detached sticky note or text, and the **caption** of any detached item. Widget-specific edits (a map's view or layers, an event's choice, a country) would come later.

## 3. What would change

**Stored names stay** (AGENTS.md: never rename stored fields or values):
- `mode` keeps its stored values: `'live'` means **Synced** and `'frozen'` means **Detached**. Only the UI, the op descriptions and `summarize` use the new words.
- New optional fields on an item block:
  - `copy`: the detached copy
  - `caption`: a detached item's own title; a synced item's caption is always its source's name
- The existing optional `frozen` field stays readable. A block with `frozen` and no `copy` still shows its saved text or picture.

**Plugin** (`packages/plugins/src/reports.ts`):
- **`report.setItemMode`** (op id unchanged; title "Sync or detach report item"):
  - `frozen` (Detached) makes the copy, checked against the type's schema (`registry.objectSchema`). It fails only when the source is gone and there is no copy.
  - `live` (Synced) relinks and drops the copy and caption.
  - The `frozen` argument stays accepted, but is ignored.
- **New `report.editItem`** (an agent tool too): `blockId`, `caption?`, `text?`. Only for a detached item, and `text` only for a sticky note or a text. It is a gesture op, like `text.setText`.
- **`summarize`:** "synced", or "detached (a copy of a *type*, made *date*)".
- **`freezeText`** and its type list go: every type can be detached.

**Web** (`apps/web/src/reports/`):
- **`ItemView`** draws `board.get(sourceId)` when synced, or an object made from `copy` when detached (with `id` set to the block's id, so it never collides with a board object).
- **`useMapPicture`** (`map/picture.ts`) takes an optional view, for a detached map's saved view.
- **The chips and the Options panel rows** described in §2.2.

**Steps:** this would replace step 7 of `agent-docs/tasks/reports.md` ("live and frozen, map pictures") with its own PR, before the report's page tools (step 5b).

## 4. Questions for reviewers

1. **What does "detached" mean?** Is a copy of the object (its fields, drawn as the object) the right meaning, rather than a picture of it?
2. **External data.** Should a detached item also pin its external data "as of" a date: the event's details, the country's figures, ReliefWeb's updates? Always, as an option, or only for a shared link or a PDF?
3. **Deleting a source.** What should happen when a synced item's source is deleted from the board: show "removed" (as proposed), detach it automatically, or ask first when deleting an object that is in a report?
4. **Edits.** Which edits should a detached item allow, first and later?
5. **Words.** Do "Synced" and "Detached" work for the people who will use reports? Other candidates: "Linked / Copy", "Live / Snapshot".
6. **The board side.** Should an object on the board show that it is in a report (for example a small badge, "In 1 report")?
