'use client'

// The workspace shell — a desktop-style environment: top bar with global
// search and identity, notebook tree, infinite canvas, inspector, library
// panel, notification center and a status bar. The notebook is the medium;
// the simulation engine is the product — the transport sits front and center.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { GraduationCap, Search, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { isDarkTheme } from '@/components/theme-provider'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useLazyActivePage } from '@/lib/store/use-active-page'
import { usePrefs } from '@/lib/store/preferences'
import { useDocStore } from '@/lib/store/document'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import { useShareInbox } from '@/hooks/use-share-inbox'
import { useIsMobile } from '@/hooks/use-mobile'
import { stop } from '@/lib/physics/world'
import { Sidebar } from './sidebar'
import { Dock } from './dock'
import { useSidebarSection, openProperties } from '@/lib/store/sidebar-sections'
import { CanvasControls } from './canvas-controls'
import { PageView } from './page-view'
import { TabsBar } from './tabs-bar'
import { SyncStatus } from './sync-status'
import { MobileShell } from './mobile-shell'
import { CommandPalette } from './command-palette'
import { Calculator } from './calculator'
import { UndoRedo } from './undo-redo'
import { NotificationCenter } from './notifications'
import { ProfileMenu } from './profile-menu'
import { SettingsDialog } from './settings-dialog'
import { TutorialPanel } from './tutorial'
import { createGeometry, componentById } from '@/lib/scene/factory'
import { str, num } from '@/lib/scene/types'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { FileObject } from '@/components/objects/file-view'

function seedFirstRun() {
  const ws = useWorkspaceStore.getState()
  if (ws.notebooks.length > 0) return
  const nbId = ws.addNotebook('My Notebook')
  const secId = ws.addSection(nbId, 'Physics')
  const pageId = ws.addPage(nbId, secId, 'Welcome')

  const doc = useDocStore.getState()
  doc.ensurePage(pageId)
  doc.addVariable(pageId, 'g', '9.81')
  doc.addVariable(pageId, 'k', '30')

  const note = createGeometry('note', { x: 40, y: 60 })
  note.size = { w: 280, h: 190 }
  note.parameters.text = str(
    'Welcome to SIMBLIP 👋\n\nEverything here is a drawing with behaviors attached. Press ▶ Play — the spring–mass system starts moving.\n\nTry it yourself: draw a circle with the pen, then add a "Rigid Body" behavior in the Inspector. Press Play again.'
  )
  note.metadata.color = 'amber'
  doc.addObject(pageId, note, { history: false })

  // Hanging spring–mass, assembled from primitives like a user would.
  const spring = componentById('spring')!.create({ x: 0, y: 0 })
  spring.name = 'Spring'
  spring.position = { x: 494, y: 80 }
  spring.geometry.points = [
    [0, 0],
    [0, 150],
  ]
  spring.size = { w: 2, h: 150 }
  const sb = spring.behaviors.find((b) => b.type === 'spring')
  if (sb) sb.params.k = num('k')
  doc.addObject(pageId, spring, { history: false })

  const mass = componentById('mass')!.create({ x: 0, y: 0 })
  mass.name = 'Mass'
  mass.position = { x: 460, y: 195 } // center (495, 230) touches the spring end
  doc.addObject(pageId, mass, { history: false })

  const ground = componentById('ground')!.create({ x: 0, y: 0 })
  ground.position = { x: 300, y: 480 }
  doc.addObject(pageId, ground, { history: false })

  const graph = createGeometry('graph', { x: 640, y: 120 })
  graph.size = { w: 420, h: 300 }
  graph.parameters.sourceId = str(mass.id)
  graph.parameters.yChannels = str('y,vy')
  doc.addObject(pageId, graph, { history: false })

  ws.setActivePage(pageId)
}

