# File Management Fixes + Multi-Format Viewer/Editor Suite

Status: Approved
Date: 2026-08-07

## Problem

Two related gaps in SIMBLIP's file/folder system:

1. **File management is broken/incomplete on both platforms.** Desktop has no
   standalone "New Folder" action outside a right-click on an existing row.
   Mobile's full-screen folder view gives notebooks and pages a full
   rename/delete/properties menu but never gave sub-folders ("sections") the
   same menu — they're inert nav tiles. Files (`FileNode` leaves) are inert
   everywhere: no click-to-open on desktop or mobile.

   Live-tested in the browser against the real desktop tree (2026-08-07):
   right-click *does* open a working context menu with the expected items
   (`notebook-tree.tsx`'s `FolderRow`/`PageRow`/`FileRow` all already have
   full `ContextMenu`s — the earlier static-code read undercounted this).
   But clicking "Rename" from that menu is itself broken: the inline
   `<input>` mounts in the DOM at the correct position (confirmed via
   `getBoundingClientRect`/computed style — visible, correctly placed,
   correct value) but never actually receives focus (`document.activeElement`
   stays `<body>`) — a focus-stealing race where Radix's context-menu-close
   returns focus to the trigger row right as the freshly-mounted
   `autoFocus` `<input>` (`InlineName`, notebook-tree.tsx:98-152) tries to
   grab it. Net effect: the box is there but unusable — visually looks like
   "nothing happened." This is the concrete bug behind "right click doesn't
   really function."

   Separately, and regardless of the above bug: relying on right-click (or
   long-press) as the *only* way to discover that rename/delete/properties
   exist is bad discoverability — desktop already has a working precedent
   for this in the same file (`FolderRow`'s "Add page" `+` button,
   notebook-tree.tsx:222-232, `opacity-0` → `group-hover:opacity-100`).
   Every row (folder, page, file) should surface its available actions as
   hover-revealed icon buttons, with the context menu staying as a secondary
   path for power users, not the only path.



2. **No viewer/editor exists for uploaded files by kind.** `FileNode`s
   (images, docx, xlsx, pptx, etc.) have no rendering path once uploaded to
   the persisted folder tree. The only existing renderers are: the ephemeral,
   session-only canvas-object `file-view.tsx` (image/pdf preview, no ink, not
   saved), and a client-side "flatten to PDF" pipeline (`to-pdf.ts`) that
   screenshots pptx/docx into a read-only, non-editable PDF. Neither gives
   users a real, persisted, editable view of their files.

## Part A — Folder/Section Management Fixes

### A0. Fix the rename-input focus race (desktop, all row kinds)

`InlineName`'s `<input autoFocus ...>` (notebook-tree.tsx:116-138) loses the
focus race against Radix's `ContextMenu` returning focus to its trigger on
close, when rename is entered via the context menu's "Rename" item. Fix by
deferring the focus grab a tick past Radix's own close-focus-return (e.g.
`requestAnimationFrame`/a microtask before calling `.focus()` explicitly,
rather than relying on the native `autoFocus` attribute racing the browser's
own focus-restoration timing). Verify against all three row kinds
(`FolderRow`, `PageRow`, `FileRow`) since all three share `InlineName`.

### A1. Desktop: hover-revealed action icons + standalone "New Folder"

`components/workspace/notebook-tree.tsx`'s header "+" button currently only
creates a full notebook (`addNotebook()` + default section + page,
notebook-tree.tsx:438-449). There is no way to create a bare folder without
first having an existing folder/notebook row to right-click
(notebook-tree.tsx:236).

Add:
- A "New folder" option alongside "New notebook" in the header control,
  calling `store.getState().addFolder('New Folder', null)`.
- Both options also available from the empty-state CTA ("No notebooks yet",
  notebook-tree.tsx:452-459), which today offers no folder-creation path at
  all.
