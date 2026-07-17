'use client'

// The workspace shell — a desktop-style environment: top bar with global
// search and identity, notebook tree, infinite canvas, inspector, library
// panel, notification center and a status bar. The notebook is the medium;
// the simulation engine is the product — the transport sits front and center.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, GraduationCap, PanelLeft, PanelRight, Search, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useLazyActivePage } from '@/lib/store/use-active-page'
import { usePrefs } from '@/lib/store/preferences'
import { useDocStore } from '@/lib/store/document'
import { useAuthStore } from '@/lib/auth/store'
import { can, ROLE_LABEL } from '@/lib/auth/types'
import { useShareInbox } from '@/hooks/use-share-inbox'
import { useIsMobile } from '@/hooks/use-mobile'
import { stop } from '@/lib/physics/world'
import { Sidebar } from './sidebar'
import { Dock } from './dock'
import { useLayout, type PanelId, type Side } from '@/lib/store/layout'
import { Toolbar } from './toolbar'
import { Transport } from './transport'
import { Palette } from './palette'
import { Inspector } from './inspector'
import { InfiniteCanvas } from './canvas'
import { AiPanel } from './ai-panel'
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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const isMobile = useIsMobile()

  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  // Only the open page stays in memory — see lib/store/use-active-page.ts
  useLazyActivePage(activePageId)
  // UI scale rides on the root font size: everything is sized in rem-derived
  // Tailwind units, so panels, docks and the inspector all follow — while the
  // CANVAS keeps its own zoom, which is what you want.
  const uiScale = usePrefs((s) => s.notebook.uiScale)
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale * 100}%`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [uiScale])
  // The chosen tint overrides --accent-blue globally; every "blue" surface
  // (selection, buttons, active states) follows, per theme, with no re-render.
  const accent = usePrefs((s) => s.appearance.accent) ?? 'blue'
  useEffect(() => {
    if (accent === 'blue') document.documentElement.style.removeProperty('--accent-blue')
    else document.documentElement.style.setProperty('--accent-blue', `var(--accent-${accent})`)
    return () => {
      document.documentElement.style.removeProperty('--accent-blue')
    }
  }, [accent])
  const panelSides = useLayout((s) => s.sides)
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const splitScreenDocumentId = useWorkspaceStore((s) => s.splitScreenDocumentId)
  const syncScroll = useWorkspaceStore((s) => s.syncScroll)

  const activePageObjects = useDocStore((s) => activePageId ? s.pages[activePageId]?.objects : null)
  const splitScreenObject = splitScreenDocumentId && activePageObjects ? activePageObjects[splitScreenDocumentId] : null

  useEffect(() => {
    if (!syncScroll || !activePageId) return
    const onPdfScroll = (e: Event) => {
      const { pct } = (e as CustomEvent).detail
      const s = useDocStore.getState()
      const box = s.viewports[activePageId] || { x: 0, y: 0, zoom: 1 }
      const canvasHeight = 10000
      s.setViewport(activePageId, { ...box, y: -pct * canvasHeight * box.zoom })
    }
    window.addEventListener('simblip-pdf-scroll', onPdfScroll)
    return () => window.removeEventListener('simblip-pdf-scroll', onPdfScroll)
  }, [syncScroll, activePageId])
  const pageName = useWorkspaceStore((s) => {
    for (const nb of s.notebooks)
      for (const sec of nb.sections)
        for (const p of sec.pages) if (p.id === s.activePageId) return p.name
    return null
  })
  const objectCount = useDocStore((s) =>
    activePageId ? Object.keys(s.pages[activePageId]?.objects ?? {}).length : 0
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

  const aiAllowed = can(profile?.role, 'use-ai')

  // Docked panels: open panels grouped by their assigned side. Panels can be
  // moved, merged into tabs, or split — see components/workspace/dock.tsx.
  const openPanels: PanelId[] = [
    ...(sidebarOpen ? (['pages'] as const) : []),
    ...(inspectorOpen && activePageId ? (['inspector'] as const) : []),
  ]
  const dockFor = (side: Side) => (
    <Dock
      side={side}
      panels={openPanels.filter((id) => panelSides[id] === side)}
      render={(id) => (id === 'pages' ? <Sidebar /> : <Inspector pageId={activePageId!} />)}
    />
  )

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-40 flex h-12 shrink-0 items-center gap-2 px-4">
        <button
          type="button"
          aria-label="Toggle sidebar"
          className={cn(
            'rounded-lg p-1.5 transition-colors hover:bg-accent',
            sidebarOpen ? 'text-foreground' : 'text-muted-foreground'
          )}
          onClick={() => togglePanel('sidebar')}
        >
          <PanelLeft className="h-4 w-4" />
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
        {institution && (
          <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
            · {institution.name}
          </span>
        )}
        {pageName && (
          <>
            <span className="hidden text-muted-foreground/50 sm:inline">/</span>
            <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground sm:inline">
              {pageName}
            </span>
          </>
        )}
        <div className="flex-1" />
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
        {activePageId && <UndoRedo pageId={activePageId} />}
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
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          aria-label="Toggle inspector"
          className={cn(
            'rounded-lg p-1.5 transition-colors hover:bg-accent',
            inspectorOpen ? 'text-foreground' : 'text-muted-foreground'
          )}
          onClick={() => togglePanel('inspector')}
        >
          <PanelRight className="h-4 w-4" />
        </button>
        <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
      </header>

      <div className="relative flex min-h-0 flex-1">
        {dockFor('left')}

        {splitScreenObject && (
          <div className="flex w-1/2 flex-col border-r border-border bg-muted/30 p-2">
            <FileObject object={splitScreenObject} pageId={activePageId!} />
          </div>
        )}

        <main className="relative min-w-0 flex-1">
          {/* Edge handles — toggle the side panels from mid-screen instead of
              reaching for the top corners. */}
          <button
            type="button"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            className="glass-strong absolute left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-xl px-0.5 py-4 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => togglePanel('sidebar')}
          >
            {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {activePageId && (
            <button
              type="button"
              aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
              className="glass-strong absolute right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl px-0.5 py-4 text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => togglePanel('inspector')}
            >
              {inspectorOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          )}
          {activePageId ? (
            <>
              <InfiniteCanvas key={activePageId} pageId={activePageId} />
              <Transport pageId={activePageId} />
              <Toolbar
                calcOpen={calcOpen}
                onToggleCalc={() => setCalcOpen((v) => !v)}
                paletteOpen={paletteOpen}
                onTogglePalette={() => setPaletteOpen((o) => !o)}
                showAi={aiAllowed}
                pageId={activePageId}
              />
              <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
              {calcOpen && <Calculator onClose={() => setCalcOpen(false)} />}
              {aiAllowed && <AiPanel pageId={activePageId} />}
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

        {dockFor('right')}
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
