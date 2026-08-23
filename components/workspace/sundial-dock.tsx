'use client'

// Dial Dock — A clean, minimal circular wheel control surface.
// Collapsed: a sleek draggable circular hub with the Pen default icon.
// Layer 1 (Inner Dial Wheel): A unified circular wheel divided into sectors by thin grey lines.
// Layer 2 (Outer Wheel Corona): Concentric outer ring for extendable tools (e.g. Shapes).

import { useState, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MousePointer2,
  LassoSelect,
  Pen,
  Eraser,
  Type,
  StickyNote,
  Sigma,
  ChartLine,
  Spline,
  TableProperties,
  Paperclip,
  X,
  Circle,
  Square,
  Minus,
} from 'lucide-react'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import { actionsForSelection } from '@/lib/scene/selection-actions'
import { usePrefs } from '@/lib/store/preferences'
import { useIsMobile } from '@/hooks/use-mobile'
import { uid, type SceneObject } from '@/lib/scene/types'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PenSettings } from './pen-settings'
import { PRST_POLYGON_POINTS } from '@/lib/scene/preset-shapes'

const PRIMARY_TOOLS: { tool: Tool; icon: React.ComponentType<{ className?: string }>; label: string; key: string }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', key: 'V' },
  { tool: 'pen', icon: Pen, label: 'Pen', key: 'P' },
  { tool: 'shaper', icon: Spline, label: 'Shaper', key: 'S' },
  { tool: 'eraser', icon: Eraser, label: 'Eraser', key: 'E' },
  { tool: 'text', icon: Type, label: 'Text', key: 'T' },
  { tool: 'note', icon: StickyNote, label: 'Note', key: 'N' },
  { tool: 'formula', icon: Sigma, label: 'Formula', key: 'F' },
  { tool: 'graph', icon: ChartLine, label: 'Graph', key: 'G' },
  { tool: 'gridtable', icon: TableProperties, label: 'Grid Table', key: 'B' },
]

/** Crisp inline n-gon icon */
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

/** Icon for a fixed-point shape (unit-space 0-1 points from PRST_POLYGON_POINTS). */
function PointsIcon({ points }: { points: number[][] }) {
  const pts = points.map(([x, y]) => `${(x * 20 + 2).toFixed(2)},${(y * 20 + 2).toFixed(2)}`).join(' ')
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
      <polygon points={pts} strokeLinejoin="round" />
    </svg>
  )
}

const SHAPES: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'line', label: 'Line / Beam', icon: <Minus className="h-4 w-4" /> },
  { id: 'circle', label: 'Circle', icon: <Circle className="h-4 w-4" /> },
  { id: 'oval', label: 'Oval', icon: <OvalIcon /> },
  { id: 'square', label: 'Square', icon: <Square className="h-4 w-4" /> },
  { id: 'rect', label: 'Rectangle', icon: <RectIcon /> },
  { id: 'triangle', label: 'Triangle', icon: <NgonIcon n={3} /> },
  { id: 'rtTriangle', label: 'Right Triangle', icon: <PointsIcon points={PRST_POLYGON_POINTS.rtTriangle} /> },
  { id: 'diamond', label: 'Diamond', icon: <PointsIcon points={PRST_POLYGON_POINTS.diamond} /> },
  { id: 'parallelogram', label: 'Parallelogram', icon: <PointsIcon points={PRST_POLYGON_POINTS.parallelogram} /> },
  { id: 'trapezoid', label: 'Trapezoid', icon: <PointsIcon points={PRST_POLYGON_POINTS.trapezoid} /> },
  { id: 'pentagon', label: 'Pentagon', icon: <NgonIcon n={5} /> },
  { id: 'hexagon', label: 'Hexagon', icon: <NgonIcon n={6} /> },
  { id: 'heptagon', label: 'Heptagon', icon: <NgonIcon n={7} /> },
  { id: 'octagon', label: 'Octagon', icon: <NgonIcon n={8} /> },
  { id: 'star5', label: 'Star', icon: <PointsIcon points={PRST_POLYGON_POINTS.star5} /> },
  { id: 'rightArrow', label: 'Right Arrow', icon: <PointsIcon points={PRST_POLYGON_POINTS.rightArrow} /> },
  { id: 'leftArrow', label: 'Left Arrow', icon: <PointsIcon points={PRST_POLYGON_POINTS.leftArrow} /> },
  { id: 'upArrow', label: 'Up Arrow', icon: <PointsIcon points={PRST_POLYGON_POINTS.upArrow} /> },
  { id: 'downArrow', label: 'Down Arrow', icon: <PointsIcon points={PRST_POLYGON_POINTS.downArrow} /> },
]

