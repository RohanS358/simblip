'use client'

// Infinite canvas. One transformed layer holds every object; all gestures run
// through a small pointer state machine kept in refs so drags never re-render
// anything but the objects they move.
//
// The pen recognizes sketches (circle/rect/line/spring) via draw-and-hold:
// rest the pen HOLD_MS before lifting and the doodle upgrades into a
// component; lift quickly and ink stays ink. Recognition upgrades geometry
// only; meaning comes from behaviors. Shift+pen routes orthogonally — 90°
// elbows lock in as the cursor changes direction. During Play the world
// runtime writes transforms straight to the wrapper elements registered
// here; edit gestures are locked until Reset.

import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Copy, CopyPlus, BringToFront, SendToBack, Trash2, SlidersHorizontal, LibraryBig, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { useIsMobile } from '@/hooks/use-mobile'
import type { SceneObject, Vec2 } from '@/lib/scene/types'
import { num, str, uid } from '@/lib/scene/types'
import { setClipboard, getClipboard, hasClipboard, nextPasteOffset } from '@/lib/store/clipboard'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { createGeometry, fromRecognition, componentById } from '@/lib/scene/factory'
import { createBehavior } from '@/lib/behaviors/registry'
import { nearestTerminal, terminalsOf, terminalWorld, SNAP } from '@/lib/circuit/engine'
import { applyAnnotation } from '@/lib/scene/annotate'
import { recognize, regularPolygonPoints, type Recognition } from '@/lib/sketch/recognize'
import { matchCustomSketch } from '@/lib/sketch/custom'
import { publishAsset } from '@/lib/data/library'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { useDocStore, type Viewport, type Tool } from '@/lib/store/document'
import { registerElement, useRuntimeStore, play, pause, stepFrame, stepBack, stop } from '@/lib/physics/world'
import { OBJECT_RENDERERS } from '@/components/objects'
import { pointsToPath } from '@/components/objects/geometry'
import { inkPath } from '@/components/objects/ink'
import { cn } from '@/lib/utils'

const GRID = 24
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4

// Universal placement gestures: click spawns the default; dragging sizes
// the object while placing it. Line-likes go point→point, circle-likes grow
// by radius from the press point (their center), everything else stretches
// corner→corner like a marquee.
// Components whose geometry is a two-point 'line' — drag sizes them
// point→point (placeLine), not corner→corner like boxes/circles.
const CONNECTOR_IDS = new Set([
  'spring',
  'rope',
  'rod',
  'damper',
  'thin-lens',
  'optical-mirror',
  'optical-screen',
  'slit',
  'wave-boundary',
  'transmission-line',
])
const CIRCULAR_IDS = new Set([
  'mass',
  'wheel',
  'motor',
  'hinge',
  'charge',
  'torsion-pendulum',
  'light-source',
  'wave-source',
])
const MIN_PLACE_DRAG = 8
// Shapes group: how many sides each regular-polygon shape has.
const SHAPE_SIDES: Record<string, number> = { triangle: 3, pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8 }

/** A furious cover-it-up scribble: long dense path that keeps folding back
 *  on itself. Way more total turning and ink than any writing or shape. */
function isScribble(pts: number[][]): boolean {
  if (pts.length < 40) return false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let len = 0
  let totalTurn = 0
  let prevAng: number | null = null
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i]
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    if (i > 0) {
      const dx = x - pts[i - 1][0]
      const dy = y - pts[i - 1][1]
      const d = Math.hypot(dx, dy)
      if (d < 1) continue
      len += d
      const ang = Math.atan2(dy, dx)
      if (prevAng !== null) {
        let t = Math.abs(ang - prevAng)
        if (t > Math.PI) t = 2 * Math.PI - t
        totalTurn += t
      }
      prevAng = ang
    }
  }
  const diag = Math.hypot(maxX - minX, maxY - minY)
  return diag > 40 && len / diag > 5 && totalTurn > 6 * Math.PI
} // screen px below which a drag counts as a click

// Inside a system boundary, recognized doodle shapes become that domain's
// components: zigzag → resistor, box → battery/gate, blob → bulb/BJT…
const DOMAIN_SKETCH: Record<string, Partial<Record<string, string>>> = {
  mechanics: { circle: 'mass', rect: 'block' },
  electrical: { spring: 'resistor', rect: 'battery', circle: 'bulb' },
  electronics: { spring: 'resistor', circle: 'bjt', rect: 'mosfet' },
  digital: { rect: 'and-gate', circle: 'or-gate', spring: 'clock' },
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
  /** Shape id when placing from the Shapes group (square, hexagon…). */
  placeShape?: string
  /** Shift+pen orthogonal routing: committed 90° corners + current axis. */
  orthoPts?: number[][]
  orthoAxis?: 'h' | 'v'
  orthoVel?: { x: number; y: number }
  orthoPrev?: { x: number; y: number }
  /** Hold-to-convert: when the pen last really moved (see HOLD_MS). */
  lastMoveAt?: number
  holdAnchor?: Vec2
}

// Draw-and-hold: freehand ink only upgrades into a component (spring,
// domain part) when the pen rests in place this long before lifting.
const HOLD_MS = 500
const HOLD_STILL_PX = 6

type CtxItem = [label: string, action: () => void, danger?: boolean]

function ctxMenuItems(
  objectId: string | null,
  editing: boolean,
  pageId: string,
  duplicateObject: (id: string) => void,
  restack: (id: string, where: 'front' | 'back') => void
): CtxItem[] {
  const toggleInspector = () => useWorkspaceStore.getState().togglePanel('inspector')
  if (!objectId) {
    const items: CtxItem[] = [
      ['Toggle inspector', toggleInspector],
      ['Reset view', () => useDocStore.getState().setViewport(pageId, { x: 0, y: 0, zoom: 1 })],
    ]
    if (editing && hasClipboard()) items.push(['Paste', () => pasteClipboard(pageId)])
    return items
  }
  if (!editing) return [['Properties', toggleInspector]] // Play mode: hands off
  return [
    ['Properties', toggleInspector],
    ['Copy', () => copySelection(pageId)],
    ['Duplicate', () => duplicateObject(objectId)],
    ['Bring to front', () => restack(objectId, 'front')],
    ['Send to back', () => restack(objectId, 'back')],
    ['Delete', () => useDocStore.getState().removeObjects(pageId, [objectId]), true],
  ]
}

