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
// notebook.dock) is honoured everywhere except a PHONE, where left/right are
// overridden to bottom: a side dock permanently eats into a narrow width
// while a phone has height to spare. A tablet is a touch device with a
// desktop's worth of width, so it keeps the side it was given — the same
// touch-AND-narrow test the Toolbar uses to fold its extra tools into a
// "More" flyout (`condensed` in toolbar.tsx).
//
// On a phone, the app nav rail (sidebar.tsx) is ALSO a fixed bottom bar. This
// dock used to subtract the rail's published height itself; the shell's
// <main> reserves it for every page kind now (mobile-shell.tsx), so this
// overlay's inset-0 already ends above the rail.
//
// Docked bottom with a nav rail present (i.e. an actual phone) (docked bottom, nav rail present — i.e. an actual
// phone) also switches the toolbar itself from the floating centered pill
// it is everywhere else into a full-bleed bar flush with both edges, sitting
// right above the rail — a phone's bottom edge is a fixed piece of chrome,
// not a floating control, same visual language as the rail beneath it.

import { usePrefs } from '@/lib/store/preferences'
import { useIsMobile, useIsNarrow } from '@/hooks/use-mobile'
import { Toolbar } from './toolbar'
import { FloatingTransport } from './transport'
import { cn } from '@/lib/utils'
import { useViewChrome } from '@/hooks/use-dock-clearance'

import { SundialDock } from './sundial-dock'

/**
 * Should the drawing dock float over this page kind at all?
 *
 * It's a pen-and-shapes tool, so it belongs wherever there's a real canvas to
 * draw on — which is every kind except the spreadsheet:
 *
 *   board  the page itself is the canvas
 *   doc    each sheet is a canvas
 *   pptx   each slide is a canvas (locked/transparent, like a PDF page)
 *   pdf    per-page transparent ink overlay, gated on the pdf-tools toggle
 *   image  transparent ink overlay sized to the image (imageAnnotPageId)
 *   web    transparent ink overlay over the embedded page (webAnnotPageId)
 *   xlsx   NO canvas — x-data-spreadsheet is a third-party widget that owns
 *          its own scrolling grid, so there is nothing to draw on and the
 *          dock would be a row of dead buttons.
 *
 * pptx/image/web used to be excluded here even though image-view.tsx and
 * web-view.tsx both build an ink layer specifically for this dock to drive.
 * The exclusion existed because the overlay lands on top of whatever the view
 * draws along its own bottom edge and, being pointer-events-auto, eats the
 * taps meant for it — that's now handled properly by useViewChrome instead of
 * by hiding the dock (see the padding in CanvasControls below).
 *
 * Both shells used to inline their own version of this check, which is how
 * pptx ended up excluded on mobile only.
 */
export const showsCanvasDock = (kind: string, pdfToolsOn: boolean): boolean =>
  kind === 'pdf' ? pdfToolsOn : kind !== 'xlsx'

/**
 * Kinds whose real editing surface is a per-sheet canvas rather than the page
 * itself — doc sheets, pptx slides, and the image/web ink overlays. The view
 * publishes which one is focused as `activeSheetId`; everything the dock does
 * (draw, insert, select, undo) has to target that, not the container page.
 *
 * Both shells computed this inline and had drifted apart: the desktop shell
 * listed pptx, mobile didn't, and neither listed image or web — so the dock
 * would have drawn onto the empty container page instead of the ink layer.
 */
const SHEET_KINDS = new Set(['doc', 'pptx', 'image', 'web'])

export const contentPageIdFor = (
  kind: string,
  activeSheetId: string | null,
  activePageId: string | null,
  pdfToolsOn: boolean
): string | null =>
  SHEET_KINDS.has(kind) || pdfToolsOn ? activeSheetId ?? activePageId : activePageId

export function CanvasControls({
  pageId,
  showTransport = true,
}: {
  pageId: string
  showTransport?: boolean
}) {
  const dockPrefs = usePrefs((s) => s.dock)
  const isMobile = useIsMobile()
  // Phone only — a tablet is a touch device with room for a side dock, so it
  // keeps whatever side you picked. Mirrors `condensed` in toolbar.tsx.
  const isNarrow = useIsNarrow()
  const condensed = isMobile && isNarrow
  const dockSide = condensed && (dockPrefs.fixedSide === 'left' || dockPrefs.fixedSide === 'right')
    ? 'bottom'
    : dockPrefs.fixedSide

  // Whatever the view draws along its own bottom edge (the presentation's
  // slide rail + control bar). Reserved rather than overlapped — see
  // showsCanvasDock's note.
  const chromeBottom = useViewChrome((s) => s.bottom)

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

  // How much app chrome FLOATS over this overlay, and therefore has to be
  // padded around. On the desktop shell the header and the sidebar both paint
  // on top of the canvas, so inset-0 reaches under them. The mobile shell
  // (mobile-shell.tsx) puts both in flow instead — the header and tab strip
  // are shrink-0 rows above <main>, the sidebar rail is a flex sibling inside
  // it — so inset-0 already starts clear of them, and padding for them again
  // pushed the dock a header's height down into the page (and a rail's width
  // to the right of centre).
  //
  // Desktop values: 3rem is the header's h-12, in rem so it tracks Interface
  // scale. --sidebar-panel-w is published by sidebar.tsx (rail + panel), minus
  // --sidebar-reserve-w because on a document kind the shell already reserved
  // that width in layout — insetting by the full panel width again would
  // double the gap.
  const chromeTop = isMobile ? '0px' : '3rem'
  const chromeLeft = isMobile
    ? '0px'
    : 'calc(var(--sidebar-panel-w, 0px) - var(--sidebar-reserve-w, 0px))'

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
            // The nav rail's height is reserved by the shell's <main> now
            // (mobile-shell.tsx), so this overlay's inset-0 already stops
            // above it — padding for it again would double the gap. The
            // view's OWN bottom chrome is inside this box though, so that
            // part is on us.
            paddingBottom: edgeToolbar
              ? chromeBottom
              : `calc(max(1rem, env(safe-area-inset-bottom)) + ${chromeBottom}px)`,
            // See chromeLeft/chromeTop above. An edge bar butts straight up
            // against the header: it has no bottom border any more (its
            // material is a masked layer that fades out below itself, see
            // shell.tsx), so "welded strip" IS the intended read for a fixed
            // bar — a floating dock is the one that wants air, and it gets
            // its 1rem here.
            paddingLeft: edgeToolbar ? chromeLeft : `calc(1rem + ${chromeLeft})`,
            paddingTop: edgeToolbar ? chromeTop : `calc(1rem + ${chromeTop})`,
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

