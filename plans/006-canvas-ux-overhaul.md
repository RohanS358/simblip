# 006 — Canvas UX overhaul: selection system, contextual dock actions, unified left panel, reader polish

- **Status**: DONE — all six milestones applied 2026-07-23 (user approved: retire right dock, no auto-open, flush rail + soft pane edge, full scope)
- **Commit**: 9cb8091 (+ plans 001–005 applied, uncommitted)
- **Severity**: — (feature/UX program, not an audit finding)
- **Estimated scope**: ~10 files; 6 milestones, each shippable alone

## Intent (user's brief)

Minimalist student audience; aesthetic but functional-first. Specifically:

1. Better gestures/looks in `canvas.tsx` — sidebars, dock, headers.
2. Better pills/chrome in `doc-view.tsx` and `pdf-view.tsx`.
3. A more generic selection box (single + multi) with proper cursors for resize/rotate.
4. Kill the floating action bar above selections; element actions (duplicate, bring front, send back, …) appear **in the dock** when an element is selected — built as a pipeline so different element kinds contribute different actions.
5. Properties panel integrated into the **left** side panel.
6. Left side panel stops being a floating pill card — flush with the edge, minimal footprint, blends until opened.

## Current state (verified at the listed lines)

- **Selection chrome** — `canvas.tsx:405-457`: ring on the *rotated* inner div, but the 4 corner handles and the rotate grip sit on the *unrotated* outer wrapper → on a rotated object the handles don't sit on the visible corners. Corner cursors are the static pair `cursor-nwse-resize`/`cursor-nesw-resize` (`canvas.tsx:424-427`) — wrong once the object is rotated. No edge (N/S/E/W) handles. Rotate grip is `cursor: grab` (`canvas.tsx:451`) with no `grabbing` state and no live angle readout. All chrome lives inside the zoom-transformed layer, so handles shrink/grow with canvas zoom.
- **Action surfaces** — three parallel implementations of the same actions: desktop context menu (`ctxMenuItems`, `canvas.tsx:229-252`), multi-select floating glass bar (`canvas.tsx:2671-2726`), mobile single-select floating bar (`canvas.tsx:2728-2777`). The floating bars are position-computed from selection bounds and hover above the enclosure — the "hard to use" bar.
- **Dock** — the floating tool pill (`toolbar.tsx`) lives in a 3×3 placement grid (`canvas-controls.tsx`); it already scrolls internally with fade masks and publishes its rect. No contextual section.
- **Left panel** — `sidebar.tsx:222-264`: `glass m-3 rounded-2xl` floating card; rail (52px) + optional content pane; width snaps open/closed with **no animation** (`style width`, `sidebar.tsx:228`).
- **Inspector** — `inspector.tsx:1370-1440`: separate right-dock floating glass card (`glass m-3 rounded-2xl`), Properties/Variables tabs; opened via header button, right edge-handle, or ctx-menu "Properties" (`togglePanel('inspector')`).
- **Readers** — `doc-view.tsx`: sheet chrome = bare page-number text, hover-revealed delete + corner resize grip, dashed "Add page" button; zoom has no on-screen feedback (controls live in the tab-bar menu). `pdf-view.tsx`: same zoom silence; "Drop to open" overlay pops in with no transition; page number is a bare text span.
- Boards already show a zoom pill (`canvas.tsx:2779-2806`, phone: transient HUD).

## Design language (applies to every milestone)

- Springs via `useSpring()` from `lib/motion.ts` (`snap` for small chrome, `default` for panels) — never new easings for JS motion; CSS transitions use `duration-150`/`duration-200` with `ease-strong` (token from plan 005).
- Transform/opacity only for animation; no layout-property animation except the grid-rows fold pattern.
- Selection chrome color stays `var(--ring)`; contextual accents follow the tint system.
- Everything respects `useMotionOff()` / OS reduced motion (plan 002).

---

## M1 — Generic selection box + real cursors (canvas.tsx only)

**Goal:** the selection box reads as one coherent control at any rotation and zoom, with the right cursor at every grip.

1. **Move selection chrome into the rotated frame.** Render handles + ring in a sibling overlay inside the inner rotated div (or apply `rotate(object.rotation)` to a dedicated chrome layer on the outer wrapper) so handles sit on the visible corners of a rotated object.
2. **Add edge handles** at N/S/E/W midpoints (resize one axis; opposite edge anchored). Visual: 10×3px rounded bars matching the corner dots' border/bg. Extend the existing `handleResizeStart(corner)` gesture to accept `'n'|'s'|'e'|'w'`.
3. **Rotation-aware cursors.** Helper `resizeCursor(handle, rotationDeg)`: maps the handle's compass angle + object rotation into the 4-cursor cycle `ew → nwse → ns → nesw` per 45° step. Applied to corner *and* edge handles.
4. **Rotate grip**: `cursor: grab`, switch to `grabbing` for the duration of the gesture (body-level cursor override during `rotate` mode, like drag apps do); show a small mono angle chip near the grip while rotating (`23.5°`), same styling as the zoom pill, snapping hint at 0/45/90 (already snaps via Shift? — if no snap exists, add Shift = 15° steps).
5. **Zoom-independent chrome**: scale handles/ring inversely by `1/viewport.zoom` (`transform: scale(${1/zoom})` per handle with proper origins, or compute size in px) so grips are always ~10px on screen from 25% to 300% zoom.
6. **Multi-select enclosure** (`canvas.tsx:2576-2593`): keep the dashed box but give it the same corner-dot visual at the 4 corners (non-functional at first — purely to read as "one selectable thing"; group-resize is a later stretch goal).
7. **Pan/rotate cursor states**: while space-panning or middle-drag panning, body cursor `grabbing`; select-tool hover over an object shows `move`… only if cheap (hover state exists — `onHover`).

