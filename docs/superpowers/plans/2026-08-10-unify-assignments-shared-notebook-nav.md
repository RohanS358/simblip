# Unify Assignments & Shared into Notebook nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the standalone `/assignments` route and the buried "Shared with me" notebook into the same navigational surface as notebooks — three collapsible sections in the desktop/tablet sidebar, and two new in-shell mobile tabs — plus a Home gradient polish and edge-to-edge safe-area support.

**Architecture:** Extract the two role-branched assignment views (`StudentAssignments`/`TeacherAssignments`) out of `app/assignments/page.tsx` into a shared, chrome-free component so desktop sidebar and mobile in-shell view both render the same source. Build a small `SharedPanel` that lists the existing "Shared with me" notebook's contents by reusing `notebook-tree.tsx`'s existing `TreeNode` recursion (exported, not duplicated). Wrap `NotebookTree` (left completely unmodified internally) plus the two new panels in a `NotebookPanel` shell that renders three independently-collapsible cards, each keeping its own internal scroll — no merge of `NotebookTree`'s internal scroll/header logic, since that file's state (dialogs, renaming, drag-drop) is tightly self-contained and splitting it is not needed to hit the goal. Mobile gets two new `View` kinds in `MobileShell` reusing the same extracted panel/tree-recursion, a 5th tab, and the `/assignments` route becomes a redirect stub.

**Tech Stack:** Next.js App Router, React, Zustand, Tailwind, lucide-react, sonner (toast) — all already in use, no new dependencies.

## Global Constraints

- No new npm dependencies — everything is built from already-installed packages (spec: "reuse `TreeNode`/`PageRow`/`FileRow`", "reuse... accent-blue gradient").
- No test framework exists in this repo (no `test` script, no `*.test.*` files) — verification is `npm run typecheck`, `npm run lint`, and manual browser checks via the dev server, matching existing repo convention.
- `NotebookTree`'s recursive tree body (`TreeNode`/`FolderRow`/`PageRow`/`FileRow`) and its dialogs/drag-drop must not change behavior — only get one new export.
- The "Shared with me" notebook (`SHARED_NB = 'Shared with me'` constant, currently duplicated as a local const in `mobile-shell.tsx:109`) keeps being excluded from the plain Notebooks list everywhere it's already excluded, and now also from the desktop tree.
- `app/assignments/page.tsx` must not 404 for old links — becomes a redirect.

---

### Task 1: Extract `AssignmentsPanel` (shared assignments UI, no page chrome)

**Files:**
- Create: `components/workspace/assignments-panel.tsx`
- Modify: `app/assignments/page.tsx` (replaced with redirect in Task 6 — no edits here yet)

**Interfaces:**
- Consumes: `useAuthStore`, `lib/data/assignments.ts` (`listMyAssignments`, `mySubmissions`, `assignmentPageLinks`, `linkAssignmentPage`, `upsertSubmission`, `subscribeAssignments`, `subscribeSubmissions`, `listRooms`/`listAllMembers` from `lib/data/admin`, `db.list` from `lib/data/db`, `submissionsFor`, `reviewSubmission`, `removeAssignment`), `lib/store/import-page.ts` (`importPageDoc`), `lib/store/page-bundle.ts` (`bundlePage`), `useWorkspaceStore`, `useDocStore` — all exactly as `app/assignments/page.tsx` currently imports them.
- Produces: `export function AssignmentsPanel(): JSX.Element` — role-branches internally (`useAuthStore((s) => s.profile?.role)`), renders `<StudentAssignments />` or `<TeacherAssignments />`, no wrapping page chrome (no `PageShell`, no `<h1>`). Both `router.push('/notebook')` calls inside stay (needed after opening/viewing a page from any embedding context).

- [ ] **Step 1: Create the new file with the extracted component bodies**

Copy `StudentAssignments`, `TeacherAssignments`, `StatusChip`, `STATUS_STYLE`, `STATUS_LABEL`, `dueLabel` verbatim from `app/assignments/page.tsx:50-400` into the new file, with `'use client'` at the top and the same imports (adjust relative import paths — both files are one level apart in depth from repo root under `app/` vs `components/workspace/`, so `@/...` absolute imports need no change). Add the new default export at the bottom:

