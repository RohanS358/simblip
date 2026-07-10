'use client'

// The workspace shell — a desktop-style environment: top bar with global
// search and identity, notebook tree, infinite canvas, inspector, library
// panel, notification center and a status bar. The notebook is the medium;
// the simulation engine is the product — the transport sits front and center.

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { LibraryBig, PanelLeft, PanelRight, Search, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { useAuthStore } from '@/lib/auth/store'
import { can, ROLE_LABEL } from '@/lib/auth/types'
import { useIsMobile } from '@/hooks/use-mobile'
import { useShareInbox } from '@/hooks/use-share-inbox'
import { stop } from '@/lib/physics/world'
import { Sidebar } from './sidebar'
import { Toolbar } from './toolbar'
import { Transport } from './transport'
import { Palette } from './palette'
import { Inspector } from './inspector'
import { InfiniteCanvas } from './canvas'
import { AiPanel } from './ai-panel'
import { SyncStatus } from './sync-status'
import { LibraryPanel } from './library-panel'
import { CommandPalette } from './command-palette'
import { NotificationCenter } from './notifications'
import { ProfileMenu } from './profile-menu'
import { SettingsDialog } from './settings-dialog'
import { createGeometry, componentById } from '@/lib/scene/factory'
import { str, num } from '@/lib/scene/types'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

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
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const isMobile = useIsMobile()

  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
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

  const aiAllowed = can(profile?.role, 'use-ai')

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
        <SyncStatus />
        <NotificationCenter />
        <button
          type="button"
          aria-label="Toggle library"
          className={cn(
            'rounded-lg p-1.5 transition-colors hover:bg-accent',
            libraryOpen ? 'text-foreground' : 'text-muted-foreground'
          )}
          onClick={() => setLibraryOpen((o) => !o)}
        >
          <LibraryBig className="h-4 w-4" />
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
        {sidebarOpen && !isMobile && <Sidebar />}

        <main className="relative min-w-0 flex-1">
          {activePageId ? (
            <>
              <InfiniteCanvas key={activePageId} pageId={activePageId} />
              <Transport pageId={activePageId} />
              <Toolbar
                paletteOpen={paletteOpen}
                onTogglePalette={() => setPaletteOpen((o) => !o)}
                showAi={aiAllowed}
              />
              <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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

        <LibraryPanel open={libraryOpen} onClose={() => setLibraryOpen(false)} pageId={activePageId} />
        {inspectorOpen && activePageId && <Inspector pageId={activePageId} />}
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
        onOpenLibrary={() => setLibraryOpen(true)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
