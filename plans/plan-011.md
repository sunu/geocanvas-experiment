# Plan 011: who is who on the canvas

Status: built, in `main`; a color of one's own per person and the avatar list added in PR #100.

Colors and marks that tell people apart on the board: what you have selected, what others have selected, where their
pointers are, and where the agent has worked. Design source: the "Collaborator styles" frame of the Figma file
(Atlantis Pod Week Hack, AHD TTX). Implemented in `apps/web/src/canvas/Peers.tsx`, `board/collaborators.ts` and the
`--canvas-accent` / `--agent` tokens in `apps/web/src/shadcn.css`.

## Roles

| Role | Color | Outline | Marks |
| --- | --- | --- | --- |
| You | `--canvas-accent`, cyan-500 | solid 1.5 px | corner handles (only yours); marquee and draw draft in the same color |
| Another person | one of about 60 in tiers (Figma's seven first); unique on the board, `board/collaborators.ts` | solid 1.5 px | cursor arrow and name tag; no handles |
| The agent | `--agent`, violet-500 | dashed 1.5 px | sparkle in its tag, in the chat and on its avatar |

- **Yours is cyan for everyone.** Each person sees their own selection in cyan, so the color that means "mine" is the
  same on every screen. Cyan is never assigned to anyone else.
- **Everyone on the board has a color of their own.** Colors come in tiers, used in this order: (1) Figma's seven
  multiplayer colors, each as the nearest shadcn (Tailwind) color; (2) 15 more shadcn colors spanning the rainbow,
  from a farthest-first search over every shade (300 to 700) of every hue; (3) the next 17 of that search; (4)
  generated soft and deep hues for the boards that need more. About 65 people fit before a color repeats; after
  that the name tags tell them apart. Browns and olives are out.
- **Figma's colors.** Figma's editor defines seven multiplayer colors, read from the `ui_color_multiplayer_*` tokens of
  its loaded app bundle on 2026-10-30: `#18a0fb`, `#1bc47d`, `#907cff`, `#ef5533`, `#ee46d3`, `#00b5ce`, `#ffc700`.
  Matched by distance in OKLab to blue-400, emerald-500, indigo-400, orange-600, fuchsia-500, teal-500 and amber-300
  (`FIGMA_COLORS`). Figma's `#00b5ce` is a cyan, which is yours, so it is mapped to teal-500, the nearest shadcn
  color that is not cyan. Its own sky blue (`#18a0fb`, nearest sky-500) went to blue-400 for the same reason. The
  tokens are the palette's source; how Figma picks one for a person (a hash, or the order they join) is not in them,
  and with seven colors Figma must repeat them on a busy file, which this app does not.
- **How a color is assigned** (`claimColor`, `board/collaborators.ts`): a person keeps the color they had when no one
  else has it (a new person's comes from their id). Otherwise they take the free color that looks least like any in
  use, measured as distance in OKLab (the farthest from its nearest), not simply the next in a list, so the second
  person is not given a neighbour of the first. When two people join at the same moment and clash, the one with the
  higher client id moves, so exactly one does. Colors are freed when people leave. Tabs of one person share a color.
  The guess is that Figma and Miro assign per session, since a person's color there changes, but their documentation
  does not say. Presence carries the hex, so every browser draws a person the same way.
- **Label text** on a color is black or white, whichever has the higher contrast (WCAG), at least 4.5:1 on every
  color (`onColor`).
- **The agent is violet, and violet is not a person's color.** The Figma file gave violet to a person and black to the
  agent; violet moved to the agent so that "violet means the agent" holds everywhere. The agent has no selection of
  its own, so its work is marked by the objects it added or changed in the last 5 s (`board/agentActivity.ts`, from
  the shared op log), as dashed violet outlines; what it works on is busy (a violet placeholder card, dashed, "Generating map…") until its data
  has loaded. Its cursor, with a sparkle and what it does in its tag, comes from the same op log
  (`canvas/agentCursor.ts`); presence only adds what it does (`activity`).
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

- Object name labels above selections (the Figma frame shows one). Objects now have names (`core.object.rename`), so this can be built.
- Updating the Figma frame to the violet agent.

## Avatars

The others on the board show as a stack of avatars in the user menu (`chrome/PresenceAvatars.tsx`): a person's initial on their color, the agent as a violet square with a sparkle, hover for the name, four shown and the rest counted. Your own avatar stays neutral, as in the Figma file.