*Acceptance:* rotate a rect 45° — handles sit on its visible corners and the E handle shows a `nesw`-family cursor; zoom to 33% — grips are still finger-sized; mid-rotation the cursor is `grabbing` and an angle chip is visible.

## M2 — Selection-actions pipeline (new module, the future-proofing ask)

**Goal:** one registry produces the action list for any selection; every surface (dock, context menu, mobile) renders from it.

1. **New file `lib/scene/selection-actions.ts`:**
   ```ts
   export interface SelectionAction {
     id: string            // 'duplicate' | 'bring-front' | …
     label: string
     icon: LucideIcon
     run: (ctx: ActionCtx) => void
     danger?: boolean
     group?: 'edit' | 'arrange' | 'convert' | 'share'   // dock ordering + separators
   }
   export function actionsForSelection(pageId: string, ids: string[]): SelectionAction[]
   ```
   Core actions (all selections): Properties, Copy, Duplicate, Bring to front, Send to back, Delete. Conditional contributors, ported from today's three implementations: *Recognize components* (ink present), *Save to library* (role-gated), *Convert* items (per-kind, from `convertItem()`), *Paste* (empty-selection context only). Plus a **registration hook** `registerSelectionActions(kind, provider)` so future object kinds/behaviors add their own without touching the core file.
2. **Refactor** `ctxMenuItems`, the multi-select bar's action array, and the mobile bar's list to consume `actionsForSelection` (context menu keeps text labels; bars use icons). No behavior change yet — this milestone is the plumbing.

*Acceptance:* right-click menu and both floating bars render identical actions to before, now sourced from one module; a demo registration (e.g. graph-only "Reset axes" stub behind a comment) shows the extension path.

## M3 — Actions live in the dock; floating bars retire

**Goal:** select something → the dock pill grows a contextual segment with that selection's actions. The floating bars above selections are removed.

1. **`toolbar.tsx`**: subscribe to `selection` for the active page. When non-empty (and editing), render after the existing divider: `N×` count chip (multi only) + icon buttons from `actionsForSelection`, `ToolButton`-styled, danger tinted rose. The pill's existing overflow-scroll + fade masks and the 3×3 grid track already handle growth on every dock side (top/bottom/left/right all work — vertical docks stack the segment).
2. **Expansion feel:** the segment animates in with the `snap` spring — container width animates via Framer `layout` on the pill (interruptible), buttons fade/scale from 0.95 with a ≤3-item 30ms stagger; instant under reduced motion. Selecting a different object crossfades icons rather than re-running the entrance.
3. **Remove** the multi-select floating bar (`canvas.tsx:2671-2726`) and the mobile single-select bar (`canvas.tsx:2728-2777`). Context menu **stays** (precision/discoverability). Mobile: the dock is the bottom bar — same contextual segment appears there; "Properties" action opens the existing mobile inspector drawer.
4. Keyboard note in tooltips where shortcuts exist (Ctrl+D duplicate etc. — only if those shortcuts already exist; do not add new ones in this milestone).

*Acceptance:* selecting 1 or 5 objects shows their actions in the dock within one frame + short settle; nothing floats over the canvas selection anymore; a rotated/zoomed selection never causes chrome to cover it; dock still never collides with the transport.

## M4 — Properties merges into the left panel; right dock retires

**Goal:** one side panel. Properties is a rail section like Notebook/Components/Tools/Library.

1. **`lib/store/sidebar-sections.ts`**: add `{ id: 'properties', label: 'Properties', icon: SlidersHorizontal }` (placed first or last — proposal: last, keeping Notebook the default).
2. **`sidebar.tsx`**: render `<InspectorPane pageId={contentPageId}/>` for the section — extract the Tabs content (Properties/Variables) from `inspector.tsx` into an export that doesn't bring the floating `fm.aside` shell. Panel width prefs stay per-panel (reuse `simblip-sidebar-w`).
3. **Auto-open behavior**: the "Properties" selection-action and ctx-menu item now open the left panel on the properties section (`togglePanel('sidebar')` + section select — a small `openSidebarSection(id)` helper on the workspace store). **No auto-open on plain select** (selection is constant; a panel that pops on every click is noise) — but when the section is already open it live-tracks the selection, as the inspector does today.
4. **`shell.tsx`**: remove `dockFor('right')`, the right edge-handle, and repoint the header `PanelRight` button to `openSidebarSection('properties')` (icon stays as a familiar affordance). `lib/store/layout.ts` right-side plumbing becomes dead — delete or leave for a cleanup pass (proposal: delete).
5. **Mobile unchanged** — the mobile inspector drawer already exists and works.

