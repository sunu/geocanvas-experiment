# Plan 013 — Links and frames: templates that follow their seeds

Date: 2026-10-29. Status: implemented on `feat/frames-and-links`. Follows plan-012 (templates, phase 1).

## 1. Outcome

In phase 1, a template fills its nodes one time. To use another event, you must make the set again. This plan adds two separate concepts:

- **Links.** A node can follow a root node. When the root changes, the linked part of each follower changes too. Example: pick another event on the sit rep's event card. The map footprint, the ReliefWeb feed, the country card and the frame title then show the new event.
- **Frames.** A `frame` is a generic object that holds other objects together. When you drag a frame, the objects in it move with it. A frame is not a template. A template puts roots, nodes and one or more frames on the canvas. A frame only holds them.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Root | A content node when one exists (the event card). An **input** node for a seed that has no content node (an area of interest now; a country or years later). Not the frame: a frame groups objects and holds no data. |
| Link storage | A field on the linked node, `link: { from, recipe, args? }`. The canvas shows it as a dashed line. |
| Edits by hand | Only the linked part changes (for example, the event footprint layer). Other changes stay (for example, a layer that a person added). Unlink a node to stop all changes. |
| Missing facts | The node stays, but its linked part becomes blank. A feed never shows the old event's GLIDE numbers. |
| Frames | A generic object type. A drag moves the objects that are fully in the frame. A template can make more than one frame. |
| Where to change seeds | On the root (the event card's picker, the area input), or with the root's op from the palette or the agent. |

## 3. Design

### 3.1 Frame (core)

- Type `frame` in the core plugin (`packages/core/src/plugins/core.ts`). Field `title?`. Layer `bottom`. Default size 800×600. Op `frame.add`. Renaming a frame sets its `name` with `core.object.rename` (from main), not `title`, so the `frameTitle` link keeps writing `title` and a name someone gave wins.
- View (`apps/web/src/canvas/coreUI.tsx`): a light fill (`--ttx-frame-fill`), with the title in the label row above it. Tool key **A**, in the Board section of the toolbar.
- A drag moves the objects that are fully in a moved frame (`withFramed` in `apps/web/src/canvas/camera.ts`). Frames in the frame, and their contents, move too. The canvas finds the objects from their positions when the drag starts. Thus, a frame keeps no list of members, and this list cannot become incorrect between persons. The drag is one `core.object.setRect` gesture, so it is one undo step.

### 3.2 Input node

- Type `input` in the `inputs` plugin (`packages/plugins/src/inputs.ts`). Fields `kind: 'area'` and `value?: { west, south, east, north, name? }`. The value is kept as a resolved area, not as the text that a person typed. Thus, all persons see the same area.
- Op `input.setArea`. It takes the area seed value (`{ text }`, an area, or `"my view"`), resolves it, writes it, and re-renders the followers.
- View (`apps/web/src/inputs/`): "Area of interest" and the name. Double-click opens `AreaPicker`. Pick a place, or push Enter to use the best match.

### 3.3 Links

- **Core.** Each object can have an optional `link` (`linkSchema` in `packages/core/src/plugins/registry.ts`), so no object type needs a change. `BoardTx.clear(id, keys)` removes optional fields, because `update` does not change a field that is `undefined`. `summarizeBoard` adds "linked to <id> (<recipe>)".
- **Roots** (`packages/plugins/src/links/roots.ts`). `factsOf` gives the facts of a root: for an `event`, the facts of plan-012's event seed; for an `input`, its area. Then `complete` adds the country or the area.
- **Recipes** (`links/recipes.ts`). A recipe writes only its part of a node, and makes that part blank when a fact is missing:
  - `country` (country, presence, conflict): `country`, or clear it.
  - `reliefweb`: `glides` and `title`, or `glides: []` and clear the title.
  - `eventFootprint` and `conflictChoropleth` (map): the one layer with the id `link:<recipe>`. The recipe replaces this layer, adds it, or removes it. Other layers stay. The person who changed the root sees the new area on the map.
  - `frameTitle` (frame): `args.prefix` + the name, or clear the title.
- **Propagation** (`links/propagate.ts`). `planLinks` (read-only, in `prepare`) finds the followers of the root, gets the facts one time, and calculates the patches. `applyLinks` (in `apply`) writes them in the same transaction as the change to the root. Thus, a change and its effects are one undo step. Ops that do this: `event.setEvent` (now async, so the event card uses `invoke`), `input.setArea`, and `link.refresh` (no change to the root, for example when ReliefWeb gets a new GLIDE number). `link.remove` unlinks.
- **Canvas** (`apps/web/src/canvas/Links.tsx`). An arrow goes from a root to each follower. It starts and ends at the sides that face each other (left and right, or top and bottom) and curves between them. The arrows are always visible, and they move with the objects. The arrows of the selection are highlighted. They are in the world, above frames and below all other objects. There is no arrow between an object and the frame around it. The right-click menu shows Unlink and "Refresh linked objects" when they apply.

### 3.4 Templates

- Each seed kind makes a root (`SeedKind.root`: an `event` card, or an `input` for an area).
- A content node can have `link: { recipe, args?, seed? }`. Its first values come from the recipes that update it later, so templates and links use the same rules.
- A template has `frames: [{ prefix, seed? }]`. Each frame holds its columns, and the frame title follows the root. The gray box and the heading text of phase 1 are gone.
- A node that has no facts stays, and is blank (a feed without GLIDE numbers). A later root can fill it.
- Sets from phase 1 that are already on boards do not change.

## 4. Not built

- Links that people make by hand (for example, the Connector tool, or an op that links two objects). Only templates make links now.
- Other root kinds: a country input, a year-range input, a map as a root.
- More than one root for each template node. A node follows one seed.
- Templates as data, and "save this board as a template".
- The event widget in the palette form does not send typed text as `{ text }`.

## 5. Verification

- `packages/core/test/frames.test.ts`: frames, the `link` field, `BoardTx.clear`.
- `apps/web/test/frames.test.ts`: `withFramed`.
- `packages/plugins/test/links.test.ts`: a change to the event updates the followers in one undo step; a layer that a person added stays; missing facts make the parts blank; an unlinked node does not change; `link.refresh`; `input.setArea` from text; a node that is not a root cannot be followed.
- `packages/plugins/test/templates.test.ts`: templates make roots, linked nodes and frames; a later change to the event updates the set.
- A live test against Montandon and OpenCage: a sit rep for "nepal flood 2025", then a change to the 2019 Mozambique cyclone (the country, the footprint and the title change; the feed is blank, because that record has no GLIDE number); a conflict explorer for Cabo Delgado, then a change to Borno (all followers change to NGA).
- Not done yet: a check in a browser of the frame drag, the lines, the area input and Unlink.
