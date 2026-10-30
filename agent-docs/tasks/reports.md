# Task: reports

Date: 2026-10-29. Status: steps 2 to 5a built (the headless `reports` plugin; the widget on the canvas, tool P, Add to report from the menus; dropping objects on a report; report mode, live, with the chat, on real pages); step 1 (PDF spike) waits on approvals. Scope from `agent-docs/features.md` ("Ability for agent to sum up the current board and provide the report") and PRD 4.6, where reports are next. Modeled on OCHA humanitarian snapshots.

## 1. Requirements

A report turns what people found on a board into a document they can export and share. It is both:
- **a widget on the canvas**: it shows a small preview of the report as it is now, and objects can be dropped on it
- **a mode**: in focus, the report is a document editor

What it must do:
- **Add from the board.** The main workflow is adding canvas objects to a report:
  - drag one or more objects onto the report widget, which shows a drop zone and asks to confirm
  - "Add to report" from another widget's focus mode
  - "Add to report" from menus
  
  The objects stay where they are on the canvas. The preview updates.
- **More than one report per board.** Each report has a name, given by the people using it. Adding asks which report when there are several.
- **Write in the report.** Titles, rich text, images, and anything else the canvas offers can be added directly to a report.
- **Live or frozen.** A report reflects the board, but people choose, item by item, whether it stays in sync with its widget on the canvas or is frozen as it was.
- **Layout.** The page has two columns. An item takes one column, or both (full width). In report mode, people drag items to rearrange them. More columns (three or four) may come later.
- **Paper.** A4 or US Letter, portrait or landscape. The page is the size that prints on that sheet.
- **A document editor.** Report mode feels like a document editor: rich text, images and maps shown as they will print.
- **Export to PDF.** Images, maps, text and layout must come out right, every time.
- **A report URL.** A report can be shared on its own, apart from its room, as a frozen copy or kept up to date.

Rules every feature follows (PRD §2): writes are ops, so the agent and the MCP companion get every report action for free; objects store recipes and references, not fetched data; the new type has `summarize`; new dependencies need approval.

## 2. Where this lands in the current code

- **Focus mode** is the report mode.
  - A focusable type registers a `FocusableObjectUI` (`apps/web/src/canvas/registry.ts`): a `View` that branches on `focused`, an `Options` panel, and an optional `beforeShare`.
  - In focus, edits go to a private `Draft` (`packages/core/src/ops/draft.ts`) and reach the board with Share (`canvas/OptionsPanel.tsx`).
  - The map, notebook and PDF widgets already work this way: a compact view on the canvas, a full view in focus.
- **Dragging objects** is a pointer gesture in `canvas/Canvas.tsx` (`onPointerDown`, `trackDrag`, which has an `onUp`).
  - Hit testing is through the DOM: `closest('[data-id]')`.
  - Dropping one object onto another does not exist yet. The only drops are files from the operating system (`uploads/drop.ts`, `images/ImageObject.tsx`).
- **Menus:**
  - The right-click menu (`canvas/ObjectMenu.tsx`) has Duplicate, layer order and Delete, plus Unlink and Refresh linked objects for linked objects.
  - The Object panel (`canvas/ObjectPanel.tsx`) shows for one selected object whose type has `panel`; today only the map has one.
  - Any op with an `objects` target is in ⌘K and is an agent tool.
- **Toolbar** (`canvas/Toolbar.tsx`):
  - The groups are fixed arrays. `MAP_AND_REPORT` exists, but today holds only Map and Notebook.
  - The keys A, R, T, S, E, M, N, I, L, O, V and H are taken.
- **Text** on the canvas is a plain string, typed in a `<textarea>` and written whole by `text.setText`. No rich text library is installed.
- **Map pictures** (`map/snapshots.ts`):
  - One hidden MapLibre map with its deck.gl overlay (`preserveDrawingBuffer`) draws a PNG of a map view.
  - It is reachable only through `useSnapshot`, and its pixel ratio is fixed when it is made (at most 2).
  - Credits are shown under the picture as HTML, not drawn into it.
  - Drawn shapes are in the picture; sticky notes on a map are not.
- **Other widgets as pictures:**
  - The PDF widget's `renderPage` (`pdfs/pdf.ts`) draws a page at any scale.
  - Notebooks are a cross-origin iframe and cannot be captured.
  - The event, ReliefWeb and HDX HAPI widgets are HTML.
