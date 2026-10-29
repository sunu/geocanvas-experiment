# Task: landing page, new board and templates

Date: 2026-10-29. Status: planned, not started. Scope from `agent-docs/features.md` ("Prepopulate the widgets depending on the template that users choose") and PRD 4.6. Resolves the PRD §7 open decision "Templates: the schema".

## 1. Requirements

- A **landing page** lists the boards people can go back to, sorted, with a **New board** button.
- **New board** asks for a name, then offers a **blank board** or a board **from a template**.
- **From a template:** pick a template and set its context: a Montandon **event** and a **place**, both optional. The board opens already set up with widgets.
- **The board has a name**, shared with everyone on it, shown in the title bar and editable there.
- One atomic PR, with a working flow rather than mock screens.

The wireframes (landing grid, new-board dialog, template step) are lo-fi and show the flow, not the look. The look follows the Figma chrome: shadcn, Geist, rounded chrome (AGENTS.md "UI components" and "Corners and elevation").

Agreed with the product owner on 2026-10-29:
- The board list is **this browser's recent boards** (localStorage). There are no accounts and no server index of rooms.
- The board name is **stored in the doc** and written by an op.
- Templates in this PR: **SitRep**, plus **Blank**. "Event comparison" and "Blank with data explorer" from the wireframe come later.
- **A template can start without an event.** The event (and the place) can be chosen later, on the board.

## 2. Where this lands in the current code

- **Rooms:** a board is `#room=<id>` (`apps/web/src/board/room.ts`). In `apps/web/src/App.tsx`, all of this runs at module level, once per page:
  - it reads the hash
  - it makes a new id when there is none (lines 19–23)
  - it calls `connect(room)`

  Changing the hash reloads the page (`hashchange`). There is no router.
- **No board title.** The doc has `objects`, `oplog`, `chat`, `uploads` and `views`, but no meta map. `chrome/TitleBar.tsx` shows a fixed "Humanitarian TTX", and its menu has only "New board".
- **No list of boards.** Rooms are Durable Objects addressed by `idFromName`, which cannot be enumerated, and the Worker has no route that lists them.
- **Reusable parts:**
  - `EventPicker` (`events/EventObject.tsx`) is already used outside the canvas, as the palette's `event` widget.
  - `monty.getEvent` and `glidesOf` give an event's country and GLIDE numbers.
  - `tools.run('data.geocode', …)` gives places, with a `bbox` when OpenCage has bounds.
  - `fitMapTo`, `fitMapToCountry` and `fitMapToLayer` (`map/MapObject.tsx`) write the runner's view of a map.
  - The event layer recipe is `eventLayer` (`packages/plugins/src/events.ts`), and the COD-AB boundaries recipe is the one `map.addBoundaries` builds.
- **Ops:**
  - `prepare` may be async (use `runtime.invoke`).
  - `apply` writes through one `BoardTx`, so an op that adds many objects is one transaction and one undo step.
  - The UndoManager tracks `objects` only.
  - `core.object.duplicate` is the existing example of an op that adds several objects.
- **shadcn components present:** avatar, button, dropdown-menu, input, popover, progress, select, separator, textarea, tooltip. There is no dialog yet. `radix-ui` is already a dependency, so `npx shadcn@latest add dialog -c apps/web` adds no package.

## 3. Flows and screens

### 3.1 Entry

- **No room in the URL** (`/`): the landing page. Today this starts a new empty board; that changes.
- **`#new`:** the landing page with the New board dialog open. The title bar's "New board…" uses it.
- **`#room=<id>`:** the board, as today.

`main.tsx` reads the hash. With a room, it `import()`s `./App` (its module-level `connect` stays as it is). Without one, it renders `home/Landing`. The landing then loads no Yjs socket, MapLibre or deck.gl. The `hashchange` reload stays, so going from the landing to a board, or back, is a page load.

### 3.2 Landing ("Boards")

- **Header:** the logo and the app name. Help and Login from the wireframe are left out, since there are no accounts or help pages yet.
- **"Boards" heading row:** a **Sort** select (Last opened, Name) and a **New board** button.
- **Grid of board cards:**
  - Each shows the title, a line for the template or event ("SitRep · Nepal floods 2026"), and a relative date ("Opened Oct 28").
  - A card opens its board.
  - The card's menu has **Copy link** and **Remove from this list**. Removing does not delete the board; anyone with the link can still open it.
  - The wireframe's grey preview area shows a placeholder for the template: there are no thumbnails yet (§8).
