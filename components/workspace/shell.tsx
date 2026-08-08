'use client'

// The workspace shell — a desktop-style environment: top bar with global
// search and identity, notebook tree, infinite canvas, inspector, library
// panel, notification center and a status bar. The notebook is the medium;
// the simulation engine is the product — the transport sits front and center.

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { GraduationCap, Search, Sun, Moon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { isDarkTheme } from '@/components/theme-provider'
import { useWorkspaceStore, findPageMeta, childrenOf } from '@/lib/store/workspace'
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
import { UndoRedo } from './undo-redo'
import { NotificationCenter } from './notifications'
import { ProfileMenu } from './profile-menu'
import { createGeometry, componentById } from '@/lib/scene/factory'
import { str, num } from '@/lib/scene/types'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { FileObject } from '@/components/objects/file-view'

// Code-split every panel that isn't needed for first paint: the touch shell
// (mutually exclusive with this desktop one), and the overlays that start
// closed (command palette, calculator, settings, tutorial). Together these
// pull in mathjs, the full settings surface and a second whole shell — the
// biggest chunk of unused-on-load JS this page shipped.
const MobileShell = dynamic(() => import('./mobile-shell').then((m) => m.MobileShell), { ssr: false })
const CommandPalette = dynamic(() => import('./command-palette').then((m) => m.CommandPalette), { ssr: false })
const Calculator = dynamic(() => import('./calculator').then((m) => m.Calculator), { ssr: false })
const SettingsDialog = dynamic(() => import('./settings-dialog').then((m) => m.SettingsDialog), { ssr: false })
const TutorialPanel = dynamic(() => import('./tutorial').then((m) => m.TutorialPanel), { ssr: false })
const EventLogPanel = dynamic(() => import('./event-log-panel').then((m) => m.EventLogPanel), { ssr: false })

/** Returns true only on the account's actual first run (seeds a notebook),
 *  so the caller can auto-open the tutorial exactly once, right where the
 *  seeded page already primes its first course (see tutorial.tsx §basics —
 *  UX masterplan §25: the best onboarding feature was previously off by
 *  default and undiscovered on the one page built to showcase it). */
function seedFirstRun(): boolean {
  const ws = useWorkspaceStore.getState()
  if (childrenOf(ws.nodes, null).length > 0) return false
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
  return true
}

// ── PaneGrid ──────────────────────────────────────────────────────────────
// Renders 1–4 pages in a CSS grid layout. Layout strategy:
//   1 pane  → full canvas (no grid)
//   2 panes → side by side columns (splitRatio respected)
//   3 panes → left half + right column with top/bottom rows
//   4 panes → 2×2 grid
//
// Each layout variant is its own component to avoid conditional hook calls.

const SEAM_BASE = 'shrink-0 bg-border/50 transition-colors hover:bg-[var(--accent-blue)]/50'
const H_SEAM = `w-1.5 cursor-col-resize ${SEAM_BASE}`
const V_SEAM = `h-1.5 cursor-row-resize ${SEAM_BASE}`

/** Fraction below which a pane is snapped closed. */
const CLOSE_THRESHOLD = 0.12

function useDragger(dir: 'h' | 'v', hostRef: React.RefObject<HTMLDivElement | null>, onMove: (f: number) => void) {
  return useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const host = hostRef.current?.getBoundingClientRect()
      if (!host) return
      onMove(dir === 'h' ? (ev.clientX - host.left) / host.width : (ev.clientY - host.top) / host.height)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [dir, hostRef, onMove])
}

