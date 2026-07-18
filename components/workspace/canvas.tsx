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

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, CopyPlus, BringToFront, SendToBack, Trash2, SlidersHorizontal, LibraryBig, Wand2, Lock, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useIsMobile, useIsNarrow } from '@/hooks/use-mobile'
import { useDockClearance } from '@/hooks/use-dock-clearance'
import type { SceneObject, Vec2 } from '@/lib/scene/types'
import { num, str, uid } from '@/lib/scene/types'
import { usePrefs, penPrefs, PEN_STYLES, type PenStyle } from '@/lib/store/preferences'
import { searchInsertables, insertAt, type Insertable } from '@/lib/scene/insertables'
import { setClipboard, getClipboard, hasClipboard, nextPasteOffset } from '@/lib/store/clipboard'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { createGeometry, fromRecognition, componentById } from '@/lib/scene/factory'
import { createBehavior, isBody } from '@/lib/behaviors/registry'
import { nearestTerminal, terminalsOf, terminalWorld, SNAP } from '@/lib/circuit/engine'
import { applyAnnotation } from '@/lib/scene/annotate'
import { recognize, regularPolygonPoints, type Recognition } from '@/lib/sketch/recognize'
import { matchCustomSketch } from '@/lib/sketch/custom'
import { publishAsset } from '@/lib/data/library'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { useDocStore, type Viewport, type Tool } from '@/lib/store/document'
import { registerElement, getElement, useRuntimeStore, play, pause, stepFrame, stepBack, stop } from '@/lib/physics/world'
import { OBJECT_RENDERERS } from '@/components/objects'
import { pointsToPath } from '@/components/objects/geometry'
import { inkPath } from '@/components/objects/ink'
import { cn } from '@/lib/utils'

const GRID = 40  // default; overridden at runtime via nbPrefs.gridSize
/** The grid layer is inset by this much so translating it never exposes an
 *  edge. The offset must be folded into the modulo below or the dots drift
 *  against the objects at any zoom ≠ 1 — that was the "parallax". */
const GRID_PAD = GRID * 2
const MIN_ZOOM = 0.05
const MAX_ZOOM = 16

/** Notebook scroll-axis lock: zero the free axis of a screen-space pan delta.
 *  Used by wheel, pointer pan (space / middle-button), and two-finger pan —
 *  locking only the wheel path left desktop users free to drift sideways. */
function axisLockDelta(dx: number, dy: number): { dx: number; dy: number } {
  const axis = usePrefs.getState().notebook.scrollAxis
  if (axis === 'vertical') return { dx: 0, dy }
  if (axis === 'horizontal') return { dx, dy: 0 }
  return { dx, dy }
}

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
  // How hard you must scribble before anything is deleted. Every threshold
  // moves together with the setting: at 0 you have to scratch long and
  // furiously; at 1 a quick zigzag is enough. The defaults sit in the middle.
  const k = Math.min(1, Math.max(0, penPrefs().scribbleSensitivity))
  const lerp = (a: number, b: number) => a + (b - a) * k
  const minPts = lerp(60, 24) // how much ink before we even look
  const minFold = lerp(8, 3) // path length vs. its own size — how doubled-back
  const minTurn = lerp(10, 3) * Math.PI // total turning — how many reversals

  if (pts.length < minPts) return false
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
  return diag > 40 && len / diag > minFold && totalTurn > minTurn
} // screen px below which a drag counts as a click

