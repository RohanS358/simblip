'use client'

// A dock column: hosts the workspace panel(s) stacked on the left rail.
// Always exactly one panel today ('pages', the Sidebar) — this used to be
// side-swappable and mergeable-into-tabs, with a second 'inspector' panel
// that could dock independently; Properties absorbed into the rail (see
// sidebar-sections.ts) retired that second panel, and nothing ever moved
// sides again. Deleted the unused arrangement store (lib/store/layout.ts)
// rather than keep flexibility with no second caller.
//
// Panel text size/spacing preferences apply here (CSS zoom + letter-spacing),
// so the canvas keeps its own scale.

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

  if (panels.length === 0) return null

  return (
    <div
      className="relative z-30 flex min-h-0 flex-col"
      style={{
        // CSS zoom scales panel text AND spacing together without touching
        // the canvas; letter-spacing adds airiness on top.
        zoom: fontScale !== 1 ? fontScale : undefined,
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
}