```tsx
export function AssignmentsPanel() {
  const role = useAuthStore((s) => s.profile?.role)
  return role === 'student' ? <StudentAssignments /> : <TeacherAssignments />
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (the new file compiles standalone; `app/assignments/page.tsx` still has its own copies so it still compiles too — duplication is temporary, removed in Task 6).

- [ ] **Step 3: Commit**

```bash
git add components/workspace/assignments-panel.tsx
git commit -m "Extract AssignmentsPanel as a chrome-free shared component"
```

---

### Task 2: Export `TreeNode` and a folder-lookup-by-name helper from `notebook-tree.tsx`

**Files:**
- Modify: `components/workspace/notebook-tree.tsx:541-545` (add `export` to `TreeNode`), and add one new exported helper near the top-level exports.

**Interfaces:**
- Consumes: nothing new — `TreeNode` already exists exactly as shown at notebook-tree.tsx:541-545.
- Produces: `export function TreeNode({ node, depth, handlers }: { node: Node; depth: number; handlers: TreeHandlers })` (same signature, now exported) and `export type { TreeHandlers }` so `SharedPanel` (Task 3) can construct one. Also produces `export const SHARED_NB = 'Shared with me'` as the single source of truth for the notebook name (currently redefined locally in `mobile-shell.tsx:109`).

- [ ] **Step 1: Export `TreeNode` and the `TreeHandlers` type**

In `components/workspace/notebook-tree.tsx`, change line 541 from:

```tsx
function TreeNode({ node, depth, handlers }: { node: Node; depth: number; handlers: TreeHandlers }) {
```

to:

```tsx
export function TreeNode({ node, depth, handlers }: { node: Node; depth: number; handlers: TreeHandlers }) {
```

And change line 187 from `interface TreeHandlers {` to `export interface TreeHandlers {`.

- [ ] **Step 2: Add the shared `SHARED_NB` constant**

Near the top of `notebook-tree.tsx`, after the existing `SECTION_DOT` const (around line 106), add:

```tsx
/** The auto-created notebook incoming shares land in — see
 *  hooks/use-share-inbox.ts. Single source of truth for the name so the
 *  desktop Shared panel, the mobile Shared tab, and the Home grid's
 *  exclusion filter can't drift out of sync. */
export const SHARED_NB = 'Shared with me'
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors — pure additive exports.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/notebook-tree.tsx
git commit -m "Export TreeNode, TreeHandlers, and SHARED_NB for reuse outside the tree"
```

---

### Task 3: Build `SharedPanel` (desktop "Shared" section content)

**Files:**
- Create: `components/workspace/shared-panel.tsx`

**Interfaces:**
- Consumes: `TreeNode`, `TreeHandlers`, `SHARED_NB` from `./notebook-tree` (Task 2); `childrenOf` from `@/lib/store/workspace`; `useWorkspaceStore`; `useAuthStore`/`can` for the `staff` flag; page-action dialog components (`ShareDialog`, `AssignDialog`, `PresentDialog`, `PublishDialog` from `./page-actions` and `./library-panel`) and `AddPageDialog` from `./add-page-dialog` — `TreeNode` requires a full `TreeHandlers` object including these dialog openers, so `SharedPanel` needs its own small copies of that local state (mirroring the relevant slice of `NotebookTree`'s own state, since `TreeHandlers` isn't itself exported as reusable state — only the type is).
- Produces: `export function SharedPanel(): JSX.Element` — renders the "Shared with me" folder's direct children via `TreeNode`, one level deep starting at that folder (matching how `NotebookTree` renders roots, just rooted at the Shared folder's id instead of `null`), with an empty state when no shares have arrived yet.

- [ ] **Step 1: Write the component**

```tsx
'use client'

// Desktop "Shared" section — the same "Shared with me" notebook the mobile
// Shared tab and the old More-tab entry point at, rendered inline via the
// tree's own TreeNode recursion instead of a second read model.

import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore, childrenOf } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { TreeNode, SHARED_NB, type TreeHandlers } from './notebook-tree'
import { openFile as openFileNode } from './open-file'
import { importPageInto } from '@/lib/store/import-page'
import { bundlePage } from '@/lib/store/page-bundle'
import {
  AssignDialog,
  PresentDialog,
  ShareDialog,
  exportPageJson,
  type PageRef,
} from './page-actions'
import { PublishDialog } from './library-panel'
import { AddPageDialog } from './add-page-dialog'

export function SharedPanel() {
  const sharedRoot = useWorkspaceStore(
    useShallow((s) => childrenOf(s.nodes, null).find((n) => n.kind === 'folder' && n.name === SHARED_NB))
  )
  const children = useWorkspaceStore(
    useShallow((s) => (sharedRoot ? childrenOf(s.nodes, sharedRoot.id) : []))
  )
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const store = useWorkspaceStore
  const staff = can(role, 'share-pages')

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)
  const [addTarget, setAddTarget] = useState<{ parentId: string } | null>(null)
  const [uploadTarget, setUploadTarget] = useState<string | null>(null)

  const selectPage = (id: string) => store.getState().setActivePage(id)
  const duplicatePage = (parentId: string, page: PageRef) => {
    importPageInto(parentId, parentId, `${page.name} copy`, bundlePage(page.id), true)
  }
  const openFile: TreeHandlers['openFile'] = (node) => {
    openFileNode(node)
  }

  const handlers: TreeHandlers = {
    activePageId,
    renaming,
    setRenaming,
    selectPage,
    duplicatePage,
    setAddTarget,
    setShareFor,
    setAssignFor,
    setPresentFor,
    setPublishFor,
    staff,
    collapsed,
    toggleCollapsed: (id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })),
    uploadFileTo: (parentId) => setUploadTarget(parentId),
    openFile,
  }

  if (!sharedRoot || children.length === 0) {
    return (
      <p className="px-3.5 py-4 text-[0.75rem] leading-relaxed text-muted-foreground">
        Nothing shared with you yet.
      </p>
    )
  }

  return (
    <div className="px-2 pb-2">
      {children.map((n) => (
        <TreeNode key={n.id} node={n} depth={0} handlers={handlers} />
      ))}
      <ShareDialog page={shareFor} onOpenChange={(o) => !o && setShareFor(null)} />
      <AssignDialog page={assignFor} onOpenChange={(o) => !o && setAssignFor(null)} />
      <PresentDialog page={presentFor} onOpenChange={(o) => !o && setPresentFor(null)} />
      <PublishDialog
        open={publishFor !== null}
        onOpenChange={(o) => !o && setPublishFor(null)}
        pageId={publishFor?.id ?? null}
      />
      <AddPageDialog target={addTarget} onOpenChange={(o) => !o && setAddTarget(null)} onCreated={selectPage} />
    </div>
  )
}
```

Note: `uploadTarget` is tracked but intentionally has no file `<input>` wired up in this panel — "Upload file…" isn't a meaningful action inside someone else's shared copy in the same way it is in your own notebook tree. `FolderRow`'s context menu item that calls `uploadFileTo` will still call this setter harmlessly; wiring an actual picker here is out of scope (YAGNI — no user-facing entry point currently expects uploads into Shared).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `exportPageJson` import is unused (it's re-exported by `page-actions` but not called directly here — `PageRow`'s own context menu calls it internally), remove it from the import list if `lint` flags it as unused.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean, or fix any unused-import findings (see Step 2 note).

- [ ] **Step 4: Commit**

```bash
git add components/workspace/shared-panel.tsx
git commit -m "Add SharedPanel: desktop Shared section reusing tree row rendering"
```

---

### Task 4: Build `NotebookPanel` and wire it into the sidebar

**Files:**
- Create: `components/workspace/notebook-panel.tsx`
- Modify: `components/workspace/sidebar.tsx:206`
- Modify: `components/workspace/mobile-shell.tsx` (Home notebook grid exclusion — switch to the now-shared `SHARED_NB` constant instead of its local copy)

**Interfaces:**
- Consumes: `NotebookTree` (unmodified, default export from `./notebook-tree`), `AssignmentsPanel` (Task 1), `SharedPanel` (Task 3).
- Produces: `export function NotebookPanel(): JSX.Element` — three collapsible cards stacked in one scrollable column: Notebooks (open by default), Assignments, Shared. Collapse state persisted via `localStorage` key `simblip-notebook-panel-collapsed`.

- [ ] **Step 1: Write `NotebookPanel`**

```tsx
'use client'

