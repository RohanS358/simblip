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
  FileText,
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
import { useWorkspaceStore } from '@/lib/store/workspace'
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
import { InfiniteCanvas } from './canvas'
import { AiPanel } from './ai-panel'
import { NotificationCenter } from './notifications'
import { SettingsDialog } from './settings-dialog'
import { SyncStatus } from './sync-status'
import { TutorialPanel } from './tutorial'
import { UndoRedo } from './undo-redo'
import { Calculator } from './calculator'
import { clonePageDoc } from '@/lib/store/import-page'
import { FileObject } from '../objects/file-view'
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
  const splitScreenDocumentId = useWorkspaceStore((s) => s.splitScreenDocumentId)
  const splitScreenObject = useDocStore((s) => activePageId && splitScreenDocumentId ? s.pages[activePageId]?.[splitScreenDocumentId] : null)

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

  const appMenu = (
    <button type="button" aria-label="Menu" className="rounded-lg p-2 text-muted-foreground hover:bg-accent" onClick={() => setDrawerOpen(true)}>
      <Menu className="h-5 w-5" />
    </button>
  )

  // ── Editor ────────────────────────────────────────────────────────────────
  if (view.kind === 'editor' && activePageId) {
    return (
      <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
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
          <UndoRedo pageId={activePageId} />
          {appMenu}
        </header>

        <main className="relative min-h-0 flex-1 flex flex-col">
          {splitScreenObject && (
            <div className="flex w-full h-1/2 flex-col border-b border-border bg-muted/30 p-2 relative z-10">
              <FileObject object={splitScreenObject} pageId={activePageId!} />
            </div>
          )}
          <div className="relative flex-1 min-h-0">
            <InfiniteCanvas key={activePageId} pageId={activePageId} />
          </div>
          <Transport pageId={activePageId} />
          <Toolbar
            calcOpen={calcOpen}
            onToggleCalc={() => setCalcOpen((o) => !o)}
            paletteOpen={paletteOpen}
            onTogglePalette={() => setPaletteOpen((o) => !o)}
            showAi={aiAllowed}
            pageId={activePageId}
          />
          <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
          {calcOpen && <Calculator onClose={() => setCalcOpen(false)} />}
          {aiAllowed && <AiPanel pageId={activePageId} />}
        </main>

        {/* Editing on a small screen: lift the object out of the canvas and dim
            the board, so you can see what your edits are doing to it. The panel
            then comes in from the bottom (phone) or the side (tablet). */}
        {activePageId && (
          <FocusObject
            pageId={activePageId}
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
                  ? 'fixed inset-x-0 bottom-0 z-[60] flex max-h-[62dvh] flex-col rounded-t-2xl border-t border-border bg-background shadow-2xl'
                  : 'fixed bottom-0 right-0 top-0 z-[60] flex w-[22rem] max-w-[85vw] flex-col border-l border-border bg-background shadow-2xl'
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
                <Inspector pageId={activePageId} />
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
                  <button
                    type="button"
                    aria-label={`New page in ${sec.name}`}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
                    onClick={() => openPage(store.getState().addPage(notebook.id, sec.id))}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {sec.pages.length === 0 ? (
                <div className="flex min-h-[100px] items-center justify-center rounded-3xl border border-dashed border-border/60 text-[12px] text-muted-foreground">
                  No pages yet.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {sec.pages.map((page) => (
                    <fm.div
                      key={page.id}
                      whileTap={{ scale: 0.95 }}
                      className="group relative flex aspect-[4/5] flex-col justify-between rounded-3xl border border-border/40 bg-card p-4 shadow-sm"
                      onClick={() => openPage(page.id)}
                    >
                      <div className="flex w-full items-start justify-between">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
                          <FileText className="h-5 w-5" />
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              aria-label={`Actions for ${page.name}`}
                              className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
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
                      </div>
                      <span className="mt-4 line-clamp-3 text-[14px] font-bold leading-tight tracking-tight">{page.name}</span>
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

  // ── Drawer ────────────────────────────────────────────────────────────────
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
              <button 
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold transition-colors', view.kind === 'home' || view.kind === 'notebook' ? 'bg-[color-mix(in_oklch,var(--accent-blue)_15%,transparent)] text-[var(--accent-blue)]' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}
                onClick={() => { setView({ kind: 'home' }); setDrawerOpen(false) }}
              >
                <BookOpen className="h-4 w-4" /> My Notebooks
              </button>
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Share2 className="h-4 w-4" /> Shared with me
              </button>
              <button 
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" 
                onClick={() => { router.push('/assignments'); setDrawerOpen(false) }}
              >
                <ClipboardList className="h-4 w-4" /> Assignments
              </button>
              {staff && (
                <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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
          {notebooks.map((nb) => {
            const pages = nb.sections.reduce((n, s) => n + s.pages.length, 0)
            return (
              <fm.div
                key={nb.id}
                whileTap={{ scale: 0.95 }}
                className="relative flex flex-col items-start gap-3 rounded-[24px] rounded-tl-lg border border-border/60 bg-gradient-to-br from-card to-card/50 p-4 shadow-sm"
                onClick={() => setView({ kind: 'notebook', id: nb.id })}
              >
                <div className="absolute -top-[11px] left-0 h-4 w-1/3 rounded-t-lg border-x border-t border-border/60 bg-card" />
                <div className="flex w-full items-center justify-between z-10">
                  <span className="text-[28px] leading-none drop-shadow-md">{nb.emoji || <BookOpen className="h-6 w-6" />}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <MoreVertical className="h-5 w-5" />
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
                <div className="mt-1 flex flex-col z-10">
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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}
