'use client'

// Infinite canvas. One transformed layer holds every object; all gestures run
// through a small pointer state machine kept in refs so drags never re-render
// anything but the objects they move.
//
// The pen recognizes sketches on release (circle/rect/line/spring/polygon) —
// recognition upgrades geometry only; meaning comes from behaviors. During
// Play the world runtime writes transforms straight to the wrapper elements
// registered here; edit gestures are locked until Reset.

import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { SceneObject, Vec2 } from '@/lib/scene/types'
import { num } from '@/lib/scene/types'
import { createGeometry, fromRecognition, componentById } from '@/lib/scene/factory'
import { createBehavior } from '@/lib/behaviors/registry'
import { nearTerminal } from '@/lib/circuit/engine'
import { recognize } from '@/lib/sketch/recognize'
import { useDocStore, type Viewport, type Tool } from '@/lib/store/document'
import { registerElement, useRuntimeStore } from '@/lib/physics/world'
import { OBJECT_RENDERERS } from '@/components/objects'
import { pointsToPath } from '@/components/objects/geometry'
import { cn } from '@/lib/utils'

const GRID = 24
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

type GestureMode = 'idle' | 'pan' | 'move' | 'marquee' | 'draw' | 'resize'

interface Gesture {
  mode: GestureMode
  start: Vec2
  startScreen: Vec2
  startViewport: Viewport
  moved: boolean
  objectStartPositions: Map<string, Vec2>
  resizeId?: string
  resizeStart?: { w: number; h: number }
}

const ObjectView = memo(function ObjectView({
  pageId,
  object,
  selected,
  onPointerDown,
  onResizeStart,
}: {
  pageId: string
  object: SceneObject
  selected: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onResizeStart: (e: React.PointerEvent, id: string) => void
}) {
  const Renderer = OBJECT_RENDERERS[object.geometry.kind]
  if (!Renderer) return null
  const resizable = !['line', 'stroke', 'polygon'].includes(object.geometry.kind)
  return (
    // Outer wrapper: registered with the physics runtime, which drives its
    // transform during Play. Edit-time rotation lives on the inner div so the
    // two never fight over one style property.
    <div
      ref={(el) => registerElement(object.id, el)}
      data-object-id={object.id}
      className="absolute"
      style={{
        left: object.position.x,
        top: object.position.y,
        width: object.size.w || undefined,
        height: object.size.h || undefined,
        zIndex: object.z,
        transformOrigin: 'center center',
      }}
      onPointerDown={(e) => onPointerDown(e, object.id)}
    >
      <div
        className={cn(
          'h-full w-full rounded-xl',
          selected && 'ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-transparent'
        )}
        style={{ transform: object.rotation ? `rotate(${object.rotation}deg)` : undefined }}
      >
        <Renderer pageId={pageId} object={object} selected={selected} />
      </div>
      {selected && resizable && (
        <div
          role="button"
          aria-label="Resize"
          className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-se-resize rounded-full border-2 border-[var(--ring)] bg-background"
          onPointerDown={(e) => onResizeStart(e, object.id)}
        />
      )}
    </div>
  )
})

