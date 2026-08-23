'use client'

// The left dock's content — a permanently fixed rail (Notebook / Components /
// Tools / Library, with the institution mark on top) plus whichever ONE
// section is open. Replaces the old permanent 54/46 split between the
// notebook tree and the library: now each section gets the panel's full
// height when it's open.
//
// The rail itself never disappears — it's the fixed anchor point for the
// whole left edge, the way a dock or activity bar would be. Only the content
// PANE collapses when not in use (via the same sidebarOpen toggle the header
// and edge-handle already used) — collapsing used to hide the entire
// sidebar, rail included, which left branding and navigation with no fixed
// home. See docs/ui-simplification-plan.md §4.
//
// This is also where the physics/circuit Palette and the Calculator's
// trigger live now — they used to be floating popups pinned to the dock;
// browsers belong in a browsable drawer, not a flyout.
//
// "Left edge" is a desktop/tablet shape. On a phone the rail renders fixed
// along the bottom instead — a left column permanently eats into a phone's
// scarce width, and a phone has height to spare — with the open section's
// panel sliding up above it as a capped-height sheet, not sideways.

import { useEffect, useRef, useState } from 'react'
import { motion as fm, AnimatePresence, useMotionValue, animate } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'
import { useSpring } from '@/lib/motion'
import { startSeamDrag } from '@/lib/seam-drag'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useAuthStore } from '@/lib/auth/store'
import { useIsMobile, useIsNarrow } from '@/hooks/use-mobile'
import { useMobileNavBarStore } from '@/lib/store/mobile-nav-bar'
import { useTocStore } from '@/lib/store/toc'
import {
  SIDEBAR_SECTIONS,
  useSidebarSection,
  type SidebarSectionId,
} from '@/lib/store/sidebar-sections'
import { NotebookPanel } from './notebook-panel'
import { AiPanel } from './ai-panel'
import { Palette } from './palette'
import { ToolsPanel } from './tools-panel'
import { UploadsPanel } from './uploads-panel'
import { LibraryPanel } from './library-panel'
import { InspectorPane } from './inspector'
import { TocPanel } from './toc-panel'
import { cn } from '@/lib/utils'

// Rail thickness comes from railNav's own classes (w-[52px] column on
// desktop, a bar on phone) — no computed widths anymore; the pane's fold
// is a Framer width animation instead.

