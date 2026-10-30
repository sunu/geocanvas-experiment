# Plan 018: the board on a phone

A layout for phones on the same board, runtime and ops as the canvas, AI-first and fully editable: a phone is for
asking the agent and reading what is there, and anyone on it can still change anything. The canvas stays as it is;
an installable PWA comes after, as an optimization.

Status: experiment, on phone-sized screens only. Steps 1 to 7 are built; step 4 was checked in Chromium with touch emulation, not yet on real phones.

## Decisions

- **A second layout, not a responsive canvas.** The canvas is made for a mouse and a keyboard (drag to select, ⌘K,
  right-click menus, a 360 px chat panel over the canvas). A phone gets `mobile/MobileApp.tsx`, loaded instead of
  `App.tsx` by `main.tsx` when the screen is at most 640 px wide (`layout.ts`); `?layout=phone|desktop` overrides
  it in this browser, and `?layout=auto` goes back to the screen size. Both layouts join the room through
  `board/session.ts`. The phone's chunk is 18 kB and it does not load the canvas's code (`App`, 120 kB).
- **Every widget type shows with no phone code of its own.** A card is the type's own `View`, drawn as on the
  canvas at its own size and scaled to the screen's width (`ScaledObject.tsx`: a `.ttx-world` of one object with
  `--ttx-zoom`, so the name row is counter-scaled as on the canvas). A type whose height follows its content (a text)
  is shown at its content's height when that is taller than the stored one: only whoever changes a text fits it, so
  a stored height can be short, and a card would cut the rest off. Cards only show: nothing in them takes a tap,
  and a tap opens the widget full screen; a long press chooses the card without opening it. The canvas's own hints
  ("Double-click to pan and zoom", the focus button) are hidden; a new map still says "Choose a location". A per-type compact view, which reports also need
  (`agent-docs/tasks/reports.md` step 7), can replace the scaled card type by type later.
