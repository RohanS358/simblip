'use client'

// Mobile workspace — a Notes-style app, not a shrunken desktop. Navigation
// instead of panels: Home (notebook cards + assignments) → notebook (section
// & page list) → editor (full-bleed canvas, no sidebar, properties as a
// bottom sheet, the top-right actions collapsed into one menu).

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bug,
  ClipboardList,
  Copy,
  FileText,
  Download,
  GraduationCap,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  MonitorPlay,
  MoreVertical,
  Moon,
  Pencil,
  Plus,
  Presentation,
  Search,
  Settings,
  Share2,
  Sheet,
  Sun,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { isDarkTheme } from '@/components/theme-provider'
import { useWorkspaceStore, findPageMeta, childrenOf, descendantsOf } from '@/lib/store/workspace'
import type { FileNode, FolderNode } from '@/lib/scene/types'
import { useLazyActivePage } from '@/lib/store/use-active-page'
import { useDocStore } from '@/lib/store/document'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { useShareInbox } from '@/hooks/use-share-inbox'
import { CanvasControls, showsCanvasDock } from './canvas-controls'
import { Inspector } from './inspector'
import { FocusObject } from './focus-object'
import { motion as fm, AnimatePresence, useDragControls } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { haptic } from '@/lib/haptics'
import { useIsNarrow } from '@/hooks/use-mobile'
import { usePrefs } from '@/lib/store/preferences'
import { useMobileTabStore, type MobileView } from '@/lib/store/mobile-tab'
import { useMobileNavBarStore } from '@/lib/store/mobile-nav-bar'
import { MobileTabBar } from './mobile-tab-bar'
import { PageView } from './page-view'
import { TabsBar } from './tabs-bar'
import { NotificationCenter } from './notifications'
import { SyncStatus } from './sync-status'
import { UndoRedo } from './undo-redo'
import { Sidebar } from './sidebar'
import { Dock } from './dock'
import { importPageInto } from '@/lib/store/import-page'
import { bundlePage } from '@/lib/store/page-bundle'
import { FileObject } from '../objects/file-view'
import { PageThumbnail } from './page-thumbnail'
import { KIND_ICON } from './tabs-bar'
import {
  AssignDialog,
  PresentDialog,
  ShareDialog,
  exportPageJson,
  type PageRef,
} from './page-actions'
import { PublishDialog } from './library-panel'
import { AddPageDialog, type Step as AddPageStep } from './add-page-dialog'
import { BugReportDialog } from './bug-report-dialog'
import { BugSwarm, useBugHold } from './bug-swarm'
import { addFileToFolder, SHARED_NB } from './notebook-tree'
import { openFile as openFileNode } from './open-file'
import { AssignmentsPanel } from './assignments-panel'
import { HomeDueSoon } from './home-due-soon'
import {
  ConfirmDeleteDialog,
  RenameDialog,
  type ConfirmTarget,
  type RenameTarget,
} from './mobile-prompts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Same reasoning as shell.tsx: these overlays start closed, so their code
// (mathjs for the calculator, the full settings surface) shouldn't ride
// along in the initial touch-shell chunk.
const SettingsDialog = dynamic(() => import('./settings-dialog').then((m) => m.SettingsDialog), { ssr: false })
const TutorialPanel = dynamic(() => import('./tutorial').then((m) => m.TutorialPanel), { ssr: false })
const Calculator = dynamic(() => import('./calculator').then((m) => m.Calculator), { ssr: false })
const CommandPalette = dynamic(() => import('./command-palette').then((m) => m.CommandPalette), { ssr: false })

// 'notebook' kept as a distinct kind from 'folder' only for the drawer's
// "My Notebooks" highlight check below — both render through the SAME
// drill-down folder view; a top-level tap and a sub-folder tap just push
// different depths onto the same view.
// Structurally identical to MobileView in lib/store/mobile-tab.ts, which is
// where it's persisted — aliased rather than redeclared so the two can't
// drift apart.
type View = MobileView

const SECTION_DOT: Record<string, string> = {
  blue: 'bg-[var(--accent-blue)]',
  mint: 'bg-[var(--accent-mint)]',
  amber: 'bg-[var(--accent-amber)]',
  violet: 'bg-[var(--accent-violet)]',
  rose: 'bg-[var(--accent-rose)]',
}

/** The cover set that ships in /public/cover — pick one per notebook. */
const COVERS = ['blue', 'mint', 'violet', 'amber', 'rose', 'slate','1','2','3','4','5','6','7','8','9','10','11','12'].map(
  (c) => `/cover/cover-${c}.svg`
)

/** Stable index from an id, so a notebook without a chosen cover still keeps
 *  the SAME art every render and across reloads — a random pick would make
 *  the grid reshuffle its colours on every paint. */
const hashIndex = (id: string, n: number) => {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h) % n
}

// Touch targets. Apple HIG and Material both want ~44px; these controls used
// to be a 14px icon in p-1, i.e. a 22px tap area sitting in a card corner —
// the least accurate place for a thumb. The ICON stays small (the cards are
// dense on purpose); the HIT AREA grows to 44px via padding, and the visible
// chip is drawn by an inset pseudo-element-sized child instead of the button
// box itself. active:scale gives the press its confirmation.

/** The ⋮ button on a page/file/folder card: 44px tap, 28px visible chip. */
const CARD_ACTION_BTN =
  'absolute right-0 top-0 z-10 flex h-11 w-11 items-center justify-center text-muted-foreground ' +
  'transition-transform duration-150 ease-out active:scale-90 ' +
  '[&>svg]:rounded-full [&>svg]:bg-background/80 [&>svg]:p-1.5 [&>svg]:backdrop-blur-sm ' +
  '[&>svg]:h-7 [&>svg]:w-7 [&>svg]:shadow-sm'

/** A bare icon button in a header or toolbar row: 44px tap, small glyph. */
const ICON_BTN =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground ' +
  'transition-transform duration-150 ease-out active:scale-90 hover:bg-accent'

/** Section heading above a grid or strip on the home/folder screens. */
const SECTION_LABEL =
  'mb-2.5 px-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground/70'