- Hover-revealed action icons on every row (`FolderRow`, `PageRow`,
  `FileRow`), extending the existing `opacity-0`/`group-hover:opacity-100`
  pattern `FolderRow`'s "Add page" button already uses
  (notebook-tree.tsx:222-232) rather than introducing a new hover mechanism.
  Icon set per row kind mirrors what's already in that row's context menu
  (e.g. folder rows get New folder / Add page / Upload file / Rename /
  Delete as icons, not just the existing lone "+"). The context menu stays
  as-is for users who prefer right-click; hover icons make the same actions
  discoverable without needing to know right-click exists.

No store changes needed — `addFolder` already supports a `null` parent
(top-level) per `lib/store/workspace.ts:100,185`.

### A2. Mobile: sub-folder rename/delete/properties menu

`components/workspace/mobile-shell.tsx`'s folder grid (lines 675-696) renders
sub-folder cards with no `DropdownMenu`, unlike notebooks (882-911) and pages
(747-812) which already have full menus in the same file.

Add a `MoreVertical` → `DropdownMenu` to each sub-folder card, matching the
existing notebook menu's shape:
- Rename (wired to `renameNode`)
- Choose color/cover (wired to `setFolderCover`)
- Delete (wired to `removeNode`)

All three store actions already exist and are already used elsewhere in this
same file — this is UI wiring only, no new store logic.

### A3. Files become openable

- Desktop `FileRow` (notebook-tree.tsx:341-371): add a click handler that
  opens the file's viewer (see Part B) as a new tab.
- Mobile file card (mobile-shell.tsx:817-825): same — tap opens the viewer as
  a new tab.

## Part B — Multi-Format Viewer/Editor Suite

### B1. Extend `PageKind`

`lib/scene/types.ts:138`: extend the closed union from
`'board' | 'doc' | 'pdf'` to
`'board' | 'doc' | 'pdf' | 'image' | 'docx' | 'xlsx' | 'pptx'`.

Wire each new kind into the same three hardcoded dispatch points the existing
three kinds already use (no new registry abstraction — this matches the
existing pattern and TypeScript's `Record<PageKind, ...>` in `tabs-bar.tsx`
already forces exhaustive handling):

- `components/workspace/page-view.tsx`'s if/else chain (currently lines
  20-22) — add a branch per new kind rendering its viewer component.
- `components/workspace/tabs-bar.tsx`'s `KIND_ICON` map (lines 13-17) — add
  an icon per new kind.
- `components/workspace/add-page-dialog.tsx`'s `KIND_TILES`/`Step` (lines
  27-33) — not required for file-backed kinds (they're created via file
  upload, not the "add page" dialog), but confirm no regression to the
  existing board/doc/pdf tiles.

### B2. `FileNode` → companion Page, created lazily on first open

`FileNode`s today live only in the folder tree with no page representation.
On first open (click from `FileRow` or mobile file card):

1. Detect target `PageKind` from `FileNode.mime`.
2. Create a new Page of that kind, seeded from the file's bytes (fetched via
   `lib/storage/manager.ts`'s `getFile`).
3. Store a link from the `FileNode` to the created Page id (new field,
   analogous to how PDF pages already link `annotPages`/`notesDocId`,
   `lib/scene/types.ts:192-197`) so subsequent opens reuse the same page
   instead of re-importing.

This mirrors the existing `pdf-attach.ts` flow (upload → persisted `pdf`-kind
page) rather than introducing a new file-to-page pattern.

### B3. Per-format viewers/editors

**Image** (`image` kind) — `components/workspace/image-view.tsx`:
- Renders the image via `<img>` (same approach as `file-view.tsx:314`).
- Adds an `InfiniteCanvas` ink overlay, same pattern as `pdf-view.tsx`'s
  per-page annotation overlay, so annotation is consistent across image and
  PDF pages.
- View/annotate only — no pixel editing of the image itself.