// Inside a system boundary, recognized doodle shapes become that domain's
// components: zigzag → resistor, box → battery/gate, blob → bulb/BJT…
const DOMAIN_SKETCH: Record<string, Partial<Record<string, string>>> = {
  mechanics: { circle: 'mass', rect: 'block' },
  electrical: { rect: 'battery', circle: 'bulb' },
  electronics: { circle: 'bjt', rect: 'mosfet' },
  digital: { rect: 'and-gate', circle: 'or-gate' },
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
  /** Live drag offset, applied to the DOM and committed to the store on release. */
  liveDrag?: { dx: number; dy: number }
  /** Snap targets, gathered once at drag start (they can't move mid-drag). */
  snapStatics?: SceneObject[]
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

/** Kinds whose on-canvas chrome (text, buttons, tables…) should follow
 *  Components UI scale. Pure ink / connectors keep canvas zoom only. */
const COMPONENT_UI_KINDS = new Set([
  'note',
  'text',
  'formula',
  'graph',
  'table',
  'cashflow',
  'truthtable',
  'code',
  'dsa',
  'circle',
  'rect',
  'symbol',
])

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
  // Components UI scale — same CSS zoom trick as panel text size. Scales
  // KaTeX, table cells, graph labels, lab chrome, etc. without fighting
  // canvas viewport zoom.
  const componentScale = usePrefs((s) => s.notebook.componentScale ?? 1)
  const Renderer = OBJECT_RENDERERS[object.geometry.kind]
  if (!Renderer) return null
  const resizable = !['line', 'stroke', 'polygon'].includes(object.geometry.kind)
  const uiScale =
    COMPONENT_UI_KINDS.has(object.geometry.kind) && componentScale !== 1
      ? componentScale
      : undefined
  return (
    // Outer wrapper: registered with the physics runtime, which drives its
    // transform during Play. Edit-time rotation lives on the inner div so the
    // two never fight over one style property.
    <div
      ref={(el) => registerElement(object.id, el)}
      data-object-id={object.id}
      // touch-none here (not only on the canvas): on a passthrough overlay
      // the canvas allows native panning, but a touch that starts ON an
      // object is a drag/select and must not scroll the reader instead.
      className="absolute touch-none"
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
        style={{
          transform: object.rotation ? `rotate(${object.rotation}deg)` : undefined,
          // CSS zoom scales fonts, padding, SVG labels and KaTeX together.
          zoom: uiScale,
        }}
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

export function InfiniteCanvas({
  pageId,
  locked,
  transparent,
  passthrough,
}: {
  pageId: string
  locked?: boolean
  /** No opaque background, no grid — for overlaying real ink on top of
   *  something else already rendered underneath (a PDF page image). */
  transparent?: boolean
  /** Overlay lives inside a scrolling reader: with the select tool, a touch
   *  drag on empty canvas must SCROLL the reader (native pan), not marquee —
   *  objects themselves still select/drag because their wrappers opt back
   *  into touch capture. Mouse marquee still works; wheel already bubbles. */
  passthrough?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // "/" quick-insert menu: opens at the pointer on empty canvas.
  const [slash, setSlash] = useState<{ screen: Vec2; canvas: Vec2 } | null>(null)
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
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
  const pen = usePrefs((s) => s.pen)
  const penSize = pen.size
  // Phone: the zoom pill appears only while zooming (see the HUD effect).
  const isPhone = useIsNarrow(767)
  const [zoomHud, setZoomHud] = useState(false)
  const zoomHudTimer = useRef<number | null>(null)
  const zoomHudArmed = useRef(false)
  useEffect(() => {
    if (!isPhone) return
    if (!zoomHudArmed.current) {
      zoomHudArmed.current = true // mount isn't a gesture
      return
    }
    setZoomHud(true)
    if (zoomHudTimer.current) clearTimeout(zoomHudTimer.current)
    zoomHudTimer.current = window.setTimeout(() => setZoomHud(false), 1200)
  }, [viewport.zoom, isPhone])
  // The pill sits in the dock's favourite corner — let it dodge the dock.
  const zoomPillRef = useRef<HTMLDivElement>(null)
  const zoomPillShift = useDockClearance(zoomPillRef, [zoomHud])
  const nbPrefs = usePrefs((s) => s.notebook)
  const touchOrthoPen = useWorkspaceStore((s) => s.touchOrthoPen)
  const touchFreeMove = useWorkspaceStore((s) => s.touchFreeMove)
  const touchMeasureMode = useWorkspaceStore((s) => s.touchMeasureMode)
  const selection = useDocStore((s) => s.selection)
  const playMode = useRuntimeStore((s) => s.mode)
  const editing = playMode === 'edit'
  const isMobile = useIsMobile()
  const myRole = useAuthStore((s) => s.profile?.role)

  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null)
  // Live ink is imperative. Points live in a ref and the SVG path's `d` is
  // written directly on pointermove — re-rendering the whole canvas per
  // pointer event is exactly the pen latency users feel. React re-renders
  // only when a stroke starts or ends (overlay mount/unmount).
  const [stroke, setStrokeState] = useState<number[][] | null>(null)
  const strokeRef = useRef<number[][] | null>(null)
  const strokePathRef = useRef<SVGPathElement | null>(null)
  const setStroke = (v: number[][] | null) => {
    strokeRef.current = v
    setStrokeState(v)
  }
  /** Per-move update: bypasses React entirely. */
  const updateStroke = (v: number[][]) => {
    strokeRef.current = v
    const el = strokePathRef.current
    if (!el || v.length < 2) return
    el.setAttribute(
      'd',
      useDocStore.getState().tool === 'pen'
        ? inkPath(v, { size: penSize, last: false })
        : pointsToPath(v)
    )
  }
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
  const [touchMeasureTargetId, setTouchMeasureTargetId] = useState<string | null>(null)
  const [box, setBox] = useState({ w: 1600, h: 1000 })
  const layerRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const guideRaf = useRef<number | null>(null)
  const vpRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 })
  const commitTimer = useRef<number | null>(null)

  /**
   * Pan/zoom entirely outside React.
   *
   * Committing the viewport to the store on every frame re-rendered the whole
   * canvas — recomputing the culling pass and reconciling every visible object
   * 60x a second. And the grid animated `background-position`, which is NOT
   * GPU-composited, so each frame repainted the entire viewport.
   *
   * So the gesture now paints directly: the object layer and the grid each get
   * a `transform`, which the compositor handles on the GPU with no layout, no
   * paint and no React. The store is written only when the gesture SETTLES
   * (and on a slow tick during long pans, so culling can catch up) — it stays
   * the source of truth, it's just no longer in the 60 Hz path.
   */
  const paintViewport = useCallback((vp: Viewport, settled = true) => {
    // Two transform modes on purpose. While the gesture runs, translate3d +
    // will-change keeps the layer composited on the GPU (no paint per frame).
    // But a will-change/3D layer is rasterized ONCE and the bitmap is
    // stretched as you zoom — everything goes blurry and stays blurry. So the
    // moment the gesture settles we drop back to a plain 2D transform with
    // will-change released (and pixel-snapped offsets), which makes the
    // browser re-rasterize text and strokes at the real scale — sharp again.
    const x = settled ? Math.round(vp.x) : vp.x
    const y = settled ? Math.round(vp.y) : vp.y
    if (layerRef.current) {
      const s = layerRef.current.style
      s.willChange = settled ? 'auto' : 'transform'
      s.transform = settled
        ? `translate(${x}px, ${y}px) scale(${vp.zoom})`
        : `translate3d(${x}px, ${y}px, 0) scale(${vp.zoom})`
    }
    if (gridRef.current) {
      // Use the user-set grid size (from prefs), with a minimum-size pad that
      // is always large enough even at the largest grid setting.
      const gridSize = usePrefs.getState().notebook.gridSize ?? 40
      const pad = gridSize * 2
      const cell = gridSize * vp.zoom
      // The pattern repeats every cell, so only the remainder matters — but it
      // must be measured from the CONTAINER's origin, not the grid div's,
      // which sits GRID_PAD to the left/up. Leaving that out made the dots
      // slide against the objects as you zoomed (the parallax).
      const mod = (n: number) => ((n % cell) + cell) % cell
      const s = gridRef.current.style
      s.willChange = settled ? 'auto' : 'transform'
      s.backgroundSize = `${cell}px ${cell}px`
      s.transform = settled
        ? `translate(${mod(x + pad)}px, ${mod(y + pad)}px)`
        : `translate3d(${mod(x + pad)}px, ${mod(y + pad)}px, 0)`
    }
  }, [])

  const applyViewport = useCallback(
    (vp: Viewport) => {
      vpRef.current = vp // authoritative while the gesture runs
      paintViewport(vp, false)

      // Culling needs the store to move eventually, but not every frame. A
      // slow tick keeps off-screen objects mounting during a long pan; the
      // generous cull margin covers the gap in between.
      if (commitTimer.current === null) {
        commitTimer.current = window.setTimeout(() => {
          commitTimer.current = null
          useDocStore.getState().setViewport(pageId, vpRef.current)
        }, 180)
      }
    },
    [pageId, paintViewport]
  )

  /**
   * Double-tap / double-click empty canvas to zoom in on that spot, again to
   * zoom back out. Anchored at the tap, so the thing you tapped stays put —
   * zooming to the centre instead would throw your target off screen.
   */
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const doubleTapZoom = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const v = vpRef.current
      const ZOOMED = 2.5
      // Already zoomed in → this tap means "back out".
      const zoom = v.zoom >= ZOOMED - 0.01 ? 1 : ZOOMED
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      const next = {
        zoom,
        x: sx - ((sx - v.x) * zoom) / v.zoom,
        y: sy - ((sy - v.y) * zoom) / v.zoom,
      }
      vpRef.current = next
      paintViewport(next)
      useDocStore.getState().setViewport(pageId, next)
    },
    [pageId, paintViewport]
  )

  /** Flush the viewport to the store — called when a gesture ends. */
  const commitViewport = useCallback(() => {
    if (commitTimer.current !== null) {
      clearTimeout(commitTimer.current)
      commitTimer.current = null
    }
    useDocStore.getState().setViewport(pageId, vpRef.current)
  }, [pageId])

  const ensurePage = useDocStore((s) => s.ensurePage)
  useEffect(() => {
    ensurePage(pageId)
  }, [pageId, ensurePage])

  // Container-local layout coords. The doc/PDF views zoom their page stacks
  // with an ancestor `transform: scale()`, so the bounding rect is in SCALED
  // screen px while everything laid out inside is not — divide the pointer
  // offset by that scale or ink/drag lands short of (or past) the pointer.
  const toLocal = useCallback((clientX: number, clientY: number): Vec2 => {
    const el = containerRef.current!
    const rect = el.getBoundingClientRect()
    const s = el.offsetWidth ? rect.width / el.offsetWidth : 1
    return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s }
  }, [])

  const toCanvas = useCallback((clientX: number, clientY: number): Vec2 => {
    const p = toLocal(clientX, clientY)
    // vpRef, not the store — the store intentionally lags behind a live pan.
    const v = vpRef.current
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom }
  }, [toLocal])

  // Mirror the store viewport into the ref and repaint. Runs when the store
  // changes from OUTSIDE a gesture (zoom buttons, Reset view, page switch);
  // during a gesture the ref is already ahead, so this is a no-op.
  useEffect(() => {
    vpRef.current = viewport
    paintViewport(viewport)
  }, [viewport, paintViewport])

  // Doc-page sheets are static: pan/zoom gestures are disabled below, but a
  // sheet may still carry a stale viewport from before this mode existed
  // (or from a board that was converted). Snap it back to identity once.
  useEffect(() => {
    if (locked) useDocStore.getState().setViewport(pageId, { x: 0, y: 0, zoom: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, pageId])

  useEffect(() => () => {
    if (commitTimer.current !== null) clearTimeout(commitTimer.current)
  }, [])

  // Container size feeds the viewport-culling rect.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height })
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Wheel must be a non-passive native listener to preventDefault browser zoom.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let wheelIdle: number | null = null
    const onWheel = (e: WheelEvent) => {
      // Static doc sheets don't pan/zoom on wheel — let it bubble so the
      // page list scrolls normally (and the doc view's own zoom can use it).
      if (locked) return
      e.preventDefault()
      // Flush once the wheel goes quiet, so culling and persistence catch up.
      if (wheelIdle !== null) clearTimeout(wheelIdle)
      wheelIdle = window.setTimeout(commitViewport, 120)
      const v = vpRef.current
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        // Zoom is locked — swallow the event but don't change the viewport.
        if (usePrefs.getState().notebook.lockZoom) return
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.0022)))
        const sx = e.clientX - rect.left
        const sy = e.clientY - rect.top
        applyViewport({
          zoom,
          x: sx - ((sx - v.x) * zoom) / v.zoom,
          y: sy - ((sy - v.y) * zoom) / v.zoom,
        })
      } else {
        // Scroll axis: locking to one direction keeps long notes from
        // drifting sideways as you read down them. Applies to trackpad
        // two-finger scroll and mouse wheel the same way.
        const { dx, dy } = axisLockDelta(e.deltaX, e.deltaY)
        applyViewport({ ...v, x: v.x - dx, y: v.y - dy })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    // Trackpad pinch: Chromium/Firefox synthesize ctrl+wheel (handled above),
    // but Safari fires proprietary gesture* events instead — cover those too.
    interface SafariGestureEvent extends UIEvent {
      scale: number
      clientX: number
      clientY: number
    }
    let pinchStartZoom = 1
    const onGestureStart = (e: Event) => {
      if (locked) return
      e.preventDefault()
      pinchStartZoom = vpRef.current.zoom
    }
    const onGestureEnd = (e: Event) => {
      if (locked) return
      e.preventDefault()
      commitViewport()
    }
    const onGestureChange = (e: Event) => {
      if (locked) return
      e.preventDefault()
      if (usePrefs.getState().notebook.lockZoom) return
      const ge = e as SafariGestureEvent
      const v = vpRef.current
      const rect = el.getBoundingClientRect()
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * ge.scale))
      const sx = ge.clientX - rect.left
      const sy = ge.clientY - rect.top
      applyViewport({
        zoom,
        x: sx - ((sx - v.x) * zoom) / v.zoom,
        y: sy - ((sy - v.y) * zoom) / v.zoom,
      })
    }
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
  }, [pageId, applyViewport, commitViewport, locked])

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

      // "/" on empty canvas opens the quick-insert menu at the pointer —
      // same registry the Ctrl+K search uses.
      if (e.key === '/') {
        e.preventDefault()
        const rect = containerRef.current?.getBoundingClientRect()
        const lp = lastPointerRef.current
        const clientX = lp?.clientX ?? (rect ? rect.left + rect.width / 2 : 0)
        const clientY = lp?.clientY ?? (rect ? rect.top + rect.height / 2 : 0)
        setSlash({
          screen: toLocal(clientX, clientY),
          canvas: toCanvas(clientX, clientY),
        })
        return
      }

      const toolKeys: Record<string, Tool> = {
        v: 'select', p: 'pen', s: 'shaper', c: 'circle', r: 'rect', l: 'line',
        t: 'text', n: 'note', f: 'formula', g: 'graph', k: 'code', b: 'table',
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
  }, [pageId, toCanvas, toLocal])

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      const store = useDocStore.getState()
      const dxScreen = e.clientX - g.startScreen.x
      const dyScreen = e.clientY - g.startScreen.y
      if (Math.abs(dxScreen) + Math.abs(dyScreen) > 3) g.moved = true

      if (g.mode === 'pan') {
        // Space / middle-button / touch-select pan — same axis lock as wheel.
        const { dx, dy } = axisLockDelta(dxScreen, dyScreen)
        applyViewport({
          ...g.startViewport,
          x: g.startViewport.x + dx,
          y: g.startViewport.y + dy,
        })
        return
      }

      const point = toCanvas(e.clientX, e.clientY)

      if (g.mode === 'move') {
        let dx = point.x - g.start.x
        let dy = point.y - g.start.y
        const page = store.pages[pageId]
        const newGuides: { v: number[]; h: number[]; pts: Vec2[] } = { v: [], h: [], pts: [] }

        // Snap assistant (Alt on desktop, explicit free-move toggle on touch).
        if (!(e.altKey || (e.pointerType === 'touch' && touchFreeMove)) && page && g.objectStartPositions.size > 0) {
          const zoom = g.startViewport.zoom
          const th = 6 / zoom
          // The snap candidates can't change mid-drag, so gather them ONCE.
          // Rebuilding this list on every pointer event was another O(n) pass
          // per frame — and on a big page it also re-walked every symbol's
          // terminals. Cached on the gesture, it costs nothing per frame.
          if (!g.snapStatics) {
            const movingIds = new Set(g.objectStartPositions.keys())
            g.snapStatics = Object.values(page.objects).filter((o) => !movingIds.has(o.id))
          }
          const statics = g.snapStatics

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

        // Move the DOM directly. Writing every intermediate position to the
        // store meant a React render per pointer event — and on a big page
        // that's an O(n) reconcile 60x a second, which is the jitter. The
        // store is updated once, on release (see onPointerUp).
        g.liveDrag = { dx, dy }
        for (const [id] of g.objectStartPositions) {
          const el = getElement(id)
          if (el) el.style.transform = `translate(${dx}px, ${dy}px)`
        }
        // Guides repaint at most once a frame — they're React state.
        if (guideRaf.current === null) {
          guideRaf.current = requestAnimationFrame(() => {
            guideRaf.current = null
            setGuides(
              newGuides.v.length + newGuides.h.length + newGuides.pts.length > 0 ? newGuides : null
            )
          })
        }
      } else if (g.mode === 'marquee') {
        setMarquee({ a: g.start, b: point })
      } else if (g.mode === 'draw') {
        if (e.shiftKey || store.tool === 'shaper' || (e.pointerType === 'touch' && touchOrthoPen)) {
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
          updateStroke(dense)
        } else {
          // Coalesced pointer events give the full-resolution ink trail;
          // pressure rides along as a third component for the ink renderer.
          const raw: { clientX: number; clientY: number; pressure: number }[] =
            typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0
              ? e.getCoalescedEvents()
              : [e]
          const pts = raw.map((ev) => ({ ...toCanvas(ev.clientX, ev.clientY), p: ev.pressure }))
          const next = strokeRef.current ?? []
          for (const p of pts) {
            const last = next[next.length - 1]
            if (!last || Math.hypot(p.x - last[0], p.y - last[1]) > 0.75)
              next.push([p.x, p.y, p.p])
          }
          updateStroke(next)
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
        updateStroke([
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
      if (guideRaf.current !== null) {
        cancelAnimationFrame(guideRaf.current)
        guideRaf.current = null
      }
      if (g?.mode === 'pan') commitViewport() // the store has been lagging on purpose
      if (!g) return
      const store = useDocStore.getState()

      // Commit a live drag: the elements have been moved by transform only, so
      // now write the real positions ONCE and drop the inline transforms. The
      // re-render that follows puts them at their new left/top, so there's no
      // visual jump.
      if (g.mode === 'move' && g.liveDrag) {
        const { dx, dy } = g.liveDrag
        for (const [id] of g.objectStartPositions) {
          const el = getElement(id)
          if (el) el.style.transform = ''
        }
        if (dx !== 0 || dy !== 0) {
          for (const [id, startPos] of g.objectStartPositions) {
            store.updateObject(pageId, id, {
              position: { x: startPos.x + dx, y: startPos.y + dy },
            })
          }
        }
      }

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
            obj.metadata.inkSize = usePrefs.getState().pen.size
            obj.metadata.inkColor = usePrefs.getState().pen.color
            obj.metadata.inkStyle = usePrefs.getState().pen.style
            obj.metadata.smoothing = usePrefs.getState().pen.smoothing
            obj.metadata.streamline = usePrefs.getState().pen.streamline
            obj.metadata.sensitivity = usePrefs.getState().pen.sensitivity
            obj.metadata.dotSize = usePrefs.getState().pen.dotSize
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
            raw.metadata.inkSize = usePrefs.getState().pen.size
            raw.metadata.inkColor = usePrefs.getState().pen.color
            raw.metadata.inkStyle = usePrefs.getState().pen.style
            raw.metadata.smoothing = usePrefs.getState().pen.smoothing
            raw.metadata.streamline = usePrefs.getState().pen.streamline
            raw.metadata.sensitivity = usePrefs.getState().pen.sensitivity
            raw.metadata.dotSize = usePrefs.getState().pen.dotSize
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
            const m = matchCustomSketch([points])
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
            // writing) — only on draw-and-hold does a doodle upgrade, into a
            // trained component or a clean shape. Everything else stays
            // exactly the ink that was drawn; the Shaper tool is the explicit
            // way to get clean shapes.
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
          if (obj.geometry.kind === 'stroke') {
            obj.metadata.inkSize = usePrefs.getState().pen.size
            obj.metadata.inkColor = usePrefs.getState().pen.color
            obj.metadata.inkStyle = usePrefs.getState().pen.style
            obj.metadata.smoothing = usePrefs.getState().pen.smoothing
            obj.metadata.streamline = usePrefs.getState().pen.streamline
            obj.metadata.sensitivity = usePrefs.getState().pen.sensitivity
            obj.metadata.dotSize = usePrefs.getState().pen.dotSize
          }
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
    // Greedy agglomerative matching: a cluster that doesn't match on its
    // own retries merged with NEARBY clusters — multi-stroke symbols
    // (capacitor plates, battery bars) rarely overlap, they just sit close.
    // /train matches the same merged cloud, so this mirrors its behavior.
    interface Cand {
      members: SceneObject[]
      strokes: number[][][]
      pts: number[][]
      box: { x0: number; y0: number; x1: number; y1: number }
      used: boolean
    }
    const cands: Cand[] = [...clusters.values()].map((members) => {
      const strokesOf = members.map(absPts)
      const pts = strokesOf.flat()
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const [x, y] of pts) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      }
      return { members, strokes: strokesOf, pts, box: { x0, y0, x1, y1 }, used: false }
    })
    const near = (a: Cand, b: Cand, pad = 28) =>
      a.box.x0 - pad < b.box.x1 && b.box.x0 - pad < a.box.x1 &&
      a.box.y0 - pad < b.box.y1 && b.box.y0 - pad < a.box.y1
    const usedIds = new Set<string>()
    const created: SceneObject[] = []
    for (const c of cands) {
      if (c.used) continue
      // Score alone AND merged with neighbors — take whichever combination
      // matches best, so partial shapes never win over the full symbol.
      let chosen: Cand[] = [c]
      let m = matchCustomSketch(c.strokes)
      const nbs = cands.filter((o) => o !== c && !o.used && near(c, o))
      for (const nb of nbs) {
        const mm = matchCustomSketch([...c.strokes, ...nb.strokes])
        if (mm && (!m || mm.score > m.score)) {
          m = mm
          chosen = [c, nb]
        }
      }
      if (nbs.length > 1) {
        const mm = matchCustomSketch([...c.strokes, ...nbs.flatMap((n) => n.strokes)])
        if (mm && (!m || mm.score > m.score)) {
          m = mm
          chosen = [c, ...nbs]
        }
      }
      let obj: SceneObject | null = null
      if (m) {
        const def = componentById(m.componentId)
        if (def) {
          const merged = chosen.flatMap((g) => g.pts)
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
      }
      if (obj) {
        created.push(obj)
        for (const g of chosen) {
          g.used = true
          for (const o of g.members) usedIds.add(o.id)
        }
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

  useEffect(() => {
    if (!touchMeasureMode) setTouchMeasureTargetId(null)
  }, [touchMeasureMode])

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
      // Static doc sheets: two-finger pinch does nothing at all.
      if (locked) return
      // Zoom is locked — two-finger pan is still allowed (no zoom change).
      if (usePrefs.getState().notebook.lockZoom) {
        const [a, b] = [...touches.values()]
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const prevCx = p.center.x
        const prevCy = p.center.y
        const { dx, dy } = axisLockDelta(cx - prevCx, cy - prevCy)
        const v = vpRef.current
        applyViewport({ ...v, x: v.x + dx, y: v.y + dy })
        // Re-anchor so next move delta is correct.
        pinchRef.current = { ...p, center: { x: cx, y: cy } }
        return
      }
      const [a, b] = [...touches.values()]
      const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.viewport.zoom * (dist / p.dist)))
      const rect = containerRef.current!.getBoundingClientRect()
      const cx = (a.x + b.x) / 2 - rect.left
      const cy = (a.y + b.y) / 2 - rect.top
      // Zoom under the live midpoint, then freeze the locked scroll axis so a
      // diagonal pinch can't drag the page sideways while zooming.
      const next: Viewport = {
        zoom,
        x: cx - ((p.center.x - rect.left - p.viewport.x) * zoom) / p.viewport.zoom,
        y: cy - ((p.center.y - rect.top - p.viewport.y) * zoom) / p.viewport.zoom,
      }
      const axis = usePrefs.getState().notebook.scrollAxis
      if (axis === 'vertical' || axis === 'horizontal') {
        const startCx = p.center.x - rect.left
        const startCy = p.center.y - rect.top
        if (axis === 'vertical') {
          next.x = startCx - ((startCx - p.viewport.x) * zoom) / p.viewport.zoom
        } else {
          next.y = startCy - ((startCy - p.viewport.y) * zoom) / p.viewport.zoom
        }
      }
      applyViewport(next)
    },
    [pageId, applyViewport, locked]
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
        const p = toLocal(x, y)
        if (objectId) useDocStore.getState().setSelection([objectId])
        setCtxMenu({ x: p.x, y: p.y, objectId })
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
      startViewport: vpRef.current, // live — the store deliberately lags a pan
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
    // Double-tap zoom — only on the bare canvas with the select tool, so it
    // never fights double-click-to-edit on a text box or a formula.
    if (e.button === 0 && tool === 'select' && editing && !locked &&
        !usePrefs.getState().notebook.disableDoubleTapZoom &&
        !usePrefs.getState().notebook.lockZoom) {
      const now = Date.now()
      const last = lastTapRef.current
      if (
        last &&
        now - last.t < 300 &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) < 24
      ) {
        lastTapRef.current = null
        doubleTapZoom(e.clientX, e.clientY)
        return
      }
      lastTapRef.current = { t: now, x: e.clientX, y: e.clientY }
    }

    if (e.pointerType === 'touch' && (touchesRef.current.size > 1 || pinchRef.current)) return
    // Palm rejection: once a stylus has been seen recently, a resting palm
    // (single touch) must not ink or marquee — two fingers still pan/zoom.
    if (e.pointerType === 'touch' && editing && tool !== 'select' && Date.now() - lastPenRef.current < 20000)
      return
    if (!locked && (e.button === 1 || spaceRef.current)) {
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

    // A single finger (or pen) dragging in select mode behaves exactly like
    // left-click + drag: a selection marquee. Two fingers still pan/zoom.
    if (!editing || tool === 'select') {
      // Clicking empty space inside a multi-selection's bounds drags the
      // whole selection; only clicks outside it start a fresh marquee.
      if (editing && store.selection.length > 1) {
        const page = store.pages[pageId]
        const p = toCanvas(e.clientX, e.clientY)
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const sid of store.selection) {
          const o = page?.objects[sid]
          if (!o) continue
          minX = Math.min(minX, o.position.x)
          minY = Math.min(minY, o.position.y)
          maxX = Math.max(maxX, o.position.x + o.size.w)
          maxY = Math.max(maxY, o.position.y + o.size.h)
        }
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
          store.pushHistory(pageId)
          beginGesture('move', e)
          return
        }
      }
      // Passthrough overlay: this touch belongs to the reader's native
      // scroll (touch-action pans it) — just drop any selection on tap.
      if (passthrough && e.pointerType === 'touch') {
        store.setSelection([])
        return
      }
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

  // These are props of a memo()'d ObjectView. As plain functions they were a
  // NEW reference on every render, so memo could never skip: dragging one
  // object, or panning, re-rendered every object on the page, 60x a second.
  // Stable identities are what make the memo actually work.
  const handleObjectPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    setCtxMenu(null)
    if (e.pointerType === 'touch' && (touchesRef.current.size > 1 || pinchRef.current)) return
    if ((tool !== 'select' && editing) || e.button !== 0) return
    e.stopPropagation()
    const store = useDocStore.getState()
    if (e.pointerType === 'touch' && touchMeasureMode && selection.length === 1 && selection[0] !== id) {
      setTouchMeasureTargetId(id)
      return
    }
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
  }, [pageId, tool, editing, beginGesture, setCtxMenu, selection, touchMeasureMode])

  const handleResizeStart = useCallback((e: React.PointerEvent, id: string, corner: 'nw' | 'ne' | 'sw' | 'se') => {
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
  }, [pageId, tool, editing, beginGesture, setCtxMenu])

  const handleRotateStart = useCallback((e: React.PointerEvent, id: string) => {
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
  }, [pageId, tool, editing, beginGesture, setCtxMenu])

  // ── Custom right-click menu ───────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault() // the browser menu never belongs on the canvas
    clearLongPress() // Android fires contextmenu on long-press; avoid doubling
    const p = toLocal(e.clientX, e.clientY)
    const hit = (e.target as HTMLElement).closest?.('[data-object-id]')
    const objectId = hit?.getAttribute('data-object-id') ?? null
    if (objectId) useDocStore.getState().setSelection([objectId])
    setCtxMenu({ x: p.x, y: p.y, objectId })
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

  // O(1) lookups — `selection.includes(id)` inside the object map was O(n)
  // per object, i.e. O(n^2) for the page.
  const selectedSet = useMemo(() => new Set(selection), [selection])

  const splitScreenDocumentId = useWorkspaceStore((s) => s.splitScreenDocumentId)

  // Viewport culling: only mount what's actually on screen (plus a margin, so
  // scrolling doesn't pop). A page with hundreds of objects only ever pays for
  // the handful you can see. Selected objects are always kept so their handles
  // never vanish mid-drag.
  const visible = useMemo(() => {
    const all = objects ? Object.values(objects).filter(o => o.id !== splitScreenDocumentId) : []
    if (all.length < 60) return all // small pages: culling costs more than it saves
    // A wide margin (in page units) matters more now: the store viewport lags
    // a live pan by up to ~180 ms, so objects must already be mounted before
    // they scroll into view or they'd pop in late.
    const m = 1200 / viewport.zoom
    const x0 = -viewport.x / viewport.zoom - m
    const y0 = -viewport.y / viewport.zoom - m
    const x1 = x0 + box.w / viewport.zoom + 2 * m
    const y1 = y0 + box.h / viewport.zoom + 2 * m
    return all.filter(
      (o) =>
        selectedSet.has(o.id) ||
        (o.position.x < x1 &&
          o.position.x + o.size.w > x0 &&
          o.position.y < y1 &&
          o.position.y + o.size.h > y0)
    )
  }, [objects, viewport.x, viewport.y, viewport.zoom, box.w, box.h, selectedSet, splitScreenDocumentId])

  const { inkStrokes, interactiveObjects } = useMemo(() => {
    const isBareInk = (obj: SceneObject) =>
      obj.geometry.kind === 'stroke' &&
      !isBody(obj.behaviors) &&
      !obj.behaviors.some((b) => b.enabled && b.type === 'wire')

    return visible.reduce(
      (acc, obj) => {
        // Keep selected ink interactive so handles still appear
        if (isBareInk(obj) && !selectedSet.has(obj.id)) {
          acc.inkStrokes.push(obj)
        } else {
          acc.interactiveObjects.push(obj)
        }
        return acc
      },
      { inkStrokes: [] as SceneObject[], interactiveObjects: [] as SceneObject[] }
    )
  }, [visible, selectedSet])

  return (
    <div
      ref={containerRef}
      // select-none: mouse drags must marquee/move, never highlight text —
      // editing text re-enables selection locally via select-text.
      className={cn(
        'relative h-full w-full select-none overflow-hidden',
        // Passthrough + select: leave touch panning to the reader's scroller
        // (object wrappers re-block it so they stay draggable) — everywhere
        // else the canvas owns every touch itself.
        !(passthrough && tool === 'select') && 'touch-none',
        !transparent && 'bg-background'
      )}
      style={{
        cursor: editing ? cursor : 'default',
        // Scroll yes, browser pinch-zoom no.
        ...(passthrough && tool === 'select' ? { touchAction: 'pan-x pan-y' } : {}),
      }}
      onPointerDownCapture={handleTouchDownCapture}
      onPointerMoveCapture={handleTouchMoveCapture}
      onPointerUpCapture={handleTouchUpCapture}
      onPointerCancelCapture={handleTouchUpCapture}
      onPointerMove={(e) => {
        lastPointerRef.current = { clientX: e.clientX, clientY: e.clientY }
      }}
      onPointerDown={(e) => {
        setCtxMenu(null)
        setSlash(null)
        handleBackgroundPointerDown(e)
      }}
      onContextMenu={handleContextMenu}
      role="application"
      aria-label="Infinite canvas"
    >
      {/* The grid is its own layer, moved with a TRANSFORM rather than by
          animating background-position. background-position is not
          GPU-composited: changing it every frame repaints the whole viewport,
          which is most of what made panning feel heavy. The pattern repeats,
          so translating by one grid cell (modulo) is visually identical and
          costs nothing. */}
      {nbPrefs.grid !== 'none' && !transparent && (
        <div
          ref={gridRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute',
            nbPrefs.grid === 'dots' && 'canvas-dots',
            nbPrefs.grid === 'lines' && 'canvas-lines',
            nbPrefs.grid === 'graph' && 'canvas-graph'
          )}
          style={{
            left: -((nbPrefs.gridSize ?? 40) * 2),
            top: -((nbPrefs.gridSize ?? 40) * 2),
            right: -((nbPrefs.gridSize ?? 40) * 2),
            bottom: -((nbPrefs.gridSize ?? 40) * 2),
          }}
        />
      )}

      <div
        ref={layerRef}
        // While a drawing/placement tool is armed, objects must not swallow
        // the pointer (graphs/notes stop propagation) — ink goes through.
        className={cn('absolute left-0 top-0', editing && tool !== 'select' && 'pointer-events-none')}
        style={{
          // settled (sharp) form — paintViewport switches to the GPU form
          // only while a pan/zoom gesture is actually running
          transform: `translate(${Math.round(viewport.x)}px, ${Math.round(viewport.y)}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
          {inkStrokes.map((obj) => (
            <path
              key={obj.id}
              d={obj.geometry.points ? inkPath(obj.geometry.points, { 
                size: typeof obj.metadata.inkSize === 'number' ? obj.metadata.inkSize : 5,
                thinning: typeof obj.metadata.sensitivity === 'number' ? obj.metadata.sensitivity : undefined,
                dotSize: typeof obj.metadata.dotSize === 'number' ? obj.metadata.dotSize : undefined,
                smoothing: typeof obj.metadata.smoothing === 'number' ? obj.metadata.smoothing : undefined,
                streamline: typeof obj.metadata.streamline === 'number' ? obj.metadata.streamline : undefined,
              }) : ''}
              fill={(obj.metadata.inkColor as string) ?? 'var(--foreground)'}
              fillOpacity={PEN_STYLES[(obj.metadata.inkStyle as PenStyle) ?? 'ink']?.opacity ?? 1}
              stroke="none"
              style={{ transform: `translate(${obj.position.x}px, ${obj.position.y}px)` }}
            />
          ))}
        </svg>

        {interactiveObjects.map((obj) => (
          <ObjectView
            key={obj.id}
            pageId={pageId}
            object={obj}
            selected={selectedSet.has(obj.id)}
            onPointerDown={handleObjectPointerDown}
            onResizeStart={handleResizeStart}
            onRotateStart={handleRotateStart}
            onHover={setHoveredId}
          />
        ))}

        {(altHeld || touchMeasureTargetId) &&
          selection.length === 1 &&
          (touchMeasureTargetId ?? hoveredId) &&
          (touchMeasureTargetId ?? hoveredId) !== selection[0] &&
          objects &&
          (() => {
            const a = objects[selection[0]]
            const targetId = touchMeasureTargetId ?? hoveredId
            if (!targetId) return null
            const b = objects[targetId]
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

        {stroke && (
          // Mounted from the FIRST point: pointermove then writes the path's
          // `d` attribute imperatively (updateStroke) — zero React work per
          // event, which is what keeps ink glued to the pen tip.
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {tool === 'pen' ? (
              // Live ink matches the committed stroke — same renderer. The
              // amber tint + ring = hold matured: release to convert.
              <>
                <path
                  ref={strokePathRef}
                  d={
                    (strokeRef.current?.length ?? 0) > 1
                      ? inkPath(strokeRef.current!, { size: penSize, last: false })
                      : ''
                  }
                  fill={holdReady ? 'var(--accent-amber)' : pen.color}
                  fillOpacity={PEN_STYLES[pen.style].opacity}
                  stroke="none"
                />
                {holdReady && strokeRef.current && strokeRef.current.length > 0 && (
                  <circle
                    cx={strokeRef.current[strokeRef.current.length - 1][0]}
                    cy={strokeRef.current[strokeRef.current.length - 1][1]}
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
                ref={strokePathRef}
                d={(strokeRef.current?.length ?? 0) > 1 ? pointsToPath(strokeRef.current!) : ''}
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
            inputMode="text"
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

      {/* Screen-space overlays — these live OUTSIDE the zoomed/panned layer,
          so their left/top are plain viewport pixels. Putting them inside it
          would multiply their coordinates by the zoom and shove them away
          from the cursor. */}
      {slash && (
        <SlashMenu
          screen={slash.screen}
          onClose={() => setSlash(null)}
          onPick={(item) => {
            insertAt(pageId, item, slash.canvas)
            setSlash(null)
          }}
        />
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

      {/* Zoom level pill with a lock-zoom toggle button. On phones every
          pixel of canvas matters, so the pill only fades in while the zoom
          is actually changing and slips away right after. */}
      {(isPhone ? zoomHud : true) && (() => {
        const locked = nbPrefs.lockZoom
        const LockIcon = locked ? Lock : LockOpen
        return (
          <div
            ref={zoomPillRef}
            style={{ translate: `${zoomPillShift.x}px ${zoomPillShift.y}px` }}
            className="glass absolute bottom-4 right-4 z-30 flex items-center gap-0.5 rounded-full pl-3 pr-1 py-1 font-mono text-[11px] text-muted-foreground transition-[translate,opacity] duration-200"
          >
            <span className={cn(locked && 'text-foreground font-semibold')}>
              {Math.round(viewport.zoom * 100)}%
            </span>
            <button
              type="button"
              aria-label={locked ? 'Unlock zoom' : 'Lock zoom'}
              title={locked ? 'Unlock zoom' : 'Lock zoom — pinch and scroll will pan only'}
              className={cn(
                'ml-1 rounded-full p-1 transition-colors',
                locked
                  ? 'text-[var(--accent-amber)] hover:text-[var(--accent-amber)]/70'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              )}
              onClick={() => usePrefs.getState().setNotebook({ lockZoom: !locked })}
            >
              <LockIcon className="h-3 w-3" />
            </button>
          </div>
        )
      })()}
    </div>
  )
}

/** "/" quick-insert menu — type to filter every component and widget, Enter
 *  or click to drop it where the pointer was. Same registry as Ctrl+K. */
function SlashMenu({
  screen,
  onPick,
  onClose,
}: {
  screen: Vec2
  onPick: (item: Insertable) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const results = searchInsertables(q, 40)
  const listRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // Flip the menu back inside the canvas when it would open past an edge.
  const [pos, setPos] = useState(screen)
  useLayoutEffect(() => {
    const el = boxRef.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    setPos({
      x: Math.max(4, Math.min(screen.x, parent.clientWidth - el.offsetWidth - 4)),
      y: Math.max(4, Math.min(screen.y, parent.clientHeight - el.offsetHeight - 4)),
    })
  }, [screen])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  return (
    <div
      ref={boxRef}
      className="glass-strong absolute z-[60] w-64 overflow-hidden rounded-xl p-1 shadow-lg"
      style={{ left: pos.x, top: pos.y, maxHeight: 300 }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        aria-label="Insert a component"
        placeholder="Insert…"
        className="w-full rounded-lg bg-transparent px-2 py-1.5 text-[13px] outline-none"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onBlur={onClose}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSel((i) => Math.min(i + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSel((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && results[sel]) {
            e.preventDefault()
            onPick(results[sel])
          }
        }}
      />
      <div ref={listRef} className="no-scrollbar max-h-[236px] overflow-y-auto border-t border-border/60 pt-1">
        {results.length === 0 && (
          <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">Nothing matches.</p>
        )}
        {results.map((it, i) => (
          <button
            key={it.id}
            type="button"
            data-i={i}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors',
              i === sel ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
            )}
            onPointerEnter={() => setSel(i)}
            // pointerdown (not click) — the input's onBlur would close us first
            onPointerDown={(e) => {
              e.preventDefault()
              onPick(it)
            }}
          >
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            <span className="shrink-0 text-[10.5px] opacity-60">{it.group}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
