# Plan 011: who is who on the canvas

Colors and marks that tell people apart on the board: what you have selected, what others have selected, where their
pointers are, and where the agent has worked. Design source: the "Collaborator styles" frame of the Figma file
(Atlantis Pod Week Hack, AHD TTX). Implemented in `apps/web/src/canvas/Peers.tsx`, `board/collaborators.ts` and the
`--canvas-accent` / `--agent` tokens in `apps/web/src/shadcn.css`.

## Roles

| Role | Color | Outline | Marks |
| --- | --- | --- | --- |
| You | `--canvas-accent`, cyan-500 | solid 1.5 px | corner handles (only yours); marquee and draw draft in the same color |
| Another person | one of six, `board/collaborators.ts` | solid 1.5 px | cursor arrow and name tag; no handles |
| The agent | `--agent`, violet-500 | dashed 1.5 px | sparkle in its tag, in the chat and on its avatar |

- **Yours is cyan for everyone.** Each person sees their own selection in cyan, so the color that means "mine" is the
  same on every screen. Cyan is never assigned to anyone else.
- **People keep one color.** It is picked once per browser from the six (orange, pink, yellow, blue, emerald, red),
  stored with the person (`board/person.ts`) and sent in presence as a hex, so every browser draws them the same.
  A stored color from outside the palette is replaced on load. Six is the Figma file's count; with more people than
  colors, two share one, and the name tag tells them apart.
- **The agent is violet, and violet is not a person's color.** The Figma file gave violet to a person and black to the
  agent; violet moved to the agent so that "violet means the agent" holds everywhere. The agent has no cursor or
  selection of its own, so its work is marked by the objects it added or changed in the last 5 s
  (`board/agentActivity.ts`, from the shared op log), as dashed violet outlines.
- **Color is never the only signal.** Solid means a person and dashed the agent; name tags carry the name; the agent
  has a sparkle and a square avatar, people a circle.

## Rules

- Chrome colors (these) and content colors (the palette of boxes, text and sticky notes, `canvas/style.ts`) are
  separate: content can be any hue; selection and presence marks sit on top with their handles and tags.
- A label on a person's color uses the text color that reads on it (`onColor`; the Figma file's `user-N-on`).
- Only your own selection has handles; others' and the agent's outlines have none, so nothing looks draggable that is not.
- Widgets have no border at rest: the outline appears only when someone selects them.
- Other accents in the app (`--ttx-accent`: drop targets, buttons) are not part of this and stay as they are.

## Not done

- Object name labels above selections (the Figma frame shows one; objects have no names yet).
- Collaborator avatars (no list of people on the board exists yet).
- Updating the Figma frame to the violet agent.
