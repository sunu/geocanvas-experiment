# Task: reports

Date: 2026-10-29. Status: planned, not started (design). Scope from `agent-docs/features.md` ("Ability for agent to sum up the current board and provide the report") and PRD 4.6, where reports are next. Modeled on OCHA humanitarian snapshots.

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
  - The right-click menu (`canvas/ObjectMenu.tsx`) has Duplicate, layer order and Delete.
  - The Object panel (`canvas/ObjectPanel.tsx`) shows for one selected object whose type has `panel`; today only the map has one.
  - Any op with an `objects` target is in ⌘K and is an agent tool.
- **Toolbar** (`canvas/Toolbar.tsx`):
  - The groups are fixed arrays. `MAP_AND_REPORT` exists, but today holds only Map and Notebook.
  - The keys R, T, S, E, M, N, I, L, O, V and H are taken.
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
- **Frames and links** (`plans/plan-013.md` on `feat/frames-and-links`, not merged):
  - A `link: { from, recipe }` on an object is the closest model for a report item that points at a widget.
  - A frame could later be added to a report as a group.

## 3. Concepts and data

### 3.1 The `report` type

A headless plugin, `reports`, in `packages/plugins`, with its UI in `apps/web/src/reports/`. The fields are:

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | The report's name. Shown on the widget and in pickers. |
| `paper` | `'a4' \| 'letter'` | Default to decide (§10). |
| `orientation` | `'portrait' \| 'landscape'` | Default portrait. |
| `blocks` | `Block[]` | The report's content, in reading order. |

A **block** is `{ id, kind, span: 1 | 2, … }`:

| Kind | Holds |
| --- | --- |
| `heading` | Text, and a level (1 to 3). |
| `text` | Rich text (§5.3). |
| `image` | An upload id. |
| `divider` | Nothing. |
| `item` | `{ sourceId, mode: 'live' \| 'frozen', frozen?: FrozenItem }`: an object on the board. |

- **One write path:** `blocks` is written only by the report ops (§6), and replaced whole, as a map's `layers` are. Two people changing one report at the same moment can lose one change. Most report editing happens in focus, where edits are private until Share, which narrows this.
- **`summarize`** gives the agent the title, the paper, and each block: its kind, its span, and for items the source object and the mode.

### 3.2 Layout and pages

- **Two-column grid.** Blocks flow in reading order on two columns. A block with `span: 2` takes the full width.
  - Three or four columns later change only the grid and the allowed spans.
- **Pages.** The flow breaks into pages at the paper's size, at 96 CSS px per inch:
  - A4 is 794 × 1123 px.
  - Letter is 816 × 1056 px.
  - Landscape swaps the two sides.
  - Margins are fixed.
- **Page breaks.** A block that does not fit moves to the next page. A block taller than a page is scaled down to fit (maps, images), or split between lines (text).

### 3.3 Live and frozen items

- **Live:** the item shows its source object as the object is now, through a report renderer for its type.
- **Frozen:** the item keeps what its source showed when it was frozen, and never changes.
- **Each type decides** what freezing means. It registers `report?: { View, freeze(object) }` beside its `ObjectUI`:

  | Source | Live | Frozen |
  | --- | --- | --- |
  | Map | A picture of the creator's view, made again when the map changes | A high-resolution PNG (an upload), with its credits text |
  | Text, sticky note | Its text | A copy of its text |
  | Event, ReliefWeb, HDX HAPI widgets | Their current data | The data they showed (JSON), with an "as of" date |
  | Image, PDF page | The picture or page | The same, since an upload never changes |
  | Notebook | A card with the run's title and a link | The same |

- **A removed source:** a live item whose source was deleted shows "The source was removed", and its last frozen copy if it has one.
- **Freezing a map needs a browser:** the PNG is drawn by the hidden map. So the UI freezes first, then dispatches `report.setItemMode` with the result.

## 4. On the canvas

- **The widget** shows the report's first page, scaled down, with maps as pictures. Its header shows the title and the number of items. It looks like a page: white, square corners, no shadow (AGENTS.md "Corners and elevation").
- **Toolbar:** a **Report** tool in the `MAP_AND_REPORT` group, with a free key (P, if it is still free). A new report opens in focus.
- **Drag onto a report:**
  1. While objects are dragged, a report under the pointer shows a drop zone (an outline and "Drop to add to *Flood SitRep*").
  2. On release, a small confirmation appears by the report: "Add 2 objects to *Flood SitRep*?", with Add and Cancel.
  3. Add runs `report.addItems` and puts the dragged objects back where they were. Cancel leaves them where they were dropped, as a normal move.
  4. Either way it is one gesture, so one undo step.
  5. The objects stay on the canvas, and the report's preview updates.
