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
  GripHorizontal,
  GripVertical,
  FileText,
  ChevronDown,
  Wrench,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import { actionsForSelection } from '@/lib/scene/selection-actions'
import { PenSettings } from './pen-settings'
import { usePrefs } from '@/lib/store/preferences'
import { useIsMobile } from '@/hooks/use-mobile'
import { useSlashMenuStore } from '@/lib/store/slash-menu'
import { uid, type SceneObject, type PageNode } from '@/lib/scene/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { Transport } from './transport'
import { cn } from '@/lib/utils'
import { useDockRect } from '@/hooks/use-dock-clearance'
import { useSidebarSection } from '@/lib/store/sidebar-sections'

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

function DockPageMenu() {
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const nodes = useWorkspaceStore((s) => s.nodes)
  const setActivePage = useWorkspaceStore((s) => s.setActivePage)
  const activeMeta = findPageMeta(nodes, activePageId)

  const allPages = useMemo(() => {
    return Object.values(nodes).filter((n): n is PageNode => n.kind === 'page')
  }, [nodes])

  if (!activePageId) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
          title="Current Page"
        >
          <FileText className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
          <span className="max-w-[100px] truncate">{activeMeta?.name ?? 'Untitled'}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
        {allPages.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setActivePage(p.id)}
            className={cn('text-xs', p.id === activePageId && 'font-bold text-[var(--accent-blue)]')}
          >
            <FileText className="mr-2 h-3.5 w-3.5" />
            <span className="truncate">{p.name || 'Untitled'}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DockToolsMenu() {
  const setSection = useSidebarSection((s) => s.setSection)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen)

  const handleOpenTools = () => {
    setSection('tools')
    if (!sidebarOpen) togglePanel('sidebar')
  }

  return (
    <button
      type="button"
      onClick={handleOpenTools}
      className="flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent/60 transition-colors"
      title="Open Tools & Components Panel"
    >
      <Wrench className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
      <span>Tools</span>
    </button>
  )
}

