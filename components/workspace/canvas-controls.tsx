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
import { Transport } from './transport'
import { cn } from '@/lib/utils'

export function CanvasControls({
  pageId,
  showTransport = true,
}: {
  pageId: string
  /** The main workspace shells host Transport in the tab bar's controls
   *  menu instead (see page-controls-menu.tsx), so it doesn't float over
   *  the canvas there — pass false. Standalone surfaces with no tab bar
   *  (the room-board presenter, app/board/page.tsx) keep the floating
   *  default. */
  showTransport?: boolean
}) {
  const dockPref = usePrefs((s) => s.notebook.dock)
  // A side dock (left/right) costs a slice of a phone's scarce width,
  // permanently. A phone has height to spare instead, so on mobile a side
  // preference renders along the bottom — same override Toolbar itself
  // applies internally (toolbar.tsx); it has to be mirrored here too since
  // this is what actually picks the grid cell. Top/bottom are untouched,
  // they already cost height, not width.
  const isMobile = useIsMobile()
  const dock = isMobile && (dockPref === 'left' || dockPref === 'right') ? 'bottom' : dockPref

  const navBarH = useMobileNavBarStore((s) => s.height)
  // navBarH is only ever nonzero while Sidebar's phone bottom-bar is
  // mounted, so it doubles as the "are we actually on a phone" signal here.
  const edgeToolbar = dock === 'bottom' && navBarH > 0

  const toolbarCell = edgeToolbar
    ? 'col-start-1 col-end-4 row-start-3 justify-self-stretch self-end'
    : dock === 'top'
      ? 'col-start-2 row-start-1 justify-self-center self-start'
      : dock === 'bottom'
        ? 'col-start-2 row-start-3 justify-self-center self-end'
        : dock === 'left'
          ? 'col-start-1 row-start-2 justify-self-start self-center'
          : 'col-start-3 row-start-2 justify-self-end self-center'

  // Transport lives top-center by default (a video-scrubber convention) and
  // only steps aside — to top-right — when the dock is also on top and
  // would otherwise claim that same cell.
  const transportCell =
    dock === 'top'
      ? 'col-start-3 row-start-1 justify-self-end self-start'
      : 'col-start-2 row-start-1 justify-self-center self-start'

  return (
    <div
      className={cn('pointer-events-none absolute inset-0 z-40 grid gap-3 py-4', edgeToolbar ? 'px-0' : 'px-4')}
      style={{
        gridTemplateColumns: 'minmax(0,1fr) fit-content(100%) minmax(0,1fr)',
        gridTemplateRows: 'minmax(0,1fr) fit-content(100%) minmax(0,1fr)',
        // navBarH already includes the bar's own safe-area padding (it's a
        // real measured box height), so it isn't added again here.
        paddingBottom:
          dock === 'bottom' && navBarH > 0
            ? `calc(${navBarH}px + 0.75rem)`
            : 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className={cn('pointer-events-auto min-h-0 min-w-0', toolbarCell)}>
        <Toolbar pageId={pageId} edge={edgeToolbar} />
      </div>
      {showTransport && (
        <div className={cn('pointer-events-auto min-h-0 min-w-0', transportCell)}>
          <Transport pageId={pageId} />
        </div>
      )}
    </div>
  )
}
