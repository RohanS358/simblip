'use client'

// Floating tool switcher — reduced to exactly the drawing modes and inline
// objects you place by clicking-then-drawing on the canvas: Select, Pen,
// Shaper, Eraser, Text, Note, Formula, Graph, Table, Shapes, Document. Touch
// devices also get Lasso right next to Select (see canvas.tsx's marquee
// gesture) — a mouse can already drag-select over empty space, but a finger
// needs an explicit tool to circle objects without grabbing one underneath.
// Everything that was a toggle, browser, or utility (ink-to-shape/ink-
// annotate toggles, touch-assist toggles, calculator, the components
// palette, Ask AI, the Code quick-insert) has moved to the sidebar's Tools/
// Components sections, the pen settings popover's Touch assist section, or
// a dedicated AI corner bubble — see docs/ui-simplification-plan.md §3.
// Ink-to-shape/ink-annotate were already duplicated in Settings → Notebook,
// so they're a pure removal here, not a relocation.

import {
  MousePointer2,
  LassoSelect,
  Pen,
  Eraser,
  Paperclip,
  Circle,
  Square,
  Minus,
  Type,
  StickyNote,
  Sigma,
  ChartLine,
  Spline,
  TableProperties,
  Blocks,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import { actionsForSelection } from '@/lib/scene/selection-actions'
import { PenSettings } from './pen-settings'
import { usePrefs } from '@/lib/store/preferences'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSlashMenuStore } from '@/lib/store/slash-menu'
import { uid, type SceneObject } from '@/lib/scene/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useDockRect } from '@/hooks/use-dock-clearance'

const TOOLS: { tool: Tool; icon: React.ComponentType<{ className?: string }>; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { tool: 'pen', icon: Pen, label: 'Pen — ink stays as drawn', key: 'P' },
  { tool: 'shaper', icon: Spline, label: 'Shaper — 90° elbowed lines, like Shift+pen', key: 'S' },
  { tool: 'eraser', icon: Eraser, label: 'Eraser — drag over ink to remove it', key: 'E' },
  { tool: 'text', icon: Type, label: 'Text', key: 'T' },
  { tool: 'note', icon: StickyNote, label: 'Note', key: 'N' },
  { tool: 'formula', icon: Sigma, label: 'Formula', key: 'F' },
  { tool: 'graph', icon: ChartLine, label: 'Graph', key: 'G' },
  { tool: 'gridtable', icon: TableProperties, label: 'Grid Table', key: 'B' },
]

/** Crisp inline n-gon icon — lucide has no heptagon. */
function NgonIcon({ n }: { n: number }) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return `${(12 + 9 * Math.cos(a)).toFixed(2)},${(12 + 9 * Math.sin(a)).toFixed(2)}`
  }).join(' ')
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <polygon points={pts} strokeLinejoin="round" />
    </svg>
  )
}

/** Dock icon for the Shapes group — triangle + circle. */
const ShapesGroupIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
    <polygon points="8.5,2.5 14.5,12.5 2.5,12.5" strokeLinejoin="round" />
    <circle cx={16} cy={16.5} r={5} />
  </svg>
)

const RectIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x={2.5} y={7} width={19} height={10} rx={1.5} />
  </svg>
)

const OvalIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
    <ellipse cx={12} cy={12} rx={9.5} ry={6} />
  </svg>
)

// The Shapes group: everything that used to be a standalone dock tool plus
// the full regular-polygon family. `id` rides in toolOption ('shape' tool).
const SHAPES: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'line', label: 'Line / Beam', icon: <Minus className="h-4 w-4" /> },
  { id: 'circle', label: 'Circle', icon: <Circle className="h-4 w-4" /> },
  { id: 'oval', label: 'Oval', icon: <OvalIcon /> },
  { id: 'square', label: 'Square', icon: <Square className="h-4 w-4" /> },
  { id: 'rect', label: 'Rectangle', icon: <RectIcon /> },
  { id: 'triangle', label: 'Triangle', icon: <NgonIcon n={3} /> },
  { id: 'pentagon', label: 'Pentagon', icon: <NgonIcon n={5} /> },
  { id: 'hexagon', label: 'Hexagon', icon: <NgonIcon n={6} /> },
  { id: 'heptagon', label: 'Heptagon', icon: <NgonIcon n={7} /> },
  { id: 'octagon', label: 'Octagon', icon: <NgonIcon n={8} /> },
]

