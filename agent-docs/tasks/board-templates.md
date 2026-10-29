# Task: landing page, new board and templates

Date: 2026-10-29. Status: built in PR #55; browser check pending. Scope from `agent-docs/features.md` ("Prepopulate the widgets depending on the template that users choose") and PRD 4.6. The templates themselves are `plans/plan-012.md` (merged from `main` while this was built); this task adds the way into them from a new board.

## 1. Requirements

- A **landing page** lists the boards people can go back to, sorted, with a **New board** button.
- **New board** asks for a name, then offers a **blank board** or a board **from a template**.
- **From a template:** pick a template and set its context (its seeds: an event, an area). Every part of the context is optional. The board opens already set up with widgets.
- **The board has a name**, shared with everyone on it, shown in the title bar and editable there.
- One atomic PR, with a working flow rather than mock screens.

The wireframes (landing grid, new-board dialog, template step) are lo-fi and show the flow, not the look. The look follows the Figma chrome: shadcn, Geist, rounded chrome (AGENTS.md "UI components" and "Corners and elevation").

Agreed with the product owner on 2026-10-29:
- The board list is **this browser's recent boards** (localStorage). There are no accounts and no server index of rooms.
- The board name is **stored in the doc** and written by an op.
- **A template can start without its seeds.** What is left out is chosen later, on the board.
- **One template system:** plan-012's `template.<id>` ops. This task first had its own (`board.applyTemplate`); it was dropped when plan-012 reached `main`, and plan-012 gained optional seeds (§4).

## 2. Where this lands in the current code

- **Rooms:** a board is `#room=<id>` (`apps/web/src/board/room.ts`). `App.tsx` reads the hash and calls `connect(room)` at module level, once per page; changing the hash reloads the page. There is no router.
- **No list of boards.** Rooms are Durable Objects addressed by `idFromName`, which cannot be enumerated, and the Worker has no route that lists them.
- **Templates** (plan-012): each is an op, `template.<id>`, whose args are its seeds plus `x` and `y`. Its `prepare` looks the seeds up with the runtime's tools, so the dialog only passes what its pickers gave. Its `apply` adds every node in one undo step and sets the runner's view of each new map.
- **Reusable pickers:** `EventPicker` (`events/EventObject.tsx`) and `AreaPicker` (`templates/AreaPicker.tsx`), the palette's `event` and `area` form widgets.
- **shadcn:** no dialog existed. `radix-ui` is already a dependency, so the dialog component adds no package.

## 3. Flows and screens

### 3.1 Entry

- **No room in the URL** (`/`): the landing page. Before this, it started a new empty board.
- **`#new`:** the landing page with the New board dialog open. The title bar's "New board…" uses it.
- **`#room=<id>`:** the board.

`main.tsx` reads the hash. With a room, it `import()`s `./App`; without one, it renders `home/Landing`. The landing page then loads no socket, canvas or maps: about 70 kB gzipped, against 347 kB for the board.

### 3.2 Landing ("Boards")

- **Header:** the logo and the app name. Help and Login from the wireframe are left out: there are no accounts or help pages yet.
- **"Boards" heading row:** a **Sort** select (Last opened, Name), shown with two boards or more, and **New board**.
- **Grid of board cards:**
  - Each shows the title, the template it was made from, and "Opened Oct 28".
  - A card is a link to its board.
  - The card's menu has **Copy link** and **Remove from this list**. Removing does not delete the board.
  - The preview area shows an icon: there are no thumbnails yet (§6).
- **Empty state:** "No boards in this browser yet", with **New board** and a field to paste a board link.
- **Recents** (`home/recents.ts`): localStorage `ttx/boards`, `{ room, title?, template?, openedAt }[]`, at most 200, read and written in try/catch. A board opened from a shared link is recorded too. "Last opened" is what this browser knows; "last edited" would need the server.

### 3.3 New board dialog, step 1

- **Name:** placeholder "Untitled board"; it can stay empty.
- **Blank board** or **From a template**. Blank → **Create**; template → **Next**.

### 3.4 New board dialog, step 2: template and context