export function WorkspaceShell() {
  // Stores hydrate from localStorage on the client; gate rendering to avoid
  // a server/client markup mismatch.
  const [ready, setReady] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const isMobile = useIsMobile()

  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  // Only the open page stays in memory — see lib/store/use-active-page.ts
  useLazyActivePage(activePageId)
  // Interface UI scale rides on the root font size: everything is sized in
  // rem-derived Tailwind units, so panels, docks and the inspector all follow
  // — while the CANVAS keeps its own zoom, and Components UI scales objects
  // separately (see ObjectView / Calculator).
  const uiScale = usePrefs((s) => s.notebook.uiScale)
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale * 100}%`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [uiScale])
  // The accent tint is applied globally by ThemeProvider (AccentApplier) —
  // it must also cover the mobile shell, boards and the presenter.
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)
  const sidebarSection = useSidebarSection((s) => s.section)
  const calcOpen = useWorkspaceStore((s) => s.calcOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const splitScreenDocumentId = useWorkspaceStore((s) => s.splitScreenDocumentId)
  const syncScroll = useWorkspaceStore((s) => s.syncScroll)
  const splitPageId = useWorkspaceStore((s) => s.splitPageId)
  const primaryPageId = useWorkspaceStore((s) => s.primaryPageId)
  const splitRatio = useWorkspaceStore((s) => s.splitRatio)
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const pdfToolsActive = useWorkspaceStore((s) => s.pdfToolsActive)
  const activeKind = useWorkspaceStore(
    (s) => findPageMeta(s.notebooks, s.activePageId)?.kind ?? 'board'
  )
  // What the toolbar/transport/inspector actually operate on: boards act on
  // themselves, docs act on the focused SHEET, and PDF readers draw with the
  // real board dock too — targeting whichever page/notes canvas is focused.
  const pdfToolsOn = activeKind === 'pdf' && pdfToolsActive
  const contentPageId =
    activeKind === 'doc' || pdfToolsOn ? (activeSheetId ?? activePageId) : activePageId
  // Width of the legacy in-board document split pane (item: resizable).
  const [docSplitW, setDocSplitW] = useState(0.5)
  const [tabDropSide, setTabDropSide] = useState<'left' | 'right' | null>(null)

  const activePageObjects = useDocStore((s) => contentPageId ? s.pages[contentPageId]?.objects : null)
  const splitScreenObject = splitScreenDocumentId && activePageObjects ? activePageObjects[splitScreenDocumentId] : null

  useEffect(() => {
    if (!syncScroll || !contentPageId) return
    // 1:1 linked scrolling: a pixel of PDF scroll moves the canvas a pixel on
    // screen, whatever the zoom — the two columns track each other exactly.
    let lastTop: number | null = null
    const onPdfScroll = (e: Event) => {
      const { scrollTop } = (e as CustomEvent).detail as { scrollTop: number }
      if (lastTop === null) {
        lastTop = scrollTop
        return
      }
      const dy = scrollTop - lastTop
      lastTop = scrollTop
      const s = useDocStore.getState()
      const box = s.viewports[contentPageId] || { x: 0, y: 0, zoom: 1 }
      s.setViewport(contentPageId, { ...box, y: box.y - dy })
    }
    window.addEventListener('simblip-pdf-scroll', onPdfScroll)
    return () => window.removeEventListener('simblip-pdf-scroll', onPdfScroll)
  }, [syncScroll, contentPageId])
  const objectCount = useDocStore((s) =>
    contentPageId ? Object.keys(s.pages[contentPageId]?.objects ?? {}).length : 0
  )

  // Incoming shared pages auto-deliver into "Shared with me".
  useShareInbox()

  useEffect(() => {
    seedFirstRun()
    // Small screens: the canvas is the workspace — panels open on demand.
    if (window.matchMedia('(max-width: 767px)').matches)
      useWorkspaceStore.setState({ sidebarOpen: false, inspectorOpen: false })
    setReady(true)
  }, [])

  // Picking a page on a phone should reveal the canvas, not leave the
  // full-screen sidebar covering it.
  useEffect(() => {
    if (isMobile && activePageId) useWorkspaceStore.setState({ sidebarOpen: false })
  }, [isMobile, activePageId])

  // Page switch tears down any running world — simulations are per page.
  useEffect(() => {
    stop()
  }, [activePageId])

  // Global command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <span className="text-[13px] tracking-wide text-muted-foreground">SIMBLIP</span>
      </div>
    )
  }

  // Phones get a Notes-style navigation app, not a shrunken desktop.
  if (isMobile) return <MobileShell />

  // One docked panel system: the left rail (branding + navigation + every
  // section, Properties included — the right Inspector dock retired when
  // Properties joined the rail). sidebarOpen only controls whether the
  // content PANE is expanded, handled inside Sidebar itself.
  const leftDock = <Dock side="left" panels={['pages']} render={() => <Sidebar />} />

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-40 flex h-12 shrink-0 items-center gap-2 px-4 border-b border-border/40 bg-background">
        
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
        {institution && (
          <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
            · {institution.name}
          </span>
        )}
        <span className="hidden text-muted-foreground/50 sm:inline">/</span>
        {/* open pages ride in the header as tabs — boards, docs and PDFs side by side */}
        <TabsBar
          pageId={contentPageId}
          showTransport={!!activePageId && (activeKind !== 'pdf' || pdfToolsOn)}
        />
        <div className="relative z-10 flex shrink-0 items-center gap-2 bg-background pl-2  dark:">
          <button
            type="button"
            aria-label="Search (Ctrl+K)"
            className="hidden items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
            Search
            <Kbd className="text-[10px]">⌘K</Kbd>
          </button>
          <button
            type="button"
            aria-label="Search"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="h-4 w-4" />
          </button>
          {contentPageId && <UndoRedo pageId={contentPageId} />}
          <SyncStatus />
          <NotificationCenter />
          <button
            type="button"
            aria-label="Tutorials"
            className={cn(
              'rounded-lg p-1.5 transition-colors hover:bg-accent',
              tutorialOpen ? 'text-foreground' : 'text-muted-foreground'
            )}
            onClick={() => setTutorialOpen((o) => !o)}
          >
            <GraduationCap className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Toggle theme"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setTheme(isDarkTheme(resolvedTheme) ? 'light' : 'dark')}
          >
            {isDarkTheme(resolvedTheme) ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          
          <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {leftDock}

        {splitScreenObject && (
          <>
            <div
              className="flex min-w-0 flex-col bg-muted/30 p-2"
              style={{ width: `${docSplitW * 100}%` }}
            >
              <FileObject object={splitScreenObject} pageId={contentPageId!} />
            </div>
            {/* resizable seam for the in-board document split */}
            <div
              role="separator"
              aria-label="Resize document pane"
              className="w-1.5 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-[var(--accent-blue)]/50"
              onPointerDown={(e) => {
                e.preventDefault()
                const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                const move = (ev: PointerEvent) =>
                  setDocSplitW(Math.min(0.75, Math.max(0.25, (ev.clientX - host.left) / host.width)))
                const up = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            />
          </>
        )}

        <main
          className="relative min-w-0 flex-1"
          // Snap assist: while a tab is dragged over the canvas, glow the half
          // it would land in; dropping splits (right) or fills the left pane.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-simblip-tab')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const r = e.currentTarget.getBoundingClientRect()
            setTabDropSide(e.clientX < r.left + r.width / 2 ? 'left' : 'right')
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setTabDropSide(null)
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-simblip-tab')
            setTabDropSide(null)
            if (!id) return
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            useWorkspaceStore.getState().dropTab(id, e.clientX < r.left + r.width / 2 ? 'left' : 'right')
          }}
        >
          {tabDropSide && (
            <div
              className={cn(
                'pointer-events-none absolute inset-y-2 z-50 w-1/2 rounded-2xl border-2 border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10',
                tabDropSide === 'left' ? 'left-2' : 'right-2'
              )}
            />
          )}
          {activePageId ? (
            <>
              {(() => {
                const leftId = splitPageId ? (primaryPageId ?? activePageId) : activePageId
                const rightId = splitPageId && splitPageId !== leftId ? splitPageId : null
                const setActive = useWorkspaceStore.getState().setActivePage
                if (!rightId) return <PageView pageId={leftId} />
                return (
                  <div className="flex h-full w-full">
                    <div
                      className={cn(
                        'relative min-w-0',
                        activePageId === leftId && 'ring-1 ring-inset ring-[var(--accent-blue)]/25'
                      )}
                      style={{ width: `${splitRatio * 100}%` }}
                      onPointerDownCapture={() => activePageId !== leftId && setActive(leftId)}
                    >
                      <PageView pageId={leftId} />
                    </div>
                    <div
                      role="separator"
                      aria-label="Resize split"
                      className="w-1.5 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-[var(--accent-blue)]/50"
                      onPointerDown={(e) => {
                        e.preventDefault()
                        const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                        const move = (ev: PointerEvent) =>
                          useWorkspaceStore.getState().setSplitRatio((ev.clientX - host.left) / host.width)
                        const up = () => {
                          window.removeEventListener('pointermove', move)
                          window.removeEventListener('pointerup', up)
                        }
                        window.addEventListener('pointermove', move)
                        window.addEventListener('pointerup', up)
                      }}
                    />
                    <div
                      className={cn(
                        'relative min-w-0 flex-1',
                        activePageId === rightId && 'ring-1 ring-inset ring-[var(--accent-blue)]/25'
                      )}
                      onPointerDownCapture={() => activePageId !== rightId && setActive(rightId)}
                    >
                      <PageView pageId={rightId} />
                    </div>
                  </div>
                )
              })()}
              {(activeKind !== 'pdf' || pdfToolsOn) && contentPageId && (
                <CanvasControls pageId={contentPageId} showTransport={false} />
              )}
              {calcOpen && <Calculator onClose={() => togglePanel('calc')} />}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[15px] font-semibold">No page open</p>
              <p className="max-w-64 text-[12.5px] leading-relaxed text-muted-foreground">
                Pick a page in the sidebar, or create a notebook to start a new workspace.
              </p>
            </div>
          )}
        </main>
      </div>

      <footer className="z-40 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-[10.5px] text-muted-foreground">
        {profile && (
          <span className="font-medium">
            {profile.full_name} · {ROLE_LABEL[profile.role]}
          </span>
        )}
        {institution && <span className="hidden sm:inline">{institution.name}</span>}
        <div className="flex-1" />
        {activePageId && <span>{objectCount} objects</span>}
        <span>SIMBLIP · Built by Rohan Singh</span>
      </footer>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {tutorialOpen && <TutorialPanel pageId={activePageId} onClose={() => setTutorialOpen(false)} />}
    </div>
  )
}