function PaneCell({
  id,
  index,
  activePaneIndex,
  paneCount,
  className,
  style,
}: {
  id: string
  index: number
  activePaneIndex: number
  paneCount: number
  className?: string
  style?: React.CSSProperties
}) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane)
  const removePane = useWorkspaceStore((s) => s.removePane)
  const isActive = index === activePaneIndex

  return (
    <div
      className={cn(
        'group relative min-h-0 min-w-0 overflow-hidden',
        isActive && 'ring-1 ring-inset ring-[var(--accent-blue)]/30',
        className
      )}
      style={style}
      onPointerDownCapture={() => { if (!isActive) setActivePane(index) }}
    >
      <PageView pageId={id} />
      {paneCount > 1 && (
        <button
          type="button"
          aria-label="Close pane"
          className={cn(
            'absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-destructive/10 hover:text-destructive',
            isActive ? 'opacity-60' : 'opacity-0 group-hover:opacity-60'
          )}
          onClick={() => removePane(index)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      )}
    </div>
  )
}

function Pane1({ panes, activePaneIndex }: { panes: string[]; activePaneIndex: number }) {
  return <PaneCell id={panes[0]} index={0} activePaneIndex={activePaneIndex} paneCount={1} className="h-full w-full" />
}

function Pane2({ panes, activePaneIndex, splitRatio }: { panes: string[]; activePaneIndex: number; splitRatio: number }) {
  const host = useRef<HTMLDivElement>(null)
  const handleH = useCallback((f: number) => {
    if (f < CLOSE_THRESHOLD) {
      // Left pane too narrow — close it
      useWorkspaceStore.getState().removePane(0)
    } else if (f > 1 - CLOSE_THRESHOLD) {
      // Right pane too narrow — close it
      useWorkspaceStore.getState().removePane(1)
    } else {
      useWorkspaceStore.getState().setSplitRatio(f)
    }
  }, [])
  const drag = useDragger('h', host, handleH)
  return (
    <div ref={host} className="flex h-full w-full">
      <PaneCell id={panes[0]} index={0} activePaneIndex={activePaneIndex} paneCount={2} style={{ width: `${splitRatio * 100}%` }} />
      <div role="separator" aria-label="Resize split" className={H_SEAM} onPointerDown={drag} />
      <PaneCell id={panes[1]} index={1} activePaneIndex={activePaneIndex} paneCount={2} className="flex-1" />
    </div>
  )
}

function Pane3({ panes, activePaneIndex, splitRatio }: { panes: string[]; activePaneIndex: number; splitRatio: number }) {
  const host = useRef<HTMLDivElement>(null)
  const rightHost = useRef<HTMLDivElement>(null)
  const [vRatio, setVRatio] = useState(0.5)
  const handleH3 = useCallback((f: number) => {
    if (f < CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(0)
    } else if (f > 1 - CLOSE_THRESHOLD) {
      // Collapse entire right column — remove both right panes (indices 2 then 1)
      useWorkspaceStore.getState().removePane(2)
      useWorkspaceStore.getState().removePane(1)
    } else {
      useWorkspaceStore.getState().setSplitRatio(f)
    }
  }, [])
  const handleV3 = useCallback((f: number) => {
    if (f < CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(1)
    } else if (f > 1 - CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(2)
    } else {
      setVRatio(Math.min(0.8, Math.max(0.2, f)))
    }
  }, [])
  const dragH = useDragger('h', host, handleH3)
  const dragV = useDragger('v', rightHost, handleV3)
  return (
    <div ref={host} className="flex h-full w-full">
      <PaneCell id={panes[0]} index={0} activePaneIndex={activePaneIndex} paneCount={3} style={{ width: `${splitRatio * 100}%` }} />
      <div role="separator" aria-label="Resize columns" className={H_SEAM} onPointerDown={dragH} />
      <div ref={rightHost} className="flex flex-1 flex-col">
        <PaneCell id={panes[1]} index={1} activePaneIndex={activePaneIndex} paneCount={3} style={{ height: `${vRatio * 100}%` }} />
        <div role="separator" aria-label="Resize rows" className={V_SEAM} onPointerDown={dragV} />
        <PaneCell id={panes[2]} index={2} activePaneIndex={activePaneIndex} paneCount={3} className="flex-1" />
      </div>
    </div>
  )
}

