'use client'

// Floating tool switcher. Tools are data — adding one never touches layout.
// The palette (component library) opens from here; drawing tools recognize
// sketches into geometry that behaviors can then make real.

import {
  MousePointer2,
  Pen,
  Circle,
  Square,
  Minus,
  Type,
  StickyNote,
  Sigma,
  ChartLine,
  Shapes,
  Sparkles,
  Wand2,
  ScanText,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const TOOLS: { tool: Tool; icon: React.ElementType; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { tool: 'pen', icon: Pen, label: 'Pen — sketches become shapes', key: 'P' },
  { tool: 'circle', icon: Circle, label: 'Circle', key: 'C' },
  { tool: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
  { tool: 'line', icon: Minus, label: 'Line / Beam', key: 'L' },
  { tool: 'text', icon: Type, label: 'Text', key: 'T' },
  { tool: 'note', icon: StickyNote, label: 'Note', key: 'N' },
  { tool: 'formula', icon: Sigma, label: 'Formula', key: 'F' },
  { tool: 'graph', icon: ChartLine, label: 'Graph', key: 'G' },
]

function ToolButton({
  active,
  label,
  shortcut,
  accent,
  onClick,
  children,
}: {
  active: boolean
  label: string
  shortcut?: string
  accent?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all',
            active
              ? 'text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
          style={active ? { background: accent ?? 'var(--accent-blue)' } : undefined}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
        {shortcut && <span className="ml-1.5 font-mono text-[10px] opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export function Toolbar({
  paletteOpen,
  onTogglePalette,
  showAi = true,
}: {
  paletteOpen: boolean
  onTogglePalette: () => void
  /** Students learn by building — the AI shortcut is staff-only. */
  showAi?: boolean
}) {
  const tool = useDocStore((s) => s.tool)
  const setTool = useDocStore((s) => s.setTool)
  const inkToShape = useDocStore((s) => s.inkToShape)
  const inkAnnotate = useDocStore((s) => s.inkAnnotate)
  const toggleInkToShape = useDocStore((s) => s.toggleInkToShape)
  const toggleInkAnnotate = useDocStore((s) => s.toggleInkAnnotate)
  const penSize = useDocStore((s) => s.penSize)
  const setPenSize = useDocStore((s) => s.setPenSize)
  const aiOpen = useWorkspaceStore((s) => s.aiOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)

  // Pen-size flyout: opens on hover (mouse) with a grace timer so the cursor
  // can travel to the slider; on touch, tapping the already-active pen toggles it.
  const [showSize, setShowSize] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const openSize = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setShowSize(true)
  }
  const closeSize = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowSize(false), 250)
  }
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }, [])

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-40 max-w-[calc(100vw-1rem)] -translate-x-1/2"
    >
      {showSize && (
        <div
          className="glass-strong absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-2.5 rounded-xl px-3 py-2"
          // Mouse-gated: on touch, pointerleave fires after every slider drag
          // and would dismiss the flyout mid-adjustment.
          onPointerEnter={(e) => e.pointerType === 'mouse' && openSize()}
          onPointerLeave={(e) => e.pointerType === 'mouse' && closeSize()}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
            <span
              className="rounded-full bg-foreground"
              style={{ width: penSize, height: penSize }}
            />
          </span>
          <input
            type="range"
            min={1.5}
            max={12}
            step={0.5}
            value={penSize}
            aria-label="Pen thickness"
            className="w-28 accent-[var(--accent-blue)]"
            onChange={(e) => setPenSize(Number(e.target.value))}
          />
          <span className="w-7 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {penSize}px
          </span>
        </div>
      )}

      {/* Inner pill owns the horizontal scroll so the flyout above never clips. */}
      <div className="glass-strong no-scrollbar flex items-center gap-1 overflow-x-auto rounded-2xl p-1.5">
      {TOOLS.map(({ tool: t, icon: Icon, label, key }) =>
        t === 'pen' ? (
          <span
            key={t}
            className="shrink-0"
            onPointerEnter={(e) => e.pointerType === 'mouse' && openSize()}
            onPointerLeave={(e) => e.pointerType === 'mouse' && closeSize()}
          >
            <ToolButton
              active={tool === 'pen'}
              label={`${label} — hover for thickness`}
              shortcut={key}
              onClick={() => (tool === 'pen' ? setShowSize((v) => !v) : setTool('pen'))}
            >
              <Icon className="h-4 w-4" />
            </ToolButton>
          </span>
        ) : (
          <ToolButton
            key={t}
            active={tool === t}
            label={label}
            shortcut={key}
            onClick={() => {
              setShowSize(false)
              setTool(t)
            }}
          >
            <Icon className="h-4 w-4" />
          </ToolButton>
        )
      )}

      <div className="mx-1 h-6 w-px shrink-0 bg-border" />

      <ToolButton
        active={inkToShape}
        label={inkToShape ? 'Ink → shape: on (sketches become components)' : 'Ink → shape: off (raw ink stays ink)'}
        accent="var(--accent-amber)"
        onClick={toggleInkToShape}
      >
        <Wand2 className="h-4 w-4" />
      </ToolButton>

      <ToolButton
        active={inkAnnotate}
        label={inkAnnotate ? 'Ink annotations: on (scribble near a part to set value/name)' : 'Ink annotations: off'}
        accent="var(--accent-amber)"
        onClick={toggleInkAnnotate}
      >
        <ScanText className="h-4 w-4" />
      </ToolButton>

      <div className="mx-1 h-6 w-px shrink-0 bg-border" />

      <ToolButton
        active={paletteOpen || tool === 'place'}
        label="Components — masses, springs, circuits"
        accent="var(--accent-mint)"
        onClick={onTogglePalette}
      >
        <Shapes className="h-4 w-4" />
      </ToolButton>

      {showAi && (
        <ToolButton active={aiOpen} label="Ask AI" accent="var(--accent-violet)" onClick={() => togglePanel('ai')}>
          <Sparkles className="h-4 w-4" />
        </ToolButton>
      )}
    </motion.div>
  )
}
