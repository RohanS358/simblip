'use client'

// The sidebar's "Tools" section — utilities you reach for occasionally, not
// drawing modes, so they don't cost permanent dock space. The calculator
// still floats over the canvas (draggable, resizable, remembers its spot);
// this panel is just its new open/close trigger, moved off the dock. Table,
// Graph and Code are quick-insert shortcuts: pick one here, then click the
// canvas — the exact same arm-a-tool flow as the dock's Table/Graph buttons,
// just reachable while browsing instead of hunting the floating dock. Code
// lives ONLY here, not on the dock — the least-used object type for a
// physics/engineering notebook doesn't earn permanent dock real estate.
// See docs/ui-simplification-plan.md §3/§4.

import { Calculator as CalculatorIcon, ChartLine, TableProperties, Terminal } from 'lucide-react'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { cn } from '@/lib/utils'

const QUICK_INSERT: { tool: Tool; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { tool: 'table', icon: TableProperties, label: 'Table' },
  { tool: 'graph', icon: ChartLine, label: 'Graph' },
  { tool: 'code', icon: Terminal, label: 'Code' },
]

export function ToolsPanel() {
  const calcOpen = useWorkspaceStore((s) => s.calcOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const tool = useDocStore((s) => s.tool)
  const setTool = useDocStore((s) => s.setTool)

  return (
    <div className="flex h-full min-h-0 flex-col p-2.5">
      <span className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Tools
      </span>

      <button
        type="button"
        aria-pressed={calcOpen}
        className={cn(
          'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors',
          calcOpen
            ? 'border-[var(--accent-violet)] bg-[color-mix(in_oklch,var(--accent-violet)_10%,transparent)] text-foreground'
            : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
        )}
        onClick={() => togglePanel('calc')}
      >
        <CalculatorIcon className="h-4 w-4" />
        {calcOpen ? 'Close calculator' : 'Open calculator'}
      </button>

      <span className="px-1 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70">
        Quick insert
      </span>
      <div className="space-y-1">
        {QUICK_INSERT.map(({ tool: t, icon: Icon, label }) => {
          const active = tool === t
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors',
                active
                  ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)] text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
              onClick={() => setTool(active ? 'select' : t)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </div>
      {tool === 'table' || tool === 'graph' || tool === 'code' ? (
        <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground">
          Click the canvas to place · Esc to stop
        </p>
      ) : null}
    </div>
  )
}
