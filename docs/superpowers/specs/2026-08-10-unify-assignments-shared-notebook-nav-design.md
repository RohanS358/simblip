# Unify Assignments & Shared Documents into the Notebook nav

2026-08-10

## Problem

Assignments (`/assignments`) and Shared Documents ("Shared with me" notebook)
are inconsistent with the rest of the app's navigation model:

- Desktop/tablet: Assignments has no presence in the sidebar at all — it's a
  full-page route unrelated to the notebook tree, even though its content
  (student/teacher assignment cards) is really just another kind of
  page-list. "Shared with me" is technically already in the tree (it's an
  ordinary auto-created notebook), but nothing calls it out.
- Mobile/tablet: Assignments is a real Next.js route (`/assignments`)
  reached via the bottom tab bar, breaking the "everything lives inside
  `/notebook`'s shell" pattern every other tab follows. "Shared with me" is
  buried two taps deep (More → Shared with me).

Since every assignment and every share ends up as a notebook/page anyway
(via `importPageDoc`), both belong in the same navigational surface as
notebooks, not off to the side.

## Design

### 1. Desktop/tablet sidebar — three collapsible sections

The sidebar's `notebook` section (`sidebar.tsx`, `activeSection === 'notebook'`)
currently renders `<NotebookTree />` alone. It becomes a new `NotebookPanel`
wrapper that owns one scroll container and stacks three collapsible
divisions, in this order:

1. **Notebooks** — today's `NotebookTree` body (unchanged tree behavior),
   with its "Shared with me" notebook excluded from the root list (see §2).
2. **Assignments** — the same `StudentAssignments` / `TeacherAssignments`
   logic that exists today, extracted into a shared component so desktop
   and mobile both import one source instead of duplicating it.
3. **Shared** — the "Shared with me" notebook's contents, rendered with the
   tree's existing `PageRow`/`FileRow` components rooted at that folder
   instead of at `null`.

`NotebookTree` loses its own outer header ("Notebooks" label + `+`
dropdown) and its own `flex-1 overflow-y-auto` wrapper — those move up into
`NotebookPanel` as the shared shell, with the header becoming section 1's
collapsible header. The recursive tree rendering itself
(`TreeNode`/`FolderRow`/`PageRow`/`FileRow`) does not change.

Each section collapses independently (chevron header, same grid-rows
collapse animation `FolderRow` already uses), state persisted the same way
folder-collapse state is today.

### 2. Mobile/tablet — 5-tab bar, in-shell drill-ins, no separate route

- `MobileTab` (`lib/store/mobile-tab.ts`) grows from
  `'home'|'notebooks'|'assignments'|'more'` to
  `'home'|'notebooks'|'assignments'|'shared'|'more'`.
- `MobileTabBar` adds a "Shared" tab (`Share2` icon). `go()` no longer
  special-cases a route push for Assignments — all five tabs are in-shell
  state changes inside `MobileShell` at `/notebook`. `PageShell`'s `tabBar`
  prop is removed (no longer needed by anything).
- Assignments and Shared render as new `View` kinds in `MobileShell`,
  styled like the existing Home/Notebooks screens (header + scrollable
  `main`, `MobileTabBar` pinned at bottom):
  - **Assignments view** renders the same extracted assignments component
    used by the desktop `AssignmentsPanel`, in its current mobile card
    styling (unchanged visually from today's `/assignments` route).
  - **Shared view** reuses the existing folder drill-down screen, rooted at
    the "Shared with me" notebook — the same rendering that view already
    gets when reached via More today.
- The Home notebook grid keeps excluding "Shared with me" (unchanged).
- The More tab's "Shared with me" row is removed (redundant with the new
  tab). The staff-only "Review" row now switches to the Assignments view
  in-shell instead of `router.push('/assignments')`.
- `app/assignments/page.tsx` becomes a redirect-only stub to `/notebook` so
  old links/bookmarks don't 404. No UI of its own.

### 3. Home screen gradient polish

Mobile Home's header/greeting area gets a subtle background wash instead of
flat `bg-background` — reusing the existing accent-blue color-mix gradient
already used for the notebook empty-cover placeholder
(`from-[color-mix(in_oklch,var(--accent-blue)_18%,transparent)] to-transparent`),
applied behind the header instead of introducing a new palette.

### 4. Edge-to-edge safe-area top

Root cause: `app/layout.tsx`'s `viewport` export has no `viewportFit:
'cover'`, so every `env(safe-area-inset-*)` in the app currently resolves
to `0px` on notched devices. Fix:

- Add `viewportFit: 'cover'` to the `viewport` export.
- Add top safe-area padding to `MobileShell`'s screen headers (Home,
  Notebooks, folder drill-down, Assignments, Shared, More, editor), the
  same pattern `presentation-view.tsx` already uses
  (`paddingTop: 'env(safe-area-inset-top)'`), so content draws up under the
  status bar instead of stopping below it.

## Non-goals

- No change to the assignment/submission data model, sharing data model, or
  desktop's non-sidebar UI (page-actions dialogs, notifications).
- No change to how notebooks/folders/pages nest or how drag-and-drop works
  in the tree.
- Tablet-in-rail-mode and tablet-in-phone-mode (`isPhone` split in
  `sidebar.tsx`) both get the same 3-section treatment — no new tablet-only
  branch.

## Files touched (expected)

- `components/workspace/sidebar.tsx` — swap in `NotebookPanel`.
- `components/workspace/notebook-tree.tsx` — extract outer
  header/scroll shell; keep recursive tree body.
- `components/workspace/notebook-panel.tsx` (new) — three-section shell.
- `components/workspace/assignments-panel.tsx` (new) — extracted
  `StudentAssignments`/`TeacherAssignments` shared component.
- `components/workspace/shared-panel.tsx` (new) — desktop "Shared"
  section content.
- `components/workspace/mobile-shell.tsx` — new `View` kinds for
  Assignments/Shared, header safe-area padding, Home gradient.
- `components/workspace/mobile-tab-bar.tsx` — add Shared tab, simplify
  `go()`.
- `lib/store/mobile-tab.ts` — add `'shared'` to `MobileTab`.
- `components/platform/page-shell.tsx` — remove now-unused `tabBar` prop.
- `app/assignments/page.tsx` — replace with redirect stub.
- `app/layout.tsx` — add `viewportFit: 'cover'`.