// The "Notebook" sidebar section — three collapsible divisions stacked in
// one scroll column: Notebooks (the existing NotebookTree, unmodified),
// Assignments, and Shared. Assignments and Shared both live inside a
// notebook's worth of pages anyway (importPageDoc lands them there), so
// they read as siblings of the notebook list rather than a separate app
// surface — see docs/superpowers/specs/2026-08-10-unify-assignments-shared-notebook-nav-design.md.

import { useEffect, useState } from 'react'
import { ChevronDown, ClipboardList, Share2 } from 'lucide-react'
import { NotebookTree } from './notebook-tree'
import { AssignmentsPanel } from './assignments-panel'
import { SharedPanel } from './shared-panel'
import { cn } from '@/lib/utils'

type SectionId = 'notebooks' | 'assignments' | 'shared'

const STORAGE_KEY = 'simblip-notebook-panel-collapsed'

function loadCollapsed(): Record<SectionId, boolean> {
  const fallback: Record<SectionId, boolean> = { notebooks: false, assignments: true, shared: true }
  if (typeof window === 'undefined') return fallback
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<SectionId, boolean>>
    return { ...fallback, ...saved }
  } catch {
    return fallback
  }
}

function Section({
  id,
  label,
  icon: Icon,
  open,
  onToggle,
  children,
}: {
  id: SectionId
  label: string
  icon: typeof ClipboardList
  open: boolean
  onToggle: (id: SectionId) => void
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex min-h-0 flex-col border-b border-border/40 last:border-b-0', open && 'flex-1')}>
      <button
        type="button"
        className="flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-left"
        onClick={() => onToggle(id)}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !open && '-rotate-90')} />
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
      </button>
      {open && <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">{children}</div>}
    </div>
  )
}