- **Template cards:** every `template.*` op, read from the templates plugin (`home/templates.ts`), so a new template appears here with no change. Today: Situation report and Conflict explorer.
- **Set context:** one picker per seed of the chosen template, chosen by the seed's form widget:
  - `event`: `EventPicker` (search as you type; recent events without text)
  - `area`: `AreaPicker`, without "Use my map view", since the board does not exist yet

  Each has **Choose later**.
- **A typed area must be picked from the list** before Create. The template would look up typed text on the new board, where a failed lookup would show nowhere.
- **Create board** saves a pending setup (§3.5) and opens `#room=<newRoomId()>`.

### 3.5 The board opens

- **Pending setup** (`home/pending.ts`): sessionStorage `ttx/pending/<room>`, holding `{ title?, template?, seeds? }`. The dialog writes it; the board page reads and deletes it, so only the tab that made the board sets it up, and only once (the same rule as `addFeedOnPick`).
- After the provider's first `sync`, `App.tsx`:
  - does nothing if the board has objects
  - runs `board.setTitle` when there is a name
  - runs `template.<id>` with the seeds, at the center of the view, then zooms to fit. The template sets the creator's view of its maps; others start from that view.
- Then `recordBoard` adds or updates the board in recents, and keeps its name current as people rename it.

### 3.6 Title bar on a board

- It shows the board's title ("Untitled board" when there is none). Clicking it renames the board inline, by dispatching `board.setTitle`; others see it live.
- The logo opens a menu: **All boards** (the landing page) and **New board…** (`#new`).
- **Share** is unchanged.

## 4. Optional seeds (a change to plan-012)

Every seed of a `template.<id>` op is optional. When a seed is left out:
- a node whose facts are not known is added **empty** if it has `blank` fields, to fill in on the board
- a node without `blank` is left out, as before

A seed that is given but lacks a fact still leaves its node out: for example, an event with no GLIDE numbers gets no ReliefWeb feed.

| Template | Left out | Added empty |
| --- | --- | --- |
| Situation report | event | event card, country context, map (no layers); no ReliefWeb feed |
| Conflict explorer | area | map (no layers), conflict, who's where, country context |

Headings fall back to "Situation report", or "Conflict: area of interest". The op's summary says "no event yet". Picking an event on the empty card later adds its ReliefWeb feed, through `addFeedOnPick`. It does not fill in the map or the country widgets: that is plan-012's phase 2, linking.

The agent sees every seed as optional too. The op's description tells it to leave a seed out only when asked.

## 5. Board title

- `packages/core/src/doc/board.ts`: a `meta` Y.Map with `title`, and a `Board.title` getter. Older tabs ignore the key.
- `BoardTx.setTitle` and the core op `board.setTitle` (canvas target, at most 80 characters; an empty title removes it).
- **Not undoable:** the UndoManager tracks `objects` only, as for map views.
- `summarizeBoard` starts with the title, so the agent knows the board's name.

## 6. Decisions and what is out

1. **Recent boards are per browser** (2026-10-29). A server list would show every room to everyone, since there is no access control. With accounts, recents become per account.
2. **The board title is in the doc**, written by `board.setTitle`, and not undone.
3. **One template system:** plan-012's, with optional seeds (2026-10-29).
4. **No new dependency:** the dialog uses the installed `radix-ui`.

Out, for later:
- **Date range** in the context: no template takes one yet (plan-012's seed kind `years`).
- **Board thumbnails** on the landing cards.
- **"Last edited"** sort, a **server board list**, **Help** and **Login**: they need the server or accounts.
- **Linking widgets** (plan-012 phase 2), so that a seed picked later fills in the map and the country widgets.

## 7. Checks

- `npm test`, `npm run typecheck`, `npm run build`.
- With `npm run sync` and `npm run dev`:
  1. `/` shows the empty landing page.
  2. Blank board named "Test": the title bar says "Test"; All boards lists it.
  3. Situation report for an event with GLIDE numbers (e.g. a Nepal flood): every widget appears, and the map shows the event.
  4. ⌘Z removes the whole template in one step.
  5. Situation report with **Choose later**: the widgets come empty. Picking an event on the card adds its feed.
  6. Conflict explorer for "Cabo Delgado", picked from the list.
  7. Reloading does not set the board up again.
  8. A second browser sees the same title and widgets, and its map starts at the creator's view. Renaming shows up there live.
