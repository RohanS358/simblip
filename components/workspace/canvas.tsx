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
import { nearTerminal, TERMINALS, terminalWorld, SNAP } from '@/lib/circuit/engine'
import { applyAnnotation } from '@/lib/scene/annotate'
import { recognize } from '@/lib/sketch/recognize'
import { useDocStore, type Viewport, type Tool } from '@/lib/store/document'
import { registerElement, useRuntimeStore } from '@/lib/physics/world'
import { OBJECT_RENDERERS } from '@/components/objects'
import { pointsToPath } from '@/components/objects/geometry'
import { cn } from '@/lib/utils'

const GRID = 24
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

// Universal placement gestures: click spawns the default; dragging sizes
// the object while placing it. Line-likes go point→point, circle-likes grow
// by radius from the press point (their center), everything else stretches
// corner→corner like a marquee.
const CONNECTOR_IDS = new Set(['spring', 'rope', 'rod', 'damper'])
const CIRCULAR_IDS = new Set(['mass', 'wheel', 'motor', 'hinge'])
const MIN_PLACE_DRAG = 8 // screen px below which a drag counts as a click

// Inside a system boundary, recognized doodle shapes become that domain's
// components: zigzag → resistor, box → battery/gate, blob → bulb/BJT…
const DOMAIN_SKETCH: Record<string, Partial<Record<string, string>>> = {
  mechanics: { circle: 'mass', rect: 'block' },
  electrical: { spring: 'resistor', rect: 'battery', circle: 'bulb', polygon: 'capacitor' },
  electronics: { spring: 'resistor', circle: 'bjt', polygon: 'diode', rect: 'mosfet' },
  digital: { rect: 'and-gate', circle: 'or-gate', polygon: 'xor-gate', spring: 'clock' },
}

type GestureMode =
  | 'idle'
  | 'pan'
  | 'move'
  | 'marquee'
  | 'draw'
  | 'resize'
  | 'rotate'
  | 'placeLine'
  | 'placeRect'
  | 'placeRadius'

interface Gesture {
  mode: GestureMode
  start: Vec2
  startScreen: Vec2
  startViewport: Viewport
  moved: boolean
  objectStartPositions: Map<string, Vec2>
  resizeId?: string
  resizeStart?: { w: number; h: number }
  resizeOrigin?: Vec2
  resizeCorner?: 'nw' | 'ne' | 'sw' | 'se'
  rotateId?: string
  rotateCenter?: Vec2
  rotateStartAngle?: number
  rotateStartRotation?: number
  /** Palette component id for drag-to-draw placement. */
  placeComponent?: string
  /** Geometry tool for drag-to-draw placement (circle, rect, text…). */
  placeTool?: Tool
}