export function NotebookPanel() {
  const [collapsed, setCollapsed] = useState<Record<SectionId, boolean>>(() => loadCollapsed())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed))
    } catch {}
  }, [collapsed])

  const toggle = (id: SectionId) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Section id="notebooks" label="Notebooks" icon={ClipboardList} open={!collapsed.notebooks} onToggle={toggle}>
        <NotebookTree />
      </Section>
      <Section id="assignments" label="Assignments" icon={ClipboardList} open={!collapsed.assignments} onToggle={toggle}>
        <div className="px-1"><AssignmentsPanel /></div>
      </Section>
      <Section id="shared" label="Shared" icon={Share2} open={!collapsed.shared} onToggle={toggle}>
        <SharedPanel />
      </Section>
    </div>
  )
}
```

`NotebookTree` keeps its own internal header ("Notebooks" + `+` dropdown) and its own scroll — this reads as a slightly redundant label (`Section`'s "Notebooks" header sits right above `NotebookTree`'s own), which Step 2 removes by trimming `NotebookTree`'s duplicate label without touching its `+` dropdown or scroll behavior.

- [ ] **Step 2: Remove `NotebookTree`'s now-duplicate "Notebooks" label**

In `components/workspace/notebook-tree.tsx`, the header block at lines 607-636 has a label + dropdown. Since `NotebookPanel`'s `Section` wrapper now supplies the "Notebooks" label, remove just the `<span>` label (keep the `+` dropdown so New Notebook/New Folder stays reachable):

Change:
```tsx
      <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
        <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Notebooks
        </span>
        <DropdownMenu>
```
to:
```tsx
      <div className="flex items-center justify-end px-3.5 pb-1 pt-1">
        <DropdownMenu>
```

- [ ] **Step 3: Wire `NotebookPanel` into the sidebar**

In `components/workspace/sidebar.tsx`, change line 206 from:

```tsx
      {activeSection === 'notebook' && <NotebookTree />}
```

to:

```tsx
      {activeSection === 'notebook' && <NotebookPanel />}
```

Update the import at the top of the file from `import { NotebookTree } from './notebook-tree'` (or wherever it's imported) to `import { NotebookPanel } from './notebook-panel'` — check the exact current import line first with `grep -n "NotebookTree" components/workspace/sidebar.tsx` since the sidebar may also reference `NotebookTree` for other reasons (it does not, per the earlier exploration — it's only used at line 206).

- [ ] **Step 4: Switch mobile-shell's local `SHARED_NB` to the shared export**

In `components/workspace/mobile-shell.tsx`, remove the local constant at line 109 (`const SHARED_NB = 'Shared with me'`) and instead import it:

```tsx
import { addFileToFolder, SHARED_NB } from './notebook-tree'
```

(merging with the existing `import { addFileToFolder } from './notebook-tree'` at line 72).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Manual browser check**

Run: `npm run dev`, open the app at desktop width, open the left sidebar's Notebook rail entry. Verify:
- Three sections appear: Notebooks (expanded by default), Assignments (collapsed by default), Shared (collapsed by default).
- Clicking each header's chevron toggles it; state persists across a page reload.
- Notebooks section behaves exactly as before (create/rename/drag/context-menu all still work).
- Expanding Assignments shows the same cards as the old `/assignments` page did for the current role.
- Expanding Shared shows the "Shared with me" notebook's pages (or the empty state if none).
- The "Shared with me" notebook itself no longer appears as a normal entry inside the Notebooks section's root list — confirm by checking `NotebookTree`'s root list; if it still appears, note this as a follow-up (see Task 5, which handles exclusion explicitly).

- [ ] **Step 7: Commit**

```bash
git add components/workspace/notebook-panel.tsx components/workspace/notebook-tree.tsx components/workspace/sidebar.tsx components/workspace/mobile-shell.tsx
git commit -m "Add NotebookPanel: collapsible Notebooks/Assignments/Shared sections in sidebar"
```

---

### Task 5: Exclude "Shared with me" from the Notebooks section's root list

**Files:**
- Modify: `components/workspace/notebook-tree.tsx` (root list rendering, around line 701)

**Interfaces:**
- Consumes: `SHARED_NB` (Task 2, already exported in the same file — no import needed, it's a local const in this file).
- Produces: no new export — behavior-only change to `NotebookTree`'s root rendering.

- [ ] **Step 1: Filter the shared notebook out of the root map**

In `components/workspace/notebook-tree.tsx`, find the root list render (originally around line 701):

```tsx
        {roots.map((nb) => (
          <TreeNode key={nb.id} node={nb} depth={0} handlers={handlers} />
        ))}
```

Change to:

```tsx
        {roots
          .filter((nb) => nb.name !== SHARED_NB)
          .map((nb) => (
            <TreeNode key={nb.id} node={nb} depth={0} handlers={handlers} />
          ))}
