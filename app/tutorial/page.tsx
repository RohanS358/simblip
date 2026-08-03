'use client'

// Tutorial board: the normal whiteboard spatial layout, copied as closely as
// possible, with each chrome cluster starting as a ghost skeleton until the
// lesson reaches it. The board footprint is the point: header, dock, canvas,
// and footer all sit where they do on the real page.

import { useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  Circle as CircleIcon,
  GraduationCap,
  MousePointer2,
  Moon,
  Pen,
  Play,
  Search,
  Settings2,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { RequireAuth } from '@/components/auth/require-auth'
import { cn } from '@/lib/utils'

type StageId =
  | 'top-search'
  | 'top-page-controls'
  | 'dock-notebook'
  | 'dock-components'
  | 'dock-tools'
  | 'dock-library'
  | 'dock-properties'
  | 'toolbar-select'
  | 'toolbar-pen'
  | 'toolbar-shaper'
  | 'toolbar-eraser'
  | 'canvas-place'
  | 'canvas-edit'
  | 'canvas-draw'
  | 'canvas-shape'
  | 'canvas-text'
  | 'canvas-move'
  | 'canvas-play'
  | 'canvas-undo'

interface Vec {
  x: number
  y: number
}

interface GhostComponent {
  x: number
  y: number
  w: number
  h: number
  label: string
}

const STAGES: { id: StageId; label: string; caption: string }[] = [
  { id: 'top-search', label: 'Search', caption: 'Search is in the exact top bar position, but still ghosted.' },
  { id: 'top-page-controls', label: 'Page controls', caption: 'Page controls sit beside Search in the same row.' },
  { id: 'dock-notebook', label: 'Notebook', caption: 'The dock rail is in place; the Notebook section is still a skeleton.' },
  { id: 'dock-components', label: 'Components', caption: 'The Components section appears where the real dock keeps it.' },
  { id: 'dock-tools', label: 'Tools', caption: 'Tools are part of the same left dock stack.' },
  { id: 'dock-library', label: 'Library', caption: 'Library sits in the same dock footprint as the real board.' },
  { id: 'dock-properties', label: 'Properties', caption: 'Properties is the edit dock slot used on the real board.' },
  { id: 'toolbar-select', label: 'Select', caption: 'The canvas toolbar lives in the same place as the real one.' },
  { id: 'toolbar-pen', label: 'Pen', caption: 'Pen is the first actual tool to learn.' },
  { id: 'toolbar-shaper', label: 'Shaper', caption: 'Shaper is part of the same toolbar strip.' },
  { id: 'toolbar-eraser', label: 'Eraser', caption: 'Eraser stays in the same toolbar lane.' },
  { id: 'canvas-place', label: 'Place component', caption: 'Place a component on the canvas inside the same whiteboard space.' },
  { id: 'canvas-edit', label: 'Edit component', caption: 'Edit the component where it sits on the board.' },
  { id: 'canvas-draw', label: 'Draw', caption: 'Draw directly on the canvas like the real whiteboard.' },
  { id: 'canvas-shape', label: 'Shape', caption: 'Shapes belong in the same canvas region.' },
  { id: 'canvas-text', label: 'Text', caption: 'Text also lives in the canvas region, not a side panel.' },
  { id: 'canvas-move', label: 'Move', caption: 'Move objects in place on the board.' },
  { id: 'canvas-play', label: 'Play', caption: 'Play is part of the board control strip.' },
  { id: 'canvas-undo', label: 'Undo', caption: 'Undo completes the board control set.' },
]

const TOP_STAGES: StageId[] = ['top-search', 'top-page-controls']
const DOCK_STAGES: StageId[] = ['dock-notebook', 'dock-components', 'dock-tools', 'dock-library', 'dock-properties']
const TOOL_STAGES: StageId[] = ['toolbar-select', 'toolbar-pen', 'toolbar-shaper', 'toolbar-eraser']
const CANVAS_STAGES: StageId[] = ['canvas-place', 'canvas-edit', 'canvas-draw', 'canvas-shape', 'canvas-text', 'canvas-move', 'canvas-play', 'canvas-undo']

function localPoint(el: HTMLElement, e: { clientX: number; clientY: number }): Vec {
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function GhostPill({ label, learned, active, onClick }: { label: string; learned: boolean; active: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/12 text-foreground shadow-[0_0_0_1px_color-mix(in_oklch,var(--accent-blue)_20%,transparent)]'
          : learned
            ? 'border-[var(--accent-mint)]/40 bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]'
            : 'border-dashed border-border/70 bg-foreground/[0.03] text-muted-foreground/45'
      )}
    >
      {label}
    </button>
  )
}