// Snap a drawn line/stroke's endpoints onto any circuit terminal within
// reach (mutates geometry.points in place, pre-insert) and report whether it
// connected. Hand-drawing always stops a few pixels short of the pin — this
// closes that gap so wires actually touch what they join.
function connectEnds(obj: SceneObject, all: SceneObject[]): boolean {
  const gpts = obj.geometry.points
  if (!gpts || gpts.length < 2) return false
  let hit = false
  for (const i of [0, gpts.length - 1]) {
    const t = nearestTerminal(all, {
      x: obj.position.x + gpts[i][0],
      y: obj.position.y + gpts[i][1],
    })
    if (t) {
      const pressure = gpts[i].length > 2 ? [gpts[i][2]] : []
      gpts[i] = [t.x - obj.position.x, t.y - obj.position.y, ...pressure]
      hit = true
    }
  }
  return hit
}

// Copy/cut/paste the current selection — plain functions (not closures over
// component state) so they're safe to call from both the keyboard handler
// and the context menu without any stale-pageId risk. Works across pages
// too: the clipboard (lib/store/clipboard.ts) is a module that outlives
// Canvas unmounting when the user switches pages.
function copySelection(pageId: string) {
  const store = useDocStore.getState()
  const objs = store.selection
    .map((id) => store.pages[pageId]?.objects[id])
    .filter((o): o is SceneObject => Boolean(o))
  if (objs.length > 0) setClipboard(objs)
}

function cutSelection(pageId: string) {
  copySelection(pageId)
  const store = useDocStore.getState()
  if (store.selection.length > 0) store.removeObjects(pageId, store.selection)
}

function pasteClipboard(pageId: string) {
  const items = getClipboard()
  if (items.length === 0) return
  const store = useDocStore.getState()
  const offset = nextPasteOffset()
  const idMap = new Map<string, string>()
  const clones = items.map((src) => {
    const clone: SceneObject = JSON.parse(JSON.stringify(src))
    const newId = uid()
    idMap.set(src.id, newId)
    clone.id = newId
    clone.position = { x: src.position.x + offset, y: src.position.y + offset }
    clone.z = Date.now() % 1_000_000
    clone.behaviors.forEach((b) => (b.id = uid()))
    return clone
  })
  // A graph pasted together with the object it's bound to should stay
  // paired with the NEW copy, not silently keep pointing at the original.
  for (const clone of clones) {
    const sourceId = clone.parameters.sourceId
    if (clone.geometry.kind === 'graph' && sourceId?.kind === 'string' && idMap.has(sourceId.value)) {
      clone.parameters.sourceId = str(idMap.get(sourceId.value)!)
    }
  }
  store.pushHistory(pageId)
  for (const clone of clones) store.addObject(pageId, clone, { history: false })
  store.setSelection(clones.map((c) => c.id))
}