export function RailButton({
  active = false,
  label,
  tooltipSide = 'right',
  onClick,
  children,
}: {
  active?: boolean
  label: string
  tooltipSide?: 'top' | 'right'
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors',
            active
              ? 'bg-[var(--accent-blue)] text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="text-ui-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Sidebar({
  hideNotebook = false,
  bottomRailContent,
}: {
  hideNotebook?: boolean
  bottomRailContent?: React.ReactNode
}) {
  const motion = useSpring()
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const institution = useAuthStore((s) => s.institution)
  // A phone is a narrow TOUCH device — a tablet is touch but not narrow, a
  // narrowed desktop browser window is narrow but not touch, and neither of
  // those wants the bottom bar (matches the isMobile+isPhone combo
  // canvas-controls.tsx uses to reserve clearance for this same bar). Only
  // an actual phone gets it: a left column permanently eats into its scarce
  // width, and a phone has height to spare instead.
  const isMobile = useIsMobile()
  const isNarrow = useIsNarrow(767)
  const isPhone = isMobile && isNarrow

  // The dock (Toolbar/Transport, see canvas-controls.tsx) needs to always
  // clear this bar — rail alone when collapsed, rail+panel when it's open
  // and taller — so the actual measured height is published live rather
  // than assuming a fixed rail thickness.
  //
  // State, not useRef: the ref is on the plain <aside> below, which fires
  // reliably (see comment there). State lets this effect re-run once the
  // node actually exists.
  const [barEl, setBarEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!isPhone || !barEl) {
      useMobileNavBarStore.getState().setHeight(0)
      return
    }
    const publish = () => useMobileNavBarStore.getState().setHeight(barEl.getBoundingClientRect().height)
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(barEl)
    return () => {
      ro.disconnect()
      useMobileNavBarStore.getState().setHeight(0)
    }
  }, [isPhone, barEl])

  // Which section shows when the pane is open — remembered even while
  // collapsed, so reopening lands back where you left it. Shared store (not
  // local state) so actions elsewhere — the dock's Properties action, the
  // context menu — can land the user on a specific section.
  const activeSection = useSidebarSection((s) => s.section)
  const setActiveSection = useSidebarSection((s) => s.setSection)

  useEffect(() => {
    if (hideNotebook && activeSection === 'notebook') {
      setActiveSection('components')
    }
  }, [hideNotebook, activeSection, setActiveSection])

  // Contents is view-dependent: it only exists while the open page is one
  // that can produce an outline (a PDF with a real outline, a deck with slide
  // headings), so it is filtered out rather than shown dead.
  const hasToc = useTocStore((s) => (s.toc?.entries.length ?? 0) > 0)
  const sections = SIDEBAR_SECTIONS.filter(
    (s) => !(hideNotebook && s.id === 'notebook') && !(s.id === 'toc' && !hasToc)
  )

  useEffect(() => {
    if (!hasToc && activeSection === 'toc') setActiveSection('notebook')
  }, [hasToc, activeSection, setActiveSection])

  // What Properties operates on: boards act on themselves, docs act on the
  // focused sheet, PDF readers on the focused ink/notes canvas — the same
  // derivation the toolbar/transport use (see shell.tsx).
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const pdfToolsActive = useWorkspaceStore((s) => s.pdfToolsActive)
  const activeKind = useWorkspaceStore(
    (s) => findPageMeta(s.nodes, s.activePageId)?.pageKind ?? 'board'
  )
  // A board is a canvas: the sidebar floats over it. Everything else is a
  // document surface that the sidebar must not cover. See the effect below.
  const floats = activeKind === 'board'

  const contentPageId =
    activeKind === 'doc' || activeKind === 'pptx' || (activeKind === 'pdf' && pdfToolsActive)
      ? (activeSheetId ?? activePageId)
      : activePageId

  const [panelW, setPanelW] = useState(() => {
    if (typeof window === 'undefined') return 288
    return Number(localStorage.getItem('simblip-sidebar-w')) || 288
  })

  // Written to directly during a seam drag so a resize never re-renders the
  // panel (and the canvas beside it) per pointermove — see startSeamDrag.
  const foldRef = useRef<HTMLDivElement>(null)
  const bulgeRef = useRef<HTMLButtonElement>(null)

  // The fold's width is a motion value, not an `animate` prop: a drag writes
  // it straight to the DOM, so the spring below can't try to re-animate from
  // a stale value and snap the panel back when the drag commits. It springs
  // only for the open/close fold.
  const foldW = useMotionValue(sidebarOpen ? panelW : 0)
  useEffect(() => {
    const controls = animate(foldW, sidebarOpen ? panelW : 0, motion)
    return () => controls.stop()
    // `motion` is a stable spring config from useSpring().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen, panelW])

  // The panel floats over the canvas so its glass has something to sample,
  // which on its own would hide whatever sits under it. Shifting the page
  // viewport by the panel's width gives the same visual result as the canvas
  // being squeezed — content moves out from under the panel — while the canvas
  // keeps painting behind it.
  //
  // Published as a CSS variable too, so floating canvas chrome (the dock, the
  // transport) can inset itself past the panel. See canvas-controls.tsx.
  // Rail included: the canvas runs under the whole sidebar, so the whole
  // sidebar is what content has to clear. 40px matches railNav's w-[40px].
  const visibleW = 40 + (sidebarOpen ? panelW : 0)
  const lastVisibleW = useRef(visibleW)
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-panel-w', `${visibleW}px`)
    // How much of that width the LAYOUT has to give up. Floating over the
    // canvas is the right call for a board — the glass needs the canvas
    // painting behind it, and the viewport shift below moves content out
    // from under it anyway. A document has no viewport to shift, so floating
    // there just covers the page: those kinds reserve real space instead
    // (shell.tsx pads the content row by this) and the sidebar's glass sits
    // over the page background rather than over the document.
    document.documentElement.style.setProperty(
      '--sidebar-reserve-w',
      floats ? '0px' : `${visibleW}px`
    )
    const delta = visibleW - lastVisibleW.current
    lastVisibleW.current = visibleW
    // Reserved space already moved the content — shifting the viewport too
    // would move it twice.
    if (delta === 0 || !floats) return
    const doc = useDocStore.getState()
    const id = useWorkspaceStore.getState().activePageId
    if (!id) return
    const v = doc.viewports[id]
    if (!v) return
    doc.setViewport(id, { ...v, x: v.x + delta })
  }, [visibleW, floats])

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--sidebar-panel-w')
      document.documentElement.style.removeProperty('--sidebar-reserve-w')
    },
    []
  )

  const selectSection = (id: SidebarSectionId) => {
    if (sidebarOpen && activeSection === id) {
      togglePanel('sidebar') // same section tapped again — collapse the pane
      return
    }
    setActiveSection(id)
    if (!sidebarOpen) togglePanel('sidebar')
  }


  const railNav = (
    <nav
      className={cn(
        'flex shrink-0 items-center gap-2',
        isPhone ? 'w-full flex-row justify-center px-3 py-2' : 'h-full w-[40px] flex-col py-3'
      )}
    >
      {sections.map((s) => (
        <RailButton
          key={s.id}
          label={s.label}
          tooltipSide={isPhone ? 'top' : 'right'}
          active={sidebarOpen && activeSection === s.id}
          onClick={() => selectSection(s.id)}
        >
          <s.icon className="h-[18px] w-[18px]" />
        </RailButton>
      ))}
      {bottomRailContent && (
        <div className={cn('flex items-center justify-center', !isPhone && 'mt-auto')}>
          {bottomRailContent}
        </div>
      )}
    </nav>
  )

  const panelSections = (
    <>
      {activeSection === 'notebook' && <NotebookPanel />}
      {activeSection === 'assistant' && <AiPanel pageId={contentPageId} />}
      {activeSection === 'components' && <Palette />}
      {activeSection === 'tools' && <ToolsPanel />}
      {activeSection === 'toc' && <TocPanel />}
      {activeSection === 'uploads' && (
        <UploadsPanel inline open pageId={activePageId} />
      )}
      {activeSection === 'library' && (
        <LibraryPanel inline open pageId={activePageId} />
      )}
      {activeSection === 'properties' &&
        (contentPageId ? (
          <InspectorPane pageId={contentPageId} />
        ) : (
          <p className="py-6 text-center text-ui-sm leading-relaxed text-muted-foreground">
            Open a page to inspect its objects and variables.
          </p>
        ))}
    </>
  )

  // A left column permanently eats into a phone's scarce width; a phone has
  // height to spare instead, so the rail renders as a fixed bottom bar there
  // (same isPhone signal the Inspector uses for its own bottom sheet, see
  // mobile-shell.tsx) — a tablet keeps the desktop-shaped left rail below.
  if (isPhone) {
    return (
      // Ref goes on this plain <aside>, not on fm.div: motion.aside never
      // forwards its ref to the DOM node, so height stayed stuck at 0 and
      // CanvasControls's toolbar rendered on top of the rail. fm.div below
      // only handles the entrance animation.
      <aside ref={setBarEl} className="fixed inset-x-0 bottom-0 z-40" aria-label="Sidebar">
        <fm.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={motion}
          className="glass-strong flex flex-col rounded-t-2xl border-t border-border/40 pb-[env(safe-area-inset-bottom)]"
        >
          {/* The panel used to be a bare `sidebarOpen && <div>` — it popped in
              and out with no motion at all, while desktop (below) folded open
              on a spring. Same idea here, on height instead of width: the
              inner div keeps its real height inside the overflow-hidden fold,
              so the content never reflows mid-animation. `motion` is
              useSpring(), which already collapses to an instant transition
              under prefers-reduced-motion. */}
          <AnimatePresence initial={false}>
            {sidebarOpen && (
              <fm.div
                key="panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={motion}
                className="min-h-0 overflow-hidden border-b border-border/50"
              >
                <div className="flex max-h-[38dvh] min-h-0 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-y-auto">{panelSections}</div>
                </div>
              </fm.div>
            )}
          </AnimatePresence>
          {railNav}
        </fm.div>
      </aside>
    )
  }

  return (
    // NOTE: the entrance animation is OPACITY ONLY, deliberately. Any
    // transform here would make this element a backdrop root, and the glass
    // layer below could then only sample this subtree — rendering opaque.
    <fm.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={motion}
      className="relative z-30 flex min-h-0 flex-row"
      aria-label="Sidebar"
    >
      {/* The sidebar's material. Sized by inset-0, so it tracks the rail +
          fold width exactly as the panel animates. NO top mask: it used to
          fade in over the first 4rem to dissolve into the header, but the
          header paints opaque, so the fade just left the top of the panel
          unblurred. clipPath is geometrically a no-op but forces a hard clip
          on the composited layer — without it Chromium lets the blurred
          backdrop bleed a few px past the right edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[var(--chrome-glass)] backdrop-blur-sm"
        style={{ clipPath: 'inset(0)' }}
      />

      <div className="relative z-10 flex min-h-0 flex-col">
        {railNav}
      </div>

      {/* Width animates; the content keeps its TRUE width inside the
          overflow-hidden fold so text never reflows mid-motion.
          While dragging the seam the width is driven straight through
          --panel-w (see the separator below) — the spring is for the
          open/close fold only, and springing toward the cursor is exactly
          what made resizing feel laggy. */}
      <fm.div
        ref={foldRef}
        initial={false}
        animate={{ opacity: sidebarOpen ? 1 : 0 }}
        transition={motion}
        style={{ width: foldW, ['--panel-w' as string]: `${panelW}px` }}
        className="relative z-30 min-h-0 overflow-hidden"
      >
        <div
          style={{ width: 'var(--panel-w)' }}
          className="relative flex h-full min-h-0 flex-col rounded-r-2xl"
        >

          <div
            role="separator"
            aria-label="Resize sidebar"
            className="group absolute right-0 top-0 z-30 h-full w-3 touch-none cursor-col-resize border-r-2 border-border/60 transition-colors duration-150 hover:border-sky-400"
            onPointerDown={(e) => {
              const startX = e.clientX
              const startW = panelW
              startSeamDrag(
                e,
                (ev) => Math.min(480, Math.max(200, startW + (ev.clientX - startX))),
                (w) => {
                  foldW.set(w)
                  foldRef.current?.style.setProperty('--panel-w', `${w}px`)
                  // The bulge's `left` is CSS-transitioned for the open/close
                  // fold; that same easing would make it trail the cursor
                  // here, so it's suppressed for the gesture.
                  if (bulgeRef.current) {
                    bulgeRef.current.style.transitionProperty = 'none'
                    bulgeRef.current.style.left = `${w + 40}px`
                  }
                },
                (w) => {
                  if (bulgeRef.current) bulgeRef.current.style.transitionProperty = ''
                  setPanelW(w)
                  try {
                    localStorage.setItem('simblip-sidebar-w', String(w))
                  } catch {}
                }
              )
            }}
          />

          <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
            {panelSections}
          </div>
        </div>
      </fm.div>

      <button
        ref={bulgeRef}
        type="button"
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        onClick={() => togglePanel('sidebar')}
        className={cn(
          'group/bulge absolute top-1/2 z-30 flex h-7 w-4 -translate-y-1/2',
          'items-center justify-center border-y border-r border-border/40 bg-[var(--chrome-glass)] backdrop-blur-sm shadow-sm',
          'transition-[left,height,width,border-color,box-shadow] duration-200 ease-out hover:h-8 hover:w-[18px] hover:border-sky-400 hover:shadow-md',
          'active:scale-95'
        )}
        style={{
          left: sidebarOpen ? panelW + 40 : 40,
          borderRadius: '0 50% 50% 0 / 0 50% 50% 0',
        }}
      >
        <ChevronLeft
          className={cn(
            'h-3 w-3 -translate-x-0.5 text-muted-foreground transition-colors duration-200 ease-out group-hover/bulge:text-sky-500',
            !sidebarOpen && 'rotate-180'
          )}
        />
      </button>
    </fm.aside>
  )
}