```

Also apply the same filter to the empty-state check just above it — find:

```tsx
        {roots.length === 0 && (
```

Change to:

```tsx
        {roots.filter((nb) => nb.name !== SHARED_NB).length === 0 && (
```

(so a workspace with only an auto-created "Shared with me" notebook and nothing else still shows the "No notebooks yet" empty state instead of silently showing nothing).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Manual browser check**

With a test account that has at least one incoming share (or manually create a notebook named exactly `Shared with me` via the store dev tools / by triggering a share from another account), confirm it no longer appears in the Notebooks section's list but does appear under the Shared section (Task 4).

- [ ] **Step 4: Commit**

```bash
git add components/workspace/notebook-tree.tsx
git commit -m "Exclude Shared-with-me notebook from the Notebooks section root list"
```

---

### Task 6: Mobile — add the Shared tab, retire the Assignments route

**Files:**
- Modify: `lib/store/mobile-tab.ts`
- Modify: `components/workspace/mobile-tab-bar.tsx`
- Modify: `components/workspace/mobile-shell.tsx`
- Modify: `components/platform/page-shell.tsx` (remove unused `tabBar` prop)
- Modify: `app/assignments/page.tsx` (replace with redirect stub)

**Interfaces:**
- Consumes: `AssignmentsPanel` (Task 1), `SHARED_NB` (Task 2, now imported in `mobile-shell.tsx` per Task 4 Step 4), existing `View` union and `navigateToView`/`pushHistory` helpers already in `mobile-shell.tsx`.
- Produces: `MobileTab` type gains `'shared'`. `View` union in `mobile-shell.tsx` gains `{ kind: 'assignments' }` and reuses the existing `{ kind: 'folder'; id: string }` for Shared (navigating straight to the Shared folder's id, exactly like tapping any other notebook already does — no new `View` case needed for Shared).

- [ ] **Step 1: Add `'shared'` to `MobileTab`**

In `lib/store/mobile-tab.ts`, change:

```tsx
export type MobileTab = 'home' | 'notebooks' | 'assignments' | 'more'
```

to:

```tsx
export type MobileTab = 'home' | 'notebooks' | 'assignments' | 'shared' | 'more'
```

Update the file's top comment (lines 3-6) to drop the now-inaccurate "Assignments lives there [in a PageShell-based route]" framing:

```tsx
// Which bottom-tab destination is active — Home, Notebooks, Assignments,
// Shared, and More all live in-place inside MobileShell now; this store
// just tracks which one is showing.
```

- [ ] **Step 2: Update `MobileTabBar`**

Rewrite `components/workspace/mobile-tab-bar.tsx` in full:

```tsx
'use client'

// Persistent bottom nav for the touch shell — Home / Notebooks /
// Assignments / Shared / More, always visible except inside the editor
// (full-bleed canvas). All five are in-place views inside MobileShell; none
// of them are separate routes.

import { useRouter, usePathname } from 'next/navigation'
import { BookOpen, ClipboardList, Home, MoreHorizontal, Share2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMobileTabStore, type MobileTab } from '@/lib/store/mobile-tab'

const TABS: { id: MobileTab; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'notebooks', label: 'Notebooks', icon: BookOpen },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'shared', label: 'Shared', icon: Share2 },
  { id: 'more', label: 'More', icon: MoreHorizontal },
]

export function MobileTabBar() {
  const router = useRouter()
  const pathname = usePathname()
  const tab = useMobileTabStore((s) => s.tab)
  const setTab = useMobileTabStore((s) => s.setTab)

  const go = (id: MobileTab) => {
    setTab(id)
    if (pathname !== '/notebook') router.push('/notebook')
  }

  return (
    <nav
      className="flex h-16 shrink-0 border-t border-border/50 bg-background pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1',
              active ? 'text-[var(--accent-blue)]' : 'text-muted-foreground'
            )}
            onClick={() => go(id)}
          >
            <Icon className="h-[18px] w-[18px]" />
            <span className="text-[0.625rem] font-semibold">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 3: Add the Assignments `View` kind and Shared navigation to `MobileShell`**

In `components/workspace/mobile-shell.tsx`:

a) Extend the `View` union (line 94) from:

```tsx
type View = { kind: 'home' } | { kind: 'notebook'; id: string } | { kind: 'folder'; id: string } | { kind: 'editor' }
```

to:

```tsx
type View = { kind: 'home' } | { kind: 'notebook'; id: string } | { kind: 'folder'; id: string } | { kind: 'assignments' } | { kind: 'editor' }
```

b) Add `AssignmentsPanel` to the imports (near line 62, alongside the other workspace component imports):

```tsx
import { AssignmentsPanel } from './assignments-panel'
```

c) Add an effect that keeps `view` in sync with the `assignments`/`shared` tabs, next to the existing Home/Notebooks reset effect (lines 206-211). Replace that block:

```tsx
  useEffect(() => {
    if ((mobileTab === 'home' || mobileTab === 'notebooks') && view.kind !== 'home') {
      setView({ kind: 'home' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTab])
```

with:

```tsx
  useEffect(() => {
    if ((mobileTab === 'home' || mobileTab === 'notebooks') && view.kind !== 'home') {
      setView({ kind: 'home' })
    } else if (mobileTab === 'assignments' && view.kind !== 'assignments') {
      setView({ kind: 'assignments' })
    } else if (mobileTab === 'shared') {
      const ws = useWorkspaceStore.getState()
      const nb = childrenOf(ws.nodes, null).find((n) => n.name === SHARED_NB)
      const id = nb?.id ?? ws.addNotebook(SHARED_NB)
      if (!(view.kind === 'folder' && view.id === id)) setView({ kind: 'folder', id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileTab])
```

d) Add the Assignments screen render branch. Place it right before the `// ── Home / Notebooks ──` comment block (before line 898), matching the same header/main/tab-bar shape as the `moreTab` block:

```tsx
  // ── Assignments ──────────────────────────────────────────────────────────
  if (mobileTab === 'assignments' && view.kind === 'assignments') {
    return (
      <div className="flex h-dvh flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center px-4">
          <span className="text-[0.9375rem] font-extrabold tracking-tight">Assignments</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <AssignmentsPanel />
        </main>
        <MobileTabBar />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {tutorialOpen && activePageId && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
      </div>
    )
  }
```

e) In the `moreTab` block, remove the "Shared with me" button (lines 369-380) since the new Shared tab replaces it, and change the "Review" button to go in-shell instead of routing:

Change:
```tsx
        <div className="space-y-1">
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-accent"
            onClick={() => {
              const ws = store.getState()
              const nb = childrenOf(ws.nodes, null).find((n) => n.name === SHARED_NB)
              const id = nb?.id ?? ws.addNotebook(SHARED_NB)
              navigateToView({ kind: 'folder', id })
            }}
          >
            <Share2 className="h-4 w-4 text-muted-foreground" /> Shared with me
          </button>
          {staff && (
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-accent"
              onClick={() => router.push('/assignments')}
            >
              <GraduationCap className="h-4 w-4 text-muted-foreground" /> Review
            </button>
          )}
          <div className="my-2 border-t border-border/40" />
```

to:

```tsx
        <div className="space-y-1">
          {staff && (
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-accent"
              onClick={() => useMobileTabStore.getState().setTab('assignments')}
            >
              <GraduationCap className="h-4 w-4 text-muted-foreground" /> Review
            </button>
          )}
          <div className="my-2 border-t border-border/40" />
```

Note: the `Share2` import may now be unused in `mobile-shell.tsx` if nothing else references it — check with `grep -n "Share2" components/workspace/mobile-shell.tsx` after this edit and remove it from the lucide-react import list at the top if so.