/**
 * The home screen's create grid.
 *
 * Colour-coded per page kind so the row is scannable by hue rather than by
 * reading four labels — the same reason Canva's "Get started" row works. The
 * tints are literal oklch values rather than theme tokens on purpose: these
 * identify a KIND (a presentation is always amber, a sheet always green),
 * which must stay stable across the ~12 user themes, exactly like a file-type
 * icon in a file manager. They're used at 16% against the card, so they read
 * as soft category chips in both light and dark.
 */
const CREATE_TILES: { step: AddPageStep; label: string; icon: typeof LayoutDashboard; tint: string }[] = [
  { step: 'board', label: 'Whiteboard', icon: LayoutDashboard, tint: 'oklch(0.62 0.17 265)' },
  { step: 'doc', label: 'Document', icon: FileText, tint: 'oklch(0.60 0.15 230)' },
  { step: 'pptx', label: 'Slides', icon: Presentation, tint: 'oklch(0.68 0.16 55)' },
  { step: 'xlsx', label: 'Sheet', icon: Sheet, tint: 'oklch(0.60 0.14 155)' },
]

/**
 * Entry animation for a card in a grid. Cards used to appear as one solid
 * block, which reads as a page repaint rather than as content arriving.
 *
 * The delay is capped at 8 items: a stagger is a flourish on the first
 * screenful, and a 40-page folder should not take two seconds to finish
 * drawing. Reduced-motion callers pass a spring of duration 0, which
 * collapses this to a plain fade.
 */
const cardEntry = (i: number) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: Math.min(i, 8) * 0.04 },
})