function ToolButton({
  active,
  label,
  shortcut,
  accent,
  size = 'h-9 w-9',
  onClick,
  onDoubleClick,
  children,
}: {
  active: boolean
  label: string
  shortcut?: string
  accent?: string
  /** Button footprint — shrunk to 'h-8 w-8' on mobile so the dock's fixed
   *  track (see canvas-controls.tsx) fits more tools before it has to
   *  scroll. */
  size?: string
  onClick?: () => void
  onDoubleClick?: () => void
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
          onDoubleClick={onDoubleClick}
          className={cn(
            'flex shrink-0 items-center justify-center rounded-xl transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]',
            size,
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
        {shortcut && <span className="ml-1.5 font-mono text-[0.625rem] opacity-60">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

export function Toolbar({
  pageId,
  edge = false,
}: {
  pageId?: string
  /** A phone's bottom edge is a fixed piece of chrome, not a floating
   *  control — when true (see canvas-controls.tsx) the dock stretches full
   *  width, flush with both edges, instead of the centered floating pill it
   *  is everywhere else. */
  edge?: boolean
}) {
  const motion = useSpring()
  const tool = useDocStore((s) => s.tool)
  const setTool = useDocStore((s) => s.setTool)
  // Contextual segment: whatever the current selection can do, straight from
  // the selection-actions pipeline (lib/scene/selection-actions.ts). The dock
  // is where element actions live — nothing floats over the canvas anymore.
  const selection = useDocStore((s) => s.selection)
  const editing = useRuntimeStore((s) => s.mode) === 'edit'
  const selActions = pageId && selection.length > 0
    ? actionsForSelection({ pageId, ids: selection, editing })
    : []
  // Keep the last non-empty list rendered while the segment folds shut, so
  // deselecting collapses smoothly instead of blinking the buttons away.
  const lastActionsRef = useRef(selActions)
  if (selActions.length > 0) lastActionsRef.current = selActions
  const segActions = selActions.length > 0 ? selActions : lastActionsRef.current
  // Lasso only earns a dock slot on touch: a mouse already gets multi-select
  // for free (drag the Select tool over empty space) — a finger doesn't
  // reliably find "empty space" in a crowded diagram, so touch needs an
  // explicit tool that circles objects without ever grabbing one.
  const isMobile = useIsMobile()

  // Pen settings popover: the ONE control surface for the pen. Opens on
  // double-click (or by tapping the already-active pen — the touch
  // equivalent). The old hover thickness flyout is gone on purpose: every
  // pen control lives in the settings panel, nowhere else.
  const [showPen, setShowPen] = useState(false)
  const [showShapes, setShowShapes] = useState(false)
  const dockPref = usePrefs((s) => s.notebook.dock)
  // A side dock (left/right) claims a slice of the SCARCE axis on a phone —
  // its own width, permanently, out of a ~375px screen. A phone has plenty
  // of height to spare instead, so the side preference only applies on
  // desktop; on mobile every dock renders along the bottom regardless of
  // what's saved in prefs (top stays top — it already costs height, not
  // width, same as bottom).
  const dock = isMobile && (dockPref === 'left' || dockPref === 'right') ? 'bottom' : dockPref
  const vertical = dock === 'left' || dock === 'right'
  // Smaller footprint on mobile so more tools fit before the pill's own
  // overflow-x-auto has to kick in (see canvas-controls.tsx for why the
  // track itself is capped to the viewport in the first place).
  const btnSize = isMobile ? 'h-8 w-8' : 'h-9 w-9'
  const iconSize = isMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const penFlyoutClass =
    dock === 'bottom'
      ? 'bottom-full left-1/2 mb-2 -translate-x-1/2'
      : dock === 'top'
        ? 'left-1/2 top-full mt-2 -translate-x-1/2'
        : dock === 'left'
          ? 'left-full top-1/2 ml-2 -translate-y-1/2'
          : 'right-full top-1/2 mr-2 -translate-y-1/2'
  const toolOption = useDocStore((s) => s.toolOption)

  const toolbarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (showPen && toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowPen(false)
      }
    }
    if (showPen) {
      window.addEventListener('pointerdown', handleClickOutside)
    }
    return () => window.removeEventListener('pointerdown', handleClickOutside)
  }, [showPen])

  // The dock announces where it is: its measured rect goes into the shared
  // store so floating neighbours (zoom pill, transport, reader controls) can
  // slide out of its way instead of guessing. The same measurement drives
  // the scroll-edge fades that show a clipped dock has more tools.
  const pillRef = useRef<HTMLDivElement>(null)
  const publishRef = useRef<() => void>(() => {})
  const [fades, setFades] = useState({ start: false, end: false })
  useEffect(() => {
    const el = pillRef.current
    if (!el) return
    const publish = () => {
      const r = el.getBoundingClientRect()
      useDockRect.getState().set({ side: dock, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      const horizontal = dock === 'top' || dock === 'bottom'
      const pos = horizontal ? el.scrollLeft : el.scrollTop
      const max = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
      setFades((f) => {
        const next = { start: pos > 2, end: pos < max - 2 }
        return f.start === next.start && f.end === next.end ? f : next
      })
    }
    publishRef.current = publish
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', publish)
      useDockRect.getState().set(null)
    }
  }, [dock])

  const fadeMask =
    fades.start || fades.end
      ? `linear-gradient(${vertical ? 'to bottom' : 'to right'}, ${
          fades.start ? 'transparent, black 24px' : 'black'
        }, ${fades.end ? 'black calc(100% - 24px), transparent' : 'black'})`
      : undefined

  return (
    <fm.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={motion}
      onAnimationComplete={() => publishRef.current()}
      // No self-positioning here anymore — CanvasControls places this in a
      // dedicated grid track for the current dock side, so it can never
      // land on top of the transport. min-w/h-0 lets it actually shrink to
      // that track instead of blowing out the grid (the flex default is
      // min-width/height:auto, i.e. "never smaller than my content").
      className={cn('flex min-h-0 min-w-0', edge ? 'w-full' : vertical ? 'max-h-full' : 'max-w-full')}
    >
      <div ref={toolbarRef} className={cn('relative flex min-h-0 min-w-0', edge && 'w-full')}>
      {showPen && (
        <>
          <div className={cn('glass-strong absolute z-50 max-h-[70dvh] w-80 overflow-y-auto rounded-2xl p-3', penFlyoutClass)}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Pen
              </span>
              <button
                type="button"
                aria-label="Close"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <PenSettings />
          </div>
        </>
      )}

      {showShapes && (
        <div className={cn("glass-strong absolute z-50 grid grid-cols-5 gap-1 rounded-2xl p-1.5", penFlyoutClass)}>
          {SHAPES.map((sh) => (
            <ToolButton
              key={sh.id}
              active={tool === 'shape' && toolOption === sh.id}
              label={sh.label}
              onClick={() => {
                setTool('shape', sh.id)
                setShowShapes(false)
              }}
            >
              {sh.icon}
            </ToolButton>
          ))}
        </div>
      )}

      {/* Inner pill owns the scrolling so the flyouts above never clip; the
          fade mask marks whichever end still has tools out of view. */}
      <div
        ref={pillRef}
        onScroll={() => publishRef.current()}
        style={fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
        className={cn(
          'glass-strong no-scrollbar flex min-h-0 min-w-0',
          isMobile ? 'gap-0.5 p-1' : 'gap-1 p-1.5',
          vertical ? 'flex-col items-center overflow-y-auto' : 'items-center overflow-x-auto',
          // Flush with the screen edges above the phone's nav bar, not a
          // floating pill — same rounded-top-only shape as that bar (see
          // sidebar.tsx) rather than fully rounded.
          edge ? 'w-full justify-center rounded-t-2xl border-t border-border/40' : 'rounded-2xl'
        )}
      >
      {TOOLS.map(({ tool: t, icon: Icon, label, key }) =>
        t === 'pen' ? (
          <ToolButton
            key={t}
            active={tool === 'pen'}
            label={`${label} — double-click for pen settings`}
            shortcut={key}
            size={btnSize}
            onClick={() => (tool === 'pen' ? setShowPen(true) : setTool('pen'))}
            onDoubleClick={() => setShowPen(true)}
          >
            <Icon className={iconSize} />
          </ToolButton>
        ) : t === 'select' ? (
          <Fragment key={t}>
            <ToolButton active={tool === t} label={label} shortcut={key} size={btnSize} onClick={() => setTool(t)}>
              <Icon className={iconSize} />
            </ToolButton>
            {isMobile && (
              <ToolButton
                active={tool === 'lasso'}
                label="Lasso — drag over objects to select several, without moving them"
                size={btnSize}
                onClick={() => setTool('lasso')}
              >
                <LassoSelect className={iconSize} />
              </ToolButton>
            )}
          </Fragment>
        ) : (
          <ToolButton key={t} active={tool === t} label={label} shortcut={key} size={btnSize} onClick={() => setTool(t)}>
            <Icon className={iconSize} />
          </ToolButton>
        )
      )}

      <ToolButton
        active={showShapes || tool === 'shape'}
        label="Shapes — line, circle, oval, square, rectangle, triangle … octagon"
        size={btnSize}
        onClick={() => setShowShapes((v) => !v)}
      >
        <ShapesGroupIcon />
      </ToolButton>

      {/* Touch has no physical "/" key — this opens the same quick-insert
          search desktop gets from the keyboard shortcut (see canvas.tsx's
          SlashMenu + lib/store/slash-menu.ts), a faster path than the
          Components sidebar's arm-then-tap-canvas flow. Tablets need this
          exactly as much as phones — gated on touch capability, not width. */}
      {isMobile && pageId && (
        <ToolButton
          active={false}
          label="Insert a component — search everything you can add"
          size={btnSize}
          onClick={() => useSlashMenuStore.getState().open(pageId)}
        >
          <Blocks className={iconSize} />
        </ToolButton>
      )}

      {pageId && (
        <>
          <div className={cn('shrink-0 bg-border', vertical ? 'my-1 h-px w-6' : 'mx-1 h-6 w-px')} />
          <ToolButton
            active={false}
            label="Document — attach a PDF/image for this session (never saved to the cloud)"
            size={btnSize}
            onClick={() => {
              // Drop a session-document element at the viewport center.
              const doc = useDocStore.getState()
              const v = doc.viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
              const cx = (window.innerWidth / 2 - v.x) / v.zoom
              const cy = (window.innerHeight / 2 - v.y) / v.zoom
              const obj: SceneObject = {
                id: uid(),
                name: 'Document',
                geometry: { kind: 'note' },
                position: { x: cx - 240, y: cy - 170 },
                size: { w: 480, h: 340 },
                rotation: 0,
                z: 0,
                behaviors: [],
                parameters: {},
                metadata: { render: 'file' },
              }
              doc.addObject(pageId, obj)
              doc.setSelection([obj.id])
              doc.setTool('select')
            }}
          >
            <Paperclip className={iconSize} />
          </ToolButton>
        </>
      )}

      {/* Selection actions — fold out of the pill while something is
          selected (grid 0fr↔1fr, a width/height transition that retargets
          mid-motion if the selection changes under it). */}
      {pageId && (
        <div
          className={cn(
            'grid min-w-0 shrink-0 transition-[grid-template-columns,grid-template-rows] duration-200 ease-strong',
            vertical
              ? selActions.length > 0 ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              : selActions.length > 0 ? 'grid-cols-[1fr]' : 'grid-cols-[0fr]'
          )}
        >
          <div
            className={cn(
              'flex min-h-0 min-w-0 items-center overflow-hidden',
              vertical && 'flex-col',
              isMobile ? 'gap-0.5' : 'gap-1'
            )}
          >
            <div className={cn('shrink-0 bg-border', vertical ? 'my-1 h-px w-6' : 'mx-1 h-6 w-px')} />
            {selection.length > 1 && (
              <span className="shrink-0 px-0.5 font-mono text-[0.6875rem] text-muted-foreground">
                {selection.length}×
              </span>
            )}
            {segActions.map((a) => (
              <Tooltip key={a.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={a.label}
                    onClick={a.run}
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-xl transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]',
                      btnSize,
                      a.danger
                        ? 'text-[var(--accent-rose)] hover:bg-[color-mix(in_oklch,var(--accent-rose)_12%,transparent)]'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <a.icon className={iconSize} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {a.label}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
      </div>
      </div>
    </fm.div>
  )
}