export function Toolbar({
  pageId,
  edge = false,
}: {
  pageId?: string
  edge?: boolean
}) {
  const motion = useSpring()
  const tool = useDocStore((s) => s.tool)
  const setTool = useDocStore((s) => s.setTool)
  const selection = useDocStore((s) => s.selection)
  const editing = useRuntimeStore((s) => s.mode) === 'edit'
  const selActions = pageId && selection.length > 0
    ? actionsForSelection({ pageId, ids: selection, editing })
    : []
  const lastActionsRef = useRef(selActions)
  if (selActions.length > 0) lastActionsRef.current = selActions
  const segActions = selActions.length > 0 ? selActions : lastActionsRef.current
  const isMobile = useIsMobile()

  const [showPen, setShowPen] = useState(false)
  const [showShapes, setShowShapes] = useState(false)

  const dockPrefsState = usePrefs((s) => s.dock)
  const setDock = usePrefs((s) => s.setDock)
  const dockSide = isMobile && (dockPrefsState.fixedSide === 'left' || dockPrefsState.fixedSide === 'right')
    ? 'bottom'
    : dockPrefsState.fixedSide
  const vertical = dockSide === 'left' || dockSide === 'right'

  // Draggable positioning state
  const isDraggable = dockPrefsState.positionMode === 'draggable' && !isMobile
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null)

  const defaultX = typeof window !== 'undefined' ? Math.max(20, (window.innerWidth - 600) / 2) : 200
  const defaultY = typeof window !== 'undefined' ? window.innerHeight - 100 : 600
  const posX = dockPrefsState.dragPosition?.x ?? defaultX
  const posY = dockPrefsState.dragPosition?.y ?? defaultY

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !isDraggable) return
    e.stopPropagation()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX,
      posY,
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    const maxW = typeof window !== 'undefined' ? window.innerWidth - 100 : 1000
    const maxH = typeof window !== 'undefined' ? window.innerHeight - 60 : 800
    const newX = Math.max(10, Math.min(maxW, dragRef.current.posX + dx))
    const newY = Math.max(10, Math.min(maxH, dragRef.current.posY + dy))
    setDock({ dragPosition: { x: newX, y: newY } })
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
  }

  // Sizing styles
  const sizeMode = isMobile ? 'compact' : dockPrefsState.size
  const btnSize = sizeMode === 'compact' ? 'h-7 w-7' : sizeMode === 'large' ? 'h-11 w-11' : 'h-9 w-9'
  const iconSize = sizeMode === 'compact' ? 'h-3.5 w-3.5' : sizeMode === 'large' ? 'h-5 w-5' : 'h-4 w-4'
  const paddingClass = sizeMode === 'compact' ? 'p-1 gap-0.5' : sizeMode === 'large' ? 'p-2 gap-1.5' : 'p-1.5 gap-1'

  // Shape styles
  const shapeClass =
    dockPrefsState.shape === 'sharp'
      ? 'rounded-lg'
      : dockPrefsState.shape === 'soft'
        ? 'rounded-2xl'
        : 'rounded-full'

  // Color theme styles
  const colorThemeClass =
    dockPrefsState.colorTheme === 'translucent'
      ? 'bg-background/50 backdrop-blur-sm border border-border/40 shadow-lg'
      : dockPrefsState.colorTheme === 'solid'
        ? 'bg-card border border-border shadow-md text-card-foreground'
        : dockPrefsState.colorTheme === 'accent-tinted'
          ? 'bg-[var(--accent-blue)]/15 border border-[var(--accent-blue)]/30 backdrop-blur-md shadow-xl text-foreground'
          : dockPrefsState.colorTheme === 'dark-glass'
            ? 'bg-zinc-900/90 text-zinc-100 backdrop-blur-lg border border-zinc-700/60 shadow-2xl'
            : 'glass-strong' // default glass

  // Autohide opacity effect
  const [idle, setIdle] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!dockPrefsState.autohide) {
      setIdle(false)
      return
    }
    const resetTimer = () => {
      setIdle(false)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => setIdle(true), 3500)
    }
    window.addEventListener('pointermove', resetTimer)
    resetTimer()
    return () => {
      window.removeEventListener('pointermove', resetTimer)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [dockPrefsState.autohide])

  const penFlyoutClass =
    dockSide === 'bottom'
      ? 'bottom-full left-1/2 mb-2 -translate-x-1/2'
      : dockSide === 'top'
        ? 'left-1/2 top-full mt-2 -translate-x-1/2'
        : dockSide === 'left'
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

  const pillRef = useRef<HTMLDivElement>(null)
  const publishRef = useRef<() => void>(() => {})
  const [fades, setFades] = useState({ start: false, end: false })
  useEffect(() => {
    const el = pillRef.current
    if (!el) return
    const publish = () => {
      const r = el.getBoundingClientRect()
      useDockRect.getState().set({ side: dockSide, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      const horizontal = dockSide === 'top' || dockSide === 'bottom'
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
  }, [dockSide])

  const fadeMask =
    fades.start || fades.end
      ? `linear-gradient(${vertical ? 'to bottom' : 'to right'}, ${
          fades.start ? 'transparent, black 24px' : 'black'
        }, ${fades.end ? 'black calc(100% - 24px), transparent' : 'black'})`
      : undefined

  const isExtended = dockPrefsState.layoutMode === 'extended'

  const content = (
    <div ref={toolbarRef} className={cn('relative flex min-h-0 min-w-0', edge && 'w-full')}>
      {showPen && (
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
      )}

      {showShapes && (
        <div className={cn('glass-strong absolute z-50 grid grid-cols-5 gap-1 rounded-2xl p-1.5', penFlyoutClass)}>
          {SHAPES.map((sh) => (
            <ToolButton
              key={sh.id}
              active={tool === 'shape' && toolOption === sh.id}
              label={sh.label}
              size={btnSize}
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

      <div
        ref={pillRef}
        onScroll={() => publishRef.current()}
        style={fadeMask ? { maskImage: fadeMask, WebkitMaskImage: fadeMask } : undefined}
        className={cn(
          'no-scrollbar flex min-h-0 min-w-0 transition-all duration-200',
          colorThemeClass,
          paddingClass,
          vertical ? 'flex-col items-center overflow-y-auto' : 'items-center overflow-x-auto',
          edge
            ? dockSide === 'bottom'
              ? 'w-full justify-center rounded-none border-t border-border/50 shadow-2xl'
              : dockSide === 'top'
                ? 'w-full justify-center rounded-none border-b border-border/50 shadow-2xl'
                : dockSide === 'left'
                  ? 'h-full flex-col justify-center rounded-none border-r border-border/50 shadow-2xl'
                  : 'h-full flex-col justify-center rounded-none border-l border-border/50 shadow-2xl'
            : shapeClass,
          idle && 'opacity-30 hover:opacity-100'
        )}
      >
        {isDraggable && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="flex shrink-0 items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground px-0.5"
            title="Drag dock to move"
          >
            {vertical ? <GripVertical className="h-4 w-4" /> : <GripHorizontal className="h-4 w-4" />}
          </div>
        )}

        {isExtended && (dockPrefsState.showToolsMenu ?? true) && (
          <>
            <DockToolsMenu />
            <div className={cn('shrink-0 bg-border/60', vertical ? 'my-1 h-px w-6' : 'mx-1 h-5 w-px')} />
          </>
        )}

        {isExtended && dockPrefsState.showPageMenu && pageId && (
          <>
            <DockPageMenu />
            <div className={cn('shrink-0 bg-border/60', vertical ? 'my-1 h-px w-6' : 'mx-1 h-5 w-px')} />
          </>
        )}

        {isExtended && dockPrefsState.showTransport && pageId && (
          <>
            <div className="flex items-center shrink-0">
              <Transport pageId={pageId} flat />
            </div>
            <div className={cn('shrink-0 bg-border/60', vertical ? 'my-1 h-px w-6' : 'mx-1 h-5 w-px')} />
          </>
        )}

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
                  label="Lasso — drag over objects to select several"
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

        {isMobile && pageId && (
          <ToolButton
            active={false}
            label="Insert a component"
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
              label="Document — attach a PDF/image"
              size={btnSize}
              onClick={() => {
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
  )

  if (isDraggable) {
    return (
      <fm.div
        style={{ left: `${posX}px`, top: `${posY}px` }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motion}
        onAnimationComplete={() => publishRef.current()}
        className="pointer-events-auto fixed z-50 select-none touch-none"
      >
        {content}
      </fm.div>
    )
  }

  return (
    <fm.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={motion}
      onAnimationComplete={() => publishRef.current()}
      className={cn('flex min-h-0 min-w-0', edge ? 'w-full' : vertical ? 'max-h-full' : 'max-w-full')}
    >
      {content}
    </fm.div>
  )
}