export function MobileShell() {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  // Mirrored into the persisted mobile-tab store on every change, so
  // reopening the app returns to the same screen. Local state stays the
  // render source (it's read on every branch below); the store is the
  // durable copy, restored once on mount by the effect further down.
  const [view, setViewLocal] = useState<View>({ kind: 'home' })
  const setView = useCallback((next: View) => {
    setViewLocal(next)
    useMobileTabStore.getState().setView(next)
  }, [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [bugOpen, setBugOpen] = useState(false)
  const [swarm, setSwarm] = useState(false)
  // Hold the bug item for five seconds — see bug-swarm.tsx.
  const bugHold = useBugHold(() => setSwarm(true))
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)
  const [addTarget, setAddTarget] = useState<{ parentId: string; step?: AddPageStep } | null>(null)
  // One shared hidden <input type=file>, same pattern notebook-tree.tsx
  // uses — a tap can't open the native picker directly.
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)
  const uploadFileTo = (parentId: string) => {
    uploadTargetRef.current = parentId
    uploadInputRef.current?.click()
  }
  const [coverFor, setCoverFor] = useState<string | null>(null)
  // Drag handle for the Inspector bottom sheet — the gesture starts only from
  // its header, never from the scrolling body.
  const sheetDrag = useDragControls()
  // Rename / delete used to call window.prompt and window.confirm — native OS
  // dialogs that break the app illusion on a phone. See mobile-prompts.tsx.
  const [renameFor, setRenameFor] = useState<RenameTarget | null>(null)
  const [deleteFor, setDeleteFor] = useState<ConfirmTarget | null>(null)
  const mobileTab = useMobileTabStore((s) => s.tab)
  const tabHydrated = useMobileTabStore((s) => s.hydrated)

  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const nodes = useWorkspaceStore((s) => s.nodes)
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  // Only the open page stays in memory — see lib/store/use-active-page.ts
  useLazyActivePage(activePageId)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorOpen)
  const calcOpen = useWorkspaceStore((s) => s.calcOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const spring = useSpring('soft')
  // A phone is narrow; a tablet is a touch device that isn't. They want
  // different panels — a sheet from the bottom vs. the desktop side panel.
  const isPhone = useIsNarrow(767)
  // Live height of the fixed bottom nav rail (0 on tablet, where the rail is
  // a normal left column) — the editor reserves it so page chrome isn't
  // covered. Published by sidebar.tsx.
  const navBarH = useMobileNavBarStore((s) => s.height)
  const selection = useDocStore((s) => s.selection)
  const focusOnEdit = usePrefs((s) => s.appearance.focusOnEdit)
  const focusedId = focusOnEdit && inspectorOpen && selection.length === 1 ? selection[0] : null
  const closeInspector = () => useWorkspaceStore.getState().togglePanel('inspector')
  const store = useWorkspaceStore
  const primaryPageId = useWorkspaceStore((s) => s.primaryPageId)
  const splitPageId = useWorkspaceStore((s) => s.splitPageId)
  const splitRatio = useWorkspaceStore((s) => s.splitRatio)
  const splitScreenDocumentId = useWorkspaceStore((s) => s.splitScreenDocumentId)
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const pdfToolsActive = useWorkspaceStore((s) => s.pdfToolsActive)
  const activeKind = useWorkspaceStore(
    (s) => findPageMeta(s.nodes, s.activePageId)?.pageKind ?? 'board'
  )
  // Docs: the tools act on the focused sheet; boards act on themselves; PDFs
  // draw with the same real tools, targeting the focused page/notes canvas.
  const pdfToolsOn = activeKind === 'pdf' && pdfToolsActive
  const contentPageId =
    activeKind === 'doc' || pdfToolsOn ? (activeSheetId ?? activePageId) : activePageId
  const splitScreenObject = useDocStore((s) =>
    contentPageId && splitScreenDocumentId
      ? s.pages[contentPageId]?.objects?.[splitScreenDocumentId] ?? null
      : null
  )

  useShareInbox()

  // 'notebook' and 'folder' views are the same drill-down screen at
  // different depths — resolve whichever one is active to its FolderNode.
  const currentFolder: FolderNode | null =
    view.kind === 'notebook' || view.kind === 'folder'
      ? ((nodes[view.id]?.kind === 'folder' ? nodes[view.id] : null) as FolderNode | null)
      : null
  const pageName = findPageMeta(nodes, activePageId)?.name ?? 'Page'
  // Where the editor's back button returns to — the folder the open page
  // actually lives in, not always Home.
  const activeParentId = activePageId ? (nodes[activePageId]?.parentId ?? null) : null
  const goBackFromEditor = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      setView(activeParentId ? { kind: 'folder', id: activeParentId } : { kind: 'home' })
    }
  }

  const pushHistory = (tag: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({ simblip: true, tag, ts: Date.now() }, '')
    }
  }

  const navigateToView = (nextView: View) => {
    pushHistory(nextView.kind)
    setView(nextView)
  }

  // Restore last session's screen, once, after the persisted store has been
  // read back. Runs BEFORE the tab-reset effect below can act on the
  // restored tab (see restoredRef there): reopening into the editor means
  // the tab is still 'home', and that effect's whole job is to force
  // view→home for exactly that combination.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !tabHydrated) return
    restoredRef.current = true
    const saved = useMobileTabStore.getState().view
    // Only restore a view that still points at something real — a notebook
    // deleted on another device (or an editor view whose page is gone)
    // would otherwise land on a blank screen with no way back.
    const ws = useWorkspaceStore.getState()
    const valid =
      saved.kind === 'editor'
        ? !!ws.activePageId && !!findPageMeta(ws.nodes, ws.activePageId)
        : saved.kind === 'folder' || saved.kind === 'notebook'
          ? !!ws.nodes[saved.id]
          : true
    if (valid && saved.kind !== 'home') setViewLocal(saved)
  }, [tabHydrated])

  // Tapping Home/Notebooks in the persistent tab bar while deep in a
  // notebook (or the editor) returns to the drill-down root — same as
  // tapping a fresh tab in Canva always resets that tab's stack to its top.
  useEffect(() => {
    // Skip the mount run: at that point `mobileTab` is the RESTORED tab, not
    // a tap, and resetting here would immediately undo the restore above.
    if (!restoredRef.current) return
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

  const openSettings = () => {
    pushHistory('settings')
    setSettingsOpen(true)
  }

  const openTutorial = () => {
    pushHistory('tutorial')
    setTutorialOpen(true)
  }

  const openSearch = () => {
    pushHistory('search')
    setCommandOpen(true)
  }

  const openPage = (pageId: string) => {
    haptic('tick')
    pushHistory('editor')
    store.getState().setActivePage(pageId)
    setView({ kind: 'editor' })
  }

  const openFile = (node: FileNode) => {
    if (openFileNode(node)) {
      haptic('tick')
      pushHistory('editor')
      setView({ kind: 'editor' })
    }
  }

  // Mobile hardware/gesture back button handler: closes open drawers/modals/overlays first,
  // then unwinds nested views (editor -> folder -> home) instead of closing the browser app.
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!window.history.state?.simblip) {
      window.history.replaceState({ simblip: true, tag: 'root' }, '')
    }

    const onPopState = () => {
      // 1. Close overlays in priority order
      if (settingsOpen) {
        setSettingsOpen(false)
        return
      }
      if (commandOpen) {
        setCommandOpen(false)
        return
      }
      if (tutorialOpen) {
        setTutorialOpen(false)
        return
      }
      if (shareFor) {
        setShareFor(null)
        return
      }
      if (assignFor) {
        setAssignFor(null)
        return
      }
      if (presentFor) {
        setPresentFor(null)
        return
      }
      if (publishFor) {
        setPublishFor(null)
        return
      }
      if (addTarget) {
        setAddTarget(null)
        return
      }
      if (inspectorOpen) {
        useWorkspaceStore.getState().togglePanel('inspector')
        return
      }
      if (calcOpen) {
        useWorkspaceStore.getState().togglePanel('calc')
        return
      }

      // 2. Unwind view navigation
      if (view.kind === 'editor') {
        const parentId = activePageId ? (nodes[activePageId]?.parentId ?? null) : null
        setView(parentId ? { kind: 'folder', id: parentId } : { kind: 'home' })
        return
      }
      if (view.kind === 'folder' || view.kind === 'notebook') {
        const currentFolder = nodes[view.id]
        const parentId = currentFolder?.parentId
        setView(parentId ? { kind: 'folder', id: parentId } : { kind: 'home' })
        return
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [
    settingsOpen,
    commandOpen,
    tutorialOpen,
    shareFor,
    assignFor,
    presentFor,
    publishFor,
    addTarget,
    inspectorOpen,
    calcOpen,
    view,
    activePageId,
    nodes,
  ])



  const staff = can(profile?.role, 'share-pages')

  const duplicatePage = (parentId: string, page: PageRef) => {
    // Bundle-aware: duplicating a doc keeps its sheets, a PDF keeps its file.
    importPageInto(parentId, parentId, `${page.name} copy`, bundlePage(page.id))
    store.getState().setActivePage(null)
  }

  // Everything the desktop right-click menu offers, reachable on a phone.
  const pageDialogs = (
    <>
      <ShareDialog page={shareFor} onOpenChange={(o) => !o && setShareFor(null)} />
      <AssignDialog page={assignFor} onOpenChange={(o) => !o && setAssignFor(null)} />
      <PresentDialog page={presentFor} onOpenChange={(o) => !o && setPresentFor(null)} />
      <PublishDialog
        open={publishFor !== null}
        onOpenChange={(o) => !o && setPublishFor(null)}
        pageId={publishFor?.id ?? null}
      />
      <AddPageDialog target={addTarget} onOpenChange={(o) => !o && setAddTarget(null)} onCreated={openPage} />
      <RenameDialog target={renameFor} onClose={() => setRenameFor(null)} />
      <ConfirmDeleteDialog target={deleteFor} onClose={() => setDeleteFor(null)} />
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          const parentId = uploadTargetRef.current
          e.target.value = ''
          if (f && parentId) void addFileToFolder(parentId, f)
        }}
      />
    </>
  )

  // "More" tab — everything the old drawer's App section had (Tutorials,
  // Theme, Settings, Sign out), plus Shared-with-me and Review for staff,
  // as an in-place list rather than a slide-out panel.
  const moreTab = (
    <div className="flex h-dvh flex-col bg-background">
      <header
        className="flex shrink-0 items-center px-4 pt-[max(0px,env(safe-area-inset-top))]"
        style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
      >
        <span className="text-[0.9375rem] font-extrabold tracking-tight">More</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-lg font-bold text-white shadow-sm">
            {profile?.full_name?.charAt(0) || 'U'}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.9375rem] font-bold text-foreground">{profile?.full_name || 'User'}</span>
            <span className="truncate text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-wider">{profile?.role || 'Student'}</span>
          </div>
        </div>
        <div className="space-y-1">
          {staff && (
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] active:bg-accent hover:bg-accent"
              onClick={() => useMobileTabStore.getState().setTab('assignments')}
            >
              <GraduationCap className="h-4 w-4 text-muted-foreground" /> Review
            </button>
          )}
          <div className="my-2 border-t border-border/40" />
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] active:bg-accent hover:bg-accent"
            onClick={openTutorial}
          >
            <MonitorPlay className="h-4 w-4 text-muted-foreground" /> Tutorials
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] active:bg-accent hover:bg-accent"
            onClick={() => setTheme(isDarkTheme(resolvedTheme) ? 'light' : 'dark')}
          >
            {isDarkTheme(resolvedTheme) ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />} Theme
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] active:bg-accent hover:bg-accent"
            onClick={openSettings}
          >
            <Settings className="h-4 w-4 text-muted-foreground" /> Settings
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] active:bg-accent hover:bg-accent"
            {...bugHold.handlers}
            // A five-second press would otherwise raise the OS text-selection
            // callout right over the item being held.
            style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
            onClick={() => {
              // A completed hold already did its thing; don't also open the form.
              if (bugHold.fired.current) return
              setBugOpen(true)
            }}
          >
            <Bug className="h-4 w-4 text-muted-foreground" /> Report a bug
          </button>
          <div className="my-2 border-t border-border/40" />
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-destructive transition-[background-color,transform] duration-150 ease-out active:scale-[0.98] active:bg-destructive/10 hover:bg-destructive/10"
            onClick={() => useAuthStore.getState().logout()}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </main>
      <MobileTabBar />
      <BugReportDialog open={bugOpen} onOpenChange={setBugOpen} />
      {swarm && <BugSwarm onEnd={() => setSwarm(false)} />}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && activePageId && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )

  if (mobileTab === 'more' && view.kind !== 'editor') {
    return moreTab
  }

  // ── Assignments ──────────────────────────────────────────────────────────
  if (mobileTab === 'assignments' && view.kind === 'assignments') {
    return (
      <div className="relative flex h-dvh flex-col bg-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-[color-mix(in_oklch,var(--accent-blue)_14%,transparent)] to-transparent"
        />
        <header
          className="relative flex shrink-0 items-center px-4 pt-[max(0px,env(safe-area-inset-top))]"
          style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
        >
          <span className="text-[0.9375rem] font-extrabold tracking-tight">Assignments</span>
          <div className="flex-1" />
          {staff && (
            <button
              type="button"
              className="flex h-11 items-center gap-1.5 rounded-full px-3 text-[11.5px] font-medium text-muted-foreground transition-transform duration-150 ease-out active:scale-95 hover:bg-accent hover:text-foreground"
              onClick={() => router.push('/assignments/insights')}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Insights
            </button>
          )}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <AssignmentsPanel />
        </main>
        <MobileTabBar />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {tutorialOpen && activePageId && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
      </div>
    )
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  if (view.kind === 'editor' && activePageId) {
    return (
      <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
        <header
          className="z-40 flex shrink-0 items-center gap-1 border-b border-border/40 bg-background px-2 pt-[max(0px,env(safe-area-inset-top))]"
          style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
        >
          <button
            type="button"
            aria-label="Back"
            className={ICON_BTN}
            onClick={goBackFromEditor}
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          {institution?.logo_url ? (
            <Image
              src={String(institution.logo_url)}
              alt={institution.name}
              width={20}
              height={20}
              unoptimized
              // Hidden on the narrowest phones: at 390px the header was
              // logo + wordmark + title + 3 status/action controls, and the
              // page title — the only thing that identifies what you're
              // editing — truncated to a few characters.
              className="hidden h-5 w-5 rounded object-contain xs:block"
            />
          ) : null}
          {/* The page title is what matters mid-edit — the wordmark only
              earns its pixels once the screen is tablet-sized. */}
          <span className="hidden text-[0.875rem] font-extrabold tracking-tight sm:inline">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold">{pageName}</span>
          <NotificationCenter />
          <UndoRedo pageId={contentPageId ?? activePageId} />
        </header>

        {/* Same tab strip as desktop — open pages, ×, split toggle — plus the
            controls menu at its left edge (PDF page nav/zoom, simulation
            transport). It used to collapse away on a phone with a single
            page open, but it's no longer just tab-switching chrome — it's
            also where those controls live now instead of floating over the
            canvas, so it stays. */}
        <div className="flex h-9 shrink-0 items-center border-b border-border/40 bg-background px-1">
          <TabsBar
            pageId={contentPageId}
            showTransport={!!activePageId && (activeKind !== 'pdf' || pdfToolsOn)}
          />
          {/* Sync state is ambient — it belongs beside the tabs, not competing
              with the page title for the header's last few pixels. */}
          <div className="ml-auto shrink-0 pr-1">
            <SyncStatus />
          </div>
        </div>

        {/* The phone nav rail (sidebar.tsx) is `fixed inset-x-0 bottom-0`, so
            it covers whatever the editor renders along its own bottom edge —
            a presentation's slide rail + toolbar, a sheet's tab strip, a web
            view's browser bar. Reserving its measured height here fixes that
            once for every page kind instead of per-view (CanvasControls used
            to be the only thing compensating, which is why board/doc looked
            fine and pptx/xlsx overlapped). */}
        <main
          className="relative flex min-h-0 flex-1 flex-row"
          style={{ paddingBottom: navBarH }}
        >
          {/* Same left-docked rail + collapsible pane as desktop — on a
              phone it starts collapsed to the rail (sidebarOpen is forced
              false below max-width:767px, same as the desktop shell), so it
              never eats into canvas space uninvited. */}
          <Dock panels={['pages']} render={() => <Sidebar />} />

          {/* min-w-0: <main> is always flex-row, so without this the flex
              item won't shrink below its content's width. That content is
              a doc page (~800px), so on phone the scroll area stayed
              page-width instead of the real viewport, breaking DocView's
              zoom math. */}
          <div className={cn('relative flex min-h-0 min-w-0 flex-1', isPhone ? 'flex-col' : 'flex-row')}>
            {splitScreenObject && (
              <div
                className={cn(
                  'flex bg-muted/30 p-2 relative z-10',
                  isPhone
                    ? 'w-full h-1/2 flex-col border-b border-border'
                    : 'h-full w-1/2 flex-col border-r border-border'
                )}
              >
                <FileObject object={splitScreenObject} pageId={contentPageId!} />
              </div>
            )}
            {(() => {
              // Split screen, exactly like desktop: primary pane stays put,
              // the split pane sits beside it (tablet) or below it (phone).
              const leftId = splitPageId ? (primaryPageId ?? activePageId) : activePageId
              const rightId = splitPageId && splitPageId !== leftId ? splitPageId : null
              if (!rightId) {
                return (
                  <div className="relative flex-1 min-h-0 min-w-0">
                    <PageView pageId={leftId} />
                  </div>
                )
              }
              return (
                <div className={cn('relative flex min-h-0 min-w-0 flex-1', isPhone ? 'flex-col' : 'flex-row')}>
                  <div
                    className={cn('relative min-h-0 min-w-0', activePageId === leftId && 'ring-1 ring-inset ring-[var(--accent-blue)]/25')}
                    style={isPhone ? { height: `${splitRatio * 100}%` } : { width: `${splitRatio * 100}%` }}
                    onPointerDownCapture={() => activePageId !== leftId && store.getState().setActivePage(leftId)}
                  >
                    <PageView pageId={leftId} />
                  </div>
                  <div
                    role="separator"
                    aria-label="Resize split"
                    className={cn('shrink-0 touch-none bg-border/60', isPhone ? 'h-1.5 w-full cursor-row-resize' : 'w-1.5 cursor-col-resize')}
                    onPointerDown={(e) => {
                      e.preventDefault()
                      const el = e.currentTarget.parentElement!
                      const rect = el.getBoundingClientRect()
                      const move = (ev: PointerEvent) => {
                        const r = isPhone
                          ? (ev.clientY - rect.top) / rect.height
                          : (ev.clientX - rect.left) / rect.width
                        store.getState().setSplitRatio(r)
                      }
                      const up = () => {
                        window.removeEventListener('pointermove', move)
                        window.removeEventListener('pointerup', up)
                      }
                      window.addEventListener('pointermove', move)
                      window.addEventListener('pointerup', up)
                    }}
                  />
                  <div
                    className={cn('relative min-h-0 min-w-0 flex-1', activePageId === rightId && 'ring-1 ring-inset ring-[var(--accent-blue)]/25')}
                    onPointerDownCapture={() => activePageId !== rightId && store.getState().setActivePage(rightId)}
                  >
                    <PageView pageId={rightId} />
                  </div>
                </div>
              )
            })()}
            {/* Only kinds with a canvas to draw on — see showsCanvasDock. */}
            {showsCanvasDock(activeKind, pdfToolsOn) && contentPageId && (
              <CanvasControls pageId={contentPageId} showTransport={false} />
            )}
            {calcOpen && <Calculator onClose={() => togglePanel('calc')} />}
          </div>
        </main>

        {/* Editing on a small screen: lift the object out of the canvas and dim
            the board, so you can see what your edits are doing to it. The panel
            then comes in from the bottom (phone) or the side (tablet). */}
        {activePageId && (
          <FocusObject
            pageId={contentPageId ?? activePageId}
            objectId={focusedId}
            onDismiss={closeInspector}
            // The panel's footprint: a sheet along the bottom on a phone, the
            // desktop-shaped column on the right on a tablet.
            reserve={
              isPhone
                ? { bottom: Math.round(window.innerHeight * 0.62) }
                : { right: Math.min(352, Math.round(window.innerWidth * 0.85)) }
            }
          />
        )}

        <AnimatePresence>
          {inspectorOpen && activePageId && (
            <fm.div
              key="inspector"
              className={
                isPhone
                  ? 'fixed inset-x-0 bottom-0 z-[60] flex max-h-[62dvh] flex-col rounded-t-2xl border-t border-border/30 bg-background'
                  : 'fixed bottom-0 right-0 top-0 z-[60] flex w-[22rem] max-w-[85vw] flex-col border-l border-border/30 bg-background'
              }
              initial={isPhone ? { y: '100%' } : { x: '100%' }}
              animate={isPhone ? { y: 0 } : { x: 0 }}
              exit={isPhone ? { y: '100%' } : { x: '100%' }}
              transition={spring}
              // Drag-to-dismiss, phone only — a side panel on a tablet isn't a
              // sheet and shouldn't behave like one.
              //
              // dragListener={false} + dragControls: the gesture starts ONLY
              // from the header below. Dragging anywhere else would fight the
              // Inspector's own vertical scrolling, which is the usual way
              // this pattern goes wrong.
              //
              // dragConstraints pins the top so the sheet can't be flung up
              // past its own height; elastic gives the resistance a real sheet
              // has when you pull against a stop, instead of a dead wall.
              drag={isPhone ? 'y' : false}
              dragListener={false}
              dragControls={sheetDrag}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.02, bottom: 0.9 }}
              onDragEnd={(_, info) => {
                // Distance OR velocity — a quick flick should dismiss even if
                // it barely moved, which is what makes the gesture feel light.
                if (info.offset.y > 120 || info.velocity.y > 500) {
                  haptic('bump')
                  closeInspector()
                }
              }}
            >
              <div
                className="flex shrink-0 touch-none flex-col border-b border-border"
                onPointerDown={(e) => isPhone && sheetDrag.start(e)}
                style={{ cursor: isPhone ? 'grab' : undefined }}
              >
                {/* Grabber. Nothing else signals the sheet is draggable, and
                    an invisible gesture is one nobody finds. */}
                {isPhone && (
                  <div className="flex justify-center pt-2 pb-1" aria-hidden>
                    <div className="h-1 w-9 rounded-full bg-muted-foreground/25" />
                  </div>
                )}
                <div className="flex items-center justify-between px-4 pb-2 pt-1">
                  <span className="text-[0.75rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Properties
                  </span>
                  <button
                    type="button"
                    aria-label="Close"
                    className={ICON_BTN}
                    onClick={closeInspector}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [&>aside]:!m-0 [&>aside]:!w-full [&>aside]:!max-w-none [&>aside]:!rounded-none [&>aside]:!bg-transparent [&>aside]:!shadow-none [&>aside]:!backdrop-blur-none">
                <Inspector pageId={contentPageId ?? activePageId} />
              </div>
            </fm.div>
          )}
        </AnimatePresence>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
      </div>
    )
  }

  // ── Folder (drill-down) ───────────────────────────────────────────────────
  // One screen per folder, at any depth — a sub-folder is a tappable card
  // that pushes a new 'folder' view instead of trying to render nested
  // grids inline (which doesn't work past 2 levels on a phone screen).
  // Top-level notebooks and sub-folders ("sections", or any folder a user
  // creates inside another) render through this SAME screen.
  if ((view.kind === 'notebook' || view.kind === 'folder') && currentFolder) {
    const folder = currentFolder
    const kids = childrenOf(nodes, folder.id)
    const subFolders = kids.filter((n): n is FolderNode => n.kind === 'folder')
    const pages = kids.filter((n) => n.kind === 'page')
    const files = kids.filter((n) => n.kind === 'file')
    const parentId = folder.parentId
    return (
      <div className="relative flex h-dvh flex-col bg-background">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-[color-mix(in_oklch,var(--accent-blue)_14%,transparent)] to-transparent"
        />
        <header
          className="relative flex shrink-0 items-center gap-1 border-b border-border/40 px-2 pt-[max(0px,env(safe-area-inset-top))]"
          style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
        >
          <button
            type="button"
            aria-label="Back"
            className={ICON_BTN}
            onClick={goBackFromEditor}
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold">
            {folder.name}
          </span>
          <button
            type="button"
            aria-label="New folder"
            className={ICON_BTN}
            onClick={() => store.getState().addFolder('New Folder', folder.id)}
          >
            <Plus className="h-4.5 w-4.5" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-4">
          {subFolders.length > 0 && (
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                  Folders
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {subFolders.map((sub, i) => (
                  <fm.div
                    key={sub.id}
                    {...cardEntry(i)}
                    transition={{ ...spring, ...cardEntry(i).transition }}
                    whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2 rounded-2xl border border-border/40 bg-card px-3 py-3 shadow-sm"
                    onClick={() => navigateToView({ kind: 'folder', id: sub.id })}
                  >
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', SECTION_DOT[sub.color ?? 'blue'] ?? SECTION_DOT.blue)} />
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{sub.name}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Actions for ${sub.name}`}
                          // -my-2 keeps the 44px tap area from stretching the
                          // card taller than its text row.
                          className="-my-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform duration-150 ease-out active:scale-90 hover:bg-accent hover:text-foreground"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameFor({
                              kind: 'folder',
                              name: sub.name,
                              onRename: (next) => store.getState().renameNode(sub.id, next),
                            })
                          }}
                        >
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            const colors = Object.keys(SECTION_DOT)
                            const next = colors[(colors.indexOf(sub.color ?? 'blue') + 1) % colors.length]
                            store.getState().setFolderColor(sub.id, next)
                          }}
                        >
                          <span className={cn('h-3.5 w-3.5 rounded-full', SECTION_DOT[sub.color ?? 'blue'] ?? SECTION_DOT.blue)} /> Choose color
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteFor({
                              kind: 'folder',
                              name: sub.name,
                              detail: 'Everything inside it goes too.',
                              onConfirm: () => store.getState().removeNode(sub.id),
                            })
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </fm.div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3 flex items-center justify-between px-1">
            <span className="text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
              Pages
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Upload file"
                className={ICON_BTN}
                onClick={() => uploadFileTo(folder.id)}
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="New page"
                className={ICON_BTN}
                onClick={() => setAddTarget({ parentId: folder.id })}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {pages.length === 0 && files.length === 0 ? (
            <div className="flex min-h-[100px] items-center justify-center rounded-3xl border border-dashed border-border/60 text-[0.75rem] text-muted-foreground">
              Add your first page
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {pages.map((page, i) => (
                <fm.div
                  key={page.id}
                  {...cardEntry(i)}
                  transition={{ ...spring, ...cardEntry(i).transition }}
                  whileTap={{ scale: 0.95 }}
                  className="group relative flex aspect-[3/4] sm:aspect-[4/5] flex-col overflow-hidden rounded-2xl border border-border/40 bg-card p-2.5 shadow-sm"
                  onClick={() => openPage(page.id)}
                >
                  {/* Thumbnail takes the bulk of the card so the user can
                      preview the page without opening it. */}
                  <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-muted/40">
                    <PageThumbnail pageId={page.id} className="absolute inset-0 p-1.5" />
                    {(() => {
                      const KindIcon = KIND_ICON[page.pageKind ?? 'board']
                      return (
                        <span className="absolute left-1 top-1 rounded-full bg-background/70 p-1 text-muted-foreground backdrop-blur-sm">
                          <KindIcon className="h-3 w-3" />
                        </span>
                      )
                    })()}
                    <DropdownMenu>
                      {/* The trigger IS the button — wrapping it in another
                          <button> nests interactive elements (invalid HTML,
                          and screen readers see one control where there are
                          two). stopPropagation lives here so opening the menu
                          doesn't also open the page. */}
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${page.name}`}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={CARD_ACTION_BTN}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 rounded-xl">
                          <DropdownMenuItem onClick={() => openPage(page.id)}>
                            <BookOpen className="h-4 w-4" /> Open
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              setRenameFor({
                                kind: 'page',
                                name: page.name,
                                onRename: (next) => store.getState().renameNode(page.id, next),
                              })
                            }}
                          >
                            <Pencil className="h-4 w-4" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation()
                            duplicatePage(folder.id, page)
                          }}>
                            <Copy className="h-4 w-4" /> Duplicate
                          </DropdownMenuItem>
                          {staff && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setShareFor(page) }}>
                                <Share2 className="h-4 w-4" /> Share copy…
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setAssignFor(page) }}>
                                <ClipboardList className="h-4 w-4" /> Assign…
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setPresentFor(page) }}>
                                <MonitorPlay className="h-4 w-4" /> Present on room board…
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setPublishFor(page) }}>
                                <LibraryBig className="h-4 w-4" /> Add to library…
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); exportPageJson(page) }}>
                            <Download className="h-4 w-4" /> Export JSON
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteFor({
                                kind: 'page',
                                name: page.name,
                                onConfirm: () => store.getState().removeNode(page.id),
                              })
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Delete page
                          </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <span className="mt-2 line-clamp-2 px-0.5 text-[0.75rem] font-bold leading-tight tracking-tight">{page.name}</span>
                </fm.div>
              ))}
              {files.map((file, i) => (
                <fm.div
                  key={file.id}
                  {...cardEntry(pages.length + i)}
                  transition={{ ...spring, ...cardEntry(pages.length + i).transition }}
                  whileTap={{ scale: 0.95 }}
                  className="group relative flex aspect-[3/4] sm:aspect-[4/5] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border/40 bg-card p-2.5 text-center shadow-sm"
                  onClick={() => openFile(file)}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions for ${file.name}`}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={CARD_ACTION_BTN}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem onClick={() => openFile(file)}>
                          <BookOpen className="h-4 w-4" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameFor({
                              kind: 'file',
                              name: file.name,
                              onRename: (next) => store.getState().renameNode(file.id, next),
                            })
                          }}
                        >
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteFor({
                              kind: 'file',
                              name: file.name,
                              onConfirm: () => store.getState().removeNode(file.id),
                            })
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> Delete file
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="line-clamp-2 px-0.5 text-[0.75rem] font-bold leading-tight tracking-tight">{file.name}</span>
                  <span className="text-[0.625rem] text-muted-foreground">{file.mime}</span>
                </fm.div>
              ))}
            </div>
          )}
        </main>
        <MobileTabBar />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {pageDialogs}
        {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
      </div>
    )
  }

  // ── Home / Notebooks ─────────────────────────────────────────────────────
  // Same drill-down root screen for both tabs — Home adds a greeting above
  // the notebook grid, Notebooks tab shows just the grid with a plain
  // header. mobileTab defaults to 'home', and Notebooks falls back to it
  // too (never renders blank if the store hasn't caught up to a nav yet).
  const showGreeting = mobileTab !== 'notebooks'
  // Continue editing — reuses openTabs (already-tracked open/recent pages,
  // most-recent last) instead of adding new MRU state. Most recent first,
  // capped so the strip doesn't scroll forever. Each page is tagged with its
  // owning notebook (walk parentId up to the root) so the strip can group by
  // notebook and show that name, not just the page title.
  const recentPages = [...openTabs].reverse().slice(0, 10)
    .map((id) => findPageMeta(nodes, id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => {
      let cur = nodes[p.parentId ?? '']
      while (cur?.parentId && nodes[cur.parentId]) cur = nodes[cur.parentId]
      return { page: p, notebookName: cur?.name ?? 'Notebook' }
    })
  return (
    <div className="relative flex h-dvh flex-col bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-[color-mix(in_oklch,var(--accent-blue)_22%,transparent)] via-[color-mix(in_oklch,var(--accent-violet)_10%,transparent)] to-transparent"
      />
      <header
        className="relative flex shrink-0 items-center gap-1 px-4 pt-[max(0px,env(safe-area-inset-top))]"
        style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
      >
        {showGreeting ? (
          <span className="text-[0.9375rem] font-extrabold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
        ) : (
          <span className="text-[0.9375rem] font-bold">Notebooks</span>
        )}
        <div className="flex-1" />
        <SyncStatus />
        <NotificationCenter />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">
        {/* One line, not three. The old block spent ~180px on a 40px black
            "Hello there, {name}" + subtitle before any content — on a 900px
            phone that's a fifth of the screen given to the app introducing
            itself. The name still greets you; it just doesn't take the fold. */}
        {showGreeting && profile && (
          <h1 className="pb-3 pt-1 text-[1.5rem] font-extrabold tracking-tight leading-tight text-foreground">
            Hi, {profile.full_name.split(' ')[0]}
            <span className="text-muted-foreground/70"> — what are we making?</span>
          </h1>
        )}
        {showGreeting && (
          <button
            type="button"
            onClick={openSearch}
            className="mb-5 flex w-full items-center gap-2.5 rounded-2xl border border-border/50 bg-card/80 px-4 py-3 text-left shadow-sm backdrop-blur-sm transition-transform active:scale-[0.98]"
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-[0.875rem] text-muted-foreground">Search your notebooks and pages…</span>
          </button>
        )}
        {/* Create grid — the screen's reason to exist, above the fold.
            Every page kind is one tap from home instead of buried behind
            "New notebook" → open → "+" → pick a kind. Each tile deep-links
            into that kind's step in AddPageDialog, so the kind you tapped is
            never asked again. Color-coded per kind so the grid is scannable
            by shape and hue, not by reading four labels. */}
        {showGreeting && (
          <div className="pb-6">
            <p className={SECTION_LABEL}>Create</p>
            <div className="grid grid-cols-4 gap-2">
              {CREATE_TILES.map(({ step, label, icon: Icon, tint }) => (
                <button
                  key={step}
                  type="button"
                  className="flex flex-col items-center gap-2 rounded-2xl border border-border/50 bg-card/80 px-1 py-3 shadow-sm transition-transform active:scale-95"
                  onClick={() => {
                    // Create into the most recently used notebook when there
                    // is one — a page has to live somewhere, and asking
                    // "which notebook?" first is the friction this grid exists
                    // to remove. Falls back to making one.
                    const ws = store.getState()
                    const existing = childrenOf(ws.nodes, null)
                      .find((n): n is FolderNode => n.kind === 'folder' && n.name !== SHARED_NB)
                    setAddTarget({ parentId: existing?.id ?? ws.addNotebook(), step })
                  }}
                >
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `color-mix(in oklch, ${tint} 16%, transparent)` }}
                  >
                    <Icon className="h-5 w-5" style={{ color: tint }} />
                  </span>
                  <span className="text-[0.6875rem] font-semibold leading-tight text-foreground">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {showGreeting && <HomeDueSoon onOpen={() => useMobileTabStore.getState().setTab('assignments')} />}
        {/* Recent. Labels sit BELOW the thumbnail, not stacked on top of it:
            the old card had a dark gradient at the top for the notebook name
            and a solid black bar at the bottom for the page name, which
            covered a third of the preview and still truncated both to
            "UNTITLED NOTEBO…". A thumbnail's whole job is to be recognised at
            a glance — so the image gets the full card, and the text gets
            real background contrast underneath it. */}
        {showGreeting && recentPages.length > 0 && (
          <div className="pb-6">
            <p className={SECTION_LABEL}>Recent</p>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {recentPages.map(({ page, notebookName }) => {
                const KindIcon = KIND_ICON[page.pageKind ?? 'board']
                return (
                  <button
                    key={page.id}
                    type="button"
                    className="w-32 shrink-0 text-left transition-transform active:scale-95"
                    onClick={() => openPage(page.id)}
                  >
                    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm">
                      <PageThumbnail pageId={page.id} className="absolute inset-0 p-1" />
                    </div>
                    <p className="mt-1.5 flex items-center gap-1 truncate text-[0.75rem] font-semibold text-foreground">
                      <KindIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="truncate">{page.name}</span>
                    </p>
                    <p className="truncate text-[0.6875rem] text-muted-foreground">{notebookName}</p>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {showGreeting && <p className={SECTION_LABEL}>Your notebooks</p>}
        <div className="grid grid-cols-2 gap-4">
          {childrenOf(nodes, null)
            .filter((n): n is FolderNode => n.kind === 'folder' && n.name !== SHARED_NB)
            .map((nb, i) => {
            const pages = descendantsOf(nodes, nb.id).filter((n) => n.kind === 'page').length
            return (
              <fm.div
                key={nb.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: Math.min(i, 7) * 0.05 }}
                whileTap={{ scale: 0.95 }}
                className="relative flex flex-col overflow-hidden rounded-[20px] border border-border/60 bg-card shadow-sm"
                onClick={() => navigateToView({ kind: 'folder', id: nb.id })}
              >
                {/* Cover image instead of an icon — pick one from /cover. */}
                {/* A notebook with no cover picked used to render a flat pale
                    wash with a grey book glyph — the same image for every
                    notebook, so a grid of them was a grid of identical grey
                    rectangles with nothing to tell them apart but the caption.
                    The shipped cover art is already there; picking one by id
                    hash gives each notebook a stable, distinct face from the
                    moment it's created, and the user can still override it. */}
                <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted/40">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={nb.cover ?? COVERS[hashIndex(nb.id, COVERS.length)]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        aria-label={`Actions for ${nb.name}`}
                        className={CARD_ACTION_BTN}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation()
                          setRenameFor({
                            kind: 'notebook',
                            name: nb.name,
                            onRename: (next) => store.getState().renameNotebook(nb.id, next),
                          })
                        }}>
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setCoverFor(nb.id) }}>
                          <BookOpen className="h-4 w-4" /> Choose cover…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={(e) => {
                          e.stopPropagation()
                          setDeleteFor({
                            kind: 'notebook',
                            name: nb.name,
                            detail: 'All of its pages go too.',
                            onConfirm: () => store.getState().removeNotebook(nb.id),
                          })
                        }}>
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-col p-3">
                  <span className="line-clamp-2 text-[0.9375rem] font-bold tracking-tight">{nb.name}</span>
                  {/* Plain sentence case, not bold uppercase: the count is
                      supporting metadata, and shouting "3 PAGES" at the same
                      weight as the notebook's own name flattens the card's
                      hierarchy to nothing. */}
                  <span className="mt-0.5 text-[0.75rem] text-muted-foreground">
                    {pages} page{pages === 1 ? '' : 's'}
                  </span>
                </div>
              </fm.div>
            )
          })}
          <fm.div
            whileTap={{ scale: 0.95 }}
            className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-border/70 bg-muted/20 p-4 text-muted-foreground"
            onClick={() => {
              const id = store.getState().addNotebook()
              const sec = store.getState().addFolder('Section 1', id)
              store.getState().addPageIn(sec, 'Page 1')
              store.getState().setActivePage(null)
              navigateToView({ kind: 'folder', id })
            }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-foreground">
              <Plus className="h-5 w-5" />
            </div>
            <span className="text-[0.8125rem] font-bold">New notebook</span>
          </fm.div>
        </div>
      </main>

      {/* Cover picker — the /public/cover set, one tap to apply. */}
      <AnimatePresence>
        {coverFor && (
          <>
            <fm.div
              className="fixed inset-0 z-[70] bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCoverFor(null)}
            />
            <fm.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={spring}
              className="fixed inset-x-0 bottom-0 z-[80] rounded-t-2xl border-t border-border/40 bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[0.75rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Choose a cover
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  className={ICON_BTN}
                  onClick={() => setCoverFor(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {COVERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="overflow-hidden rounded-xl border border-border/60 transition-transform active:scale-95"
                    onClick={() => {
                      store.getState().setNotebookCover(coverFor, c)
                      setCoverFor(null)
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c} alt="" className="aspect-[3/2] w-full object-cover" />
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="mt-3 w-full rounded-xl border border-dashed border-border/60 py-2 text-[0.8125rem] font-medium text-muted-foreground active:bg-accent"
                onClick={() => {
                  store.getState().setNotebookCover(coverFor, undefined)
                  setCoverFor(null)
                }}
              >
                No cover
              </button>
            </fm.div>
          </>
        )}
      </AnimatePresence>

      <MobileTabBar />
      {/* Notebook rename/delete live on THIS screen, so the shared dialogs
          have to be mounted here too — not only on the folder screen. */}
      <RenameDialog target={renameFor} onClose={() => setRenameFor(null)} />
      <ConfirmDeleteDialog target={deleteFor} onClose={() => setDeleteFor(null)} />
      {/* Same reason: the Create grid above sets addTarget, and the dialog
          that consumes it is otherwise mounted only inside the folder branch
          — so every Create tile set state that nothing was listening for and
          the buttons looked dead. */}
      <AddPageDialog target={addTarget} onOpenChange={(o) => !o && setAddTarget(null)} onCreated={openPage} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onOpenSettings={openSettings} />
      {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}
