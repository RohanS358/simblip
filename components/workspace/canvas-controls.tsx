'use client'

// The two floating controls that share the canvas's edges — the tool dock
// and the simulation transport — laid out on one 3×3 grid instead of each
// guessing its own absolute position and reactively nudging itself away if
// it happens to measure a collision with the other (the old approach: see
// hooks/use-dock-clearance.ts). Every edge and corner is its own grid
// track — an item can grow right up to its track's limit (the toolbar's
// own pill already scrolls internally past that point, see toolbar.tsx) but
// it can never spill into a neighbouring track, so the dock and the
// transport can't end up on top of each other on any of the four dock sides.
//
// The center track is sized with `fit-content(100%)`, not bare max-content —
// a bare max-content track is sized to the toolbar's UNCLIPPED width (every
// tool button, no scrolling) regardless of how little room the viewport
// actually has, so on a narrow phone the dock's own overflow-x-auto (in
// toolbar.tsx) never gets a chance to kick in: the track itself already
// spilled past the screen edge. fit-content(100%) grows to content like
// max-content but never past the container, which is what makes the
// internal scroll (and its fade mask) actually engage. (An earlier attempt
// used minmax(0, min(max-content,100%)) — invalid, since CSS math functions
// can't take sizing keywords as arguments; the whole declaration got
// dropped, which is why the dock briefly lost its centering entirely.)
//
// The dock's own side preference (top/bottom/left/right, see usePrefs
// notebook.dock) is a desktop-only choice: on mobile, left/right are
// overridden to bottom, since a side dock permanently eats into a phone's
// narrow width while a phone has height to spare (Toolbar shrinks its own
// buttons on mobile too, see toolbar.tsx).
//
// On a phone, the app nav rail (sidebar.tsx) is ALSO a fixed bottom bar, and
// it changes height (rail alone vs. rail+open panel) — so when this dock
// also resolves to 'bottom', the grid can't reserve a fixed guess for it.
// Sidebar publishes its live measured height to useMobileNavBarStore (same
// "written by one, read by another" shape as useDockRect/usePdfDockStore);
// this always reads the current value, whichever state the bar is in.
//
// That same condition (docked bottom, nav rail present — i.e. an actual
// phone) also switches the toolbar itself from the floating centered pill
// it is everywhere else into a full-bleed bar flush with both edges, sitting
// right above the rail — a phone's bottom edge is a fixed piece of chrome,
// not a floating control, same visual language as the rail beneath it.

import { usePrefs } from '@/lib/store/preferences'
import { useIsMobile } from '@/hooks/use-mobile'
import { useMobileNavBarStore } from '@/lib/store/mobile-nav-bar'
import { Toolbar } from './toolbar'
import { FloatingTransport } from './transport'
import { cn } from '@/lib/utils'

import { SundialDock } from './sundial-dock'

export function CanvasControls({
  pageId,
  showTransport = true,
}: {
  pageId: string
  showTransport?: boolean
}) {
  const dockPrefs = usePrefs((s) => s.dock)
  const isMobile = useIsMobile()
  const dockSide = isMobile && (dockPrefs.fixedSide === 'left' || dockPrefs.fixedSide === 'right')
    ? 'bottom'
    : dockPrefs.fixedSide

  const navBarH = useMobileNavBarStore((s) => s.height)
  const isSundial = dockPrefs.containerStyle === 'sundial'
  const edgeToolbar = dockPrefs.positionMode === 'fixed' && dockPrefs.containerStyle === 'fixed-bar'

  const toolbarCell = edgeToolbar
    ? dockSide === 'top'
      ? 'col-start-1 col-end-4 row-start-1 justify-self-stretch self-start'
      : dockSide === 'bottom'
        ? 'col-start-1 col-end-4 row-start-3 justify-self-stretch self-end'
        : dockSide === 'left'
          ? 'col-start-1 row-start-1 row-end-4 justify-self-start self-stretch'
          : 'col-start-3 row-start-1 row-end-4 justify-self-end self-stretch'
    : dockSide === 'top'
      ? 'col-start-2 row-start-1 justify-self-center self-start'
      : dockSide === 'bottom'
        ? 'col-start-2 row-start-3 justify-self-center self-end'
        : dockSide === 'left'
          ? 'col-start-1 row-start-2 justify-self-start self-center'
          : 'col-start-3 row-start-2 justify-self-end self-center'

  // If in Draggable mode, position is controlled by dragPosition or floating overlay
  const isDraggable = dockPrefs.positionMode === 'draggable' && !isMobile

  if (isSundial) {
    return (
      <>
        <FloatingTransport pageId={pageId} />
        <SundialDock pageId={pageId} />
      </>
    )
  }

  return (
    <>
      <FloatingTransport pageId={pageId} />
      {isDraggable ? (
        <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
          <Toolbar pageId={pageId} edge={false} />
        </div>
      ) : (
        <div
          className={cn('pointer-events-none absolute inset-0 z-40 grid gap-3', edgeToolbar ? 'p-0' : 'p-4')}
          style={{
            gridTemplateColumns: 'minmax(0,1fr) fit-content(100%) minmax(0,1fr)',
            gridTemplateRows: 'minmax(0,1fr) fit-content(100%) minmax(0,1fr)',
            paddingBottom:
              dockSide === 'bottom' && navBarH > 0
                ? `calc(${navBarH}px + 0.75rem)`
                : edgeToolbar
                  ? 0
                  : 'max(1rem, env(safe-area-inset-bottom))',
          }}
        >
          <div className={cn('pointer-events-auto min-h-0 min-w-0', toolbarCell)}>
            <Toolbar pageId={pageId} edge={edgeToolbar} />
          </div>
        </div>
      )}
    </>
  )
}