- **Add to report…** from the right-click menu, the Object panel and ⌘K (`report.addItems`, which acts on the selection):
  - with one report on the board, it adds directly
  - with several, a submenu lists the reports by name
  - with none, "New report with these" makes one

## 5. Report mode

### 5.1 The view

- **A document editor.** The report's pages fill the screen, at a zoom where a page fits. Headings, rich text, images and maps look as they will print.
- **Arranging blocks:**
  - Each block has a drag handle. Dragging shows where it will go, in either column.
  - A toggle on each block switches it between one column and the full width.
  - An insert menu, between blocks and at the end, adds a heading, text, an image (upload, or from the board's uploads) or a divider.
- **Edits are private until Share,** as in every focus mode (`Draft`).

### 5.2 Options panel

- The report's **title**.
- **Paper** (A4 or Letter) and **orientation** (portrait or landscape).
- **Items:** each item block, with its source's title, a **Live / Frozen** switch, **Go to source** (leaves focus and selects the object), and **Remove**.
- **Export PDF** (§7).
- **Share link** (§8).

### 5.3 Rich text

- `text` blocks are edited with a ProseMirror-based editor (Tiptap). It is a new dependency, approved in its step (§9).
- What it offers: paragraphs, headings, bold, italic, links, lists, and quotes.
- **Storage:** the editor's JSON, stored in the block and written whole by `report.setText`, a gesture op like `text.setText`. Typing is one undo step per editing gesture. Two people typing in one block at the same moment can lose keystrokes, as with text on the canvas today.
- **Later:** character-level co-editing with y-prosemirror on a `Y.XmlFragment`, if people need it (§10).

### 5.4 Adding from another widget's focus

- The Options panel of every focusable widget gets **Add to report**, with the same picker as §4.
- It writes to the board, not to the draft, since it does not change the focused widget (§10, open).

## 6. Ops

All with zod schemas, so they are in ⌘K, are agent tools, and are in the MCP manifest.

| Op | Target | Args |
| --- | --- | --- |
| `report.add` | canvas | the type's fields, as every `<type>.add` |
| `report.setTitle` | one report | `title` |
| `report.setPage` | one report | `paper`, `orientation` |
| `report.addItems` | the selection | `reportId`, `mode` (default live) |
| `report.addBlock` | one report | `kind`, its content, `index` |
| `report.removeBlock` | one report | `blockId` |
| `report.moveBlock` | one report | `blockId`, `index` |
| `report.setSpan` | one report | `blockId`, `span` |
| `report.setItemMode` | one report | `blockId`, `mode`, `frozen` (from the UI) |
| `report.setText` | one report | `blockId`, the editor's JSON. A gesture op, hidden from tools. |

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
2. **`reports` plugin:** the type, blocks and ops (§3, §6), with `summarize`. Node tests:
   - each op, and one undo step for each
   - `report.addItems` from a selection, for several objects at once
   - blocks that reference a removed object
3. **The widget on the canvas:** the preview, the toolbar tool, and Add to report from the right-click menu, the Object panel and ⌘K, with the report picker.
4. **Drag onto a report:** the drop zone, the confirmation, objects back in place, one undo step.
5. **Report mode:** pages, the two-column grid, reordering by drag, spans, paper and orientation, the insert menu, headings and plain text.
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

Open:
1. **The PDF approach:** decided by the spike (§7.4).
2. **Rich text storage:** whole-block JSON first (recommended), or y-prosemirror for character-level co-editing from the start.
3. **Add to report from another widget's focus:** straight to the board (recommended), or into the draft, shared with Share.
4. **How far "frozen" goes** for event, ReliefWeb and HDX HAPI widgets: the data they showed (recommended), or only their recipe, which would still fetch fresh data.
5. **The report URL:** whether links expire, and who may publish and unpublish.
6. **Browser Rendering:** its cost and limits, before step 8.
7. **The default paper:** A4, Letter, or by the browser's locale.
8. **More than two columns:** later, if people ask.
9. **Links and frames** (plan-013): whether report items use the same `link` model, and whether a frame can be added as a group.
10. **New dependencies,** each approved in its step: Tiptap, `@cloudflare/puppeteer`, and possibly Paged.js or `@react-pdf/renderer`.