- **Empty state:** "No boards in this browser yet", with **New board** and a field to paste a board link someone shared.
- **Recents** (`home/recents.ts`):
  - localStorage `ttx/boards`, holding `{ room, title, template?, eventName?, openedAt }[]`.
  - Every read and write is in try/catch: storage can be missing or blocked.
  - A board opened from a shared link is recorded too.
  - "Last opened" is what this browser knows. "Last edited" (the wireframe's sort) would need the server.

### 3.3 New board dialog, step 1

- **Name:** an input with the placeholder "Untitled board". It can stay empty.
- **Two choice cards:**
  - **Blank board:** start from an empty canvas.
  - **From template:** SitRep, and others later.
- **Blank → Create:** opens the new board with its name set.
- **From template → Next:** goes to step 2.

### 3.4 New board dialog, step 2: template and context

- **Template cards:** only **SitRep** in this PR ("Event, map, ReliefWeb, country context, who's where, conflict, report notes"), with a small sketch of its layout. The row has room for more templates later.
- **Set context:**
  - **Event:** optional. `EventPicker` (search as you type, recent events without text), with **Choose later**.
  - **Place / AOI:** optional. Typed text, geocoded on Create. When it is empty, the map fits the event's footprint, or stays at the whole world with no event either.
  - The wireframe's **date range** is left out: no widget takes one yet (§8).
- **Back** and **Create board.** Create resolves the context first, so errors show in the dialog, not on a half-made board:
  - If an event was picked, `monty.getEvent(id)` gives the country (ISO3), the event's name and `glidesOf(event)`.
  - If a place was typed, `data.geocode` gives its bbox. When there is no place found, the dialog says so.
  - Then it saves a **pending setup** (§3.5) and opens `#room=<newRoomId()>`.

### 3.5 The board opens

- **Pending setup** (`home/pending.ts`): sessionStorage `ttx/pending/<room>`, holding `{ title?, template?, eventId?, eventName?, country?, glides?, bbox? }`.
  - It is written by the dialog, and read and deleted by the board page, so it reaches only the tab that made the board, and only once. This is the same rule as `addFeedOnPick`: only the browser that acted adds objects.
- After the provider's first `sync`, `App.tsx` takes the pending setup:
  - If the board is not empty, it does nothing. That guards against a second apply.
  - **Blank:** `runtime.invoke('board.setTitle', …)` when a name was given.
  - **Template:** `runtime.invoke('board.applyTemplate', …)`, then it writes the creator's view of the template's map:
    - with `fitMapTo(bbox)` for a place
    - otherwise with `fitMapToLayer` on the event layer
  - Others who open the board start from that saved view (AGENTS.md "Map widget").
- Then `recordBoard` adds or updates the board in recents. The title is observed, so recents keep the current name.

### 3.6 Title bar on a board

- It shows the board's title, or "Untitled board" when there is none.
- Clicking the title renames the board inline, as `board/NameButton.tsx` does for a person's name, by dispatching `board.setTitle`. Others see the new name live.
- The menu has:
  - **All boards** (the landing)
  - **New board…** (`#new`), which replaces today's "New board", the one that opens an empty board at once
- **Share** stays as it is.

## 4. Templates

### 4.1 Schema

A template is code in a headless plugin, not stored data. The board stores only what the template added: ordinary objects with their recipes.

```ts
// packages/plugins/src/templates.ts
export interface TemplateContext {
  title?: string
  eventId?: string
  eventName?: string
  country?: string   // ISO3
  glides?: string[]
}

export interface BoardTemplate {
  id: 'sitrep'
  title: string
  description: string
  /** Objects to add, with x and y relative to the template's top left; sizes from each type's defaultSize. */
  build(ctx: TemplateContext): Array<{ type: string; fields: Record<string, unknown> }>
}

export const TEMPLATES: Record<BoardTemplate['id'], BoardTemplate>
```

**Op `board.applyTemplate`** (canvas target), in a `templates` plugin listed in `packages/plugins/src/plugins.ts`:
- **Args:** `{ template, title?, eventId?, country?, glides?, x?, y? }`. Every context field is optional.
- **`prepare`:** checks the template and lays out its objects around the origin. The origin is the center of the runner's view when `x` and `y` are left out, as adds from the palette do.
- **`apply`:** one `tx.add` per object, plus `tx.setTitle` when a title is given. That is one transaction, so one undo step and one op log entry.
- Because it is an op, the agent and the MCP manifest get it with no extra work ("set up a SitRep for the Nepal floods"). An agent's SitRep has no ReliefWeb feed, since its tools do not see GLIDE numbers. This is the same as event picks by the agent today.

### 4.2 SitRep layout

Built only from types and recipes that exist:

| Place | Object | With an event | Without an event |
| --- | --- | --- | --- |
| Top | `text` heading | "{title}: situation report" | same, or "Situation report" without a title |
| Left | `event` | `eventId` set | empty: "Double-click to search for an event" |
| Left, below | `reliefweb` | when the event has GLIDE numbers | not added |
| Center | `map` | layers: COD-AB admin 1 boundaries + `eventLayer(eventId)` | boundaries only; shows "Choose a location" |
| Right | `country`, `presence`, `conflict` | `country` set from the event | no country; double-click opens the country picker |
| Bottom row | `sticky` × 5 | Key figures, Situation overview, Needs, Response, Gaps | same |

- The sticky notes stand in for the report sections until reports and charts exist (PRD 4.6, step 14).
- Without an event, people fill the widgets in on the board. Picking an event on the empty card adds its ReliefWeb feed through the existing `addFeedOnPick`. It does **not** fill in the map or the country widgets: that needs explicit links between widgets (PRD §7, design-spec proposals). This is a follow-up.
- The boundaries recipe is exported from the map plugin and reused, not copied.

## 5. Board title

- `packages/core/src/doc/board.ts`: a `meta` Y.Map (`doc.getMap('meta')`) with `title`, and a `Board.title` getter. Older tabs ignore the new key.
- `BoardTx.setTitle(title)` (`packages/core/src/doc/tx.ts`).
- Core op `board.setTitle`:
  - canvas target, `title: z.string().max(80)`
  - in `packages/core/src/plugins/core.ts`
- **Not undoable:** the UndoManager tracks `objects` only, as for map views. The op's description says so.
- `summarizeBoard` starts with the title, so the agent knows the board's name.

## 6. Files

New:
- `packages/plugins/src/templates.ts` (+ test)
- `apps/web/src/home/Landing.tsx`, `BoardCard.tsx`, `NewBoardDialog.tsx`, `recents.ts` (+ test), `pending.ts`, `resolve.ts`
- `apps/web/src/components/ui/dialog.tsx` (shadcn; change its imports to `@/lib/utils` and Phosphor)

Changed:
- `packages/core/src/doc/board.ts`, `doc/tx.ts`, `plugins/core.ts`, and the board summary (title)
- `packages/plugins/src/plugins.ts`, `index.ts`, `map.ts` (export the boundaries recipe)
- `apps/web/src/main.tsx` (entry split), `App.tsx` (no auto-create; apply the pending setup; record recents)
- `apps/web/src/chrome/TitleBar.tsx` (title, rename, menu)
- `AGENTS.md`:
  - the Rooms bullet
  - a bullet each for the board title and for templates
  - `home/` in the layout
- `agent-docs/prd.md`:
  - 4.1: the landing page and recent boards
  - 4.6: SitRep template → Built, other templates → Not sequenced
  - §7: the template schema is decided

## 7. Steps

One PR, in this order:

1. **Board title:** `meta`, `BoardTx.setTitle`, `board.setTitle`, the summary. Node tests.
2. **Templates plugin:** `TEMPLATES.sitrep` and `board.applyTemplate`. Node tests:
   - With an event, country and GLIDE numbers, it adds every row of §4.2, in one undo step.
   - With no event, it adds the full layout: an empty event, a map with boundaries only, HAPI widgets without a country, and no feed.
   - Leaving out `x` and `y` places the template at the view center.
3. **Entry split and landing:** `main.tsx`, `Landing`, `BoardCard`, `recents.ts` (Node tests: record, sort, forget, broken storage).
4. **New board dialog:** both steps, `resolve.ts` and `pending.ts`. Then, in `App.tsx`, apply the pending setup after sync and record recents.
5. **Title bar:** the title, inline rename, and the menu.
6. **Docs:** AGENTS.md and the PRD.

**Checks:**
- `npm test` and `npm run typecheck`.
- With `npm run sync` and `npm run dev`:
  1. `/` shows the empty landing.
  2. Blank board named "Test": the title bar says "Test"; All boards lists it.
  3. SitRep with an event that has GLIDE numbers (e.g. a Nepal flood): every widget appears, and the map is fitted to the footprint.
  4. ⌘Z removes the whole template in one step.
  5. SitRep with **Choose later**: the layout appears empty. Picking an event on the card adds its feed.
  6. Reloading does not apply the template again.
  7. A second browser sees the same title and widgets, and its map starts at the creator's view. Renaming shows up there live.
  8. Asking the agent "set up a SitRep for <event>" runs `board.applyTemplate`.

## 8. Decisions

1. **Recent boards are per browser** (2026-10-29). A server list would show every room to everyone, since there is no access control. When accounts come, recents become per account.
2. **The board title is in the doc**, written by `board.setTitle`, and is not undoable (2026-10-29).
3. **A template is code that adds ordinary objects through one op.** It stores no template id on the board, and no template data. The agent and MCP can apply it.
4. **SitRep first; the event is optional** (2026-10-29).
5. **No new dependency:** the dialog uses the installed `radix-ui`.

Out of this PR, for later:
- **Date range** in the context: no widget takes one. It comes with the Input widget (step 16) or with event search by dates.
- **Board thumbnails** on the landing cards: they need a snapshot of the canvas (see the map snapshots in `map/snapshots.ts`).
- **"Last edited"** sort, a **server board list**, **Help** and **Login**: they need the server or accounts.
- The **Event comparison** and **Data explorer** templates.
- **Linking widgets**, so that picking an event later fills in the map and the country widgets.