const ObjectView = memo(function ObjectView({
  pageId,
  object,
  selected,
  onPointerDown,
  onResizeStart,
  onRotateStart,
}: {
  pageId: string
  object: SceneObject
  selected: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onResizeStart: (e: React.PointerEvent, id: string, corner: 'nw' | 'ne' | 'sw' | 'se') => void
  onRotateStart: (e: React.PointerEvent, id: string) => void
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
          selected && 'ring-1 ring-[var(--ring)] ring-offset-1 ring-offset-transparent'
        )}
        style={{ transform: object.rotation ? `rotate(${object.rotation}deg)` : undefined }}
      >
        <Renderer pageId={pageId} object={object} selected={selected} />
      </div>
      {selected && resizable && (
        // Figma-style corner handles — resize from any corner; opposite corner
        // stays anchored. Shift keeps the aspect ratio.
        <>
          {(
            [
              ['nw', '-top-1 -left-1 cursor-nwse-resize'],
              ['ne', '-top-1 -right-1 cursor-nesw-resize'],
              ['sw', '-bottom-1 -left-1 cursor-nesw-resize'],
              ['se', '-bottom-1 -right-1 cursor-nwse-resize'],
            ] as const
          ).map(([corner, cls]) => (
            <div
              key={corner}
              role="button"
              aria-label={`Resize ${corner}`}
              className={cn(
                'absolute h-2.5 w-2.5 rounded-[3px] border border-[var(--ring)] bg-background',
                cls
              )}
              onPointerDown={(e) => onResizeStart(e, object.id, corner)}
            />
          ))}
        </>
      )}
      {selected && (
        // Canva-style rotation grip above the selection box.
        <div
          role="button"
          aria-label="Rotate"
          className="absolute -top-6 left-1/2 flex -translate-x-1/2 flex-col items-center"
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => onRotateStart(e, object.id)}
        >
          <div className="h-3 w-3 rounded-full border border-[var(--ring)] bg-background" />
          <div className="h-2.5 w-px bg-[var(--ring)] opacity-60" />
        </div>
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
  // Snap assistant: alignment guide lines + terminal connection points,
  // populated during move gestures and cleared on release.
  const [guides, setGuides] = useState<{ v: number[]; h: number[]; pts: Vec2[] } | null>(null)
  // Ink annotation: a tiny scribble near a component opens this mini input;
  // its text sets the nearest component's value ("100k", "9V") or name.
  const [quickLabel, setQuickLabel] = useState<{ x: number; y: number; id: string } | null>(null)
  // Drag-to-place outline (dashed box or circle) while sizing a new object.
  const [placePreview, setPlacePreview] = useState<{
    x: number
    y: number
    w: number
    h: number
    round: boolean
  } | null>(null)

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
        let dx = point.x - g.start.x
        let dy = point.y - g.start.y
        const page = store.pages[pageId]
        const newGuides: { v: number[]; h: number[]; pts: Vec2[] } = { v: [], h: [], pts: [] }

        // Snap assistant (hold Alt to move freely).
        if (!e.altKey && page && g.objectStartPositions.size > 0) {
          const zoom = g.startViewport.zoom
          const th = 6 / zoom
          const movingIds = new Set(g.objectStartPositions.keys())
          const statics = Object.values(page.objects).filter((o) => !movingIds.has(o.id))

          // 1) Electrical terminals click together exactly — a solid
          // connection beats mere alignment, so it wins outright.
          let pinned = false
          outer: for (const [id, sp0] of g.objectStartPositions) {
            const obj = page.objects[id]
            const defs = obj?.geometry.kind === 'symbol' ? TERMINALS[obj.geometry.symbol ?? ''] : undefined
            if (!obj || !defs) continue
            const proposed = { ...obj, position: { x: sp0.x + dx, y: sp0.y + dy } }
            for (const td of defs) {
              const mp = terminalWorld(proposed, td)
              for (const so of statics) {
                if (so.geometry.kind !== 'symbol') continue
                for (const sd of TERMINALS[so.geometry.symbol ?? ''] ?? []) {
                  const tp = terminalWorld(so, sd)
                  if (Math.hypot(tp.x - mp.x, tp.y - mp.y) < SNAP / zoom + 4) {
                    dx += tp.x - mp.x
                    dy += tp.y - mp.y
                    newGuides.pts.push(tp)
                    pinned = true
                    break outer
                  }
                }
              }
            }
          }

          // 2) Edges & centers align against every other object, per axis —
          // centers included, so finding a rigid body's middle is free.
          if (!pinned) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (const [id, sp0] of g.objectStartPositions) {
              const o = page.objects[id]
              if (!o) continue
              minX = Math.min(minX, sp0.x + dx)
              maxX = Math.max(maxX, sp0.x + dx + o.size.w)
              minY = Math.min(minY, sp0.y + dy)
              maxY = Math.max(maxY, sp0.y + dy + o.size.h)
            }
            if (Number.isFinite(minX)) {
              const mxs = [minX, (minX + maxX) / 2, maxX]
              const mys = [minY, (minY + maxY) / 2, maxY]
              let bestX: { d: number; adj: number; at: number } | null = null
              let bestY: { d: number; adj: number; at: number } | null = null
              for (const so of statics) {
                const sxs = [so.position.x, so.position.x + so.size.w / 2, so.position.x + so.size.w]
                const sys = [so.position.y, so.position.y + so.size.h / 2, so.position.y + so.size.h]
                for (const mv of mxs)
                  for (const sv of sxs) {
                    const d = Math.abs(sv - mv)
                    if (d < th && (!bestX || d < bestX.d)) bestX = { d, adj: sv - mv, at: sv }
                  }
                for (const mv of mys)
                  for (const sv of sys) {
                    const d = Math.abs(sv - mv)
                    if (d < th && (!bestY || d < bestY.d)) bestY = { d, adj: sv - mv, at: sv }
                  }
              }
              if (bestX) {
                dx += bestX.adj
                newGuides.v.push(bestX.at)
              }
              if (bestY) {
                dy += bestY.adj
                newGuides.h.push(bestY.at)
              }
            }
          }
        }

        for (const [id, startPos] of g.objectStartPositions) {
          store.updateObject(pageId, id, { position: { x: startPos.x + dx, y: startPos.y + dy } })
        }
        setGuides(newGuides.v.length + newGuides.h.length + newGuides.pts.length > 0 ? newGuides : null)
      } else if (g.mode === 'marquee') {
        setMarquee({ a: g.start, b: point })
      } else if (g.mode === 'draw') {
        // Coalesced pointer events give the full-resolution ink trail.
        const raw: { clientX: number; clientY: number }[] =
          typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
            ? e.getCoalescedEvents()
            : [e]
        const pts = raw.map((ev) => toCanvas(ev.clientX, ev.clientY))
        setStroke((prev) => {
          const next = prev ? [...prev] : []
          for (const p of pts) {
            const last = next[next.length - 1]
            if (!last || Math.hypot(p.x - last[0], p.y - last[1]) > 0.75) next.push([p.x, p.y])
          }
          return next
        })
      } else if (g.mode === 'placeLine') {
        // Straight rubber-band preview; Shift snaps the angle to 15° steps.
        let end = point
        if (e.shiftKey) {
          const ang = Math.atan2(point.y - g.start.y, point.x - g.start.x)
          const snap = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
          const len = Math.hypot(point.x - g.start.x, point.y - g.start.y)
          end = { x: g.start.x + len * Math.cos(snap), y: g.start.y + len * Math.sin(snap) }
        }
        setStroke([
          [g.start.x, g.start.y],
          [end.x, end.y],
        ])
      } else if (g.mode === 'placeRect') {
        // Corner→corner outline; Shift keeps it square.
        let w = point.x - g.start.x
        let h = point.y - g.start.y
        if (e.shiftKey) {
          const k = Math.max(Math.abs(w), Math.abs(h))
          w = Math.sign(w || 1) * k
          h = Math.sign(h || 1) * k
        }
        setPlacePreview({
          x: Math.min(g.start.x, g.start.x + w),
          y: Math.min(g.start.y, g.start.y + h),
          w: Math.abs(w),
          h: Math.abs(h),
          round: false,
        })
      } else if (g.mode === 'placeRadius') {
        // Press point is the center; drag distance is the radius.
        const r = Math.hypot(point.x - g.start.x, point.y - g.start.y)
        setPlacePreview({ x: g.start.x - r, y: g.start.y - r, w: 2 * r, h: 2 * r, round: true })
      } else if (g.mode === 'resize' && g.resizeId && g.resizeStart && g.resizeOrigin) {
        const zoom = g.startViewport.zoom
        const corner = g.resizeCorner ?? 'se'
        const dx = dxScreen / zoom
        const dy = dyScreen / zoom
        let w = Math.max(16, g.resizeStart.w + (corner.includes('e') ? dx : -dx))
        let h = Math.max(16, g.resizeStart.h + (corner.includes('s') ? dy : -dy))
        if (e.shiftKey) {
          const k = Math.max(w / g.resizeStart.w, h / g.resizeStart.h)
          w = Math.max(16, g.resizeStart.w * k)
          h = Math.max(16, g.resizeStart.h * k)
        }
        store.updateObject(pageId, g.resizeId, {
          size: { w, h },
          position: {
            x: corner.includes('w') ? g.resizeOrigin.x + (g.resizeStart.w - w) : g.resizeOrigin.x,
            y: corner.includes('n') ? g.resizeOrigin.y + (g.resizeStart.h - h) : g.resizeOrigin.y,
          },
        })
      } else if (g.mode === 'rotate' && g.rotateId && g.rotateCenter) {
        const angle = Math.atan2(point.y - g.rotateCenter.y, point.x - g.rotateCenter.x)
        let deg =
          (g.rotateStartRotation ?? 0) + ((angle - (g.rotateStartAngle ?? 0)) * 180) / Math.PI
        // Shift snaps to 15° steps, like Figma/Canva.
        if (e.shiftKey) deg = Math.round(deg / 15) * 15
        deg = ((deg % 360) + 360) % 360
        store.updateObject(pageId, g.rotateId, { rotation: Math.round(deg * 10) / 10 })
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
      setGuides(null)
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
      } else if (g.mode === 'placeRect' || g.mode === 'placeRadius') {
        // Drag-to-size placement: the preview outline (which already encodes
        // Shift-square and radius-from-center) becomes the object's box; a
        // plain click falls back to the default size centered on the press.
        setPlacePreview((pv) => {
          const def = g.placeComponent ? componentById(g.placeComponent) : undefined
          const obj = def
            ? def.create(g.start)
            : g.placeTool && g.placeTool !== 'select' && g.placeTool !== 'pen' && g.placeTool !== 'place'
              ? createGeometry(g.placeTool as Parameters<typeof createGeometry>[0], g.start)
              : null
          if (obj) {
            if (pv && g.moved && Math.max(pv.w, pv.h) > MIN_PLACE_DRAG) {
              obj.size = { w: Math.max(16, pv.w), h: Math.max(16, pv.h) }
              obj.position = { x: pv.x, y: pv.y }
            } else {
              obj.position = { x: g.start.x - obj.size.w / 2, y: g.start.y - obj.size.h / 2 }
            }
            store.addObject(pageId, obj)
            store.setSelection([obj.id])
            if (!g.placeComponent) store.setTool('select')
          }
          return null
        })
      } else if (g.mode === 'placeLine') {
        // Drag-to-draw connector: anchor at press point, end at release.
        // Read the endpoint from the preview stroke so Shift-snap sticks.
        setStroke((pts) => {
          const def = g.placeComponent ? componentById(g.placeComponent) : undefined
          const maker = def
            ? () => def.create(g.start)
            : g.placeTool === 'line'
              ? () => createGeometry('line', g.start)
              : null
          if (maker) {
            const a = g.start
            const b =
              pts && pts.length > 1 ? { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] } : a
            const obj = maker()
            if (g.moved && Math.hypot(b.x - a.x, b.y - a.y) > 12) {
              const px = Math.min(a.x, b.x)
              const py = Math.min(a.y, b.y)
              obj.position = { x: px, y: py }
              obj.geometry.points = [
                [a.x - px, a.y - py],
                [b.x - px, b.y - py],
              ]
              obj.size = { w: Math.max(Math.abs(b.x - a.x), 2), h: Math.max(Math.abs(b.y - a.y), 2) }
            } else {
              // Plain click: legacy behavior, default length centered on the click.
              obj.position = { x: a.x - obj.size.w / 2, y: a.y - obj.size.h / 2 }
            }
            store.addObject(pageId, obj)
            store.setSelection([obj.id])
            if (!g.placeComponent) store.setTool('select')
          }
          return null
        })
      } else if (g.mode === 'draw') {
        setStroke((points) => {
          if (!points || points.length < 2) return null
          const rec = recognize(points)
          const all = Object.values(store.pages[pageId]?.objects ?? {})
          const cx = rec.x + rec.w / 2
          const cy = rec.y + rec.h / 2

          // A tiny scribble near a component is an annotation, not a shape:
          // open the mini input (tablet handwriting lands here as text).
          if (store.inkAnnotate && rec.w < 36 && rec.h < 36) {
            let best: SceneObject | null = null
            let bestD = 170
            for (const o of all) {
              if (o.metadata.render === 'system') continue
              const d = Math.hypot(o.position.x + o.size.w / 2 - cx, o.position.y + o.size.h / 2 - cy)
              if (d < bestD) {
                bestD = d
                best = o
              }
            }
            if (best) {
              setQuickLabel({ x: rec.x, y: rec.y + rec.h + 6, id: best.id })
              return null
            }
          }

          // Recognition off → the ink stays exactly as drawn, no upgrades.
          if (!store.inkToShape) {
            const raw = fromRecognition({
              kind: 'stroke',
              points: points.map(([x, y]) => [x - rec.x, y - rec.y]),
              x: rec.x,
              y: rec.y,
              w: rec.w,
              h: rec.h,
            })
            store.addObject(pageId, raw)
            store.setSelection([raw.id])
            return null
          }

          // Inside a system boundary the doodle becomes that domain's part.
          const sys = all
            .filter(
              (o) =>
                o.metadata.render === 'system' &&
                cx > o.position.x &&
                cx < o.position.x + o.size.w &&
                cy > o.position.y &&
                cy < o.position.y + o.size.h
            )
            .sort((a, b) => a.size.w * a.size.h - b.size.w * b.size.h)[0]
          const domain = sys?.metadata.domain as string | undefined

          let obj: SceneObject | null = null
          if (domain) {
            const mapped = DOMAIN_SKETCH[domain]?.[rec.kind]
            const def = mapped ? componentById(mapped) : undefined
            if (def) {
              obj = def.create({ x: cx, y: cy })
              if (obj.geometry.kind === 'symbol') {
                // Symbols keep their 2:1 glyph box, scaled to the sketch.
                const w = Math.min(200, Math.max(72, rec.w))
                obj.size = { w, h: w / 2 }
              } else {
                obj.size = { w: Math.max(24, rec.w), h: Math.max(24, rec.h) }
              }
              obj.position = { x: cx - obj.size.w / 2, y: cy - obj.size.h / 2 }
            } else if ((rec.kind === 'line' || rec.kind === 'stroke') && domain !== 'mechanics') {
              // Any free line in a circuit system conducts.
              obj = fromRecognition(rec)
              obj.behaviors.push(createBehavior('wire'))
              obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
            } else if (rec.kind === 'line' && domain === 'mechanics') {
              obj = fromRecognition(rec)
              obj.behaviors.push(createBehavior('rod'))
            }
          }

          if (!obj) {
            // Sketch → recognized geometry. A zigzag lands as a live spring.
            obj = fromRecognition(rec)
            // A doodle whose end touches a circuit terminal IS a wire.
            if (
              (obj.geometry.kind === 'line' || obj.geometry.kind === 'stroke') &&
              obj.behaviors.length === 0
            ) {
              const pts = obj.geometry.points ?? []
              const ends = [pts[0], pts[pts.length - 1]].filter(Boolean)
              if (
                ends.some(([x, y]) =>
                  nearTerminal(all, { x: obj!.position.x + x, y: obj!.position.y + y })
                )
              ) {
                obj.behaviors.push(createBehavior('wire'))
                obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
              }
            }
          }
          store.addObject(pageId, obj)
          store.setSelection([obj.id])
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

    // Placement: one gesture language everywhere — click spawns the default
    // size, dragging sizes the object as you place it (corner→corner for
    // boxes, radius from center for circles, point→point for lines).
    const point = toCanvas(e.clientX, e.clientY)
    if (tool === 'place') {
      const def = toolOption ? componentById(toolOption) : undefined
      if (!def) return
      if (CONNECTOR_IDS.has(def.id)) {
        setStroke([[point.x, point.y]])
        beginGesture('placeLine', e, { placeComponent: def.id })
        return
      }
      beginGesture(CIRCULAR_IDS.has(def.id) ? 'placeRadius' : 'placeRect', e, {
        placeComponent: def.id,
      })
      return
    }
    if (tool === 'line') {
      setStroke([[point.x, point.y]])
      beginGesture('placeLine', e, { placeTool: tool })
      return
    }
    beginGesture(tool === 'circle' ? 'placeRadius' : 'placeRect', e, { placeTool: tool })
  }

  const handleObjectPointerDown = (e: React.PointerEvent, id: string) => {
    if ((tool !== 'select' && editing) || e.button !== 0) return
    e.stopPropagation()
    const store = useDocStore.getState()
    // System boundaries only grab their border/label — clicks in the middle
    // fall through to marquee so the contents stay selectable.
    const hit = store.pages[pageId]?.objects[id]
    if (hit?.metadata.render === 'system' && editing) {
      const p = toCanvas(e.clientX, e.clientY)
      const m = 16
      if (
        p.x > hit.position.x + m &&
        p.x < hit.position.x + hit.size.w - m &&
        p.y > hit.position.y + m &&
        p.y < hit.position.y + hit.size.h - m
      ) {
        beginGesture('marquee', e)
        return
      }
    }
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

  const handleResizeStart = (e: React.PointerEvent, id: string, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!editing) return
    e.stopPropagation()
    const store = useDocStore.getState()
    const obj = store.pages[pageId]?.objects[id]
    if (!obj) return
    store.pushHistory(pageId)
    beginGesture('resize', e, {
      resizeId: id,
      resizeStart: { ...obj.size },
      resizeOrigin: { ...obj.position },
      resizeCorner: corner,
    })
  }

  const handleRotateStart = (e: React.PointerEvent, id: string) => {
    if (!editing) return
    e.stopPropagation()
    const store = useDocStore.getState()
    const obj = store.pages[pageId]?.objects[id]
    if (!obj) return
    store.pushHistory(pageId)
    const center = {
      x: obj.position.x + obj.size.w / 2,
      y: obj.position.y + obj.size.h / 2,
    }
    const p = toCanvas(e.clientX, e.clientY)
    beginGesture('rotate', e, {
      rotateId: id,
      rotateCenter: center,
      rotateStartAngle: Math.atan2(p.y - center.y, p.x - center.x),
      rotateStartRotation: obj.rotation,
    })
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
        // While a drawing/placement tool is armed, objects must not swallow
        // the pointer (graphs/notes stop propagation) — ink goes through.
        className={cn('absolute left-0 top-0', editing && tool !== 'select' && 'pointer-events-none')}
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
              onRotateStart={handleRotateStart}
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

        {guides && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {guides.v.map((x, i) => (
              <line
                key={`v${i}`}
                x1={x} x2={x} y1={-100000} y2={100000}
                stroke="var(--accent-rose)"
                strokeWidth={1 / viewport.zoom}
                strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
              />
            ))}
            {guides.h.map((y, i) => (
              <line
                key={`h${i}`}
                x1={-100000} x2={100000} y1={y} y2={y}
                stroke="var(--accent-rose)"
                strokeWidth={1 / viewport.zoom}
                strokeDasharray={`${4 / viewport.zoom} ${3 / viewport.zoom}`}
              />
            ))}
            {guides.pts.map((p, i) => (
              // Terminal connection: a filled ring says "this pin is seated".
              <g key={`p${i}`}>
                <circle cx={p.x} cy={p.y} r={7 / viewport.zoom} fill="none" stroke="var(--accent-mint)" strokeWidth={1.5 / viewport.zoom} />
                <circle cx={p.x} cy={p.y} r={2.5 / viewport.zoom} fill="var(--accent-mint)" />
              </g>
            ))}
          </svg>
        )}

        {placePreview && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_6%,transparent)]"
            style={{
              left: placePreview.x,
              top: placePreview.y,
              width: placePreview.w,
              height: placePreview.h,
              borderRadius: placePreview.round ? '50%' : 12,
            }}
          />
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

      {quickLabel && (
        // Own transformed layer: the objects layer may be pointer-events-none
        // while a drawing tool is armed, and this input must stay typable.
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <input
            autoFocus
            aria-label="Component value or name"
            placeholder="100k · 9V · name"
            className="absolute z-50 w-32 rounded-md border border-[var(--ring)] bg-card px-2 py-1 font-mono text-[12px] shadow-md outline-none placeholder:text-muted-foreground/50"
            style={{ left: quickLabel.x, top: quickLabel.y }}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                applyAnnotation(pageId, quickLabel.id, e.currentTarget.value)
                setQuickLabel(null)
              }
              if (e.key === 'Escape') setQuickLabel(null)
            }}
            onBlur={(e) => {
              applyAnnotation(pageId, quickLabel.id, e.target.value)
              setQuickLabel(null)
            }}
          />
        </div>
      )}

      <div className="glass absolute bottom-4 right-4 rounded-full px-3 py-1 font-mono text-[11px] text-muted-foreground">
        {Math.round(viewport.zoom * 100)}%
      </div>
    </div>
  )
}