/** SVG Sector Path generator */
function describeArc(cx: number, cy: number, rIn: number, rOut: number, startAngle: number, endAngle: number) {
  const x1Out = cx + rOut * Math.cos(startAngle)
  const y1Out = cy + rOut * Math.sin(startAngle)
  const x2Out = cx + rOut * Math.cos(endAngle)
  const y2Out = cy + rOut * Math.sin(endAngle)

  const x1In = cx + rIn * Math.cos(startAngle)
  const y1In = cy + rIn * Math.sin(startAngle)
  const x2In = cx + rIn * Math.cos(endAngle)
  const y2In = cy + rIn * Math.sin(endAngle)

  const largeArcFlag = endAngle - startAngle <= Math.PI ? '0' : '1'

  return [
    'M', x1Out, y1Out,
    'A', rOut, rOut, 0, largeArcFlag, 1, x2Out, y2Out,
    'L', x2In, y2In,
    'A', rIn, rIn, 0, largeArcFlag, 0, x1In, y1In,
    'Z',
  ].join(' ')
}

export function DialDock({ pageId }: { pageId?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [showShapes, setShowShapes] = useState(false)
  const [showPenSettings, setShowPenSettings] = useState(false)

  const tool = useDocStore((s) => s.tool)
  const setTool = useDocStore((s) => s.setTool)
  const toolOption = useDocStore((s) => s.toolOption)
  const selection = useDocStore((s) => s.selection)
  const editing = useRuntimeStore((s) => s.mode) === 'edit'
  const dockPrefs = usePrefs((s) => s.dock)
  const setDock = usePrefs((s) => s.setDock)
  const isMobile = useIsMobile()

  const selActions = pageId && selection.length > 0
    ? actionsForSelection({ pageId, ids: selection, editing })
    : []

  // Drag position logic
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null)
  const defaultX = typeof window !== 'undefined' ? Math.max(30, window.innerWidth / 2 - 26) : 200
  const defaultY = typeof window !== 'undefined' ? window.innerHeight - 110 : 600

  const posX = dockPrefs.dragPosition?.x ?? defaultX
  const posY = dockPrefs.dragPosition?.y ?? defaultY

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
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
    const maxW = typeof window !== 'undefined' ? window.innerWidth - 60 : 1000
    const maxH = typeof window !== 'undefined' ? window.innerHeight - 60 : 800
    const newX = Math.max(20, Math.min(maxW, dragRef.current.posX + dx))
    const newY = Math.max(20, Math.min(maxH, dragRef.current.posY + dy))
    setDock({ dragPosition: { x: newX, y: newY } })
  }

  const handlePointerUp = () => {
    dragRef.current = null
  }

  // Active Tool Icon — default to Pen as requested
  const ActiveIcon = useMemo(() => {
    if (tool === 'pen') return Pen
    if (tool === 'shape') return ShapesGroupIcon
    if (tool === 'select') return MousePointer2
    const found = PRIMARY_TOOLS.find((t) => t.tool === tool)
    return found ? found.icon : Pen
  }, [tool])

  // Wheel dimensions (compact)
  const CX = 90
  const CY = 90
  const R1_IN = 22
  const R1_OUT = 66

  const R2_IN = 70
  const R2_OUT = 112

  // Ring 1 item sectors
  const totalR1 = PRIMARY_TOOLS.length + (pageId ? 2 : 1) // + Shapes (+ Document)
  const angleStep1 = (2 * Math.PI) / totalR1

  const r1Sectors = useMemo(() => {
    const items = [...PRIMARY_TOOLS]
    return items.map((t, idx) => {
      const startAngle = -Math.PI / 2 + idx * angleStep1
      const endAngle = startAngle + angleStep1
      const midAngle = (startAngle + endAngle) / 2
      const rMid = (R1_IN + R1_OUT) / 2
      return {
        ...t,
        type: 'tool' as const,
        startAngle,
        endAngle,
        midX: CX + rMid * Math.cos(midAngle),
        midY: CY + rMid * Math.sin(midAngle),
        path: describeArc(CX, CY, R1_IN, R1_OUT, startAngle, endAngle),
      }
    })
  }, [angleStep1])

  const shapesSector = useMemo(() => {
    const idx = PRIMARY_TOOLS.length
    const startAngle = -Math.PI / 2 + idx * angleStep1
    const endAngle = startAngle + angleStep1
    const midAngle = (startAngle + endAngle) / 2
    const rMid = (R1_IN + R1_OUT) / 2
    return {
      startAngle,
      endAngle,
      midX: CX + rMid * Math.cos(midAngle),
      midY: CY + rMid * Math.sin(midAngle),
      path: describeArc(CX, CY, R1_IN, R1_OUT, startAngle, endAngle),
    }
  }, [angleStep1])

  const docSector = useMemo(() => {
    if (!pageId) return null
    const idx = PRIMARY_TOOLS.length + 1
    const startAngle = -Math.PI / 2 + idx * angleStep1
    const endAngle = startAngle + angleStep1
    const midAngle = (startAngle + endAngle) / 2
    const rMid = (R1_IN + R1_OUT) / 2
    return {
      startAngle,
      endAngle,
      midX: CX + rMid * Math.cos(midAngle),
      midY: CY + rMid * Math.sin(midAngle),
      path: describeArc(CX, CY, R1_IN, R1_OUT, startAngle, endAngle),
    }
  }, [angleStep1, pageId])

  // Outer Ring 2 (Shapes / Actions)
  const r2Shapes = useMemo(() => {
    const total = SHAPES.length
    const step = (2 * Math.PI) / total
    return SHAPES.map((sh, idx) => {
      const startAngle = -Math.PI / 2 + idx * step
      const endAngle = startAngle + step
      const midAngle = (startAngle + endAngle) / 2
      const rMid = (R2_IN + R2_OUT) / 2
      return {
        ...sh,
        startAngle,
        endAngle,
        midX: CX + rMid * Math.cos(midAngle),
        midY: CY + rMid * Math.sin(midAngle),
        path: describeArc(CX, CY, R2_IN, R2_OUT, startAngle, endAngle),
      }
    })
  }, [])

  const r2Actions = useMemo(() => {
    const total = selActions.length
    const step = (2 * Math.PI) / (total || 1)
    return selActions.map((act, idx) => {
      const startAngle = -Math.PI / 2 + idx * step
      const endAngle = startAngle + step
      const midAngle = (startAngle + endAngle) / 2
      const rMid = (R2_IN + R2_OUT) / 2
      return {
        ...act,
        startAngle,
        endAngle,
        midX: CX + rMid * Math.cos(midAngle),
        midY: CY + rMid * Math.sin(midAngle),
        path: describeArc(CX, CY, R2_IN, R2_OUT, startAngle, endAngle),
      }
    })
  }, [selActions])

  const hasOuterRing = showShapes || showPenSettings || selActions.length > 0
  const viewSize = hasOuterRing ? R2_OUT * 2 + 16 : R1_OUT * 2 + 16
  const centerOffset = viewSize / 2

  return (
    <div
      style={{ left: `${posX}px`, top: `${posY}px` }}
      className="pointer-events-auto fixed z-50 select-none touch-none"
    >
      <div className="relative flex items-center justify-center">
        {/* Expanded Wheel Container */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="absolute pointer-events-auto flex items-center justify-center"
              style={{
                width: viewSize,
                height: viewSize,
              }}
            >
              <svg
                width={viewSize}
                height={viewSize}
                viewBox={`${CX - centerOffset} ${CY - centerOffset} ${viewSize} ${viewSize}`}
                className="overflow-visible drop-shadow-xl"
              >
                {/* Outer Ring 2 Slices */}
                {hasOuterRing && (
                  <g className="transition-all duration-200">
                    <circle cx={CX} cy={CY} r={R2_OUT} className="fill-background/90 stroke-border/40" strokeWidth="1" />
                    <circle cx={CX} cy={CY} r={R2_IN} className="fill-background/90 stroke-border/40" strokeWidth="1" />

                    {showShapes &&
                      r2Shapes.map((sh) => {
                        const isActive = tool === 'shape' && toolOption === sh.id
                        return (
                          <path
                            key={sh.id}
                            d={sh.path}
                            onClick={() => {
                              setTool('shape', sh.id)
                              setShowShapes(false)
                            }}
                            className={cn(
                              'cursor-pointer transition-colors duration-150 stroke-border/50',
                              isActive
                                ? 'fill-[var(--accent-blue)] text-white'
                                : 'fill-background/80 hover:fill-accent/80 text-foreground'
                            )}
                            strokeWidth="1"
                          />
                        )
                      })}

                    {!showShapes &&
                      !showPenSettings &&
                      r2Actions.map((act) => (
                        <path
                          key={act.id}
                          d={act.path}
                          onClick={act.run}
                          className={cn(
                            'cursor-pointer transition-colors duration-150 stroke-border/50',
                            act.danger
                              ? 'fill-rose-500/10 hover:fill-rose-500/20'
                              : 'fill-background/80 hover:fill-accent/80'
                          )}
                          strokeWidth="1"
                        />
                      ))}
                  </g>
                )}

                {/* Inner Ring 1 Slices */}
                <g className="transition-all duration-200">
                  <circle cx={CX} cy={CY} r={R1_OUT} className="fill-background/95 stroke-border/50" strokeWidth="1" />
                  <circle cx={CX} cy={CY} r={R1_IN} className="fill-background/95 stroke-border/50" strokeWidth="1" />

                  {/* Primary Tools Sectors */}
                  {r1Sectors.map((t) => {
                    const isActive = tool === t.tool
                    return (
                      <path
                        key={t.tool}
                        d={t.path}
                        onClick={() => {
                          if (t.tool === 'pen' && tool === 'pen') {
                            setShowPenSettings((v) => !v)
                          } else {
                            setTool(t.tool)
                            setShowPenSettings(false)
                            setShowShapes(false)
                          }
                        }}
                        className={cn(
                          'cursor-pointer transition-colors duration-150 stroke-border/50',
                          isActive
                            ? 'fill-[var(--accent-blue)] text-white'
                            : 'fill-background/90 hover:fill-accent/70 text-foreground'
                        )}
                        strokeWidth="1"
                      />
                    )
                  })}

                  {/* Shapes Sector */}
                  <path
                    d={shapesSector.path}
                    onClick={() => {
                      setShowShapes((v) => !v)
                      setShowPenSettings(false)
                    }}
                    className={cn(
                      'cursor-pointer transition-colors duration-150 stroke-border/50',
                      showShapes || tool === 'shape'
                        ? 'fill-[var(--accent-blue)] text-white'
                        : 'fill-background/90 hover:fill-accent/70 text-foreground'
                    )}
                    strokeWidth="1"
                  />

                  {/* Document Sector */}
                  {docSector && (
                    <path
                      d={docSector.path}
                      onClick={() => {
                        const doc = useDocStore.getState()
                        const v = doc.viewports[pageId!] ?? { x: 0, y: 0, zoom: 1 }
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
                        doc.addObject(pageId!, obj)
                        doc.setSelection([obj.id])
                        doc.setTool('select')
                      }}
                      className="cursor-pointer fill-background/90 hover:fill-accent/70 text-foreground stroke-border/50"
                      strokeWidth="1"
                    />
                  )}
                </g>
              </svg>

              {/* HTML Icons Overlay on Top of Sectors */}
              <div className="absolute inset-0 pointer-events-none">
                {/* Ring 1 Icons */}
                {r1Sectors.map((t) => {
                  const Icon = t.icon
                  const isActive = tool === t.tool
                  return (
                    <Tooltip key={t.tool}>
                      <TooltipTrigger asChild>
                        <div
                          style={{
                            left: `${t.midX - (CX - centerOffset) - 10}px`,
                            top: `${t.midY - (CY - centerOffset) - 10}px`,
                          }}
                          className={cn(
                            'absolute flex h-5 w-5 items-center justify-center rounded-full pointer-events-none transition-colors',
                            isActive ? 'text-white' : 'text-foreground/80'
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-ui-xs">
                        {t.label} {t.key && `(${t.key})`}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}

                {/* Shapes Icon */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      style={{
                        left: `${shapesSector.midX - (CX - centerOffset) - 10}px`,
                        top: `${shapesSector.midY - (CY - centerOffset) - 10}px`,
                      }}
                      className={cn(
                        'absolute flex h-5 w-5 items-center justify-center rounded-full pointer-events-none transition-colors',
                        showShapes || tool === 'shape' ? 'text-white' : 'text-foreground/80'
                      )}
                    >
                      <ShapesGroupIcon />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-ui-xs">
                    Shapes & Geometry
                  </TooltipContent>
                </Tooltip>

                {/* Document Icon */}
                {docSector && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        style={{
                          left: `${docSector.midX - (CX - centerOffset) - 10}px`,
                          top: `${docSector.midY - (CY - centerOffset) - 10}px`,
                        }}
                        className="absolute flex h-5 w-5 items-center justify-center rounded-full pointer-events-none text-foreground/80"
                      >
                        <Paperclip className="h-3 w-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-ui-xs">
                      Attach Document / Image
                    </TooltipContent>
                  </Tooltip>
                )}

                {/* Ring 2 Outer Shapes Icons */}
                {hasOuterRing &&
                  showShapes &&
                  r2Shapes.map((sh) => {
                    const isActive = tool === 'shape' && toolOption === sh.id
                    return (
                      <Tooltip key={sh.id}>
                        <TooltipTrigger asChild>
                          <div
                            style={{
                              left: `${sh.midX - (CX - centerOffset) - 10}px`,
                              top: `${sh.midY - (CY - centerOffset) - 10}px`,
                            }}
                            className={cn(
                              'absolute flex h-5 w-5 items-center justify-center rounded-full pointer-events-none transition-colors',
                              isActive ? 'text-white font-bold' : 'text-foreground/80'
                            )}
                          >
                            {sh.icon}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-ui-xs">
                          {sh.label}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}

                {/* Ring 2 Outer Action Icons */}
                {hasOuterRing &&
                  !showShapes &&
                  !showPenSettings &&
                  r2Actions.map((act) => (
                    <Tooltip key={act.id}>
                      <TooltipTrigger asChild>
                        <div
                          style={{
                            left: `${act.midX - (CX - centerOffset) - 10}px`,
                            top: `${act.midY - (CY - centerOffset) - 10}px`,
                          }}
                          className={cn(
                            'absolute flex h-5 w-5 items-center justify-center rounded-full pointer-events-none transition-colors',
                            act.danger ? 'text-rose-500' : 'text-foreground/80'
                          )}
                        >
                          <act.icon className="h-3 w-3" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-ui-xs">
                        {act.label}
                      </TooltipContent>
                    </Tooltip>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Center Minimal Circular Hub — Default Pen Icon */}
        <motion.div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'relative z-30 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/95 backdrop-blur-md cursor-grab active:cursor-grabbing shadow-md transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out',
            expanded ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/20' : 'hover:border-border'
          )}
          onClick={() => setExpanded((v) => !v)}
          title="Dial Dock — click to open wheel, drag to move"
        >
          {expanded ? (
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Pen className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
          )}
        </motion.div>
      </div>

      {/* Floating Pen settings popover if active */}
      {showPenSettings && expanded && (
        <div className="absolute top-full left-1/2 mt-4 -translate-x-1/2 z-50 glass-strong w-80 max-h-[70dvh] overflow-y-auto rounded-2xl p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-ui-xs font-bold uppercase tracking-wider text-muted-foreground">
              Pen Feel & Palette
            </span>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPenSettings(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <PenSettings />
        </div>
      )}
    </div>
  )
}

// Export SundialDock as alias for backwards compatibility
export { DialDock as SundialDock }
