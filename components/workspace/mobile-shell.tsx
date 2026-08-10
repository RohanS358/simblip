'use client'

// Mobile workspace — a Notes-style app, not a shrunken desktop. Navigation
// instead of panels: Home (notebook cards + assignments) → notebook (section
// & page list) → editor (full-bleed canvas, no sidebar, properties as a
// bottom sheet, the top-right actions collapsed into one menu).

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BookOpen,
  ClipboardList,
  Copy,
  Download,
  GraduationCap,
  LibraryBig,
  LogOut,
  MonitorPlay,
  MoreVertical,
  Moon,
  Pencil,
  Plus,
  Settings,
  Share2,
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
import { CanvasControls } from './canvas-controls'
import { Inspector } from './inspector'
import { FocusObject } from './focus-object'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useIsNarrow } from '@/hooks/use-mobile'
import { usePrefs } from '@/lib/store/preferences'
import { useMobileTabStore } from '@/lib/store/mobile-tab'
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
import { AddPageDialog } from './add-page-dialog'
import { addFileToFolder } from './notebook-tree'
import { openFile as openFileNode } from './open-file'
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

// 'notebook' kept as a distinct kind from 'folder' only for the drawer's
// "My Notebooks" highlight check below — both render through the SAME
// drill-down folder view; a top-level tap and a sub-folder tap just push
// different depths onto the same view.
type View = { kind: 'home' } | { kind: 'notebook'; id: string } | { kind: 'folder'; id: string } | { kind: 'editor' }

const SECTION_DOT: Record<string, string> = {
  blue: 'bg-[var(--accent-blue)]',
  mint: 'bg-[var(--accent-mint)]',
  amber: 'bg-[var(--accent-amber)]',
  violet: 'bg-[var(--accent-violet)]',
  rose: 'bg-[var(--accent-rose)]',
}

/** The cover set that ships in /public/cover — pick one per notebook. */
const COVERS = ['blue', 'mint', 'violet', 'amber', 'rose', 'slate'].map(
  (c) => `/cover/cover-${c}.svg`
)

const SHARED_NB = 'Shared with me'

