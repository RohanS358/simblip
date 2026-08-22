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

import { useState, useMemo } from 'react'
import {
  Calculator as CalculatorIcon,
  ChartLine,
  TableProperties,
  Terminal,
  Sliders,
  MousePointerClick,
  Zap,
  Box,
  BarChart3,
  Ruler,
  Search,
  Wrench,
} from 'lucide-react'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { Input } from '@/components/ui/input'
import { PanelHeader } from './panel-header'
import { cn } from '@/lib/utils'

const QUICK_INSERT: { tool: Tool; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { tool: 'table', icon: TableProperties, label: 'Formula Table' },
  { tool: 'graph', icon: ChartLine, label: 'Graph' },
  { tool: 'surface3d', icon: Box, label: '3D Graph' },
  { tool: 'chart', icon: BarChart3, label: 'Chart' },
  { tool: 'code', icon: Terminal, label: 'Code' },
  { tool: 'measurement', icon: Ruler, label: 'Measurement' },
]

const INTERACTIVE_TOOLS: { tool: Tool; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { tool: 'slider', icon: Sliders, label: 'Slider' },
  { tool: 'button', icon: MousePointerClick, label: 'Button' },
  { tool: 'trigger', icon: Zap, label: 'Trigger' },
]

export function ToolsPanel() {
  const calcOpen = useWorkspaceStore((s) => s.calcOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const tool = useDocStore((s) => s.tool)
  const setTool = useDocStore((s) => s.setTool)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()

  const filteredInteractive = useMemo(
    () => INTERACTIVE_TOOLS.filter((t) => !q || t.label.toLowerCase().includes(q)),
    [q]
  )

  const filteredQuickInsert = useMemo(
    () => QUICK_INSERT.filter((t) => !q || t.label.toLowerCase().includes(q)),
    [q]
  )

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Tools panel">
      <PanelHeader icon={Wrench} title="Tools" accent="var(--accent-violet)">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools…"
            className="h-8 pl-8 text-ui-sm"
          />
        </div>
      </PanelHeader>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {(!q || 'calculator'.includes(q)) && (
          <button
            type="button"
            aria-pressed={calcOpen}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-ui-sm transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.99]',
              calcOpen
                ? 'border-[var(--accent-violet)] bg-[color-mix(in_oklch,var(--accent-violet)_10%,transparent)] text-foreground'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            )}
            onClick={() => togglePanel('calc')}
          >
            <CalculatorIcon className="h-4 w-4 text-[var(--accent-violet)]" />
            {calcOpen ? 'Close calculator' : 'Open calculator'}
          </button>
        )}

        {filteredInteractive.length > 0 && (
          <div>
            <span className="block px-1 pb-1 text-ui-2xs font-medium text-muted-foreground">
              Interactive controls
            </span>
            <div className="space-y-1">
              {filteredInteractive.map(({ tool: t, icon: Icon, label }) => {
                const active = tool === t
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-ui-sm transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.99]',
                      active
                        ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)] text-foreground'
                        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                    )}
                    onClick={() => setTool(active ? 'select' : t)}
                  >
                    <Icon className="h-4 w-4 text-[var(--accent-blue)]" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {filteredQuickInsert.length > 0 && (
          <div>
            <span className="block px-1 pb-1 text-ui-2xs font-medium text-muted-foreground">
              Quick insert
            </span>
            <div className="space-y-1">
              {filteredQuickInsert.map(({ tool: t, icon: Icon, label }) => {
                const active = tool === t
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-ui-sm transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.99]',
                      active
                        ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)] text-foreground'
                        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                    )}
                    onClick={() => setTool(active ? 'select' : t)}
                  >
                    <Icon className="h-4 w-4 text-[var(--accent-blue)]" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {tool === 'table' || tool === 'graph' || tool === 'surface3d' || tool === 'chart' || tool === 'code' || tool === 'slider' || tool === 'button' || tool === 'trigger' ? (
          <p className="mt-1 rounded-lg bg-accent/50 px-2.5 py-1.5 text-ui-xs text-muted-foreground">
            Click the canvas to place · Esc to stop
          </p>
        ) : tool === 'measurement' ? (
          <p className="mt-1 rounded-lg bg-accent/50 px-2.5 py-1.5 text-ui-xs text-muted-foreground">
            Click-drag across the canvas to measure · Esc to stop
          </p>
        ) : null}
      </div>
    </div>
  )
}