*Acceptance:* selecting an object and hitting Properties (dock action, ctx menu, or header button) opens the left panel's Properties section showing that object; no right-side panel exists on desktop; Variables tab still reachable.

## M5 — The left panel merges into the edge

**Goal:** rail feels like part of the window chrome, not a floating card; opened pane costs the minimum.

1. **`sidebar.tsx` desktop shell**: drop `glass m-3 rounded-2xl` → flush column: `h-full border-r border-border/50 bg-sidebar/80 backdrop-blur-xl` (uses the existing `--sidebar` token family), no margins, no rounding on the window side (keep a subtle `rounded-r-2xl` on the *pane* only, or fully square — see question Q3). Rail stays 52px.
2. **Animated open/close**: pane width animates with the `default` spring (Framer `animate={{ width }}` on the pane container, content `min-w` fixed so text doesn't reflow mid-motion; fade content 0→1 in the last 40%). Interruptible; instant under reduced motion. The snap-open today is the single most visible missing transition in the app.
3. **Edge handle** (`shell.tsx:394-401`): with the rail always present, the mid-screen left chevron tab is redundant chrome — remove it (rail buttons open sections directly). Keep the header `PanelLeft` toggle.
4. Sidebar/canvas seam: canvas content no longer needs the `m-3` gutter illusion; verify the dock grid + zoom pill margins still look balanced.

*Acceptance:* collapsed = a quiet 52px rail flush with the edge; opening Notebook glides the pane out (interruptible mid-flight); nothing floats or casts a card shadow on the left.

## M6 — Doc/PDF reader polish (doc-view.tsx, pdf-view.tsx)

**Goal:** the reading surfaces speak the same chrome language as the board.

1. **Zoom feedback**: transient zoom HUD pill (reuse the board pattern: mono %, fades in while zoom changes, away 1.2s later) for both readers, bottom-right, dock-clearance-aware. Board's `zoomHud` logic extracted into a small shared hook `useTransientHud(value)`.
2. **Page-number chips**: doc sheets (`doc-view.tsx:143-145`) and PDF pages (`pdf-view.tsx:156-158`) get a consistent quiet chip (`rounded-md bg-black/35 px-1.5 text-[10px] text-white/90 backdrop-blur-sm` on PDF's white page; theme-aware `bg-foreground/8` on doc sheets) instead of bare text.
3. **Sheet affordances**: delete button + resize grip fade in on hover with `duration-150` (they already use transition-opacity — verify + unify); resize grip gets a press state; "Add page" gets `active:scale-[0.97]` + the standard transition list (plan 003 language).
4. **Drop-to-open overlay** (`pdf-view.tsx:482-486`): fade+scale in (opacity 0→1, scale 0.98→1, 150ms ease-strong) via `data-[state]` or mount animation; instant under reduced motion.
5. **Active sheet indication** (`doc-view.tsx:120`): soften `ring-2 …/60` → `ring-1 ring-[var(--accent-blue)]/50 + shadow-[0_2px_24px_color-mix(...)]` so the active page reads focused, not alarmed.
6. **Notes split divider** (`pdf-view.tsx:544-549`): add `active` color state (blue at 50% while dragging) and widen the hit area with an `::after` pad like the corner handles do.

*Acceptance:* pinch-zooming a PDF/doc shows the % pill; page chips look identical across readers and themes; drag-over never pops.

---

## Execution order & risk

M2 → M3 is the critical pair (pipeline before dock rendering). M1 is independent. M4 → M5 in order. M6 anytime.

| Milestone | Files | Risk |
| --- | --- | --- |
| M1 selection box | canvas.tsx | Medium — gesture math touched; rotation cursor mapping needs feel-testing |
| M2 pipeline | new lib/scene/selection-actions.ts, canvas.tsx | Low — pure refactor, behavior-frozen |
| M3 dock actions | toolbar.tsx, canvas.tsx (deletions) | Medium — dock width churn on selection change; test all 4 dock sides + phone edge bar |
| M4 properties→left | sidebar-sections.ts, sidebar.tsx, inspector.tsx, shell.tsx, workspace store | Medium — desktop-only surface area, mobile untouched |
| M5 flush panel | sidebar.tsx, shell.tsx | Low–medium — pure presentation + one animation |
| M6 readers | doc-view.tsx, pdf-view.tsx, small shared hook | Low |

Verification per milestone: `npx tsc --noEmit`, production build, and a feel-check script (to be written into each milestone's commit message; Playwright smoke on `/notebook` where feasible).

## Open questions for the user (blocking sign-off)

- **Q1 — Right inspector**: fully retire the right dock (proposal) or keep it as an optional home?
- **Q2 — Auto-open**: should selecting an object ever auto-open the Properties section (proposal: no — only explicit Properties actions open it)?
- **Q3 — Flush panel look**: fully square, edge-to-edge (maximal merge) vs. flush rail with a softly rounded pane edge (proposal)?
- **Q4 — Scope**: all six milestones, or trim (e.g. defer M6)?