- **Uploads** (`packages/core/src/uploads.ts`, `apps/worker/src/uploads.ts`):
  - PNG and PDF are allowed already.
  - Each upload is listed in the doc's `uploads`, so it shows in the Uploads gallery.
  - Links are immutable and hard to guess.
  - HTML and SVG are refused.
- **Worker** (`apps/worker/src/worker.ts`, `wrangler.jsonc`):
  - The Room Durable Object holds the doc, so a read-only route is simple to add.
  - There is no Browser Rendering (`browser`) binding.
  - A new `/reports/*` route goes in `run_worker_first`; any other path falls back to the app.
- **Names:** every object has an optional `name` (`core.object.rename`, a field shared by all types in `packages/core/src/plugins/registry.ts`). Menus and panels show it instead of the type's title.
- **Frames** (`plans/plan-013.md`, core type `frame`, tool key A):
  - A frame holds objects together. Dragging it moves the objects fully inside it (`withFramed` in `canvas/camera.ts`).
  - It keeps **no list of its members**: they are found from positions when a drag starts.
  - Its `title` can follow a root through a link; a `name` someone gives wins.
  - Templates now put each seed's objects in a frame titled after the seed (for example, "Situation report: Flood in Nepal").
- **Links** (`plans/plan-013.md`, `packages/plugins/src/links/`):
  - An object can follow a **root** (an `event` card, or an `input` holding an area of interest) through its optional `link: { from, recipe, args? }` field.
  - When the root changes, a **recipe** rewrites only the linked part of each follower, in the same undo step: the country of the HAPI widgets, a map's footprint layer, the ReliefWeb feed, a frame's title.
  - Arrows on the canvas (`canvas/Links.tsx`) go from each root to its followers.
  - Only templates make links; people cannot link objects by hand yet.
- **Inputs** (`packages/plugins/src/inputs.ts`): an `input` object holds a seed that has no content widget, today an area of interest.

## 3. Concepts and data

### 3.1 The `report` type

A headless plugin, `reports`, in `packages/plugins`, with its UI in `apps/web/src/reports/`.

- **Its title** shows at the top of its first page, in pickers and on the widget. It is the `name` every object has (`core.object.rename`), as for frames; else the title of the frame the report was made from (`titleFrom`, below), which stays live; else "Untitled report". `reportTitle` in the plugin is this rule. No `title` field of its own.
- **Its fields:**

| Field | Type | Notes |
| --- | --- | --- |
| `paper` | `'a4' \| 'letter'` | Default A4 for now; the default is still open (§10). A new report does not ask for it: forms fold the page away (`advanced`), and the Options panel changes it (`report.setPage`). |
| `orientation` | `'portrait' \| 'landscape'` | Default portrait. |
| `blocks` | `Block[]` | The report's content, in reading order. A flat list: nothing in a report is a container. |
| `titleFrom` | object id, optional | The frame the report was made from (§4): its title is the report's title until the report is renamed. |

A **block** is `{ id, kind, span: 1 | 2, … }`:

| Kind | Holds |
| --- | --- |
| `heading` | Text, and a level (1 to 3). |
| `text` | Rich text (§5.3). |
| `image` | An upload id. |
| `divider` | Nothing. |
| `item` | `{ sourceId, mode: 'live' \| 'frozen', frozen?: FrozenItem }`: an object on the board. |

- **One write path:** `blocks` is written only by the report ops (§6), and replaced whole, as a map's `layers` are. Two people changing one report at the same moment can lose one change. Most report editing happens in focus, where edits are private until Share, which narrows this.
- **`summarize`** gives the agent the name, the paper, and each block: its kind, its span, and for items the source object and the mode.

### 3.2 Layout and pages

- **Two-column grid.** Blocks flow in reading order on two columns. A block with `span: 2` takes the full width.
  - Three or four columns later change only the grid and the allowed spans.
- **Pages.** The flow breaks into pages at the paper's size, at 96 CSS px per inch:
  - A4 is 794 × 1123 px.
  - Letter is 816 × 1056 px.
  - Landscape swaps the two sides.
  - Margins are fixed.