**DOCX** (`docx` kind) — `components/workspace/docx-view.tsx`:
- Editor: TipTap/ProseMirror.
- Import: `mammoth` (new dependency) converts docx → HTML on first open;
  HTML is loaded into the TipTap document.
- Persistence: autosaves continuously as TipTap JSON, stored as this page's
  content (SIMBLIP's own format — same autosave pattern `doc`-kind pages
  already use).
- Export: explicit "Export as .docx" action re-serializes the TipTap
  document via the `docx` library (new dependency) and downloads/re-uploads
  the result.

**XLSX** (`xlsx` kind) — `components/workspace/xlsx-view.tsx`:
- Editor: a spreadsheet grid component (x-spreadsheet or jspreadsheet — pick
  during implementation based on current maintenance/TS support).
- Import/export: `xlsx` (SheetJS, new dependency) converts to/from the grid's
  internal cell model.
- Persistence: autosaves grid state as JSON (this page's content). Explicit
  "Export as .xlsx" re-serializes via SheetJS.

**PPTX** (`pptx` kind) — `components/workspace/pptx-view.tsx`:
- Editor: slides modeled as bounded regions on SIMBLIP's existing canvas
  engine (`SceneObject` geometry+behaviors) — one slide = one canvas region
  with its own object tree (text boxes, images, shapes), plus a slide-list
  rail for navigation and reordering. Reuses the existing object
  renderer/registry (`components/objects/index.tsx`) rather than building a
  new rendering engine.
- Import: hand-rolled parser reading pptx/OOXML slide XML into
  `SceneObject`s (text runs → text objects, images → image objects, shapes →
  shape objects) on first open. No existing library provides
  pptx-to-editable-model conversion at adequate fidelity, so this is
  new/bespoke code. Best-effort fidelity — complex layouts, animations, and
  embedded media may not round-trip perfectly.
- Persistence: autosaves as this page's normal scene-object content (same
  mechanism `board`-kind pages already use).
- Export: explicit "Export as .pptx" walks the slide object trees and
  serializes via `pptxgenjs` (new dependency).

### B4. Legacy flatten-to-PDF path stays as fallback

`to-pdf.ts`'s existing pptx/docx → flattened-PDF conversion
(`notebook-tree.tsx:71-80`) is not deleted. New pptx/docx uploads route to
the new editable `pptx`/`docx` kinds by default; the flatten path remains
available (e.g., as a fallback or explicit "view as PDF instead" option) for
files the new import parsers can't handle, avoiding regression risk on the
currently-working conversion pipeline. `.xlsx` was previously hard-rejected
by this pipeline (`to-pdf.ts:236-243`) — that rejection becomes moot once the
new `xlsx` kind handles it directly.

## New dependencies

| Package | Format | Purpose |
|---|---|---|
| `mammoth` | docx | Import: docx → HTML |
| `docx` | docx | Export: TipTap JSON → docx |
| `xlsx` (SheetJS) | xlsx | Import/export: grid ↔ xlsx |
| x-spreadsheet or jspreadsheet | xlsx | Spreadsheet grid editor UI |
| `pptxgenjs` | pptx | Export: slide objects → pptx |
| TipTap/ProseMirror (+ related packages) | docx | Rich text editor |

pptx import has no new dependency — hand-rolled OOXML parsing.

## Explicitly out of scope

- Pixel-level image editing (crop/filter/draw-on-image beyond ink
  annotation).
- Real-time multi-user co-editing of docx/xlsx/pptx pages (follows whatever
  sync model SIMBLIP's existing board/doc pages already use — no new
  collaboration work).
- Pixel-perfect Office fidelity for docx/xlsx/pptx import or export.
- Legacy binary Office formats (`.doc`, `.xls`, `.ppt`) — OOXML
  (`.docx`/`.xlsx`/`.pptx`) only, consistent with the existing `LEGACY`
  rejection list in `to-pdf.ts`.
- Deleting/replacing the existing flatten-to-PDF pipeline.
