'use client'

// A dock column: hosts the workspace panel(s) stacked on the left rail.
// Always exactly one panel today ('pages', the Sidebar) — this used to be
// side-swappable and mergeable-into-tabs, with a second 'inspector' panel
// that could dock independently; Properties absorbed into the rail (see
// sidebar-sections.ts) retired that second panel, and nothing ever moved
// sides again. Deleted the unused arrangement store (lib/store/layout.ts)
// rather than keep flexibility with no second caller.
//
// Panel text size/spacing preferences apply here (transform: scale +
// letter-spacing), so the canvas keeps its own scale.
//
// Uses transform, not CSS zoom: zoom resizes the layout box, which is what
// let a single style prop scale font AND spacing together with no extra
// wrapper — but Radix's portalled popovers (dropdowns, tooltips) position
// themselves from the trigger's getBoundingClientRect(), and zoom's effect
// on that geometry is inconsistent across browsers, so any dropdown opened
// from inside a zoomed panel could render detached from its trigger.
// transform: scale() doesn't have that problem, but it also doesn't resize
// the layout box — the OUTER div below stays at the panel's real (unscaled)
// size so surrounding flex siblings never see it change, while the INNER
// div is sized up by 1/scale first (so its own layout is still the full
// real panel width) and then visually scaled back down to fit.

import type { ReactNode } from 'react'
import { usePrefs } from '@/lib/store/preferences'

export type PanelId = 'pages'

export function Dock({
  panels,
  render,
}: {
  panels: PanelId[]
  render: (id: PanelId) => ReactNode
}) {
  // `?? 1` — persisted prefs from before these fields existed lack them
  const fontScale = usePrefs((s) => s.notebook.panelFontScale ?? 1)
  const spacing = usePrefs((s) => s.notebook.panelSpacing ?? 1)
  const scaled = fontScale !== 1

  const content = (
    <div
      className="relative z-30 flex min-h-0 flex-col"
      style={{
        transform: scaled ? `scale(${fontScale})` : undefined,
        transformOrigin: 'top left',
        // Compensate the inverse of the visual shrink/grow so the
        // unscaled layout box (this div's real width/height before
        // transform) still matches the panel's actual on-screen size.
        width: scaled ? `${100 / fontScale}%` : undefined,
        height: scaled ? `${100 / fontScale}%` : undefined,
        letterSpacing: spacing !== 1 ? `${((spacing - 1) * 2).toFixed(2)}px` : undefined,
      }}
    >
      {panels.map((id) => (
        <div key={id} className="flex min-h-0 flex-1">
          {render(id)}
        </div>
      ))}
    </div>
  )

  if (panels.length === 0) return null
  if (!scaled) return content

  return <div className="relative z-30 min-h-0 flex-1 overflow-hidden">{content}</div>
}