- **Page breaks** (built in step 5a, `apps/web/src/reports/pages.ts` and `ReportPages.tsx`). The flow becomes rows: a full-width block is a row by itself, two one-column blocks in a row share it, and a one-column block before a full-width one sits alone in the left column. Every block is laid out once out of sight at the page's column widths to measure its row, and measured again when a row changes size (an image loads). Rows go on pages in order, page 1 under the report's title; a row that does not fit what is left starts the next page. A row taller than a whole page gets a page of its own and is clipped for now; scaling maps and images down, and splitting text between lines, come later. Each page shows its number at the bottom.

### 3.3 Live and frozen items

- **Live:** the item shows its source object as the object is now, through a report renderer for its type.
- **Frozen:** the item keeps what its source showed when it was frozen, and never changes.
- **Each type decides** how it shows in a report and what freezing means. It registers `report?: { View, freeze(object) }` beside its `ObjectUI`:

  | Source | Live | Frozen |
  | --- | --- | --- |
  | Map | A picture of the creator's view, made again when the map changes | A high-resolution PNG (an upload), with its credits text |
  | Text, sticky note | Its text | A copy of its text |
  | Event, ReliefWeb, HDX HAPI widgets | Their current data | The data they showed (JSON), with an "as of" date |
  | Image, PDF page | The picture or page | The same, since an upload never changes |
  | Notebook | A card with the run's title and a link | The same |
  | Frame | A heading: the frame's name, or its title (which may follow a root) | The heading as it was |
  | Input (area of interest) | "Area of interest: Cabo Delgado" | The same text |

- **An item's label** in report mode and the Options panel is its source's `name`, or its type's title.
- **Items are not links.** A report item keeps its own `sourceId`. It does not use the `link` field of plan-013, because they point in opposite directions:
  - a link is a field on the follower, from one root; a recipe writes the follower's fields
  - a report item only reads its source and writes nothing to it, and one object can be in several reports

  So adding an object to a report never changes the object, and a linked object can be in a report too.