f) Add the `assignments` view to `goBackFromEditor`'s and the `popstate` handler's understanding of "non-home views to unwind to" — check the existing `popstate` listener (originally lines 238-313) for how it currently unwinds `folder`/`notebook` views back toward `home`, and confirm `assignments` needs no special unwind logic: since it's tab-driven (not push-driven — the effect in Step 3c drives it, mirroring how `home`/`notebooks` already work without needing popstate-specific handling), no changes to the `popstate` listener are required. Verify this assumption in Step 5's manual check by pressing hardware/gesture back from the Assignments tab and confirming it behaves like Home/Notebooks do today (exits toward the previous screen/app, doesn't get stuck).

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean (watch for the `Share2` unused-import case from Step 3e, and confirm `GraduationCap` is still used).

- [ ] **Step 5: Manual browser check (mobile viewport)**

Run: `npm run dev`, open Chrome DevTools device toolbar at a phone width (e.g. 390×844), navigate to `/notebook`. Verify:
- Bottom tab bar now shows 5 tabs: Home, Notebooks, Assignments, Shared, More.
- Tapping Assignments shows the role-appropriate assignment list in-place (no URL change away from `/notebook`).
- Tapping Shared navigates into the "Shared with me" folder view (same look as tapping any notebook card).
- Tapping Home or Notebooks after being in Assignments/Shared resets back to the Home/Notebooks root screen (existing reset-on-tab-tap behavior, now covers all tabs).
- More tab no longer shows "Shared with me"; staff accounts still see "Review" and tapping it switches to the Assignments tab in-place.
- Hardware/gesture back from Assignments doesn't strand the user (goes back to wherever browser history says, same as Home does).

- [ ] **Step 6: Commit**

```bash
git add lib/store/mobile-tab.ts components/workspace/mobile-tab-bar.tsx components/workspace/mobile-shell.tsx
git commit -m "Add mobile Shared tab and in-shell Assignments view; drop /assignments route dependency"
```

---

### Task 7: Retire the `/assignments` route and `PageShell`'s `tabBar` prop

**Files:**
- Modify: `app/assignments/page.tsx` (replace entirely with a redirect)
- Modify: `components/platform/page-shell.tsx` (remove `tabBar` prop and its `MobileTabBar` branch)

**Interfaces:**
- Consumes: Next.js `redirect` from `next/navigation`.
- Produces: `/assignments` no longer renders a page — it 302s to `/notebook`. `PageShell`'s public signature drops `tabBar`.

- [ ] **Step 1: Check for other `tabBar` callers before removing the prop**

Run: `grep -rn "tabBar" --include="*.tsx" app components`
Expected: only `app/assignments/page.tsx` (`<PageShell title="Assignments" tabBar>`) and `page-shell.tsx`'s own definition. If any other route passes `tabBar`, stop and re-scope this step — leave the prop in place and only remove it from `assignments/page.tsx`'s usage.

- [ ] **Step 2: Replace `app/assignments/page.tsx` with a redirect stub**

```tsx
import { redirect } from 'next/navigation'

// Assignments moved into the notebook nav — the sidebar's Assignments
// section on desktop/tablet, the Assignments tab on mobile. This route
// only exists so old links/bookmarks don't 404.
export default function AssignmentsPage() {
  redirect('/notebook')
}
```

- [ ] **Step 3: Remove `tabBar` from `PageShell`**

In `components/platform/page-shell.tsx`, remove the `tabBar` prop entirely:

```tsx
export function PageShell({
  title,
  backHref = '/notebook',
  children,
}: {
  title: string
  backHref?: string | null
  children: React.ReactNode
}) {
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <header className="absolute inset-x-0 top-0 z-40">
        <div className="progressive-blur-top !h-20" />
        <div className="relative m-3 mb-0 flex h-11 items-center gap-2 rounded-2xl px-3 liquid-glass sm:mx-4">
          {backHref && (
            <Link
              href={backHref}
              aria-label="Back to notebook"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          )}
          <span className="text-[14px] font-extrabold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-[13px] font-semibold">{title}</span>
          {institution && (
            <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
              · {institution.name}
            </span>
          )}
          <div className="flex-1" />
          <NotificationCenter />
          <ProfileMenu />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-10 pt-20 sm:px-4 md:px-6 lg:px-10">
        <h1 className="mb-6 text-[clamp(1.5rem,3vw,2.4rem)] font-bold leading-tight tracking-[-0.02em]">
          {title}
        </h1>
        {children}
      </main>

      <footer className="z-40 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-[10.5px] text-muted-foreground">
        {profile && (
          <span className="font-medium">
            {profile.full_name} · {ROLE_LABEL[profile.role]}
          </span>
        )}
        <div className="flex-1" />
        <span>SIMBLIP · Built by Rohan Singh</span>
      </footer>
    </div>
  )
}
```

Remove the now-unused `useIsMobile` and `MobileTabBar` imports from the top of the file.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Manual browser check**

Visit `/assignments` directly in the browser — confirm it redirects to `/notebook` instead of 404ing or showing stale UI.

- [ ] **Step 6: Commit**

```bash
git add app/assignments/page.tsx components/platform/page-shell.tsx
git commit -m "Retire /assignments route (redirect stub) and PageShell's tabBar prop"
```

---

### Task 8: Home screen gradient polish

**Files:**
- Modify: `components/workspace/mobile-shell.tsx` (Home/Notebooks header area, around line 911)

**Interfaces:**
- Consumes: none new — pure Tailwind class changes using the existing `--accent-blue` CSS variable already used elsewhere in this file (line 973's notebook placeholder gradient).
- Produces: no new exports — visual-only change.

- [ ] **Step 1: Add the gradient wash behind the header/greeting**

In `components/workspace/mobile-shell.tsx`, the Home/Notebooks return block currently starts (around line 910-924):

```tsx
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-1 px-4">
```

Change the outer wrapper to a `relative` positioning context with a gradient layer behind the header, and give the header itself a transparent background so the gradient shows through:

```tsx
  return (
    <div className="relative flex h-dvh flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-[color-mix(in_oklch,var(--accent-blue)_14%,transparent)] to-transparent"
      />
      <header className="relative flex h-12 shrink-0 items-center gap-1 px-4">
```

The `main` element right after stays `relative` implicitly (normal flow) and sits on top of the gradient div since it comes later in DOM order with no explicit z-index conflict — the gradient div is `absolute` and `pointer-events-none`, so it never intercepts taps.

- [ ] **Step 2: Manual browser check**

Run: `npm run dev`, view Home at phone width in both light and dark theme (toggle via the More tab's Theme button). Confirm:
- A subtle blue wash is visible behind the header/greeting, fading to transparent by the time it reaches the "Continue editing" strip.
- No regression to tap targets — `SyncStatus`/`NotificationCenter` in the header and the greeting text remain fully interactive/legible.
- The gradient doesn't reappear on the Notebooks tab in a jarring way — it's the same screen, so it's expected to show there too; confirm it doesn't look wrong without the greeting text above it.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/mobile-shell.tsx
git commit -m "Add subtle gradient wash to mobile Home header"
```

---

### Task 9: Edge-to-edge safe-area top

**Files:**
- Modify: `app/layout.tsx` (viewport export)
- Modify: `components/workspace/mobile-shell.tsx` (header padding — Home/Notebooks, folder drill-down, Assignments, More, editor headers)

**Interfaces:**
- Consumes: none new.
- Produces: no new exports — the app's `viewport-fit=cover` meta setting changes, plus padding additions.

- [ ] **Step 1: Add `viewportFit: 'cover'` to the root viewport export**

In `app/layout.tsx`, change:

```tsx
export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  width: 'device-width',
  initialScale: 1,
}
```

to:

```tsx
export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}
```

- [ ] **Step 2: Add top safe-area padding to each mobile-shell header**

In `components/workspace/mobile-shell.tsx`, every screen's `<header>` currently uses a fixed `h-12` with no top-inset awareness. For each of the following headers, add `pt-[env(safe-area-inset-top)]` and let the header grow instead of clipping — change `h-12 shrink-0` to `shrink-0 pt-[env(safe-area-inset-top)]` and add a fixed-height inner row so the 12-unit tap-target height is preserved below the inset:

For the Home/Notebooks header (around line 912):
```tsx
      <header className="flex h-12 shrink-0 items-center gap-1 px-4">
```
becomes:
```tsx
      <header className="relative flex shrink-0 items-center gap-1 px-4 pt-[max(0px,env(safe-area-inset-top))]" style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}>
