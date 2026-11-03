# Plan 027: links to objects, and an agent that shows you an object

## Context

People want to share a link that opens a board on one card or frame. They also want to tell the agent "go to the
Nepal frame". Before this change:
- A board link named only the room (`#room=<id>`).
- The canvas camera is local to each tab and is never synced. The view ops (`core.view.*`) need a camera
  (`runtime.view`). The room's agent runs in the Worker and the browser agent has its own runtime, so neither has a
  camera, and the runtime refused these ops for them. Only the MCP executor has the tab's camera.

The agent could already find an object by its name: `summarizeBoard` gives each object's id and name.

## Design

**Links.** A link to an object is `#room=<room>&obj=<object id>` (`board/room.ts`). The anchor is the object id, not
a new name field: ids do not change when people rename an object, and nothing new is stored. Copy link is in the
right-click menu of one object. The canvas shows the object (selects it and zooms to it, as `zoomTo` does) once the
doc has synced, then removes `&obj=` from the URL, so the same link pasted again shows it again. A hash change that
only changes the object does not reload the page (`main.tsx`). The phone layout ignores `obj` for now.

**Agent.** The op `core.view.show` (core plugin) has no `applyView`. Its `apply` writes a show request in the doc's
`nav` map (`packages/core/src/nav.ts`): person id → `{ id, at }`, for the runner, or for an agent the person it acts
for (`onBehalfOf`). Only that person's view moves, as with `map.showArea` without `for`. Each browser listens to its
own person's entry from the sync on, and shows the object as a link does. It does not compare `at` with its own
clock, since the Worker's clock and the browser's can differ. `nav` is not undone (the UndoManager tracks `objects`
only).

Why the doc and not a message on the socket (as the code relay does): the doc reaches every agent the same way (the
room's, a browser agent, MCP), and a tab that opens later does not act on an old request, since it listens from the
sync on.

## Not built

- A show request for everyone (a facilitator brings all people to one frame).
- Links on the phone layout (open the card full screen).
- Readable anchors (a slug per object).