- **Live items follow links for free.** When a root changes (another event on a SitRep's event card), its linked widgets update on the canvas, so their live items in a report update as well. Frozen items do not, by design.
- **A removed source:** a live item whose source was deleted shows "The source object was removed.", and its last frozen copy if it has one.
- **Freezing a map needs a browser:** the PNG is drawn by the hidden map. So the UI freezes first, then dispatches `report.setItemMode` with the result.

## 4. On the canvas

- **The widget** (`apps/web/src/reports/ReportObject.tsx`) shows the report's first page: laid out at the paper's real size in CSS px (`pageSize`) and scaled down to the object with one transform, centered in it, so it is the page report mode shows.
  - At the top, the report's title. Then the blocks on the two-column grid.
  - On the canvas, the preview stays compact: items as cards (icon and name, and a sticky note's or text's text), with no captions, and the page count of the real pages. In report mode, every live item shows its actual content, under a small caption with its name (`ItemView` in `reports/ReportPages.tsx`): a map as a picture of it as this person sees it, with its credits on one line (`useMapPicture` in `map/picture.ts`: the snapshot renderer, never a live map); any other widget (a sticky note, a text, an event, a country's figures, a feed, a notebook, an image, a PDF, an area) as its own view, at its board size and proportions, scaled to the block and read-only. An embedded widget shows its content only: its header (title, rename, actions) is left out, so report mode's top bar shows the report's title alone, and an item is not renamed or acted on from the report. A frame shows as a heading. A frozen item shows its copy, tagged Frozen, until step 7 gives each type its frozen view. A removed source says so.
  - Its corner reads "Page 1 of N · M items". N is an estimate from the content's height until report mode paginates (step 5).
  - An empty report says "Drop objects here, or use Add to report".
  - It looks like a page: white, square corners, no shadow (AGENTS.md "Corners and elevation").
  - The Object panel shows its paper and its number of items.
- **Toolbar:** a **Report** tool in the `MAP_AND_REPORT` group, with the key P (free on 2026-10-29). A new report opens in focus.
- **Drag onto a report:**
  1. While objects are dragged, the report under the pointer (the topmost one that is not being dragged: `reportUnder` in `apps/web/src/reports/drop.ts`, from the DOM's `elementsFromPoint`) shows a drop zone: a dashed outline and "Drop to add to *Flood SitRep*" (`DropZone` in `Canvas.tsx`, screen space like selections). Dragging only reports shows none. Over the report, the dragged objects (with a frame's contents) are drawn above it, at 60% opacity and 80% size, without their selection outlines, so the report shows through as the place they go. This is only a look: their stored layer and size do not change.
  2. On release over it, a small confirmation appears by the drop point (`reports/DropConfirm.tsx`): "Add 2 objects to *Flood SitRep*?", or "Add this frame and all its contents to *Flood SitRep*?" (several objects with frames: "Add 3 objects, including all frame contents, to …?"), with Add (focused, so Enter adds) and Cancel (or Esc, or a press anywhere else).
  3. Add puts everything that moved back where it was, then runs `report.addItems` on the selection. Cancel leaves the objects where they were dropped, as a normal move.
  4. Either way it is one undo step: Add dispatches both writes inside the drag's own gesture, and the confirmation keeps presses from reaching the canvas, which would start a new one. `Runtime.dispatch` now records an op's summary as `invoke` does, so the canvas's notice says what was added.
  5. The objects stay on the canvas, and the report's preview updates.
- **Adding a frame adds all its contents.** Dropping a frame on a report, or Add to report on a frame, adds an item for each object fully inside the frame, in reading order (top to bottom, then left to right). Frames inside it follow, each as a heading and then its own objects. The report stays a flat list of blocks: the frame does not become a container in the report, and each block can be moved, removed or added to on its own.
  - **Into an empty report, the frame becomes the report** (for example a Situation report template's frame). Its title becomes the report's title, shown at the top of the first page, and kept live (`titleFrom`): when the template's event changes, the report's title changes with the frame's, until someone renames the report. No heading block is added.
  - **Into a report with content, the frame adds a heading block first:** an item for the frame itself, showing its live title, then its objects. So a second frame (a conflict explorer next to a SitRep) stays readable.
  - **With objects from outside the frame in the same selection,** the frame is not the whole report, so it gets its heading block too.

  Frames keep no list of members, so what is inside is worked out once, when the frame is added, with the same containment rule as a frame drag. Objects moved into the frame later are not added. The containment test moves from `canvas/camera.ts` to a shared place, so the canvas and the op use one rule.
- **Dragging a frame onto a report** moves its contents with it while dragging, as any frame drag does. On Add, everything goes back to where it was.
- **Seeing what is in a report:** when a report is selected, its live sources get a light outline on the canvas. There are no permanent arrows: the canvas already draws link arrows, and report arrows would crowd it.
- **Add to report…** (`report.addItems`, which acts on the selection), with the board's reports listed by title (`boardReports` in `apps/web/src/reports/reports.ts`) and **New report**:
  - **Right-click menu:** an Add to report submenu after Duplicate; with no report on the board, one item, Add to new report. Not shown when only reports are selected.
  - **Object panel:** an Add to report button beside Open, with the same choices (not for a report itself).
  - In both, a **check** marks each report that already has everything selected, as an item or as the frame it was made from (`holds` in `reports/reports.ts`). Choosing it again adds only what is missing, or the notice says it is all there. The menus only add: a checked report does not remove anything (§5.2a).
  - **⌘K:** a dropdown (the `report` form widget, `apps/web/src/reports/ui.tsx`); with one report on the board, it is chosen already; with none or several, New report is.
  - New report makes a report to the right of the objects, top-aligned with them, and the menus select it.
  - The canvas's notice says what happened ("Added 4 items to a new report, titled after the frame"), or why nothing was added.
  - Items always go at the end; move them afterwards in report mode.

## 5. Report mode

Step 5 is two PRs: **5a** (built) is report mode itself: opening it (the ⤢ button, a double-click, or the Object panel's Open), live edits, the chat beside it, every page in a scrolling column, and the Options panel. **5b** is editing on the page: dragging blocks to reorder, the column toggle, the insert menu, × and Delete on a block, and typing headings and plain text.

### 5.1 The view

- **A document editor.** The report's pages fill the screen, at a zoom where a page fits. Headings, rich text, images and maps look as they will print.
- **Arranging blocks:**
  - Each block has a drag handle. Dragging shows where it will go, in either column.
  - A toggle on each block switches it between one column and the full width.
  - An insert menu, between blocks and at the end, adds a heading, text, an image (upload, or from the board's uploads) or a divider.
- **Every page, scrolling.** A report can run over several pages. Report mode shows them all, stacked top to bottom with a gap between, in a column that scrolls, as the PDF widget's focus view does. A new page starts when the content reaches the page's height; a block does not split between pages unless it is text (§3.2).
- **Edits are live, with no private draft** (decided 2026-10-29). Unlike other focus modes, report mode writes straight to the shared report, as typing in a text on the canvas does:
  - others and the agent see changes as they happen
  - undo is per gesture
  - there is no Share button and no exit dialog

  Why: the agent edits the shared board and cannot see a private draft. With a draft, it would miss unshared edits, and Share could overwrite one side's changes, since `blocks` is replaced whole. `FocusableObjectUI` gets an option for this, for example `live: true`.

### 5.1a Layout: the agent beside the report

Report mode opens with the pages **fitted to the width** of the middle column, past 100% when there is room. A **zoom control** floats at the bottom left of the pages (zoom out, the percentage with Fit width and set steps from 50% to 200%, zoom in; 25% to 300% in all), and ⌘ or Ctrl with the wheel, or a trackpad pinch, zooms the report rather than the browser page. The zoom is this person's, and resets to Fit width each time report mode opens.

Report mode is a document view, not the canvas: the dotted canvas background is off around it (the canvas carries `data-focus` with the type in focus; `styles.css`).

Report mode fills the screen with three parts:
- **Left: the agent chat,** kept open so people can ask the agent to act on the report ("add the map", "write a summary of the key figures"). The agent's edits appear on the pages as it makes them.
- **Middle: the pages,** scrolling.
- **Right: the Options panel** (§5.2), with more in it than other widgets have.

Today focus mode hides all the app's panels (`styles.css` hides `.ttx-shell` in focus) and keeps room for the Options panel on the right only (`focusArea` in `canvas/focus.ts`). Report mode needs:
- a layout option on `FocusableObjectUI`, for example `keepChat: true`
- `focusArea` that leaves room on the left as well
- the chat panel shown in that mode

### 5.2 Options panel

- The report's **name** (`core.object.rename`).
- **Paper** (A4 or Letter) and **orientation** (portrait or landscape).
- **Items:** each item block, with its source's title, a **Live / Frozen** switch, **Go to source** (leaves focus and selects the object), and **Remove**.
- **Export PDF** (§7).
- **Share link** (§8).

### 5.2a Removing from a report

Removing happens **only in report mode**, where people see the whole report and what they take out of it. The canvas's menus (§4) only add.
- **Each block** (an item, a heading, text, an image, a divider) has a **Remove** action: an × on the block's toolbar while it is hovered or selected, and the Delete key on a selected block.
- **The Options panel's item list** has Remove on each item too (§5.2).
- **Removing an item never touches its object** on the board: the object stays, and so do the other reports it is in.
- A frame's heading item is one block like any other: removing it leaves the frame's objects in the report.
- Each removal is one undo step (`report.removeBlock`). The agent removes blocks with the same op, for example "take the conflict map out of the report".

### 5.3 Rich text

- `text` blocks are edited with a ProseMirror-based editor (Tiptap). It is a new dependency, approved in its step (§9).
- What it offers: paragraphs, headings, bold, italic, links, lists, and quotes.
- **Storage:** the editor's JSON, stored in the block and written whole by `report.setText`, a gesture op like `text.setText`. Typing is one undo step per editing gesture. Two people typing in one block at the same moment can lose keystrokes, as with text on the canvas today.
- **Later:** character-level co-editing with y-prosemirror on a `Y.XmlFragment`, if people need it (§10).

### 5.4 Adding from another widget's focus

- The Options panel of every focusable widget gets **Add to report**, with the same picker as §4.
- It writes to the board, not to the draft, since it does not change the focused widget (§10, open).

## 6. Ops

All with zod schemas, so they are in ⌘K, are agent tools, and are in the MCP manifest. A report is named with `core.object.rename`, as any object.

| Op | Target | Args |
| --- | --- | --- |
| `report.add` | canvas | the type's fields, as every `<type>.add` |
| `report.setPage` | one report | `paper`, `orientation` |
| `report.addItems` | the selection | `reportId`, optional: without it, a new report is made to the right of the objects. Its defaults choose the board's report when there is exactly one. Items go at the end, live; freeze them afterwards with `report.setItemMode`. A frame adds the objects in it; into an empty report, it also titles the report (§4). Objects already in the report, and reports, are skipped. Maps and frames take the full width, other items one column. |
| `report.addBlock` | one report | `block` (a heading with its level, text as plain `text` or a rich `doc`, an image, or a divider), `index`. Headings and dividers take the full width. |
| `report.removeBlock` | one report | `blockId` |
| `report.moveBlock` | one report | `blockId`, `index` |
| `report.setSpan` | one report | `blockId`, `span` |
| `report.setItemMode` | one report | `blockId`, `mode`, `frozen`. Texts, sticky notes, frames and areas are frozen by the op itself (`freezeText`); a map or a data widget needs `frozen` from the browser. |
| `report.setText` | one report | `blockId`, and `text` for a heading or `doc` (the editor's JSON) for a text block. A gesture op, hidden from tools. |

## 7. PDF export

Export must be reliable: what prints is what the report shows.

### 7.1 Criteria

- The PDF matches the report on screen: layout, columns, page breaks.
- Text is vector and selectable, with fonts embedded (Geist).
- Maps and images are sharp at print resolution (about 300 dpi).
- Page breaks are reliable with two columns and full-width blocks.
- Portrait and landscape, A4 and Letter.
- The same result from Chrome, Safari and Firefox.
- Time to export, file size, running cost, new dependencies and bundle size.

### 7.2 Options

1. **Browser print.**
   - A print-only view of the report, with `@page` CSS at the paper's size, and `window.print()`.
   - For: no dependency, vector text.
   - Against: people go through the print dialog (Save as PDF is a manual step), and browsers differ, Safari most of all.
2. **Headless Chrome on Cloudflare Browser Rendering.**
   - The Worker opens the report's view with `@cloudflare/puppeteer` and saves it with `page.pdf()`.
   - For: one browser engine, so one result; a real file download; vector text; the same view serves the report URL (§8).
   - Against: it needs a `browser` binding, the Workers paid plan, and a view of the report that a server can load. Its limits and cost need checking.
3. **Paged.js.**
   - A polyfill that paginates HTML in the browser, on top of options 1 or 2.
   - For: reliable page breaks and page numbers.
   - Against: one more dependency, and it changes the page's DOM.
4. **Building the PDF in code.**
   - `@react-pdf/renderer`: React components, its own layout engine, vector text. But it is a second renderer to keep in step with the screen.
   - PDFKit, pdf-lib or jsPDF: drawing every line and box ourselves, so we would re-implement the layout and rich text.
5. **A picture of the page.**
   - html2canvas or html-to-image, then jsPDF.
   - **Rejected:** the text becomes a blurry picture, and it fails on WebGL maps and cross-origin content.

**Whatever the choice:**
- Maps go into the report as high-resolution PNGs, never as live WebGL. `snapshots.ts` gains an exported `snapshot(req, { pixelRatio })` that returns the PNG at the pixel ratio asked for, within the browser's limit (about 4096 to 8192 px a side).
- Each map's credits are printed under it.
- Notebooks print as a card with a link.

### 7.3 Provisional pick

- **One HTML renderer** for the report, used by report mode, the report URL and printing, with print CSS at fixed page sizes.
- **Option 2** produces the PDF, with **option 1** as the fallback that costs nothing.
- **Paged.js** only if page breaks need it.

### 7.4 The spike (step 1)

Make one test report: a map, an image, rich text, two columns with one full-width block, two pages, and a landscape version. Export it with options 1, 2, 3 and 4 (react-pdf). Compare the results against §7.1, record them here with the PDFs, and decide.

## 8. The report URL

- **Share link** publishes the report and gives a link, `<origin>/r/<token>`, which the app serves.
  - The token is random and says nothing about the room. A room's id must not appear: anyone with it can edit the board, since rooms have no access control.
- **Frozen** (a copy): the report and its frozen items are written to R2 as `reports/<token>/report.json`, with their PNGs. The page never changes.
- **Live** (kept up to date):
  - The Worker finds the report from the token (R2 `report-shares/<token>.json`: `{ room, reportId }`, so no new binding).
  - A read-only route on the Room Durable Object returns the report and its source objects.
  - Each viewer's browser fetches external data through the Worker's proxies, as on a board.
- **Unpublish** removes the token, and the link stops working.
- The same view is what Browser Rendering opens to make the PDF (§7.2, option 2).

## 9. Steps (one PR each)

1. **PDF spike.** Compare the options (§7.4); record the results and the decision here.
2. **`reports` plugin** (built: `packages/plugins/src/reports.ts`, tests in `packages/plugins/test/reports.test.ts`; the frame containment rule moved to `packages/core/src/frames.ts`): the type, blocks and ops (§3, §6), with `summarize`. Node tests:
   - each op, and one undo step for each
   - `report.addItems` from a selection, for several objects at once
   - a frame adds a heading and the objects inside it, in reading order, with nested frames
   - blocks that reference a removed object
3. **The widget on the canvas** (built: `apps/web/src/reports/`, the Report tool on P in the toolbar's Map and report group, Add to report in the right-click menu and the Object panel, with the canvas's notice saying what it did): the preview, the toolbar tool, and Add to report from the right-click menu, the Object panel and ⌘K, with the report picker.
4. **Drag onto a report** (built): the drop zone, the confirmation, objects back in place, one undo step.
5. **Report mode,** in two PRs:
   - **5a** (built): report mode opens from ⤢, a double-click or the Object panel's Open; it is live (`FocusableObjectUI.live`: no draft, Share or exit dialog) and keeps the agent chat on the left (`keepChat`); every page scrolls in the middle, on real pages; the Options panel has the name, the page, and the items (Live or Frozen, Go to source, Remove).
   - **5b:** editing on the page: drag to reorder, the column toggle, the insert menu, × and Delete, headings and plain text.
6. **Rich text:** the editor (Tiptap, needs approval), `report.setText`.
7. **Live and frozen:**
   - report renderers and `freeze` for each type
   - the high-resolution map PNG export
   - keeping report pictures out of the Uploads gallery (a new upload kind, or a flag)
8. **PDF export,** as the spike decided.
9. **The report URL:** publish, frozen and live, unpublish.
10. **The agent drafts a report:** from the board (`summarizeBoard`) with the report ops. This is PRD 4.5, "Summarize the board into a report".

Each step: `npm test`, `npm run typecheck`, and a check from two browsers. Steps that add a dependency record its size and loading time.

## 10. Decisions

Made (2026-10-29, from the product owner):
1. A report is **both a widget and a mode** (focus). This settles the PRD §7 question.
2. A **Report tool in the toolbar**.
3. **Two columns**; each item one column or both. More columns may come later.
4. **A4 or US Letter**, **portrait or landscape**, at the size that prints on the sheet.
5. Each item is **live or frozen**, chosen in report mode.
6. **Drag and drop onto the report widget, with a confirmation.** The objects stay on the canvas.
7. **Add to report from focus** and from menus, with a picker when the board has several reports.
8. Each report has **its own name**.
9. **Rich text** in report mode.
10. **PDF export**, reliable for maps, images, text and layout. Options are compared in a spike before choosing.
11. A **report URL**, frozen or live, apart from the room.
12. **Report items reference their source directly** (`sourceId`), not through plan-013's `link` field (§3.3), and **adding a frame adds the objects in it** (§4). Decided after plan-013 merged (2026-10-29).
14. **A frame added to an empty report is the report:** its title becomes the report's (live, until renamed) and no heading block is added. Into a report with content, it gets a heading block (2026-10-29).
13. **A report's name** is the shared `name` field (`core.object.rename`), not a field of its own.

15. **Report mode keeps the agent chat open** on the left, with the Options panel on the right, and shows every page in a scrolling column (§5.1, §5.1a). 2026-10-29.
16. **Report mode edits live, without a private draft,** so the agent and people work on the same report (§5.1). 2026-10-29.
17. **Removing from a report happens only in report mode** (§5.2a). The canvas's Add to report menus only add, and their checks only show what is there. 2026-10-29.

Open:
1. **The PDF approach:** decided by the spike (§7.4).
2. **Rich text storage:** whole-block JSON first (recommended), or y-prosemirror for character-level co-editing from the start.
3. **Add to report from another widget's focus:** straight to the board (recommended), or into the draft, shared with Share.
4. **How far "frozen" goes** for event, ReliefWeb and HDX HAPI widgets: the data they showed (recommended), or only their recipe, which would still fetch fresh data.
5. **The report URL:** whether links expire, and who may publish and unpublish.
6. **Browser Rendering:** its cost and limits, before step 8.
7. **The default paper:** A4, Letter, or by the browser's locale.
8. **More than two columns:** later, if people ask.
9. **Templates and reports:** whether a template can also add a report, filled from its frames.
10. **New dependencies,** each approved in its step: Tiptap, `@cloudflare/puppeteer`, and possibly Paged.js or `@react-pdf/renderer`.
11. **Versioning, or suggested edits** as in Google Docs (suggest, then accept or reject), so people can review changes, the agent's included, before they land. Too complex for now; live edits first (decision 16).