function Pane4({ panes, activePaneIndex }: { panes: string[]; activePaneIndex: number }) {
  const host = useRef<HTMLDivElement>(null)
  const topHost = useRef<HTMLDivElement>(null)
  const botHost = useRef<HTMLDivElement>(null)
  const [vRatio, setVRatio] = useState(0.5)
  const [leftRatio, setLeftRatio] = useState(0.5)
  const [rightRatio, setRightRatio] = useState(0.5)
  const handleV4 = useCallback((f: number) => {
    if (f < CLOSE_THRESHOLD) {
      // Top row too short — close top two panes
      useWorkspaceStore.getState().removePane(1)
      useWorkspaceStore.getState().removePane(0)
    } else if (f > 1 - CLOSE_THRESHOLD) {
      // Bottom row too short — close bottom two panes
      useWorkspaceStore.getState().removePane(3)
      useWorkspaceStore.getState().removePane(2)
    } else {
      setVRatio(Math.min(0.8, Math.max(0.2, f)))
    }
  }, [])
  const handleL4 = useCallback((f: number) => {
    if (f < CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(0)
    } else if (f > 1 - CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(1)
    } else {
      setLeftRatio(Math.min(0.8, Math.max(0.2, f)))
    }
  }, [])
  const handleR4 = useCallback((f: number) => {
    if (f < CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(2)
    } else if (f > 1 - CLOSE_THRESHOLD) {
      useWorkspaceStore.getState().removePane(3)
    } else {
      setRightRatio(Math.min(0.8, Math.max(0.2, f)))
    }
  }, [])
  const dragV = useDragger('v', host, handleV4)
  const dragL = useDragger('h', topHost, handleL4)
  const dragR = useDragger('h', botHost, handleR4)
  return (
    <div ref={host} className="flex h-full w-full flex-col">
      <div ref={topHost} className="flex min-h-0" style={{ height: `${vRatio * 100}%` }}>
        <PaneCell id={panes[0]} index={0} activePaneIndex={activePaneIndex} paneCount={4} style={{ width: `${leftRatio * 100}%` }} />
        <div role="separator" aria-label="Resize top columns" className={H_SEAM} onPointerDown={dragL} />
        <PaneCell id={panes[1]} index={1} activePaneIndex={activePaneIndex} paneCount={4} className="flex-1" />
      </div>
      <div role="separator" aria-label="Resize rows" className={V_SEAM} onPointerDown={dragV} />
      <div ref={botHost} className="flex min-h-0 flex-1">
        <PaneCell id={panes[2]} index={2} activePaneIndex={activePaneIndex} paneCount={4} style={{ width: `${rightRatio * 100}%` }} />
        <div role="separator" aria-label="Resize bottom columns" className={H_SEAM} onPointerDown={dragR} />
        <PaneCell id={panes[3]} index={3} activePaneIndex={activePaneIndex} paneCount={4} className="flex-1" />
      </div>
    </div>
  )
}

function PaneGrid({
  panes,
  activePaneIndex,
  splitRatio,
}: {
  panes: string[]
  activePaneIndex: number
  splitRatio: number
}) {
  if (panes.length === 0) return null
  if (panes.length === 1) return <Pane1 panes={panes} activePaneIndex={activePaneIndex} />
  if (panes.length === 2) return <Pane2 panes={panes} activePaneIndex={activePaneIndex} splitRatio={splitRatio} />
  if (panes.length === 3) return <Pane3 panes={panes} activePaneIndex={activePaneIndex} splitRatio={splitRatio} />
  return <Pane4 panes={panes} activePaneIndex={activePaneIndex} />
}