- **The board as the canvas lays it out, read-only** (`mobile/BoardCanvas.tsx`): the Board tab switches between
  List and Canvas (kept per browser), for boards whose layout says something. One finger pans, two zoom
  (`mobile/gestures.ts`, the canvas's camera helpers); a tap on a widget opens it full screen as in the list, and a tap
  on a frame fits the view to it. Nothing there moves, resizes or adds: editing stays in the list, the full screen
  and the palette. The camera is the view's own; maps show snapshots; links are drawn as on the canvas. Boxes are
  shown here, unlike in the list, since they are part of the layout.
- **The board as a list** (`mobile/order.ts`): reading order (top to bottom, then left to right), a frame as a
  section of what it holds directly (`framedBy`, as reports add a frame) with its frames nested inside it. Boxes
  (shapes, lines, arrows) are left out: they arrange the canvas and say nothing on a phone.
- **Full screen is focus mode, as on the canvas.** A type with a focus mode opens in it (`ObjectSheet.tsx`): laid out
  at the screen's size with `focused` and `editing`, its Options below it, on a `Draft` made when it opens and closed
  when it closes, as `enterFocus` does. Share sends the draft (after the type's `beforeShare`); leaving with
  unshared changes, by Back, Ask or the browser's back, asks Share, Discard or Keep editing (`ExitDialog`). Any other
  type is edited live, as on the canvas, drawn at its own size scaled to the screen's width, so a text measures its
  height at its own width when it is edited here (laid out at the screen's width, it would save a wrong height).
- **Drawing on a map works with a finger**: pointer events in `map/draw.ts`, a Done button for polygons, and
  double-tap on a map's note, from developmentseed/humanitarian-ttx#83, which this branch builds on. On a phone the
  tools are 36 px, for a finger.
- **The browser's back closes the full screen** (a swipe on iOS, the back button on Android): opening one pushes a
  history entry with only a state (`mobile/history.ts`; the hash stays, since changing it reloads the board), and
  `popstate` leaves it as Back does. Keep editing puts the entry back.
- **The keyboard:** Chrome on Android resizes the page for it (`interactive-widget=resizes-content`); Safari on iOS
  does not, so the layout follows `visualViewport` (`mobile/viewport.ts`) and the prompt box stays above it, except
  while the page is zoomed in: a zoomed visual viewport is small too, and a layout fitted to it zoomed with it, so
  pinching back out could not show the whole screen. Safari also zooms into a field whose text is under 16px when
  it is focused, and most of the app's are 12 to 14px: on iOS only, the viewport gets `maximum-scale=1`
  (`src/iosZoom.ts`, from `main.tsx`, so the landing page has it too), which stops that zoom but not pinch zoom; on
  Android it would stop pinch zoom as well.
- **The selection is the chosen card.** Opening a card selects it in presence, so others see it outlined on the
  canvas, the agent acts on it, and the Ask page shows it with a button to clear it.
- **Adds go next to the chosen card** (`mobile/placement.ts`). The phone sets `runtime.view`: `center()` is the
  chosen card's right edge (the agent's `freeSpot` then puts its adds on the card's row, past it), or below the
  board with no card; `zoomTo` scrolls the list, `focus` opens the full screen. Adds from the palette go through
  the same `firstAddSpot` as the agent's, since a person on a phone does not see where they land. A new object
  opens at once, for editing if its type has `editOnCreate`.
- **Editing is the palette.** The + button and the full screen's ⋯ open the command palette on the selection: every
  op, form and template, with no phone code per op. Undo and redo are in the top bar.
- **Ask is the default tab.** The canvas's chat, split into `useChatThread`, `ChatEntries`, `ChatComposer` and
  `sendMessage` (`agent/ChatPanel.tsx`), so both layouts use the same thread, entries and prompt box. On a phone,
  each reply also lists what it added and changed (from its `undo` record), to open them, since no canvas shows
  them. Starter prompts fill the box; nothing is sent until Send. "My key" with no key falls back to the room's
  agent.
- **Maps:** only the map open full screen is live; the list's maps are snapshots (`publishViewport` with no objects,
  the open map as `focused`), and the card of the open map draws nothing while it is open, so the map is not live
  twice. A map no longer saves a move that ends where its view already is (a resize, entering focus): it only
  changed the view's `at`, which made a draft look changed, on the canvas too.
- **Reports tab:** the board's reports one at a time, their title and blocks reflowed at the screen's width (the
  widget's `ReportContent`, in one column), not the page scaled down, which would be unreadable. A report is edited
  from its widget until report mode exists.
- **PWA** (`src/pwa/`): a manifest and icons (made from `assets/logo.svg`); our own service worker (`sw.js`, no
  dependency), which the build writes to `/sw.js` with its version and the files to cache at install
  (`precache.ts`: the page, the entry and both layouts with what they load at once, about 3.8 MB before
  compression). Pages come from the network, or from the cache when offline or after 4 s; `/assets/*` from the cache
  (their names carry hashes); everything else (the board's socket, `/monty`, `/uploads`, map tiles) is not touched.
  Registered in production builds only. A new version waits until the person reloads from the app's notice
  (`UpdateNotice.tsx`), so a tab never runs two builds' code against the board. Offline, a board's layout loads and
  says it is offline; its content needs the network (offline boards, with y-indexeddb, are a separate decision).

## Steps

1. Shell, list and full screen: built.
2. Ask page and the reply's objects: built.
3. Placement next to the chosen card, palette edits: built.
4. Phones: touch pans in a focused map, the keyboard (visualViewport), checked in Chromium with touch emulation.
   Still to check on real phones: iOS Safari's keyboard, WebGL contexts, memory with the Overture and exposure
   workers.
5. Gestures: a long press chooses a card; the browser's back closes the full screen: built.
6. PWA: built.
7. Reports tab, to read: built. Report mode (editing) comes with the reports work.

Not in this plan: updates sent to people as they happen ("2 new ReliefWeb reports"). They are to come from the room
deterministically, not from the agent, and get their own plan.

## Known limits

- The full screen has no undo of its own: the top bar's undo is under it. Undo on a draft, as ⌘Z in focus on the
  canvas, is not built.
- Opening another object full screen while one is open (from the agent's `focus`) drops the first one's draft.
- The agent's turns are shared by the room (20 per hour): an AI-first phone layout spends them faster.
- No access control, as everywhere: anyone with the link edits.