```

(Note: the gradient div added in Task 8 stays `absolute inset-x-0 top-0` and is unaffected — it already covers this taller header.)

Apply the same pattern (fixed content height plus `env(safe-area-inset-top)` added to total header height) to:
- The folder drill-down header (search for the folder view's `<header>` — same `h-12` pattern).
- The `moreTab` header (line 356: `<header className="flex h-12 shrink-0 items-center px-4">`).
- The Assignments header added in Task 6 Step 3d (`<header className="flex h-12 shrink-0 items-center px-4">`).
- The editor header (line 431: `<header className="z-40 flex h-12 shrink-0 items-center gap-1 border-b border-border/40 bg-background px-2">`).

Each becomes: `className="... shrink-0 items-center ... pt-[max(0px,env(safe-area-inset-top))]"` with `style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}` added (merge with any existing `style` prop if one is present — check each header for an existing `style` attribute before adding; none currently have one per the code read in this session, so a plain new `style` prop is safe).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (this is a styling-only change, no type surface affected).

- [ ] **Step 4: Manual browser check**

This requires an actual notched device or Chrome DevTools' device toolbar with a device that reports safe-area insets (e.g. "iPhone 14 Pro" preset) — Chrome DevTools simulates `env(safe-area-inset-top)` for iPhone device presets. Confirm:
- Headers now extend content up under/near the simulated notch/status-bar area instead of leaving a dead flat-color gap below it.
- On a device preset with no notch (e.g. a generic Android preset, inset = 0), headers look unchanged (`calc(3rem + 0px)` = `3rem`, identical to before).
- Tap targets in the header (back button, tab bar icons elsewhere) are not obscured by the status bar — the added padding pushes content down, it doesn't just extend the background color.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx components/workspace/mobile-shell.tsx
git commit -m "Extend mobile shell headers under the safe area; enable viewport-fit=cover"
```

---

## Self-Review

**Spec coverage:**
- §1 (desktop three sections) → Tasks 1, 2, 3, 4, 5.
- §2 (mobile 5-tab, in-shell drill-ins, route retirement) → Tasks 1, 6, 7.
- §3 (Home gradient) → Task 8.
- §4 (safe-area top) → Task 9.
- "Files touched" list in the spec matches the files actually modified/created across Tasks 1-9, with one addition not anticipated in the spec: `lib/store/mobile-tab.ts`'s top comment needed an update (Task 6 Step 1) since it described the old route-boundary behavior.

**Placeholder scan:** No TBD/TODO markers; every step has literal code, not descriptions of code.

**Type consistency:** `TreeHandlers` (Task 2) is consumed identically in `SharedPanel` (Task 3) and remains untouched in `notebook-tree.tsx` itself. `SHARED_NB` is defined once (Task 2) and consumed by `mobile-shell.tsx` (Task 4 Step 4, Task 6 Step 3c) and `notebook-tree.tsx` itself (Task 5) — no re-declaration. `View` union's new `{ kind: 'assignments' }` member (Task 6) is added once and consumed only by the guard in Task 6 Step 3c/3d — no other file pattern-matches on `View`.
