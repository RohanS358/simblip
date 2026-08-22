'use client'

// The one header every sidebar panel wears.
//
// Before this existed, each panel drew its own: ai-panel used a 13px
// foreground title with border-b/60 and px-3 py-2; tools/uploads/library used
// an 11px MUTED title with border-b/50 and three different paddings; the
// inspector had no header at all, so switching to Properties dropped the
// title bar entirely and the content started at a different offset. Same
// role, five different treatments — which is what made switching sections
// feel like switching apps.
//
// Sizing is fixed (h-10) rather than padding-derived, so every panel's
// content begins at the SAME y no matter what its header holds.

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PanelHeader({
  icon: Icon,
  title,
  accent = 'var(--accent-blue)',
  actions,
  children,
}: {
  icon: LucideIcon
  title: string
  /** The panel's own hue for the icon — the one spot of colour up here. */
  accent?: string
  /** Icon buttons, right-aligned on the title row. */
  actions?: React.ReactNode
  /** Search field, filter chips — anything that belongs under the title but
   *  still inside the header's border and sticky/glass treatment. */
  children?: React.ReactNode
}) {
  return (
    <div
      // --card is LIGHTER than --sidebar in every theme (light: 0.995 vs
      // 0.982; dark: 0.215 vs 0.17), so a card-tinted header read as a bright
      // white band sitting on the panel rather than part of it. And at /60
      // opacity the canvas showed through as it scrolled. The header belongs
      // to the panel, so it takes the panel's own surface, opaque.
      className={cn(
        'sticky top-0 z-20 shrink-0 border-b border-border/60',
'bg-sidebar'
      )}
    >
      <div className="flex h-10 items-center gap-2 px-3">
        <Icon className="h-4 w-4 shrink-0" style={{ color: accent }} />
        <h2 className="min-w-0 flex-1 truncate text-ui-md font-medium text-foreground" title={title}>
          {title}
        </h2>
        {actions}
      </div>
      {children && <div className="space-y-2 px-3 pb-2">{children}</div>}
    </div>
  )
}
