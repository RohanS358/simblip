'use client'

// Mobile workspace — a Notes-style app, not a shrunken desktop. Navigation
// instead of panels: Home (notebook cards + assignments) → notebook (section
// & page list) → editor (full-bleed canvas, no sidebar, properties as a
// bottom sheet, the top-right actions collapsed into one menu).

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  GraduationCap,
  LibraryBig,
  LogOut,
  Menu,
  MonitorPlay,
  MoreVertical,
  Moon,
  Pencil,
  Plus,
  Settings,
  Share2,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useLazyActivePage } from '@/lib/store/use-active-page'
import { useDocStore } from '@/lib/store/document'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { useShareInbox } from '@/hooks/use-share-inbox'
import { Toolbar } from './toolbar'
import { Transport } from './transport'
import { Palette } from './palette'
import { Inspector } from './inspector'
import { FocusObject } from './focus-object'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useIsNarrow } from '@/hooks/use-mobile'
import { usePrefs } from '@/lib/store/preferences'
import { PageView } from './page-view'
import { TabsBar } from './tabs-bar'
import { AiPanel } from './ai-panel'
import { NotificationCenter } from './notifications'
import { SettingsDialog } from './settings-dialog'
import { SyncStatus } from './sync-status'
import { TutorialPanel } from './tutorial'
import { UndoRedo } from './undo-redo'
import { Calculator } from './calculator'
import { clonePageDoc } from '@/lib/store/import-page'
import { FileObject } from '../objects/file-view'
import { PageThumbnail } from './page-thumbnail'
import {
  AssignDialog,
  PresentDialog,
  ShareDialog,
  exportPageJson,
  type PageRef,
} from './page-actions'
import { PublishDialog } from './library-panel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type View = { kind: 'home' } | { kind: 'notebook'; id: string } | { kind: 'editor' }

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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [coverFor, setCoverFor] = useState<string | null>(null)
  const [navExpanded, setNavExpanded] = useState<Record<string, boolean>>({})

  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const notebooks = useWorkspaceStore((s) => s.notebooks)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  // Only the open page stays in memory — see lib/store/use-active-page.ts
  useLazyActivePage(activePageId)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorOpen)
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
  const activeKind = useWorkspaceStore(
    (s) => findPageMeta(s.notebooks, s.activePageId)?.kind ?? 'board'
  )
  // Docs: the tools act on the focused sheet; boards act on themselves.
  const contentPageId = activeKind === 'doc' ? (activeSheetId ?? activePageId) : activePageId
  const splitScreenObject = useDocStore((s) =>
    contentPageId && splitScreenDocumentId
      ? s.pages[contentPageId]?.objects?.[splitScreenDocumentId] ?? null
      : null
  )

  useShareInbox()

  const aiAllowed = can(profile?.role, 'use-ai')
  const notebook = view.kind === 'notebook' ? notebooks.find((n) => n.id === view.id) : null
  const pageName = (() => {
    for (const nb of notebooks)
      for (const sec of nb.sections)
        for (const p of sec.pages) if (p.id === activePageId) return p.name
    return 'Page'
  })()

  const openPage = (pageId: string) => {
    store.getState().setActivePage(pageId)
    setView({ kind: 'editor' })
  }

  const staff = can(profile?.role, 'share-pages')

  const duplicatePage = (nbId: string, secId: string, page: PageRef) => {
    const newId = store.getState().addPage(nbId, secId, `${page.name} copy`)
    const content = useDocStore.getState().pages[page.id]
    if (content)
      useDocStore.setState((s) => ({ pages: { ...s.pages, [newId]: clonePageDoc(content) } }))
    useDocStore.getState().ensurePage(newId)
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
    </>
  )

  // The drawer is declared here so it can be embedded in EVERY view.
  // (It must be inside AnimatePresence and mounted wherever the header is.)
  const appMenu = (
    <button type="button" aria-label="Menu" className="rounded-lg p-2 text-muted-foreground hover:bg-accent" onClick={() => setDrawerOpen(true)}>
      <Menu className="h-5 w-5" />
    </button>
  )

  const drawer = (
    <AnimatePresence>
      {drawerOpen && (
        <>
          <fm.div
            className="fixed inset-0 z-[70] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawerOpen(false)}
          />
          <fm.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-y-0 left-0 z-[80] w-[80vw] max-w-[320px] flex flex-col border-r border-border bg-card shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-border/40 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-lg font-bold text-white shadow-sm">
                {profile?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-bold text-foreground">{profile?.full_name || 'User'}</span>
                <span className="truncate text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{profile?.role || 'Student'}</span>
              </div>
              <button
                type="button"
                className="rounded-full p-2 text-muted-foreground hover:bg-accent"
                onClick={() => setDrawerOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-2 mt-1">Workspace</div>
              <div className="flex w-full items-center gap-1">
                <button
                  className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold transition-colors', view.kind === 'home' || view.kind === 'notebook' ? 'bg-[color-mix(in_oklch,var(--accent-blue)_15%,transparent)] text-[var(--accent-blue)]' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
                  onClick={() => { setView({ kind: 'home' }); setDrawerOpen(false) }}
                >
                  <BookOpen className="h-4 w-4" /> My Notebooks
                </button>
                <button
                  type="button"
                  aria-label={navExpanded.__root ? 'Collapse notebooks' : 'Expand notebooks'}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                  onClick={() => setNavExpanded((x) => ({ ...x, __root: !x.__root }))}
                >
                  <ChevronRight className={cn('h-4 w-4 transition-transform', navExpanded.__root && 'rotate-90')} />
                </button>
              </div>
              {/* The same notebook → section → page tree the desktop sidebar has. */}
              {navExpanded.__root && notebooks.filter((n) => n.name !== SHARED_NB).map((nb) => (
                <div key={nb.id} className="ml-2">
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setNavExpanded((x) => ({ ...x, [nb.id]: !x[nb.id] }))}
                  >
                    <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', navExpanded[nb.id] && 'rotate-90')} />
                    <span className="truncate">{nb.name}</span>
                  </button>
                  {navExpanded[nb.id] &&
                    nb.sections.map((sec) => (
                      <div key={sec.id} className="ml-5">
                        <div className="flex items-center gap-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60">
                          <span className={cn('h-1.5 w-1.5 rounded-full', SECTION_DOT[sec.color] ?? SECTION_DOT.blue)} />
                          {sec.name}
                        </div>
                        {sec.pages.map((p) => (
                          <button
                            key={p.id}
                            className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px]', activePageId === p.id ? 'bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
                            onClick={() => { openPage(p.id); setDrawerOpen(false) }}
                          >
                            <span className="truncate">{p.name}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
              ))}
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => {
                  // Open (or create) the notebook where shared copies land.
                  const ws = store.getState()
                  const nb = ws.notebooks.find((n) => n.name === SHARED_NB)
                  const id = nb?.id ?? ws.addNotebook(SHARED_NB)
                  setView({ kind: 'notebook', id })
                  setDrawerOpen(false)
                }}
              >
                <Share2 className="h-4 w-4" /> Shared with me
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => { router.push('/assignments'); setDrawerOpen(false) }}
              >
                <ClipboardList className="h-4 w-4" /> Assignments
              </button>
              {staff && (
                <button
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => { router.push('/assignments'); setDrawerOpen(false) }}
                >
                  <GraduationCap className="h-4 w-4" /> Review
                </button>
              )}

              <div className="mt-6 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">App</div>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => { setTutorialOpen(true); setDrawerOpen(false) }}
              >
                <MonitorPlay className="h-4 w-4" /> Tutorials
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              >
                {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} Theme
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => { setSettingsOpen(true); setDrawerOpen(false) }}
              >
                <Settings className="h-4 w-4" /> Settings
              </button>
            </div>
            <div className="border-t border-border/40 p-4">
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-destructive transition-colors hover:bg-destructive/10"
                onClick={() => useAuthStore.getState().logout()}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </fm.div>
        </>
      )}
    </AnimatePresence>
  )

  // ── Editor ────────────────────────────────────────────────────────────────
  if (view.kind === 'editor' && activePageId) {
    return (
      <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
        {drawer}
        <header className="z-40 flex h-12 shrink-0 items-center gap-1 border-b border-border/40 bg-background px-2">
          <button
            type="button"
            aria-label="Back"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
            onClick={() => setView({ kind: 'home' })}
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
          <span className="text-[14px] font-extrabold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{pageName}</span>
          <SyncStatus />
          <NotificationCenter />
          <UndoRedo pageId={contentPageId ?? activePageId} />
          {appMenu}
        </header>

        {/* Same tab strip as desktop — open pages, ×, split toggle. */}
        <div className="flex h-9 shrink-0 items-center border-b border-border/40 bg-background px-1">
          <TabsBar />
        </div>

        <main className={cn('relative min-h-0 flex-1 flex', isPhone ? 'flex-col' : 'flex-row')}>
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
                <div className="relative flex-1 min-h-0">
                  <PageView pageId={leftId} />
                </div>
              )
            }
            return (
              <div className={cn('relative flex min-h-0 flex-1', isPhone ? 'flex-col' : 'flex-row')}>
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
          {activeKind !== 'pdf' && contentPageId && (
            <>
              <Transport pageId={contentPageId} />
              <Toolbar
                calcOpen={calcOpen}
                onToggleCalc={() => setCalcOpen((o) => !o)}
                paletteOpen={paletteOpen}
                onTogglePalette={() => setPaletteOpen((o) => !o)}
                showAi={aiAllowed}
                pageId={contentPageId}
              />
              <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
            </>
          )}
          {calcOpen && <Calculator onClose={() => setCalcOpen(false)} />}
          {aiAllowed && contentPageId && <AiPanel pageId={contentPageId} />}
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
                <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
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
              <div className="min-h-0 flex-1 overflow-y-auto [&>aside]:!m-0 [&>aside]:!w-full [&>aside]:!rounded-none [&>aside]:!bg-transparent [&>aside]:!shadow-none [&>aside]:!backdrop-blur-none">
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

  // ── Notebook (sections & pages) ───────────────────────────────────────────
  if (view.kind === 'notebook' && notebook) {
    return (
      <div className="flex h-dvh flex-col bg-background">
        {drawer}
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/40 px-2">
          <button
            type="button"
            aria-label="Back"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
            onClick={() => setView({ kind: 'home' })}
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {notebook.emoji} {notebook.name}
          </span>
          {appMenu}
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
          {notebook.sections.map((sec) => (
            <div key={sec.id} className="mb-6">
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', SECTION_DOT[sec.color] ?? SECTION_DOT.blue)} />
                  <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                    {sec.name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Rename ${sec.name}`}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
                    onClick={() => {
                      const name = window.prompt('Rename section', sec.name)
                      if (name?.trim()) store.getState().renameSection(notebook.id, sec.id, name.trim())
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`New page in ${sec.name}`}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-xl">
                      <DropdownMenuItem onClick={() => openPage(store.getState().addPage(notebook.id, sec.id))}>
                        <Plus className="h-4 w-4" /> New board
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openPage(store.getState().addPage(notebook.id, sec.id, 'Untitled Doc', 'doc'))}>
                        <Plus className="h-4 w-4" /> New document
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openPage(store.getState().addPage(notebook.id, sec.id, 'Untitled PDF', 'pdf'))}>
                        <Plus className="h-4 w-4" /> New PDF / PPT page
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              
              {sec.pages.length === 0 ? (
                <div className="flex min-h-[100px] items-center justify-center rounded-3xl border border-dashed border-border/60 text-[12px] text-muted-foreground">
                  No pages yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
                  {sec.pages.map((page) => (
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
                                  if (name?.trim()) store.getState().renamePage(page.id, name.trim())
                                }}
                              >
                                <Pencil className="h-4 w-4" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation()
                                duplicatePage(notebook.id, sec.id, page)
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
                                    store.getState().removePage(page.id)
                                  }
                                }}
                              >
                                <Trash2 className="h-4 w-4" /> Delete page
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </button>
                      </div>
                      <span className="mt-2 line-clamp-2 px-0.5 text-[12px] font-bold leading-tight tracking-tight">{page.name}</span>
                    </fm.div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 px-4 py-4 text-[13px] font-bold text-muted-foreground active:bg-accent"
            onClick={() => store.getState().addSection(notebook.id)}
          >
            <Plus className="h-4 w-4" /> New section
          </button>
        </main>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        {pageDialogs}
        {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
      </div>
    )
  }

  // ── Home ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-dvh flex-col bg-background">
      {drawer}
      <header className="flex h-12 shrink-0 items-center gap-1 px-4">
        {appMenu}
        <div className="flex-1" />
        <span className="text-[15px] font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <div className="flex-1 flex justify-end">
          <SyncStatus />
          <NotificationCenter />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {profile && (
          <div className="pb-6 pt-2">
            <h1 className="text-[28px] font-black tracking-tight leading-none text-foreground drop-shadow-sm">
              Hello, {profile.full_name.split(' ')[0]}
            </h1>
            <p className="mt-1.5 text-[14px] font-medium text-muted-foreground">Pick a notebook to start creating.</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          {notebooks.filter((nb) => nb.name !== SHARED_NB).map((nb) => {
            const pages = nb.sections.reduce((n, s) => n + s.pages.length, 0)
            return (
              <fm.div
                key={nb.id}
                whileTap={{ scale: 0.95 }}
                className="relative flex flex-col overflow-hidden rounded-[20px] border border-border/60 bg-card shadow-sm"
                onClick={() => setView({ kind: 'notebook', id: nb.id })}
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
                  <span className="line-clamp-2 text-[15px] font-bold tracking-tight">{nb.name}</span>
                  <span className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
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
              const sec = store.getState().addSection(id, 'Section 1')
              store.getState().addPage(id, sec, 'Page 1')
              store.getState().setActivePage(null)
              setView({ kind: 'notebook', id })
            }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-foreground">
              <Plus className="h-5 w-5" />
            </div>
            <span className="text-[13px] font-bold">New notebook</span>
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
                <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
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
                className="mt-3 w-full rounded-xl border border-dashed border-border/60 py-2 text-[13px] font-medium text-muted-foreground active:bg-accent"
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}
