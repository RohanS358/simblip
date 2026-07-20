'use client'

// The two floating controls that share the canvas's edges — the tool dock
// and the simulation transport — laid out on one 3×3 grid instead of each
// guessing its own absolute position and reactively nudging itself away if
// it happens to measure a collision with the other (the old approach: see
// hooks/use-dock-clearance.ts, still used by unrelated pills like the PDF
// reader's zoom indicator). Every edge and corner is its own grid track —
// an item can grow right up to its track's limit (the toolbar's own pill
// already scrolls internally past that point, see toolbar.tsx) but it can
// never spill into a neighbouring track, so the dock and the transport
// can't end up on top of each other on any of the four dock sides.

import { usePrefs } from '@/lib/store/preferences'
import { Toolbar } from './toolbar'
import { Transport } from './transport'
import { cn } from '@/lib/utils'

export function CanvasControls({ pageId }: { pageId: string }) {
  const dock = usePrefs((s) => s.notebook.dock)

  const toolbarCell =
    dock === 'top'
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
      className="pointer-events-none absolute inset-0 z-40 grid gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      style={{
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,max-content) minmax(0,1fr)',
        gridTemplateRows: 'minmax(0,1fr) minmax(0,max-content) minmax(0,1fr)',
      }}
    >
      <div className={cn('pointer-events-auto min-h-0 min-w-0', toolbarCell)}>
        <Toolbar pageId={pageId} />
      </div>
      <div className={cn('pointer-events-auto min-h-0 min-w-0', transportCell)}>
        <Transport pageId={pageId} />
      </div>
    </div>
  )
}