const ObjectView = memo(function ObjectView({
  pageId,
  object,
  selected,
  onPointerDown,
  onResizeStart,
  onRotateStart,
  onHover,
}: {
  pageId: string
  object: SceneObject
  selected: boolean
  onPointerDown: (e: React.PointerEvent, id: string) => void
  onResizeStart: (e: React.PointerEvent, id: string, corner: 'nw' | 'ne' | 'sw' | 'se') => void
  onRotateStart: (e: React.PointerEvent, id: string) => void
  onHover: (id: string | null) => void
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
      onPointerEnter={() => onHover(object.id)}
      onPointerLeave={() => onHover(null)}
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
                // The ::after pad widens the touch target without fattening the dot.
                'absolute h-2.5 w-2.5 rounded-[3px] border border-[var(--ring)] bg-background',
                "after:absolute after:-inset-2 after:content-['']",
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
          className="absolute -top-6 left-1/2 flex -translate-x-1/2 flex-col items-center after:absolute after:-inset-2 after:content-['']"
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
  // Touch state: live touch points, the two-finger pinch baseline, and the
  // long-press timer that stands in for right-click on touch screens.
  const touchesRef = useRef<Map<number, Vec2>>(new Map())
  const pinchRef = useRef<{ dist: number; center: Vec2; viewport: Viewport } | null>(null)
  const lastPenRef = useRef(0) // last stylus contact, for palm rejection
  const longPressRef = useRef<{ timer: number; x: number; y: number } | null>(null)

  const objects = useDocStore((s) => s.pages[pageId]?.objects)
  const viewport = useDocStore((s) => s.viewports[pageId]) ?? { x: 0, y: 0, zoom: 1 }
  const tool = useDocStore((s) => s.tool)
  const toolOption = useDocStore((s) => s.toolOption)
  const penSize = useDocStore((s) => s.penSize)
  const selection = useDocStore((s) => s.selection)
  const playMode = useRuntimeStore((s) => s.mode)
  const editing = playMode === 'edit'
  const isMobile = useIsMobile()
  const myRole = useAuthStore((s) => s.profile?.role)

  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null)
  const [stroke, setStroke] = useState<number[][] | null>(null)
  // Mirror refs: gesture-commit handlers must NOT create objects inside
  // setState updaters (StrictMode double-invokes them → duplicate spawns).
  const strokeRef = useRef<number[][] | null>(null)
  strokeRef.current = stroke
  // Draw-and-hold: true once the pen has rested HOLD_MS in place — the live
  // ink tints to signal "release now to convert into a component".
  const [holdReady, setHoldReady] = useState(false)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const placePreviewRef = useRef<{ x: number; y: number; w: number; h: number; round: boolean } | null>(null)
  placePreviewRef.current = placePreview
  // Custom right-click menu: screen-space position + the object under it.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; objectId: string | null } | null>(null)
  // Alt+hover measurement: while Alt is held, hovering a second object with
  // one already selected shows the displacement between their centers.
  const [altHeld, setAltHeld] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

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
      if (e.key === 'Alt' && !isTyping(e.target)) setAltHeld(true)
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
      if (mod && e.key.toLowerCase() === 'c' && !locked) {
        e.preventDefault()
        copySelection(pageId)
        return
      }
      if (mod && e.key.toLowerCase() === 'x' && !locked) {
        e.preventDefault()
        cutSelection(pageId)
        return
      }
      if (mod && e.key.toLowerCase() === 'v' && !locked) {
        e.preventDefault()
        pasteClipboard(pageId)
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
      // Transport hotkeys — mirror the Transport buttons' own disabled
      // conditions exactly, so a hotkey press is a no-op (not an error)
      // wherever the corresponding button would be greyed out. 'r' falls
      // through to the rect tool below in edit mode, same key, no conflict
      // since Reset is only meaningful outside edit mode anyway.
      if (!mod) {
        const key = e.key.toLowerCase()
        const rt = useRuntimeStore.getState()
        if (key === 'q') {
          e.preventDefault()
          if (rt.mode === 'running') pause()
          else play(pageId)
          return
        }
        if (key === 'w') {
          if (rt.mode === 'paused') {
            e.preventDefault()
            stepBack()
          }
          return
        }
        if (key === 'e') {
          if (rt.mode !== 'running') {
            e.preventDefault()
            if (rt.mode === 'edit') {
              play(pageId)
              pause()
            }
            stepFrame()
          }
          return
        }
        if (key === 'r' && rt.mode !== 'edit') {
          e.preventDefault()
          stop()
          return
        }
      }
      if (mod || locked) return
      const toolKeys: Record<string, Tool> = {
        v: 'select', p: 'pen', s: 'shaper', c: 'circle', r: 'rect', l: 'line',
        t: 'text', n: 'note', f: 'formula', g: 'graph',
      }
      const t = toolKeys[e.key.toLowerCase()]
      if (t) store.setTool(t)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
      if (e.key === 'Alt') setAltHeld(false)
    }
    const onBlur = () => setAltHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
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
            const defs = obj?.geometry.kind === 'symbol' ? terminalsOf(obj) : undefined
            if (!obj || !defs) continue
            const proposed = { ...obj, position: { x: sp0.x + dx, y: sp0.y + dy } }
            for (const td of defs) {
              const mp = terminalWorld(proposed, td)
              for (const so of statics) {
                if (so.geometry.kind !== 'symbol') continue
                for (const sd of terminalsOf(so)) {
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
        if (e.shiftKey || store.tool === 'shaper') {
          // Shift+pen (or the Shaper tool): orthogonal routing. The stroke runs dead-straight
          // along one axis; veer far enough perpendicular and it locks a
          // 90° corner under the cursor and continues along the other axis
          // — elbow after elbow, like schematic wire routing.
          const TURN_PX = 14
          if (!g.orthoPts) g.orthoPts = [[g.start.x, g.start.y]]
          const prev = g.orthoPrev ?? point
          g.orthoVel = {
            x: (g.orthoVel?.x ?? 0) * 0.7 + (point.x - prev.x) * 0.3,
            y: (g.orthoVel?.y ?? 0) * 0.7 + (point.y - prev.y) * 0.3,
          }
          g.orthoPrev = { x: point.x, y: point.y }
          let anchor = g.orthoPts[g.orthoPts.length - 1]
          const dx = point.x - anchor[0]
          const dy = point.y - anchor[1]
          if (!g.orthoAxis && (Math.abs(dx) > 3 || Math.abs(dy) > 3))
            g.orthoAxis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
          if (g.orthoAxis) {
            // A turn = clearly off the current run line AND recent motion
            // dominated by the perpendicular axis (plain hand drift on a
            // long run doesn't fold the line).
            const turning =
              g.orthoAxis === 'h'
                ? Math.abs(dy) > TURN_PX && Math.abs(g.orthoVel.y) > Math.abs(g.orthoVel.x)
                : Math.abs(dx) > TURN_PX && Math.abs(g.orthoVel.x) > Math.abs(g.orthoVel.y)
            if (turning) {
              g.orthoPts.push(
                g.orthoAxis === 'h' ? [point.x, anchor[1]] : [anchor[0], point.y]
              )
              g.orthoAxis = g.orthoAxis === 'h' ? 'v' : 'h'
              anchor = g.orthoPts[g.orthoPts.length - 1]
            }
          }
          const end =
            g.orthoAxis === 'v' ? [anchor[0], point.y] : [point.x, anchor[1]]
          // Densify each straight run (~8px spacing): the ink renderers
          // spline through sparse points, which turned crisp elbows into
          // loops — with dense collinear points the smoothing hugs the line.
          const poly = [...g.orthoPts, end]
          const dense: number[][] = [[poly[0][0], poly[0][1], 0.5]]
          for (let i = 1; i < poly.length; i++) {
            const [ax, ay] = poly[i - 1]
            const [bx, by] = poly[i]
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8))
            for (let k = 1; k <= n; k++)
              dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, 0.5])
          }
          setStroke(dense)
        } else {
          // Coalesced pointer events give the full-resolution ink trail;
          // pressure rides along as a third component for the ink renderer.
          const raw: { clientX: number; clientY: number; pressure: number }[] =
            typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
              ? e.getCoalescedEvents()
              : [e]
          const pts = raw.map((ev) => ({ ...toCanvas(ev.clientX, ev.clientY), p: ev.pressure }))
          setStroke((prev) => {
            const next = prev ? [...prev] : []
            for (const p of pts) {
              const last = next[next.length - 1]
              if (!last || Math.hypot(p.x - last[0], p.y - last[1]) > 0.75)
                next.push([p.x, p.y, p.p])
            }
            return next
          })
          // Draw-and-hold tracking: only real movement (beyond pen jitter)
          // counts; resting in place lets the hold timer mature.
          const nowMs = performance.now()
          g.lastMoveAt ??= nowMs
          let restarted = false
          for (const p of pts) {
            if (
              !g.holdAnchor ||
              Math.hypot(p.x - g.holdAnchor.x, p.y - g.holdAnchor.y) > HOLD_STILL_PX
            ) {
              g.holdAnchor = { x: p.x, y: p.y }
              g.lastMoveAt = nowMs
              restarted = true
            }
          }
          if (restarted) setHoldReady(false)
          if (store.tool === 'pen' && store.inkToShape) {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
            holdTimerRef.current = setTimeout(
              () => setHoldReady(true),
              Math.max(0, HOLD_MS - (nowMs - g.lastMoveAt))
            )
          }
        }
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
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      setHoldReady(false)
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
        const pv = placePreviewRef.current
        setPlacePreview(null)
        const def = g.placeComponent ? componentById(g.placeComponent) : undefined
        const obj = def
          ? def.create(g.start)
          : g.placeShape && SHAPE_SIDES[g.placeShape]
            ? createGeometry('polygon', g.start)
            : g.placeTool && g.placeTool !== 'select' && g.placeTool !== 'pen' && g.placeTool !== 'place'
              ? createGeometry(g.placeTool as Parameters<typeof createGeometry>[0], g.start)
              : null
        if (obj) {
          if (g.placeShape && SHAPE_SIDES[g.placeShape]) {
            obj.size = { w: 110, h: 110 }
            obj.name = obj.name.replace(/^Polygon/, g.placeShape[0].toUpperCase() + g.placeShape.slice(1))
          }
          if (pv && g.moved && Math.max(pv.w, pv.h) > MIN_PLACE_DRAG) {
            obj.size = { w: Math.max(16, pv.w), h: Math.max(16, pv.h) }
            obj.position = { x: pv.x, y: pv.y }
          } else {
            obj.position = { x: g.start.x - obj.size.w / 2, y: g.start.y - obj.size.h / 2 }
          }
          if (g.placeShape === 'square') {
            const side = Math.max(16, Math.max(obj.size.w, obj.size.h))
            obj.size = { w: side, h: side }
          }
          const sides = g.placeShape ? SHAPE_SIDES[g.placeShape] : undefined
          if (sides) obj.geometry.points = regularPolygonPoints(sides, obj.size.w, obj.size.h)
          store.addObject(pageId, obj)
          store.setSelection([obj.id])
          if (!g.placeComponent) store.setTool('select')
        }
      } else if (g.mode === 'placeLine') {
        // Drag-to-draw connector: anchor at press point, end at release.
        // Read the endpoint from the preview stroke so Shift-snap sticks.
        {
          const pts = strokeRef.current
          setStroke(null)
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
            // Coarse pointers (phone/tablet) revert to select after placing —
            // there's no hover cursor to signal "still in placement mode".
            if (!g.placeComponent || window.matchMedia('(pointer: coarse)').matches)
              store.setTool('select')
          }
        }
      } else if (g.mode === 'draw') {
        {
          const points = strokeRef.current
          setStroke(null)
          if (!points || points.length < 2) return

          // Scribble-out: scratching furiously over your work deletes what
          // is underneath — the scribble itself never commits. (Nothing
          // under it? Then it is just ink and flows through normally.)
          if (store.tool === 'pen' && !g.orthoPts && isScribble(points)) {
            let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity
            for (const [x, y] of points) {
              sx0 = Math.min(sx0, x); sy0 = Math.min(sy0, y)
              sx1 = Math.max(sx1, x); sy1 = Math.max(sy1, y)
            }
            const victims = Object.values(store.pages[pageId]?.objects ?? {})
              .filter((o) => {
                if (o.metadata.render === 'system') return false
                const ox1 = o.position.x + o.size.w
                const oy1 = o.position.y + o.size.h
                const ix = Math.max(0, Math.min(sx1, ox1) - Math.max(sx0, o.position.x))
                const iy = Math.max(0, Math.min(sy1, oy1) - Math.max(sy0, o.position.y))
                // covered ≥60% of the object, or its centre is buried
                const cxo = o.position.x + o.size.w / 2
                const cyo = o.position.y + o.size.h / 2
                return (
                  (ix * iy) / Math.max(o.size.w * o.size.h, 1) >= 0.6 ||
                  (cxo > sx0 && cxo < sx1 && cyo > sy0 && cyo < sy1 && ix * iy > 0)
                )
              })
              .map((o) => o.id)
            if (victims.length > 0) {
              store.pushHistory(pageId)
              store.removeObjects(pageId, victims)
              return null
            }
          }

          // Shift-routed orthogonal polylines (≥1 locked corner) commit
          // exactly as drawn — recognition would only smudge deliberate 90°
          // elbows. Endpoints still snap onto terminals and conduct.
          if (g.orthoPts && (g.orthoPts.length >= 2 || store.tool === 'shaper')) {
            let minX = Infinity
            let minY = Infinity
            let maxX = -Infinity
            let maxY = -Infinity
            for (const [x, y] of points) {
              if (x < minX) minX = x
              if (y < minY) minY = y
              if (x > maxX) maxX = x
              if (y > maxY) maxY = y
            }
            const obj = fromRecognition({
              kind: 'stroke',
              points: points.map(([x, y]) => [x - minX, y - minY]),
              x: minX,
              y: minY,
              w: Math.max(maxX - minX, 1),
              h: Math.max(maxY - minY, 1),
            })
            obj.metadata.inkSize = store.penSize
            const all = Object.values(store.pages[pageId]?.objects ?? {})
            if (connectEnds(obj, all)) {
              obj.behaviors.push(createBehavior('wire'))
              obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
            }
            store.addObject(pageId, obj)
            store.setSelection([obj.id])
            return null
          }

          const rec = recognize(points)
          const all = Object.values(store.pages[pageId]?.objects ?? {})
          const cx = rec.x + rec.w / 2
          const cy = rec.y + rec.h / 2
          // Draw-and-hold: a doodle only upgrades into a component when the
          // pen rested in place before lifting — a quick stroke is just ink,
          // so writing and sketching never get hijacked mid-flow.
          const held =
            g.lastMoveAt !== undefined && performance.now() - g.lastMoveAt >= HOLD_MS

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
              points: points.map(([x, y, pr]) =>
                pr === undefined ? [x - rec.x, y - rec.y] : [x - rec.x, y - rec.y, pr]
              ),
              x: rec.x,
              y: rec.y,
              w: rec.w,
              h: rec.h,
            })
            raw.metadata.inkSize = store.penSize
            // Writing with the pen never selects the ink — selection boxes
            // popping up after every word make handwriting unbearable.
            store.addObject(pageId, raw)
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
          if (domain && held) {
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
              // Any free line in a circuit system conducts — flush to pins.
              obj = fromRecognition(rec)
              connectEnds(obj, all)
              obj.behaviors.push(createBehavior('wire'))
              obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
            } else if (rec.kind === 'line' && domain === 'mechanics') {
              obj = fromRecognition(rec)
              obj.behaviors.push(createBehavior('rod'))
            }
          }

          // Taught symbols win over generic shapes: match the held doodle
          // against the user's custom sketch templates (lib/sketch/custom).
          if (!obj && held) {
            const m = matchCustomSketch(points)
            const def = m ? componentById(m.componentId) : undefined
            if (def) {
              obj = def.create({ x: cx, y: cy })
              if (obj.geometry.kind === 'symbol') {
                const w2 = Math.min(200, Math.max(72, rec.w))
                obj.size = { w: w2, h: w2 / 2 }
              } else {
                obj.size = { w: Math.max(24, rec.w), h: Math.max(24, rec.h) }
              }
              obj.position = { x: cx - obj.size.w / 2, y: cy - obj.size.h / 2 }
            }
          }
          if (!obj) {
            // The pen never auto-shapes plain geometry (annoying while
            // writing) — only live components upgrade, and only on
            // draw-and-hold: a zigzag held in place lands as a spring,
            // domain parts matched above. Everything else stays exactly the
            // ink that was drawn; the Shaper tool is the explicit way to
            // get clean shapes.
            const keep: Recognition =
              held && rec.kind !== 'stroke'
                ? rec
                : {
                    kind: 'stroke',
                    points: points.map(([x, y, pr]) =>
                      pr === undefined ? [x - rec.x, y - rec.y] : [x - rec.x, y - rec.y, pr]
                    ),
                    x: rec.x,
                    y: rec.y,
                    w: rec.w,
                    h: rec.h,
                  }
            obj = fromRecognition(keep)
            // A doodle whose end touches a circuit terminal IS a wire — and
            // its endpoints snap flush onto the pins, closing the gap.
            if (
              (obj.geometry.kind === 'line' || obj.geometry.kind === 'stroke') &&
              obj.behaviors.length === 0
            ) {
              if (connectEnds(obj, all)) {
                obj.behaviors.push(createBehavior('wire'))
                obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
              }
            }
          }
          if (obj.geometry.kind === 'stroke') obj.metadata.inkSize = store.penSize
          store.addObject(pageId, obj)
          // Plain ink stays unselected (it's writing); only strokes that
          // upgraded into live components (spring, wire, domain part) select,
          // since those are objects you usually tweak right away.
          if (obj.geometry.kind !== 'stroke' || obj.behaviors.length > 0)
            store.setSelection([obj.id])
        }
      }
    },
    [pageId, onPointerMove, toCanvas]
  )

  // Area-select → Convert: turn a pile of raw ink strokes into a live
  // circuit. Strokes whose bboxes overlap heavily cluster into one glyph and
  // run through the trained recognizer (lib/sketch/custom + /train page);
  // matches become real components. Leftover strokes whose endpoints touch
  // terminals become wires — so a fully sketched diagram assembles at once.
  const convertSelectionToCircuit = useCallback(() => {
    const store = useDocStore.getState()
    const page = store.pages[pageId]
    if (!page) return
    const strokes = store.selection
      .map((id) => page.objects[id])
      .filter(
        (o): o is SceneObject =>
          !!o && (o.geometry.kind === 'stroke' || o.geometry.kind === 'line') && o.behaviors.length === 0
      )
    if (strokes.length === 0) {
      toast('Select the sketched strokes to convert.')
      return
    }
    store.pushHistory(pageId)
    const absPts = (o: SceneObject) =>
      (o.geometry.points ?? [[0, 0], [o.size.w, 0]]).map(([x, y]) => [x + o.position.x, y + o.position.y])
    // Cluster multi-stroke glyphs: significant bbox overlap (not mere
    // touching — wires touch components at endpoints and must stay separate).
    const par = strokes.map((_, i) => i)
    const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])))
    const boxOf = (o: SceneObject) => ({ x0: o.position.x, y0: o.position.y, x1: o.position.x + o.size.w, y1: o.position.y + o.size.h })
    for (let i = 0; i < strokes.length; i++) {
      for (let j = i + 1; j < strokes.length; j++) {
        const a = boxOf(strokes[i])
        const b = boxOf(strokes[j])
        const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
        const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
        const minArea = Math.max(1, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)))
        if ((ix * iy) / minArea > 0.3) par[find(i)] = find(j)
      }
    }
    const clusters = new Map<number, SceneObject[]>()
    strokes.forEach((o, i) => {
      const r = find(i)
      clusters.set(r, [...(clusters.get(r) ?? []), o])
    })
    const usedIds = new Set<string>()
    const created: SceneObject[] = []
    for (const members of clusters.values()) {
      const merged = members.flatMap(absPts)
      const m = matchCustomSketch(merged)
      let obj: SceneObject | null = null
      if (m) {
        const def = componentById(m.componentId)
        if (def) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
          for (const [x, y] of merged) {
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
          }
          obj = def.create({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 })
          if (obj.geometry.kind === 'symbol') {
            const w2 = Math.min(200, Math.max(72, x1 - x0))
            obj.size = { w: w2, h: w2 / 2 }
          } else {
            obj.size = { w: Math.max(24, x1 - x0), h: Math.max(24, y1 - y0) }
          }
          obj.position = { x: (x0 + x1) / 2 - obj.size.w / 2, y: (y0 + y1) / 2 - obj.size.h / 2 }
        }
      } else if (members.length === 1) {
        const rec = recognize(absPts(members[0]))
        if (rec.kind === 'spring') obj = fromRecognition(rec)
      }
      if (obj) {
        created.push(obj)
        for (const o of members) usedIds.add(o.id)
      }
    }
    for (const o of created) store.addObject(pageId, o)
    if (usedIds.size > 0) store.removeObjects(pageId, [...usedIds])
    // Remaining strokes conduct when their NODES land on terminals.
    const allNow = Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
    let wires = 0
    for (const o of strokes) {
      if (usedIds.has(o.id)) continue
      const live = useDocStore.getState().pages[pageId]?.objects[o.id]
      if (!live) continue
      const clone = JSON.parse(JSON.stringify(live)) as SceneObject
      if (connectEnds(clone, allNow)) {
        clone.behaviors.push(createBehavior('wire'))
        clone.name = clone.name.replace(/^(Line|Stroke)/, 'Wire')
        useDocStore.getState().updateObject(pageId, o.id, {
          geometry: clone.geometry, position: clone.position, size: clone.size,
          behaviors: clone.behaviors, name: clone.name,
        })
        wires++
      }
    }
    toast(
      created.length > 0
        ? `Converted ${created.length} component(s), ${wires} wire(s).`
        : 'No trained component matched — add examples on /train.'
    )
    if (created.length > 0) store.setSelection(created.map((c) => c.id))
  }, [pageId])

  const convertItem = useCallback((): CtxItem[] => {
    return editing && useDocStore.getState().selection.length > 1
      ? [['Convert to circuit', convertSelectionToCircuit]]
      : []
  }, [editing, convertSelectionToCircuit])

  // Aborts an in-flight one-finger gesture — a second finger means pinch,
  // a long-press means menu; either way the started gesture must not commit.
  const cancelGesture = useCallback(() => {
    const g = gestureRef.current
    if (!g) return
    gestureRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    if (g.mode === 'move') {
      const store = useDocStore.getState()
      for (const [id, p] of g.objectStartPositions)
        store.updateObject(pageId, id, { position: { ...p } })
    }
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    setHoldReady(false)
    setStroke(null)
    setMarquee(null)
    setPlacePreview(null)
    setGuides(null)
  }, [pageId, onPointerMove, onPointerUp])

  const clearLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer)
      longPressRef.current = null
    }
  }, [])

  // Two-finger pan/zoom, tldraw-style: the canvas point under the initial
  // touch midpoint stays under the current midpoint, so moving both fingers
  // pans and spreading them zooms — one formula covers both.
  const onPinchMove = useCallback(
    (e: PointerEvent) => {
      const touches = touchesRef.current
      if (!touches.has(e.pointerId)) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const p = pinchRef.current
      if (!p || touches.size < 2) return
      const [a, b] = [...touches.values()]
      const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.viewport.zoom * (dist / p.dist)))
      const rect = containerRef.current!.getBoundingClientRect()
      const cx = (a.x + b.x) / 2 - rect.left
      const cy = (a.y + b.y) / 2 - rect.top
      useDocStore.getState().setViewport(pageId, {
        zoom,
        x: cx - ((p.center.x - rect.left - p.viewport.x) * zoom) / p.viewport.zoom,
        y: cy - ((p.center.y - rect.top - p.viewport.y) * zoom) / p.viewport.zoom,
      })
    },
    [pageId]
  )

  const pinchBaseline = useCallback(() => {
    const [a, b] = [...touchesRef.current.values()]
    pinchRef.current = {
      dist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      viewport: useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 },
    }
  }, [pageId])

  const onPinchEnd = useCallback(
    (e: PointerEvent) => {
      touchesRef.current.delete(e.pointerId)
      if (touchesRef.current.size >= 2) {
        pinchBaseline() // a finger lifted but two remain — re-anchor
        return
      }
      pinchRef.current = null
      window.removeEventListener('pointermove', onPinchMove)
      window.removeEventListener('pointerup', onPinchEnd)
      window.removeEventListener('pointercancel', onPinchEnd)
    },
    [onPinchMove, pinchBaseline]
  )

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onPinchMove)
      window.removeEventListener('pointerup', onPinchEnd)
      window.removeEventListener('pointercancel', onPinchEnd)
    },
    [onPinchMove, onPinchEnd]
  )

  // Capture-phase touch bookkeeping: runs before object handlers regardless
  // of their stopPropagation, so every finger is accounted for.
  const handleTouchDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') {
      lastPenRef.current = Date.now() // stylus present → arm palm rejection
      return
    }
    if (e.pointerType !== 'touch') return
    touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    clearLongPress()
    if (touchesRef.current.size === 2) {
      cancelGesture() // whatever one finger started, a pair means pan/zoom
      if (!pinchRef.current) {
        window.addEventListener('pointermove', onPinchMove)
        window.addEventListener('pointerup', onPinchEnd)
        window.addEventListener('pointercancel', onPinchEnd)
      }
      pinchBaseline()
      return
    }
    if (touchesRef.current.size > 2 || pinchRef.current) return
    // Long-press = right-click. Armed only while selecting/inspecting —
    // drawing and placement tools need press-and-hold for their own gestures.
    if (editing && tool !== 'select') return
    const objectId =
      (e.target as HTMLElement).closest?.('[data-object-id]')?.getAttribute('data-object-id') ??
      null
    const { clientX: x, clientY: y } = e
    longPressRef.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        longPressRef.current = null
        cancelGesture()
        const rect = containerRef.current!.getBoundingClientRect()
        if (objectId) useDocStore.getState().setSelection([objectId])
        setCtxMenu({ x: x - rect.left, y: y - rect.top, objectId })
      }, 500),
    }
  }

  const handleTouchMoveCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    if (touchesRef.current.has(e.pointerId))
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const lp = longPressRef.current
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) clearLongPress()
  }

  const handleTouchUpCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    touchesRef.current.delete(e.pointerId)
    clearLongPress()
  }

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
    if (e.pointerType === 'touch' && (touchesRef.current.size > 1 || pinchRef.current)) return
    // Palm rejection: once a stylus has been seen recently, a resting palm
    // (single touch) must not ink or marquee — two fingers still pan/zoom.
    if (e.pointerType === 'touch' && editing && tool !== 'select' && Date.now() - lastPenRef.current < 20000)
      return
    if (e.button === 1 || spaceRef.current) {
      beginGesture('pan', e)
      return
    }
    if (e.button !== 0) return
    const store = useDocStore.getState()

    // Eraser: drag over ink strokes to remove them (bare ink only — bodies
    // and components are deleted deliberately, not swept away).
    if (tool === 'eraser') {
      const eraseAt = (clientX: number, clientY: number) => {
        const p = toCanvas(clientX, clientY)
        const page = useDocStore.getState().pages[pageId]
        if (!page) return
        const hits = Object.values(page.objects)
          .filter(
            (o) =>
              o.geometry.kind === 'stroke' &&
              p.x >= o.position.x - 8 &&
              p.x <= o.position.x + o.size.w + 8 &&
              p.y >= o.position.y - 8 &&
              p.y <= o.position.y + o.size.h + 8
          )
          .map((o) => o.id)
        if (hits.length > 0) useDocStore.getState().removeObjects(pageId, hits)
      }
      eraseAt(e.clientX, e.clientY)
      const mv = (ev: PointerEvent) => eraseAt(ev.clientX, ev.clientY)
      const up = () => {
        window.removeEventListener('pointermove', mv)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', mv)
      window.addEventListener('pointerup', up)
      return
    }

    if (!editing || tool === 'select') {
      beginGesture('marquee', e)
      return
    }
    if (tool === 'pen' || tool === 'shaper') {
      const p = toCanvas(e.clientX, e.clientY)
      setStroke([[p.x, p.y, e.pressure]])
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
    if (tool === 'shape') {
      const shape = toolOption ?? 'rect'
      if (shape === 'line') {
        setStroke([[point.x, point.y]])
        beginGesture('placeLine', e, { placeTool: 'line' })
        return
      }
      beginGesture(shape === 'circle' ? 'placeRadius' : 'placeRect', e, {
        placeShape: shape,
        placeTool: shape === 'oval' ? 'circle' : shape === 'square' ? 'rect' : SHAPE_SIDES[shape] ? undefined : (shape as Tool),
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
    setCtxMenu(null)
    if (e.pointerType === 'touch' && (touchesRef.current.size > 1 || pinchRef.current)) return
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

  // ── Custom right-click menu ───────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault() // the browser menu never belongs on the canvas
    clearLongPress() // Android fires contextmenu on long-press; avoid doubling
    const rect = containerRef.current!.getBoundingClientRect()
    const hit = (e.target as HTMLElement).closest?.('[data-object-id]')
    const objectId = hit?.getAttribute('data-object-id') ?? null
    if (objectId) useDocStore.getState().setSelection([objectId])
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, objectId })
  }

  const duplicateObject = (id: string) => {
    const store = useDocStore.getState()
    const src = store.pages[pageId]?.objects[id]
    if (!src) return
    const clone: SceneObject = JSON.parse(JSON.stringify(src))
    clone.id = uid()
    clone.name = `${src.name} copy`
    clone.position = { x: src.position.x + 24, y: src.position.y + 24 }
    clone.z = Date.now() % 1_000_000
    clone.behaviors.forEach((b) => (b.id = uid()))
    store.addObject(pageId, clone)
    store.setSelection([clone.id])
  }

  // Group actions for a multi-selection (the enclosure's floating bar).
  const duplicateSelection = () => {
    const store = useDocStore.getState()
    const ids: string[] = []
    for (const id of store.selection) {
      const src = store.pages[pageId]?.objects[id]
      if (!src) continue
      const clone: SceneObject = JSON.parse(JSON.stringify(src))
      clone.id = uid()
      clone.position = { x: src.position.x + 24, y: src.position.y + 24 }
      clone.z = Date.now() % 1_000_000
      clone.behaviors.forEach((b) => (b.id = uid()))
      store.addObject(pageId, clone)
      ids.push(clone.id)
    }
    store.setSelection(ids)
  }

  const saveSelectionToLibrary = () => {
    const store = useDocStore.getState()
    const objs = store.selection
      .map((id) => store.pages[pageId]?.objects[id])
      .filter(Boolean) as SceneObject[]
    if (objs.length === 0) return
    const title = window.prompt('Library asset name', `Selection (${objs.length} objects)`)
    if (!title) return
    void publishAsset({
      title,
      category: 'Selections',
      tags: [],
      kind: 'objects',
      content: JSON.parse(JSON.stringify(objs)) as SceneObject[],
    })
      .then(() => toast.success('Saved to the institution library'))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Could not save'))
  }

  const restack = (id: string, where: 'front' | 'back') => {
    const store = useDocStore.getState()
    const zs = Object.values(store.pages[pageId]?.objects ?? {}).map((o) => o.z)
    store.updateObject(
      pageId,
      id,
      { z: where === 'front' ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1 },
      { history: true }
    )
  }

  const cursor = tool === 'pen' || tool === 'shaper' ? 'crosshair' : tool === 'select' ? 'default' : 'copy'

  return (
    <div
      ref={containerRef}
      // select-none: mouse drags must marquee/move, never highlight text —
      // editing text re-enables selection locally via select-text.
      className="canvas-dots relative h-full w-full touch-none select-none overflow-hidden bg-background"
      style={{
        cursor: editing ? cursor : 'default',
        backgroundSize: `${GRID * viewport.zoom}px ${GRID * viewport.zoom}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDownCapture={handleTouchDownCapture}
      onPointerMoveCapture={handleTouchMoveCapture}
      onPointerUpCapture={handleTouchUpCapture}
      onPointerCancelCapture={handleTouchUpCapture}
      onPointerDown={(e) => {
        setCtxMenu(null)
        handleBackgroundPointerDown(e)
      }}
      onContextMenu={handleContextMenu}
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
              onHover={setHoveredId}
            />
          ))}

        {altHeld &&
          selection.length === 1 &&
          hoveredId &&
          hoveredId !== selection[0] &&
          objects &&
          (() => {
            const a = objects[selection[0]]
            const b = objects[hoveredId]
            if (!a || !b) return null
            const ac = { x: a.position.x + a.size.w / 2, y: a.position.y + a.size.h / 2 }
            const bc = { x: b.position.x + b.size.w / 2, y: b.position.y + b.size.h / 2 }
            const dist = Math.hypot(bc.x - ac.x, bc.y - ac.y)
            const mx = (ac.x + bc.x) / 2
            const my = (ac.y + bc.y) / 2
            const label = `${dist.toFixed(1)}px`
            const z = viewport.zoom
            return (
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
                <line
                  x1={ac.x} y1={ac.y} x2={bc.x} y2={bc.y}
                  stroke="var(--accent-blue)"
                  strokeWidth={1.5 / z}
                  strokeDasharray={`${5 / z} ${4 / z}`}
                  strokeLinecap="round"
                />
                <circle cx={ac.x} cy={ac.y} r={3.5 / z} fill="var(--accent-blue)" />
                <circle cx={bc.x} cy={bc.y} r={3.5 / z} fill="var(--accent-blue)" />
                <rect
                  x={mx - (label.length * 3.6) / z}
                  y={my - 17 / z}
                  width={(label.length * 7.2) / z}
                  height={14 / z}
                  rx={4 / z}
                  fill="var(--card)"
                  stroke="var(--accent-blue)"
                  strokeWidth={1 / z}
                />
                <text
                  x={mx}
                  y={my - 7 / z}
                  fill="var(--accent-blue)"
                  fontSize={10.5 / z}
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {label}
                </text>
              </svg>
            )
          })()}

        {stroke && stroke.length > 1 && (
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {tool === 'pen' ? (
              // Live ink matches the committed stroke — same renderer. The
              // amber tint + ring = hold matured: release to convert.
              <>
                <path
                  d={inkPath(stroke, { size: penSize, last: false })}
                  fill={holdReady ? 'var(--accent-amber)' : 'var(--foreground)'}
                  stroke="none"
                />
                {holdReady && (
                  <circle
                    cx={stroke[stroke.length - 1][0]}
                    cy={stroke[stroke.length - 1][1]}
                    r={11}
                    fill="none"
                    stroke="var(--accent-amber)"
                    strokeWidth={1.5}
                    opacity={0.75}
                  />
                )}
              </>
            ) : (
              <path
                d={pointsToPath(stroke)}
                fill="none"
                stroke="var(--foreground)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
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

        {/* Multi-selection enclosure: one dashed box around everything picked. */}
        {editing &&
          selection.length > 1 &&
          objects &&
          (() => {
            const sel = selection.map((id) => objects[id]).filter(Boolean)
            if (sel.length < 2) return null
            const x = Math.min(...sel.map((o) => o.position.x)) - 10
            const y = Math.min(...sel.map((o) => o.position.y)) - 10
            const r = Math.max(...sel.map((o) => o.position.x + o.size.w)) + 10
            const b = Math.max(...sel.map((o) => o.position.y + o.size.h)) + 10
            return (
              <div
                className="pointer-events-none absolute rounded-xl border-2 border-dashed border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_4%,transparent)]"
                style={{ left: x, top: y, width: r - x, height: b - y }}
              />
            )
          })()}
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

      {ctxMenu && (
        <div
          className="glass-strong absolute z-50 w-48 rounded-xl p-1 text-[12.5px]"
          style={{ left: Math.min(ctxMenu.x, (containerRef.current?.clientWidth ?? 400) - 200), top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {[...convertItem(), ...ctxMenuItems(ctxMenu.objectId, editing, pageId, duplicateObject, restack)].map(([label, action, danger]) => (
            <button
              key={label}
              type="button"
              className={cn(
                'flex w-full items-center rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                danger && 'text-[var(--accent-rose)]'
              )}
              onClick={() => {
                action()
                setCtxMenu(null)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Group action bar above the multi-selection enclosure — the same
          quick actions the mobile single-select bar offers, plus "save the
          whole group as a reusable library component". */}
      {editing &&
        selection.length > 1 &&
        objects &&
        (() => {
          const sel = selection.map((id) => objects[id]).filter(Boolean)
          if (sel.length < 2) return null
          const x = Math.min(...sel.map((o) => o.position.x))
          const y = Math.min(...sel.map((o) => o.position.y))
          const r = Math.max(...sel.map((o) => o.position.x + o.size.w))
          const cx = ((x + r) / 2) * viewport.zoom + viewport.x
          const top = y * viewport.zoom + viewport.y
          const hasInk = sel.some(
            (o) => (o.geometry.kind === 'stroke' || o.geometry.kind === 'line') && o.behaviors.length === 0
          )
          const actions: [string, typeof Copy, () => void, boolean?][] = [
            ['Copy', Copy, () => copySelection(pageId)],
            ['Duplicate', CopyPlus, duplicateSelection],
            // Multi-stroke recognition: pen+hold is single-stroke, so this is
            // where sketched symbols made of several strokes become live
            // components (and leftover strokes become wires).
            ...(hasInk
              ? ([['Recognize components', Wand2, convertSelectionToCircuit]] as [string, typeof Copy, () => void][])
              : []),
            ...(myRole && can(myRole, 'publish-library')
              ? ([['Save to library', LibraryBig, saveSelectionToLibrary]] as [string, typeof Copy, () => void][])
              : []),
            ['Delete', Trash2, () => useDocStore.getState().removeObjects(pageId, selection), true],
          ]
          return (
            <div
              className="glass-strong absolute z-40 flex items-center gap-0.5 rounded-xl p-1"
              style={{ left: cx, top: Math.max(8, top - 62), transform: 'translateX(-50%)' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="px-2 font-mono text-[11px] text-muted-foreground">{sel.length}×</span>
              {actions.map(([label, Icon, action, danger]) => (
                <button
                  key={label}
                  type="button"
                  aria-label={label}
                  title={label}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent',
                    danger ? 'text-[var(--accent-rose)]' : 'text-foreground'
                  )}
                  onClick={action}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          )
        })()}

      {isMobile &&
        editing &&
        selection.length === 1 &&
        objects?.[selection[0]] &&
        (() => {
          const obj = objects[selection[0]]
          // The exact same action list as the desktop right-click menu —
          // "Properties" included: shell.tsx has a real mobile Inspector
          // drawer (isMobile && inspectorOpen), it's just presented as a
          // slide-in overlay instead of the docked desktop panel, so this
          // icon is what opens it here. Everything else is unchanged, just
          // icons sized for a fingertip instead of a text menu meant for a mouse.
          const items = [...convertItem(), ...ctxMenuItems(obj.id, editing, pageId, duplicateObject, restack)]
          const ICONS: Record<string, typeof Copy> = {
            Properties: SlidersHorizontal,
            Copy: Copy,
            Duplicate: CopyPlus,
            'Bring to front': BringToFront,
            'Send to back': SendToBack,
            Delete: Trash2,
          }
          const screenX = obj.position.x * viewport.zoom + viewport.x
          const screenY = obj.position.y * viewport.zoom + viewport.y
          const screenW = obj.size.w * viewport.zoom
          return (
            <div
              className="glass-strong absolute z-40 flex items-center gap-0.5 rounded-xl p-1"
              style={{ left: screenX + screenW / 2, top: Math.max(8, screenY - 52), transform: 'translateX(-50%)' }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {items.map(([label, action, danger]) => {
                const Icon = ICONS[label] ?? Copy
                return (
                  <button
                    key={label}
                    type="button"
                    aria-label={label}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-accent',
                      danger ? 'text-[var(--accent-rose)]' : 'text-foreground'
                    )}
                    onClick={action}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          )
        })()}

      <div className="glass absolute bottom-[4.5rem] right-3 rounded-full px-3 py-1 font-mono text-[11px] text-muted-foreground sm:bottom-4 sm:right-4">
        {Math.round(viewport.zoom * 100)}%
      </div>
    </div>
  )
}
