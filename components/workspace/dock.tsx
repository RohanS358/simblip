'use client'

// A dock column: hosts the workspace panels assigned to one side. Panels can
// be moved between sides, merged into tabs, split into a resizable stack,
// and reordered — the customizable-layout layer the shell composes.
//
// Panel text size/spacing preferences apply here (CSS zoom + letter-spacing),
// so the canvas keeps its own scale.

import type { ReactNode } from 'react'
import { ArrowLeftRight, ArrowUpDown, Columns2, Layers } from 'lucide-react'
import { useLayout, type PanelId, type Side } from '@/lib/store/layout'
import { usePrefs } from '@/lib/store/preferences'
import { cn } from '@/lib/utils'

const PANEL_LABEL: Record<PanelId, string> = { pages: 'Pages', inspector: 'Inspector' }

function Chrome({ side, panels }: { side: Side; panels: PanelId[] }) {
  const { merged, activeTab, setActiveTab, moveSide, toggleMerged, swapOrder } = useLayout()
  const two = panels.length === 2
  return (
    <div className="mx-3 mt-3 flex h-7 shrink-0 items-center gap-1 rounded-lg border border-border/40 bg-background/50 px-1 backdrop-blur-sm">
      {panels.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => setActiveTab(id)}
          className={cn(
            'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
            two && merged && activeTab !== id
              ? 'text-muted-foreground hover:text-foreground'
              : 'bg-accent/70 text-foreground'
          )}
        >
          {PANEL_LABEL[id]}
        </button>
      ))}
      <div className="flex-1" />
      {two && (
        <>
          <button
            type="button"
            aria-label={merged ? 'Split into stack' : 'Merge into tabs'}
            title={merged ? 'Split into stack' : 'Merge into tabs'}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={toggleMerged}
          >
            {merged ? <Columns2 className="h-3.5 w-3.5 rotate-90" /> : <Layers className="h-3.5 w-3.5" />}
          </button>
          {!merged && (
            <button
              type="button"
              aria-label="Swap order"
              title="Swap order"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={swapOrder}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
          )}
        </>
      )}
      <button
        type="button"
        aria-label="Move to other side"
        title="Move to other side"
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => {
          const target: Side = side === 'left' ? 'right' : 'left'
          ;(two ? [activeTab] : panels).forEach((id) => moveSide(id, target))
        }}
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Dock({
  side,
  panels,
  render,
}: {
  side: Side
  panels: PanelId[]
  render: (id: PanelId) => ReactNode
}) {
  const { merged, activeTab, order, split, setSplit } = useLayout()
  // `?? 1` — persisted prefs from before these fields existed lack them
  const fontScale = usePrefs((s) => s.notebook.panelFontScale ?? 1)
  const spacing = usePrefs((s) => s.notebook.panelSpacing ?? 1)

  if (panels.length === 0) return null
  const ordered = order.filter((id) => panels.includes(id))
  const two = ordered.length === 2
  const active = ordered.includes(activeTab) ? activeTab : ordered[0]

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
      <Chrome side={side} panels={ordered} />
      {!two || merged ? (
        ordered.map((id) => (
          <div key={id} className={cn('flex min-h-0 flex-1', two && merged && id !== active && 'hidden')}>
            {render(id)}
          </div>
        ))
      ) : (
        <>
          <div className="flex min-h-0" style={{ flex: split }}>
            {render(ordered[0])}
          </div>
          <div
            role="separator"
            aria-label="Resize panels"
            className="mx-6 h-1.5 shrink-0 cursor-row-resize rounded-full bg-border/50 transition-colors hover:bg-border"
            onPointerDown={(e) => {
              e.preventDefault()
              const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
              const move = (ev: PointerEvent) =>
                setSplit((ev.clientY - host.top) / Math.max(1, host.height))
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
          <div className="flex min-h-0" style={{ flex: 1 - split }}>
            {render(ordered[1])}
          </div>
        </>
      )}
    </div>
  )
}