export function WorkspaceShell() {
  // Stores hydrate from localStorage on the client; gate rendering to avoid
  // a server/client markup mismatch.
  const [ready, setReady] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tutorialInitialCourse, setTutorialInitialCourse] = useState<string | undefined>(undefined)
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
    // Below ~60% root font-size, the browser's minimum readable text size
    // clamps rem-based text while icons/borders keep shrinking — mismatched,
    // "hideous" layouts. Clamp here so any stale stored value self-heals too.
    document.documentElement.style.fontSize = `${Math.max(0.6, uiScale) * 100}%`
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
  const panes = useWorkspaceStore((s) => s.panes)
  const activePaneIndex = useWorkspaceStore((s) => s.activePaneIndex)
  const splitRatio = useWorkspaceStore((s) => s.splitRatio)
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const pdfToolsActive = useWorkspaceStore((s) => s.pdfToolsActive)
  const activeKind = useWorkspaceStore(
    (s) => findPageMeta(s.nodes, s.activePageId)?.pageKind ?? 'board'
  )
  // What the toolbar/transport/inspector actually operate on: boards act on
  // themselves, docs act on the focused SHEET, and PDF readers draw with the
  // real board dock too — targeting whichever page/notes canvas is focused.
  const pdfToolsOn = activeKind === 'pdf' && pdfToolsActive
  const contentPageId =
    activeKind === 'doc' || activeKind === 'pptx' || pdfToolsOn ? (activeSheetId ?? activePageId) : activePageId
  // Width of the legacy in-board document split pane (item: resizable).
  const [docSplitW, setDocSplitW] = useState(0.5)
  // Drop indicator while dragging a tab/node over the canvas.
  const [tabDropQuadrant, setTabDropQuadrant] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null)

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
    if (seedFirstRun()) {
      setTutorialInitialCourse('basics')
      setTutorialOpen(true)
    }
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

  // Global command palette, and '?' for the shortcuts cheat sheet (Gmail/
  // Linear/Notion/Figma convention) — skipped while typing so a literal '?'
  // in a note or formula isn't hijacked.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((o) => !o)
        return
      }
      if (e.key === '?' && !isTyping(e.target)) {
        e.preventDefault()
        setSettingsTab('shortcuts')
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Mobile/Tablet back gesture listener: close open dialogs/overlays instead of exiting the page.
  useEffect(() => {
    if (typeof window === 'undefined') return

    if (!window.history.state?.simblip) {
      window.history.replaceState({ simblip: true }, '')
    }

    const onPopState = () => {
      if (commandOpen) {
        setCommandOpen(false)
        return
      }
      if (settingsOpen) {
        setSettingsOpen(false)
        return
      }
      if (tutorialOpen) {
        setTutorialOpen(false)
        return
      }
      if (calcOpen) {
        useWorkspaceStore.getState().togglePanel('calc')
        return
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [commandOpen, settingsOpen, tutorialOpen, calcOpen])


  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <span className="text-[0.8125rem] tracking-wide text-muted-foreground">SIMBLIP</span>
      </div>
    )
  }

  // Phones get a Notes-style navigation app, not a shrunken desktop.
  if (isMobile) return <MobileShell />

  // One docked panel system: the left rail (branding + navigation + every
  // section, Properties included — the right Inspector dock retired when
  // Properties joined the rail). sidebarOpen only controls whether the
  // content PANE is expanded, handled inside Sidebar itself.
  const leftDock = <Dock panels={['pages']} render={() => <Sidebar />} />

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
      <header className="z-40 flex h-12 shrink-0 items-center gap-2 border-b border-border/40 bg-background">
        {/* Left zone: branding + institution + tabs — allowed to shrink and truncate */}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-4">
          {institution?.logo_url ? (
            <Image
              src={String(institution.logo_url)}
              alt={institution.name}
              width={20}
              height={20}
              unoptimized
              className="h-5 w-5 shrink-0 rounded object-contain"
            />
          ) : null}
          <span className="shrink-0 text-[0.875rem] font-extrabold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          {institution && (
            <span className="hidden min-w-0 truncate text-[0.75rem] text-muted-foreground lg:inline">
              · {institution.name}
            </span>
          )}
          <span aria-hidden className="hidden shrink-0 text-muted-foreground/50 lg:inline">/</span>
          {/* open pages ride in the header as tabs — boards, docs and PDFs side by side */}
          <TabsBar
            pageId={contentPageId}
            showTransport={!!activePageId && (activeKind !== 'pdf' || pdfToolsOn)}
          />
        </div>

        {/* Right zone: always-visible controls — shrink-0 so they're never hidden */}
        <div className="relative z-10 flex shrink-0 items-center gap-1 bg-background pr-4">
          <button
            type="button"
            aria-label="Search (Ctrl+K)"
            className="hidden items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1 text-[0.75rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground xl:flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
            Search
            <Kbd className="text-[0.625rem]">⌘K</Kbd>
          </button>
          <button
            type="button"
            aria-label="Search"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground xl:hidden"
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
          // Snap assist: while a tab or tree node is dragged over the canvas,
          // glow the quadrant it would land in; dropping adds a pane.
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('application/x-simblip-tab')) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const r = e.currentTarget.getBoundingClientRect()
            const xFrac = (e.clientX - r.left) / r.width
            const yFrac = (e.clientY - r.top) / r.height
            // Quadrant detection: use the closest edge within the center 40%
            // deadzone, fallback to left/right for dragging from the tab bar.
            const nearLeft = xFrac < 0.3
            const nearRight = xFrac > 0.7
            const nearTop = yFrac < 0.3
            const nearBottom = yFrac > 0.7
            if (nearTop && !nearLeft && !nearRight) setTabDropQuadrant('top')
            else if (nearBottom && !nearLeft && !nearRight) setTabDropQuadrant('bottom')
            else if (nearLeft) setTabDropQuadrant('left')
            else setTabDropQuadrant('right')
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as unknown as Element)) setTabDropQuadrant(null)
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData('application/x-simblip-tab')
            setTabDropQuadrant(null)
            if (!id) return
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            const side = e.clientX < r.left + r.width / 2 ? 'left' : 'right'
            useWorkspaceStore.getState().dropTab(id, side)
          }}
        >
          {tabDropQuadrant && (
            <div
              className={cn(
                'pointer-events-none absolute z-50 rounded-2xl border-2 border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 transition-all',
                tabDropQuadrant === 'left' && 'inset-y-2 left-2 w-1/2',
                tabDropQuadrant === 'right' && 'inset-y-2 right-2 w-1/2',
                tabDropQuadrant === 'top' && 'inset-x-2 top-2 h-1/2',
                tabDropQuadrant === 'bottom' && 'inset-x-2 bottom-2 h-1/2',
              )}
            />
          )}
          {activePageId ? (
            <>
              <PaneGrid
                panes={panes}
                activePaneIndex={activePaneIndex}
                splitRatio={splitRatio}
              />
              {(activeKind !== 'pdf' || pdfToolsOn) && activeKind !== 'web' && contentPageId && (
                <CanvasControls pageId={contentPageId} showTransport={false} />
              )}
              {calcOpen && <Calculator onClose={() => togglePanel('calc')} />}
              {contentPageId && <EventLogPanel pageId={contentPageId} />}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[0.9375rem] font-semibold">No page open</p>
              <p className="max-w-64 text-[0.78125rem] leading-relaxed text-muted-foreground">
                Pick a page in the sidebar, or create a notebook to start a new workspace.
              </p>
            </div>
          )}
        </main>
      </div>

      <footer className="z-40 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-[0.65625rem] text-muted-foreground">
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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(o) => {
          setSettingsOpen(o)
          if (!o) setSettingsTab(undefined)
        }}
        initialTab={settingsTab}
      />
      {tutorialOpen && (
        <TutorialPanel
          pageId={activePageId}
          initialCourseId={tutorialInitialCourse}
          onClose={() => setTutorialOpen(false)}
        />
      )}
    </div>
  )
}
