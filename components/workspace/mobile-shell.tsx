'use client'

// Mobile workspace — a Notes-style app, not a shrunken desktop. Navigation
// instead of panels: Home (notebook cards + assignments) → notebook (section
// & page list) → editor (full-bleed canvas, no sidebar, properties as a
// bottom sheet, the top-right actions collapsed into one menu).

import { useState } from 'react'
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
import { clonePageDoc } from '@/lib/store/import-page'
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
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [shareFor, setShareFor] = useState<PageRef | null>(null)
  const [assignFor, setAssignFor] = useState<PageRef | null>(null)
  const [presentFor, setPresentFor] = useState<PageRef | null>(null)
  const [publishFor, setPublishFor] = useState<PageRef | null>(null)

  const profile = useAuthStore((s) => s.profile)
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Menu" className="rounded-lg p-2 text-muted-foreground hover:bg-accent">
          <Menu className="h-4.5 w-4.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {view.kind === 'editor' && (
          <>
            <DropdownMenuItem onClick={() => store.getState().togglePanel('inspector')}>
              <SlidersHorizontal className="h-4 w-4" /> Properties & variables
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => router.push('/assignments')}>
          <ClipboardList className="h-4 w-4" /> Assignments
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTutorialOpen(true)}>
          <GraduationCap className="h-4 w-4" /> Tutorials
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} Theme
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => useAuthStore.getState().logout()}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{pageName}</span>
          <SyncStatus />
          <NotificationCenter />
          {appMenu}
        </header>

        <main className="relative min-h-0 flex-1">
          <InfiniteCanvas key={activePageId} pageId={activePageId} />
          <Transport pageId={activePageId} />
          <Toolbar
            paletteOpen={paletteOpen}
            onTogglePalette={() => setPaletteOpen((o) => !o)}
            showAi={aiAllowed}
            pageId={activePageId}
          />
          <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
              <div className="flex items-center justify-between px-4 py-2">
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
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
          {notebook.sections.map((sec) => (
            <div key={sec.id} className="mb-4">
              <div className="mb-1 flex items-center gap-2 px-1">
                <span className={cn('h-2 w-2 rounded-full', SECTION_DOT[sec.color] ?? SECTION_DOT.blue)} />
                <span className="flex-1 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                  {sec.name}
                </span>
                <button
                  type="button"
                  aria-label={`New page in ${sec.name}`}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                  onClick={() => openPage(store.getState().addPage(notebook.id, sec.id))}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-border/60">
                {sec.pages.length === 0 && (
                  <p className="px-4 py-3 text-[12.5px] text-muted-foreground">No pages yet.</p>
                )}
                {sec.pages.map((page) => (
                  <div
                    key={page.id}
                    className="flex w-full items-center gap-1 border-b border-border/40 bg-card pr-1 last:border-0"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-accent"
                      onClick={() => openPage(page.id)}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{page.name}</span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${page.name}`}
                          className="rounded-lg p-2 text-muted-foreground active:bg-accent"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => openPage(page.id)}>
                          <BookOpen className="h-4 w-4" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            const name = window.prompt('Rename page', page.name)
                            if (name?.trim()) store.getState().renamePage(page.id, name.trim())
                          }}
                        >
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => duplicatePage(notebook.id, sec.id, page)}>
                          <Copy className="h-4 w-4" /> Duplicate
                        </DropdownMenuItem>
                        {staff && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setShareFor(page)}>
                              <Share2 className="h-4 w-4" /> Share copy…
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAssignFor(page)}>
                              <ClipboardList className="h-4 w-4" /> Assign…
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPresentFor(page)}>
                              <MonitorPlay className="h-4 w-4" /> Present on room board…
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setPublishFor(page)}>
                              <LibraryBig className="h-4 w-4" /> Add to library…
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => exportPageJson(page)}>
                          <Download className="h-4 w-4" /> Export JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => store.getState().removePage(page.id)}
                        >
                          <Trash2 className="h-4 w-4" /> Delete page
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            className="w-full rounded-2xl border border-dashed border-border px-4 py-3 text-[13px] font-medium text-muted-foreground active:bg-accent"
            onClick={() => store.getState().addSection(notebook.id)}
          >
            <Plus className="mr-1 inline h-4 w-4" /> New section
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
      <header className="flex h-12 shrink-0 items-center gap-1 px-4">
        <span className="flex-1 text-[15px] font-extrabold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <SyncStatus />
        <NotificationCenter />
        {appMenu}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        {profile && (
          <p className="pb-3 pt-1 text-[13px] text-muted-foreground">
            Hi {profile.full_name.split(' ')[0]} — pick a notebook.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="glass flex flex-col items-start gap-2 rounded-2xl p-4 text-left active:bg-accent"
            onClick={() => router.push('/assignments')}
          >
            <ClipboardList className="h-5 w-5 text-[var(--accent-violet)]" />
            <span className="text-[13.5px] font-bold">Assignments</span>
            <span className="text-[11px] text-muted-foreground">Work due & submissions</span>
          </button>
          {notebooks.map((nb) => {
            const pages = nb.sections.reduce((n, s) => n + s.pages.length, 0)
            return (
              <button
                key={nb.id}
                type="button"
                className="glass flex flex-col items-start gap-2 rounded-2xl p-4 text-left active:bg-accent"
                onClick={() => setView({ kind: 'notebook', id: nb.id })}
              >
                <span className="text-[20px] leading-none">{nb.emoji || <BookOpen className="h-5 w-5" />}</span>
                <span className="line-clamp-2 text-[13.5px] font-bold">{nb.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {pages} page{pages === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border p-4 text-muted-foreground active:bg-accent"
            onClick={() => {
              const id = store.getState().addNotebook()
              const sec = store.getState().addSection(id, 'Section 1')
              store.getState().addPage(id, sec, 'Page 1')
              store.getState().setActivePage(null)
              setView({ kind: 'notebook', id })
            }}
          >
            <Plus className="h-5 w-5" />
            <span className="text-[12px] font-medium">New notebook</span>
          </button>
        </div>
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}