export function MobileShell() {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const [view, setView] = useState<View>({ kind: 'home' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)
  const [addTarget, setAddTarget] = useState<{ parentId: string } | null>(null)
  // One shared hidden <input type=file>, same pattern notebook-tree.tsx
  // uses — a tap can't open the native picker directly.
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)
  const uploadFileTo = (parentId: string) => {
    uploadTargetRef.current = parentId
    uploadInputRef.current?.click()
  }
  const [coverFor, setCoverFor] = useState<string | null>(null)
  const mobileTab = useMobileTabStore((s) => s.tab)

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

  // Tapping Home/Notebooks in the persistent tab bar while deep in a
  // notebook (or the editor) returns to the drill-down root — same as
  // tapping a fresh tab in Canva always resets that tab's stack to its top.
  useEffect(() => {
    if ((mobileTab === 'home' || mobileTab === 'notebooks') && view.kind !== 'home') {
      setView({ kind: 'home' })
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

  const openPage = (pageId: string) => {
    pushHistory('editor')
    store.getState().setActivePage(pageId)
    setView({ kind: 'editor' })
  }

  const openFile = (node: FileNode) => {
    if (openFileNode(node)) {
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
      <header className="flex h-12 shrink-0 items-center px-4">
        <span className="text-[0.9375rem] font-extrabold tracking-tight">More</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-accent"
            onClick={openTutorial}
          >
            <MonitorPlay className="h-4 w-4 text-muted-foreground" /> Tutorials
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-accent"
            onClick={() => setTheme(isDarkTheme(resolvedTheme) ? 'light' : 'dark')}
          >
            {isDarkTheme(resolvedTheme) ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />} Theme
          </button>
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-foreground transition-colors hover:bg-accent"
            onClick={openSettings}
          >
            <Settings className="h-4 w-4 text-muted-foreground" /> Settings
          </button>
          <div className="my-2 border-t border-border/40" />
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.875rem] font-medium text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => useAuthStore.getState().logout()}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </main>
      <MobileTabBar />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && activePageId && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )

  if (mobileTab === 'more' && view.kind !== 'editor') {
    return moreTab
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  if (view.kind === 'editor' && activePageId) {
    return (
      <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
        <header className="z-40 flex h-12 shrink-0 items-center gap-1 border-b border-border/40 bg-background px-2">
          <button
            type="button"
            aria-label="Back"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
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
              className="h-5 w-5 rounded object-contain"
            />
          ) : null}
          {/* The page title is what matters mid-edit — the wordmark only
              earns its pixels once the screen is tablet-sized. */}
          <span className="hidden text-[0.875rem] font-extrabold tracking-tight sm:inline">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <span className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold">{pageName}</span>
          <SyncStatus />
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
        </div>

        <main className="relative flex min-h-0 flex-1 flex-row">
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
            {(activeKind !== 'pdf' || pdfToolsOn) && activeKind !== 'web' && contentPageId && (
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
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-[0.75rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Properties &amp; variables
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                  onClick={closeInspector}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [&>aside]:!m-0 [&>aside]:!w-full [&>aside]:!max-w-none [&>aside]:!rounded-none [&>aside]:!bg-transparent [&>aside]:!shadow-none [&>aside]:!backdrop-blur-none">
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
      <div className="flex h-dvh flex-col bg-background">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/40 px-2">
          <button
            type="button"
            aria-label="Back"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
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
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
            onClick={() => store.getState().addFolder('New Folder', folder.id)}
          >
            <Plus className="h-4.5 w-4.5" />
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
          {subFolders.length > 0 && (
            <div className="mb-6">
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="text-[0.8125rem] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                  Folders
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {subFolders.map((sub) => (
                  <fm.div
                    key={sub.id}
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
                          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            const name = window.prompt('Rename folder', sub.name)
                            if (name?.trim()) store.getState().renameNode(sub.id, name.trim())
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
                            if (window.confirm(`Delete folder "${sub.name}"?`)) store.getState().removeNode(sub.id)
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
                className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
                onClick={() => uploadFileTo(folder.id)}
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="New page"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
                onClick={() => setAddTarget({ parentId: folder.id })}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {pages.length === 0 && files.length === 0 ? (
            <div className="flex min-h-[100px] items-center justify-center rounded-3xl border border-dashed border-border/60 text-[0.75rem] text-muted-foreground">
              No pages yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {pages.map((page) => (
                <fm.div
                  key={page.id}
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
                    <button
                      type="button"
                      aria-label={`Actions for ${page.name}`}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-1 top-1 rounded-full bg-background/70 p-1 text-muted-foreground opacity-100 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:bg-background hover:text-foreground"
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <span className="flex h-6 w-6 items-center justify-center">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 rounded-xl">
                          <DropdownMenuItem onClick={() => openPage(page.id)}>
                            <BookOpen className="h-4 w-4" /> Open
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              const name = window.prompt('Rename page', page.name)
                              if (name?.trim()) store.getState().renameNode(page.id, name.trim())
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
                              if (window.confirm(`Delete page "${page.name}"?`)) {
                                store.getState().removeNode(page.id)
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Delete page
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </button>
                  </div>
                  <span className="mt-2 line-clamp-2 px-0.5 text-[0.75rem] font-bold leading-tight tracking-tight">{page.name}</span>
                </fm.div>
              ))}
              {files.map((file) => (
                <fm.div
                  key={file.id}
                  whileTap={{ scale: 0.95 }}
                  className="group relative flex aspect-[3/4] sm:aspect-[4/5] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border/40 bg-card p-2.5 text-center shadow-sm"
                  onClick={() => openFile(file)}
                >
                  <button
                    type="button"
                    aria-label={`Actions for ${file.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-1 top-1 rounded-full bg-background/70 p-1 text-muted-foreground backdrop-blur-sm hover:bg-background hover:text-foreground"
                  >
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <span className="flex h-6 w-6 items-center justify-center">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem onClick={() => openFile(file)}>
                          <BookOpen className="h-4 w-4" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            const name = window.prompt('Rename file', file.name)
                            if (name?.trim()) store.getState().renameNode(file.id, name.trim())
                          }}
                        >
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (window.confirm(`Delete file "${file.name}"?`)) store.getState().removeNode(file.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> Delete file
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </button>
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
  // capped so the strip doesn't scroll forever.
  const recentPages = [...openTabs].reverse().slice(0, 8)
    .map((id) => findPageMeta(nodes, id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-1 px-4">
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
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {showGreeting && profile && (
          <div className="pb-6 pt-2">
            <h1 className="text-[1.75rem] font-black tracking-tight leading-none text-foreground drop-shadow-sm">
              Hello, {profile.full_name.split(' ')[0]}
            </h1>
            <p className="mt-1.5 text-[0.875rem] font-medium text-muted-foreground">Pick a notebook to start creating.</p>
          </div>
        )}
        {showGreeting && recentPages.length > 0 && (
          <div className="pb-6">
            <p className="mb-2 px-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground/70">
              Continue editing
            </p>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {recentPages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-xl border border-border/50 bg-muted/40 text-left"
                  onClick={() => openPage(page.id)}
                >
                  <PageThumbnail pageId={page.id} className="absolute inset-0 p-1" />
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-1 text-[0.625rem] font-semibold text-white">
                    {page.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          {childrenOf(nodes, null)
            .filter((n): n is FolderNode => n.kind === 'folder' && n.name !== SHARED_NB)
            .map((nb) => {
            const pages = descendantsOf(nodes, nb.id).filter((n) => n.kind === 'page').length
            return (
              <fm.div
                key={nb.id}
                whileTap={{ scale: 0.95 }}
                className="relative flex flex-col overflow-hidden rounded-[20px] border border-border/60 bg-card shadow-sm"
                onClick={() => navigateToView({ kind: 'folder', id: nb.id })}
              >
                {/* Cover image instead of an icon — pick one from /cover. */}
                <div className="relative aspect-[3/2] w-full overflow-hidden bg-muted/40">
                  {nb.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={nb.cover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[color-mix(in_oklch,var(--accent-blue)_18%,transparent)] to-transparent">
                      <BookOpen className="h-7 w-7 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="absolute right-1.5 top-1.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="rounded-full bg-background/70 p-1.5 text-muted-foreground backdrop-blur-sm hover:bg-background hover:text-foreground">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl">
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation()
                          const name = window.prompt('Rename notebook', nb.name)
                          if (name?.trim()) store.getState().renameNotebook(nb.id, name.trim())
                        }}>
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setCoverFor(nb.id) }}>
                          <BookOpen className="h-4 w-4" /> Choose cover…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={(e) => {
                          e.stopPropagation()
                          if (window.confirm(`Delete notebook "${nb.name}"?`)) {
                            store.getState().removeNotebook(nb.id)
                          }
                        }}>
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex flex-col p-3">
                  <span className="line-clamp-2 text-[0.9375rem] font-bold tracking-tight">{nb.name}</span>
                  <span className="mt-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    {pages} page{pages === 1 ? '' : 's'}
                  </span>
                </div>
              </fm.div>
            )
          })}
          <fm.div
            whileTap={{ scale: 0.95 }}
            className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-[24px] border-2 border-dashed border-border/60 bg-muted/20 p-4 text-muted-foreground"
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
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}