function GhostIconButton({
  label,
  learned,
  active,
  Icon,
  onClick,
}: {
  label: string
  learned: boolean
  active: boolean
  Icon: typeof Pen
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
        active
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/12 text-[var(--accent-blue)]'
          : learned
            ? 'border-[var(--accent-mint)]/30 bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]'
            : 'border-dashed border-border/70 bg-foreground/[0.03] text-muted-foreground/45'
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

function ToolStub({ label, learned, active, onClick }: { label: string; learned: boolean; active: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors',
        active
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/12 text-[var(--accent-blue)]'
          : learned
            ? 'border-[var(--accent-mint)]/30 bg-[var(--accent-mint)]/10 text-[var(--accent-mint)]'
            : 'border-dashed border-border/70 bg-foreground/[0.03] text-muted-foreground/45'
      )}
    >
      {label}
    </button>
  )
}

export default function TutorialWalkthroughPage() {
  const [stageIndex, setStageIndex] = useState(0)
  const [stroke, setStroke] = useState<Vec[] | null>(null)
  const [drawing, setDrawing] = useState<Vec[] | null>(null)
  const [circle, setCircle] = useState<{ cx: number; cy: number; r: number } | null>(null)
  const [text, setText] = useState<{ x: number; y: number; value: string } | null>(null)
  const [editingText, setEditingText] = useState(false)
  const [component, setComponent] = useState<GhostComponent | null>(null)
  const [draggingComponent, setDraggingComponent] = useState(false)
  const [componentOffset, setComponentOffset] = useState<Vec>({ x: 0, y: 0 })
  const [playTriggered, setPlayTriggered] = useState(false)
  const [undoTriggered, setUndoTriggered] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  const stage = STAGES[stageIndex]
  const stageId = stage?.id
  const done = stageIndex >= STAGES.length
  const currentCaption = stage?.caption ?? 'Learn the board one surface at a time.'
  const learnedTop = stageIndex >= 2
  const learnedDock = DOCK_STAGES.filter((id) => STAGES.findIndex((s) => s.id === id) < stageIndex)
  const learnedTools = TOOL_STAGES.filter((id) => STAGES.findIndex((s) => s.id === id) < stageIndex)
  const isActive = (id: StageId) => stageId === id
  const next = () => setStageIndex((i) => Math.min(i + 1, STAGES.length))

  const revealCurrent = () => {
    if (stageId && !CANVAS_STAGES.includes(stageId)) next()
  }

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stageId || !CANVAS_STAGES.includes(stageId)) return
    const el = canvasRef.current
    if (!el) return
    const p = localPoint(el, e)

    if (stageId === 'canvas-place') {
      setComponent({ x: p.x - 72, y: p.y - 32, w: 144, h: 64, label: 'Component' })
      next()
      return
    }

    if (stageId === 'canvas-edit' && component) {
      const inside = p.x >= component.x && p.x <= component.x + component.w && p.y >= component.y && p.y <= component.y + component.h
      if (inside) setEditingText(true)
      return
    }

    if (stageId === 'canvas-draw') {
      setDrawing([p])
      return
    }

    if (stageId === 'canvas-shape') {
      setCircle({ cx: p.x, cy: p.y, r: 16 })
      return
    }

    if (stageId === 'canvas-text') {
      setText({ x: p.x, y: p.y, value: '' })
      setEditingText(true)
      return
    }

    if (stageId === 'canvas-move' && component) {
      const inside = p.x >= component.x && p.x <= component.x + component.w && p.y >= component.y && p.y <= component.y + component.h
      if (inside) {
        setDraggingComponent(true)
        setComponentOffset({ x: p.x - component.x, y: p.y - component.y })
      }
      return
    }

    if (stageId === 'canvas-play') {
      setPlayTriggered(true)
      next()
      return
    }

    if (stageId === 'canvas-undo') {
      setUndoTriggered(true)
      setStroke(null)
      setCircle(null)
      next()
    }
  }

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = canvasRef.current
    if (!el) return
    const p = localPoint(el, e)

    if (stageId === 'canvas-draw' && drawing) {
      setDrawing((pts) => (pts ? [...pts, p] : pts))
      return
    }

    if (stageId === 'canvas-shape' && circle) {
      setCircle((c) => (c ? { ...c, r: Math.max(12, Math.hypot(p.x - c.cx, p.y - c.cy)) } : c))
      return
    }

    if (stageId === 'canvas-move' && draggingComponent && component) {
      setComponent({ ...component, x: p.x - componentOffset.x, y: p.y - componentOffset.y })
    }
  }

  const onCanvasPointerUp = () => {
    if (!stageId) return
    if (stageId === 'canvas-draw' && drawing && drawing.length > 2) {
      setStroke(drawing)
      setDrawing(null)
      next()
    }
    if (stageId === 'canvas-shape' && circle && circle.r > 14) next()
    if (stageId === 'canvas-move' && draggingComponent) {
      setDraggingComponent(false)
      next()
    }
  }

  return (
    <RequireAuth>
      <div className="flex h-dvh flex-col overflow-hidden bg-background px-3 py-3 sm:px-4">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-border/60 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_94%,white)_0%,var(--background)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--accent-blue)_10%,transparent),transparent_35%),radial-gradient(circle_at_bottom_right,color-mix(in_oklch,var(--accent-mint)_10%,transparent),transparent_35%)]" />

          <header className="relative z-10 flex h-12 shrink-0 items-center gap-2 bg-background px-4">
            <div className="flex items-center gap-2 text-[14px] font-extrabold tracking-tight">
              SIM<span className="text-[var(--accent-blue)]">BLIP</span>
            </div>
            <div className="hidden h-5 w-px bg-border sm:block" />
            <div className="flex-1 overflow-x-auto no-scrollbar">
              <div className="flex min-w-max items-center gap-2">
                <GhostPill label="Search" learned={learnedTop} active={isActive('top-search')} onClick={stageId === 'top-search' ? next : undefined} />
                <GhostPill label="Page controls" learned={learnedTop} active={isActive('top-page-controls')} onClick={stageId === 'top-page-controls' ? next : undefined} />
                <GhostPill label="Undo / redo" learned={stageIndex > STAGES.findIndex((s) => s.id === 'canvas-undo')} active={false} />
                <GhostPill label="Tutorial" learned={stageIndex > 0} active={false} />
                <GhostPill label="Theme" learned={stageIndex > 0} active={false} />
                <GhostPill label="Profile" learned={stageIndex > 0} active={false} />
              </div>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-2 bg-background">
              <GhostIconButton label="Theme" learned={stageIndex > 0} active={false} Icon={Moon} />
              <GhostIconButton label="Settings" learned={stageIndex > 0} active={false} Icon={Settings2} />
              <GhostIconButton label="Close" learned={false} active={false} Icon={X} />
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1">
            <aside className="hidden w-[min(18rem,24vw)] min-w-[14rem] flex-col border-r border-border/60 bg-background/70 md:flex">
              <div className="border-b border-border/50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">Dock</p>
                <div className="mt-2 space-y-1.5">
                  <ToolStub label="Notebook" learned={learnedDock.includes('dock-notebook')} active={isActive('dock-notebook')} onClick={stageId === 'dock-notebook' ? next : undefined} />
                  <ToolStub label="Components" learned={learnedDock.includes('dock-components')} active={isActive('dock-components')} onClick={stageId === 'dock-components' ? next : undefined} />
                  <ToolStub label="Tools" learned={learnedDock.includes('dock-tools')} active={isActive('dock-tools')} onClick={stageId === 'dock-tools' ? next : undefined} />
                  <ToolStub label="Library" learned={learnedDock.includes('dock-library')} active={isActive('dock-library')} onClick={stageId === 'dock-library' ? next : undefined} />
                  <ToolStub label="Properties" learned={learnedDock.includes('dock-properties')} active={isActive('dock-properties')} onClick={stageId === 'dock-properties' ? next : undefined} />
                </div>
              </div>
              <div className="min-h-0 flex-1 p-3">
                <div className="h-full rounded-2xl border border-dashed border-border/70 bg-foreground/[0.02] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">Panel skeleton</p>
                  <div className="mt-3 space-y-2">
                    <div className="h-3 w-3/5 rounded bg-current opacity-15" />
                    <div className="h-3 w-4/5 rounded bg-current opacity-10" />
                    <div className="h-3 w-2/5 rounded bg-current opacity-15" />
                    <div className="mt-4 h-28 rounded-2xl border border-dashed border-border/60" />
                  </div>
                </div>
              </div>
            </aside>

            <main className="relative min-w-0 flex-1">
              <div className="relative flex h-full min-h-0 flex-col">
                <div className="flex items-center gap-2 bg-background px-4 py-2.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground/55" />
                  <span className="rounded-lg border border-dashed border-border/70 px-2.5 py-1 text-[12px] text-muted-foreground/45">Search</span>
                  <div className="flex-1" />
                  <GhostPill label="Page controls" learned={learnedTop} active={isActive('top-page-controls')} onClick={stageId === 'top-page-controls' ? next : undefined} />
                  <GhostPill label="Undo" learned={stageIndex > STAGES.findIndex((s) => s.id === 'canvas-undo')} active={false} />
                </div>

                <div className="flex min-h-0 flex-1">
                  <div
                    ref={canvasRef}
                    onPointerDown={onCanvasPointerDown}
                    onPointerMove={onCanvasPointerMove}
                    onPointerUp={onCanvasPointerUp}
                    className={cn(
                      'relative min-h-[24rem] flex-1 overflow-hidden rounded-3xl border border-border/70 bg-background/90 touch-none select-none',
                      stageId && CANVAS_STAGES.includes(stageId) ? 'ring-2 ring-[var(--accent-blue)]/15' : 'ring-1 ring-border/30'
                    )}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,transparent_0,transparent_39px,color-mix(in_oklch,var(--border)_30%,transparent)_40px),linear-gradient(to_bottom,transparent_0,transparent_39px,color-mix(in_oklch,var(--border)_30%,transparent)_40px)] bg-[size:40px_40px] opacity-40" />
                    <div className="absolute left-4 top-4 max-w-[18rem] rounded-2xl border border-dashed border-border/70 bg-background/78 px-3 py-2 text-[12px] text-muted-foreground/60 backdrop-blur-sm">
                      {currentCaption}
                    </div>

                    <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
                      <div className="flex max-w-full flex-wrap justify-center gap-1.5 rounded-2xl border border-border/60 bg-background/85 p-2 backdrop-blur-md">
                        <GhostIconButton label="Select" learned={learnedTools.includes('toolbar-select')} active={isActive('toolbar-select')} Icon={MousePointer2} onClick={stageId === 'toolbar-select' ? next : undefined} />
                        <GhostIconButton label="Pen" learned={learnedTools.includes('toolbar-pen')} active={isActive('toolbar-pen')} Icon={Pen} onClick={stageId === 'toolbar-pen' ? next : undefined} />
                        <GhostIconButton label="Shaper" learned={learnedTools.includes('toolbar-shaper')} active={isActive('toolbar-shaper')} Icon={Square} onClick={stageId === 'toolbar-shaper' ? next : undefined} />
                        <GhostIconButton label="Eraser" learned={learnedTools.includes('toolbar-eraser')} active={isActive('toolbar-eraser')} Icon={X} onClick={stageId === 'toolbar-eraser' ? next : undefined} />
                      </div>
                    </div>

                    {component && (
                      <div
                        className={cn(
                          'absolute rounded-2xl border bg-background shadow-sm',
                          stageId === 'canvas-place' || stageId === 'canvas-edit' || stageId === 'canvas-move'
                            ? 'border-[var(--accent-blue)]/50'
                            : 'border-border/60'
                        )}
                        style={{ left: component.x, top: component.y, width: component.w, height: component.h }}
                      >
                        <div className="flex h-full flex-col justify-between p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded-full bg-[var(--accent-blue)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-blue)]">Component</span>
                            <span className="rounded-full border border-dashed border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground/50">drag</span>
                          </div>
                          {editingText ? (
                            <input
                              autoFocus
                              value={component.label}
                              onChange={(e) => setComponent({ ...component, label: e.target.value })}
                              onBlur={() => {
                                setEditingText(false)
                                if (component.label.trim()) next()
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                              }}
                              className="w-full rounded-md border border-[var(--accent-blue)] bg-background px-2 py-1 text-[13px] outline-none"
                            />
                          ) : (
                            <p className="truncate text-[13px] font-semibold text-foreground">{component.label}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {(stroke || drawing) && (
                      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                        <polyline
                          points={(drawing ?? stroke ?? []).map((p) => `${p.x},${p.y}`).join(' ')}
                          fill="none"
                          stroke="var(--foreground)"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {circle && (
                          <circle
                            cx={circle.cx}
                            cy={circle.cy}
                            r={circle.r}
                            fill="color-mix(in oklch, var(--accent-mint) 25%, transparent)"
                            stroke="var(--accent-mint)"
                            strokeWidth={2}
                          />
                        )}
                      </svg>
                    )}

                    {text &&
                      (editingText ? (
                        <input
                          autoFocus
                          value={text.value}
                          onChange={(e) => setText({ ...text, value: e.target.value })}
                          onBlur={() => {
                            setEditingText(false)
                            if (text.value.trim()) next()
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur()
                          }}
                          className="absolute rounded-md border border-[var(--accent-blue)] bg-background px-1.5 py-0.5 text-[13px] outline-none"
                          style={{ left: text.x, top: text.y - 12 }}
                          placeholder="Type something…"
                        />
                      ) : (
                        <span
                          className="absolute -translate-y-1/2 rounded-md bg-[var(--accent-amber)]/15 px-1.5 py-0.5 text-[13px] font-medium text-[var(--accent-amber)]"
                          style={{ left: text.x, top: text.y }}
                        >
                          {text.value}
                        </span>
                      ))}

                    {playTriggered && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/25 backdrop-blur-[1px]">
                        <div className="rounded-full border border-[var(--accent-mint)]/40 bg-[var(--accent-mint)]/10 px-4 py-2 text-[12px] font-semibold text-[var(--accent-mint)]">
                          Simulation mode learned
                        </div>
                      </div>
                    )}

                    {undoTriggered && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/25 backdrop-blur-[1px]">
                        <div className="rounded-full border border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10 px-4 py-2 text-[12px] font-semibold text-[var(--accent-rose)]">
                          Undo learned
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </main>
          </div>

          {done && (
            <div className="border-t border-border/50 p-4">
              <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/70 bg-foreground/[0.02] px-4 py-6 text-center">
                <p className="max-w-md text-[15px] font-medium leading-relaxed text-foreground">
                  That's the core of SIMBLIP — the board, the dock, the tools and the canvas all work the same way.
                </p>
                <Link
                  href="/board"
                  className="flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Open your notebook <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          )}

          <footer className="relative z-10 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-[10.5px] text-muted-foreground">
            <span className="font-medium">SIMBLIP · Tutorial shell</span>
            <div className="flex-1" />
            <span>Ghosted until learned</span>
          </footer>
        </div>
      </div>
    </RequireAuth>
  )
}