export function InfiniteCanvas({ pageId }: { pageId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const spaceRef = useRef(false)

  const objects = useDocStore((s) => s.pages[pageId]?.objects)
  const viewport = useDocStore((s) => s.viewports[pageId]) ?? { x: 0, y: 0, zoom: 1 }
  const tool = useDocStore((s) => s.tool)
  const toolOption = useDocStore((s) => s.toolOption)
  const selection = useDocStore((s) => s.selection)
  const playMode = useRuntimeStore((s) => s.mode)
  const editing = playMode === 'edit'

  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null)
  const [stroke, setStroke] = useState<number[][] | null>(null)

  const ensurePage = useDocStore((s) => s.ensurePage)
  useEffect(() => {
    ensurePage(pageId)
  }, [pageId, ensurePage])

  const toCanvas = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const rect = containerRef.current!.getBoundingClientRect()
      const v = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
      return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom }
    },
    [pageId]
  )

  // Wheel must be a non-passive native listener to preventDefault browser zoom.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const store = useDocStore.getState()
      const v = store.viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.0022)))
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        store.setViewport(pageId, {
          zoom,
          x: sx - ((sx - v.x) * zoom) / v.zoom,
          y: sy - ((sy - v.y) * zoom) / v.zoom,
        })
      } else {
        store.setViewport(pageId, { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pageId])

  // Global keyboard map. Skipped while typing in inputs/contentEditable.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) spaceRef.current = true
      if (isTyping(e.target)) return
      const store = useDocStore.getState()
      const locked = useRuntimeStore.getState().mode !== 'edit'
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z' && !locked) {
        e.preventDefault()
        if (e.shiftKey) store.redo(pageId)
        else store.undo(pageId)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection.length > 0 && !locked) {
        e.preventDefault()
        store.removeObjects(pageId, store.selection)
        return
      }
      if (e.key === 'Escape') {
        store.setSelection([])
        store.setTool('select')
        return
      }
      if (mod || locked) return
      const toolKeys: Record<string, Tool> = {
        v: 'select', p: 'pen', c: 'circle', r: 'rect', l: 'line',
        t: 'text', n: 'note', f: 'formula', g: 'graph',
      }
      const t = toolKeys[e.key.toLowerCase()]
      if (t) store.setTool(t)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [pageId])

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      const store = useDocStore.getState()
      const dxScreen = e.clientX - g.startScreen.x
      const dyScreen = e.clientY - g.startScreen.y
      if (Math.abs(dxScreen) + Math.abs(dyScreen) > 3) g.moved = true

      if (g.mode === 'pan') {
        store.setViewport(pageId, {
          ...g.startViewport,
          x: g.startViewport.x + dxScreen,
          y: g.startViewport.y + dyScreen,
        })
        return
      }

      const point = toCanvas(e.clientX, e.clientY)

      if (g.mode === 'move') {
        const dx = point.x - g.start.x
        const dy = point.y - g.start.y
        for (const [id, startPos] of g.objectStartPositions) {
          store.updateObject(pageId, id, { position: { x: startPos.x + dx, y: startPos.y + dy } })
        }
      } else if (g.mode === 'marquee') {
        setMarquee({ a: g.start, b: point })
      } else if (g.mode === 'draw') {
        setStroke((prev) => (prev ? [...prev, [point.x, point.y]] : [[point.x, point.y]]))
      } else if (g.mode === 'resize' && g.resizeId && g.resizeStart) {
        const zoom = g.startViewport.zoom
        store.updateObject(pageId, g.resizeId, {
          size: {
            w: Math.max(16, g.resizeStart.w + dxScreen / zoom),
            h: Math.max(16, g.resizeStart.h + dyScreen / zoom),
          },
        })
      }
    },
    [pageId, toCanvas]
  )

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const g = gestureRef.current
      gestureRef.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      if (!g) return
      const store = useDocStore.getState()

      if (g.mode === 'marquee') {
        const point = toCanvas(e.clientX, e.clientY)
        const x0 = Math.min(g.start.x, point.x)
        const y0 = Math.min(g.start.y, point.y)
        const x1 = Math.max(g.start.x, point.x)
        const y1 = Math.max(g.start.y, point.y)
        setMarquee(null)
        if (g.moved) {
          const hit = Object.values(store.pages[pageId]?.objects ?? {})
            .filter(
              (o) =>
                o.position.x < x1 &&
                o.position.x + o.size.w > x0 &&
                o.position.y < y1 &&
                o.position.y + o.size.h > y0
            )
            .map((o) => o.id)
          store.setSelection(hit)
        } else {
          store.setSelection([])
        }
      } else if (g.mode === 'draw') {
        setStroke((points) => {
          if (points && points.length > 1) {
            // Sketch → recognized geometry. A zigzag lands as a live spring.
            const obj = fromRecognition(recognize(points))
            // A doodle whose end touches a circuit terminal IS a wire.
            if (
              (obj.geometry.kind === 'line' || obj.geometry.kind === 'stroke') &&
              obj.behaviors.length === 0
            ) {
              const pts = obj.geometry.points ?? []
              const ends = [pts[0], pts[pts.length - 1]].filter(Boolean)
              const others = Object.values(store.pages[pageId]?.objects ?? {})
              if (
                ends.some(([x, y]) =>
                  nearTerminal(others, { x: obj.position.x + x, y: obj.position.y + y })
                )
              ) {
                obj.behaviors.push(createBehavior('wire'))
                obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
              }
            }
            store.addObject(pageId, obj)
            store.setSelection([obj.id])
          }
          return null
        })
      }
    },
    [pageId, onPointerMove, toCanvas]
  )

  const beginGesture = (mode: GestureMode, e: React.PointerEvent, extra?: Partial<Gesture>) => {
    const store = useDocStore.getState()
    gestureRef.current = {
      mode,
      start: toCanvas(e.clientX, e.clientY),
      startScreen: { x: e.clientX, y: e.clientY },
      startViewport: store.viewports[pageId] ?? { x: 0, y: 0, zoom: 1 },
      moved: false,
      objectStartPositions: new Map(
        store.selection
          .map((id) => [id, store.pages[pageId]?.objects[id]?.position] as const)
          .filter((entry): entry is [string, Vec2] => Boolean(entry[1]))
          .map(([id, p]) => [id, { ...p }])
      ),
      ...extra,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || spaceRef.current) {
      beginGesture('pan', e)
      return
    }
    if (e.button !== 0) return
    const store = useDocStore.getState()

    if (!editing || tool === 'select') {
      beginGesture('marquee', e)
      return
    }
    if (tool === 'pen') {
      const p = toCanvas(e.clientX, e.clientY)
      setStroke([[p.x, p.y]])
      beginGesture('draw', e)
      return
    }

    // Placement: geometry primitives or a palette component.
    const point = toCanvas(e.clientX, e.clientY)
    let obj: SceneObject | null = null
    if (tool === 'place') {
      const def = toolOption ? componentById(toolOption) : undefined
      if (def) obj = def.create(point)
    } else {
      obj = createGeometry(tool, point)
    }
    if (!obj) return
    obj.position = { x: point.x - obj.size.w / 2, y: point.y - obj.size.h / 2 }
    store.addObject(pageId, obj)
    store.setSelection([obj.id])
    if (tool !== 'place') store.setTool('select')
  }

  const handleObjectPointerDown = (e: React.PointerEvent, id: string) => {
    if ((tool !== 'select' && editing) || e.button !== 0) return
    e.stopPropagation()
    const store = useDocStore.getState()
    let nextSelection: string[]
    if (e.shiftKey) {
      nextSelection = store.selection.includes(id)
        ? store.selection.filter((s) => s !== id)
        : [...store.selection, id]
    } else {
      nextSelection = store.selection.includes(id) ? store.selection : [id]
    }
    store.setSelection(nextSelection)
    if (!editing) {
      // Interactive components stay clickable while the circuit runs.
      const obj = store.pages[pageId]?.objects[id]
      const sym = obj?.geometry.kind === 'symbol' ? obj.geometry.symbol : undefined
      const param = sym === 'switch' ? 'closed' : sym === 'input' ? 'value' : undefined
      if (obj && param) {
        const p = obj.parameters[param]
        const cur = p?.kind === 'number' ? p.value : sym === 'switch' ? 1 : 0
        const next = cur >= 0.5 ? '0' : '1'
        if (p) store.setParam(pageId, id, param, next)
        else
          store.updateObject(pageId, id, {
            parameters: { ...obj.parameters, [param]: num(next) },
          })
      }
      return // inspecting during Play is fine; moving is not
    }
    store.pushHistory(pageId)
    beginGesture('move', e)
  }

  const handleResizeStart = (e: React.PointerEvent, id: string) => {
    if (!editing) return
    e.stopPropagation()
    const store = useDocStore.getState()
    const obj = store.pages[pageId]?.objects[id]
    if (!obj) return
    store.pushHistory(pageId)
    beginGesture('resize', e, { resizeId: id, resizeStart: { ...obj.size } })
  }

  const cursor = tool === 'pen' ? 'crosshair' : tool === 'select' ? 'default' : 'copy'

  return (
    <div
      ref={containerRef}
      className="canvas-dots relative h-full w-full touch-none overflow-hidden bg-background"
      style={{
        cursor: editing ? cursor : 'default',
        backgroundSize: `${GRID * viewport.zoom}px ${GRID * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={handleBackgroundPointerDown}
      role="application"
      aria-label="Infinite canvas"
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {objects &&
          Object.values(objects).map((obj) => (
            <ObjectView
              key={obj.id}
              pageId={pageId}
              object={obj}
              selected={selection.includes(obj.id)}
              onPointerDown={handleObjectPointerDown}
              onResizeStart={handleResizeStart}
            />
          ))}

        {stroke && stroke.length > 1 && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            <path
              d={pointsToPath(stroke)}
              fill="none"
              stroke="var(--foreground)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {marquee && (
          <div
            className="pointer-events-none absolute rounded-md border border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_8%,transparent)]"
            style={{
              left: Math.min(marquee.a.x, marquee.b.x),
              top: Math.min(marquee.a.y, marquee.b.y),
              width: Math.abs(marquee.b.x - marquee.a.x),
              height: Math.abs(marquee.b.y - marquee.a.y),
            }}
          />
        )}
      </div>

      <div className="glass absolute bottom-4 right-4 rounded-full px-3 py-1 font-mono text-[11px] text-muted-foreground">
        {Math.round(viewport.zoom * 100)}%
      </div>
    </div>
  )
}
