# Connector Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `connector` drawing tool that snaps to a continuous nearest-point on any shape's boundary, stays attached (reprojecting) as anchored shapes move, renders as an orthogonal elbow path with draggable/reflowable bends, and supports independent start/end arrowhead caps.

**Architecture:** New `Tool = 'connector'` behaves like the existing `line`/`measurement` tools' `placeLine` gesture in `canvas.tsx`, but its endpoints snap via a new `nearestPointOnBoundary()` helper (continuous, not the existing `snapMeasurePoint`'s discrete corner/mid/center candidates) and are stored as `metadata.startAnchor`/`endAnchor` (`{ objectId, t }`, `t` = 0–1 boundary parameter) plus `metadata.bends: number[][]` for user-adjustable elbow points and `metadata.startCap`/`endCap: 'none' | 'arrow'`. Rendering extends `connectorPath()`'s existing `'wire'` Manhattan case with a new `'connector'` branch that walks the bend list and draws arrowhead markers. A `reprojectConnectors()` pass runs after any `updateObject` move/resize, re-resolving anchored endpoints from world boundary geometry. Segment-drag reflow is a new gesture mode in `canvas.tsx`'s pointer state machine, following the same ref-based non-React-state pattern as `placeLine`/`resize`.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand (no persist-schema version bump needed — `metadata: Record<string, unknown>` already accepts arbitrary new keys with no migration).

## Global Constraints

- No new npm dependencies.
- Connector's own fixed stroke styling ignores pen prefs, following the same pattern `isWire`/`render === 'wire'` already use in `components/objects/geometry.tsx:1050-1051` (mint accent color, fixed width) — do not read from `PEN_STYLES`/pen prefs anywhere in the new code.
- `metadata.render = 'connector'` is the discriminator tag (same convention as `metadata.render = 'measurement'` already uses) — set once at creation, read everywhere else. Do NOT introduce a second flag for "is this a connector".
- Verify each task with `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip` — this repo has no test runner beyond typecheck + manual QA (confirmed in prior research on this codebase).
- Follow existing file boundaries: geometry math goes in `lib/scene/` or a new small `lib/scene/connectors.ts`, not inlined into `canvas.tsx` beyond the pointer-gesture wiring itself.
- The existing `shaper` tool (freehand ink smoothing, `lib/store/document.ts:23`) and `wire` behavior (circuit terminals, `lib/circuit/engine.ts`) are NOT touched by this plan.

---

### Task 1: Boundary math — `nearestPointOnBoundary`

**Files:**
- Create: `lib/scene/connectors.ts`

**Interfaces:**
- Consumes: `SceneObject`, `Vec2` from `lib/scene/types.ts`.
- Produces: `nearestPointOnBoundary(obj: SceneObject, pt: Vec2): { point: Vec2; t: number } | null` and `pointAtBoundaryT(obj: SceneObject, t: number): Vec2`. Later tasks (2, 3, 4) call both by these exact names.

`t` is a single continuous 0–1 parameter around the shape's outline perimeter, starting at the top-left corner of the bbox and going clockwise: for `rect`/`polygon`-ish bbox shapes this walks the 4 bbox edges by cumulative edge length; for `circle` it's simply the angle around the ellipse (0 = top, clockwise). Every other geometry kind (line, text, note, etc.) falls back to the same 4-edge bbox rule — good enough for snapping, no special case needed per kind.

- [ ] **Step 1: Write the math**

```ts
// lib/scene/connectors.ts
//
// Boundary snapping for the connector tool: a single continuous parameter
// `t` (0..1, clockwise from top-left) walks any object's outline, so a
// connector endpoint can snap to "the nearest point on this shape" without
// needing per-kind fixed connection points.

import type { SceneObject, Vec2 } from './types'

function bboxEdges(obj: SceneObject): { a: Vec2; b: Vec2; len: number }[] {
  const { x, y } = obj.position
  const { w, h } = obj.size
  const corners: Vec2[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  const edges: { a: Vec2; b: Vec2; len: number }[] = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    edges.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) || 1 })
  }
  return edges
}

function ellipseParams(obj: SceneObject) {
  const { x, y } = obj.position
  const { w, h } = obj.size
  return { cx: x + w / 2, cy: y + h / 2, rx: w / 2 || 1, ry: h / 2 || 1 }
}

/** Nearest point on `obj`'s outline to `pt`, plus the boundary parameter
 *  `t` (0..1) that reproduces it via pointAtBoundaryT. Circles walk the
 *  ellipse angle; every other kind falls back to the bbox rectangle. */
export function nearestPointOnBoundary(
  obj: SceneObject,
  pt: Vec2
): { point: Vec2; t: number } | null {
  if (obj.geometry.kind === 'circle') {
    const { cx, cy, rx, ry } = ellipseParams(obj)
    const ang = Math.atan2((pt.y - cy) / ry, (pt.x - cx) / rx)
    const point = { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) }
    let t = (ang + Math.PI / 2) / (2 * Math.PI)
    if (t < 0) t += 1
    return { point, t }
  }
  const edges = bboxEdges(obj)
  const total = edges.reduce((s, e) => s + e.len, 0) || 1
  let best: { point: Vec2; t: number } | null = null
  let bestD = Infinity
  let cum = 0
  for (const e of edges) {
    const dx = e.b.x - e.a.x
    const dy = e.b.y - e.a.y
    const len2 = dx * dx + dy * dy || 1
    let s = ((pt.x - e.a.x) * dx + (pt.y - e.a.y) * dy) / len2
    s = Math.max(0, Math.min(1, s))
    const point = { x: e.a.x + s * dx, y: e.a.y + s * dy }
    const d = Math.hypot(point.x - pt.x, point.y - pt.y)
    if (d < bestD) {
      bestD = d
      best = { point, t: (cum + s * e.len) / total }
    }
    cum += e.len
  }
  return best
}

/** Inverse of nearestPointOnBoundary's `t`: world position at boundary
 *  parameter t (0..1) for the object's CURRENT position/size — used to
 *  reproject an anchored connector endpoint after the object moves. */
export function pointAtBoundaryT(obj: SceneObject, t: number): Vec2 {
  const tt = ((t % 1) + 1) % 1
  if (obj.geometry.kind === 'circle') {
    const { cx, cy, rx, ry } = ellipseParams(obj)
    const ang = tt * 2 * Math.PI - Math.PI / 2
    return { x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) }
  }
  const edges = bboxEdges(obj)
  const total = edges.reduce((s, e) => s + e.len, 0) || 1
  let target = tt * total
  for (const e of edges) {
    if (target <= e.len || e === edges[edges.length - 1]) {
      const s = e.len ? target / e.len : 0
      return { x: e.a.x + s * (e.b.x - e.a.x), y: e.a.y + s * (e.b.y - e.a.y) }
    }
    target -= e.len
  }
  return edges[0].a
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no new errors from `lib/scene/connectors.ts`.

- [ ] **Step 3: Manual sanity check (no test runner in this repo)**

Add a temporary scratch file `scratch-check.ts` (not committed) that imports both functions, builds a fake rect `SceneObject`-shaped object (`{ position:{x:0,y:0}, size:{w:100,h:50}, geometry:{kind:'rect'} } as SceneObject`), calls `nearestPointOnBoundary(obj, {x:50,y:-10})` and confirms it returns `~{x:50,y:0}`, then calls `pointAtBoundaryT(obj, result.t)` and confirms it round-trips to the same point. Delete the scratch file after confirming.

- [ ] **Step 4: Commit**

```bash
git add lib/scene/connectors.ts
git commit -m "feat: add boundary-snapping math for connector tool"
```

---

### Task 2: Tool registration + geometry creation

**Files:**
- Modify: `lib/store/document.ts:19-42` (`Tool` union)
- Modify: `lib/scene/factory.ts:40-52` (`createGeometry` — reuse the existing `'line'` case, no change needed there; add object creation for connector via `metadata.render`)
- Modify: `components/workspace/toolbar.tsx:65-75` (`TOOLS` array)
- Modify: `components/workspace/sundial-dock.tsx:38-47` (`PRIMARY_TOOLS` array)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Tool` union now includes `'connector'`. Task 3 reads `store.tool === 'connector'`.

- [ ] **Step 1: Add `'connector'` to the `Tool` union**

In `lib/store/document.ts`, add a new line inside the `Tool` union (after `'measurement'`, before `'shape'`):

```ts
  | 'connector' // shape-to-shape orthogonal connector: snaps to boundary, stays attached
```

- [ ] **Step 2: Add toolbar entry**

In `components/workspace/toolbar.tsx`, import a line-ish icon already available from `lucide-react` in that file's import block — use `Waypoints` (add to the existing `lucide-react` import line). Add to `TOOLS`, after the `eraser` entry:

```ts
  { tool: 'connector', icon: Waypoints, label: 'Connector — snaps to shapes, stays attached', key: 'C' },
```

- [ ] **Step 3: Add dock entry**

In `components/workspace/sundial-dock.tsx`, same `Waypoints` import addition, add to `PRIMARY_TOOLS` after `eraser`:

```ts
  { tool: 'connector', icon: Waypoints, label: 'Connector', key: 'C' },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no errors (check `Waypoints` exists in the installed `lucide-react` version — if not, substitute `Cable` or `GitBranch`, both confirmed present in lucide-react's standard icon set).

- [ ] **Step 5: Commit**

```bash
git add lib/store/document.ts components/workspace/toolbar.tsx components/workspace/sundial-dock.tsx
git commit -m "feat: register connector tool in toolbar and dock"
```

---

### Task 3: Draw gesture — snap dot + placement

**Files:**
- Modify: `components/workspace/canvas.tsx`

**Interfaces:**
- Consumes: `nearestPointOnBoundary`, `pointAtBoundaryT` from `lib/scene/connectors.ts` (Task 1); `Tool` (`'connector'`) from Task 2.
- Produces: on commit, a `SceneObject` with `geometry.kind === 'line'`, `metadata.render = 'connector'`, `metadata.startAnchor`/`metadata.endAnchor` (each `{ objectId: string; t: number } | undefined`), `metadata.bends: number[][]` (empty array initially), `metadata.startCap = 'none'`, `metadata.endCap = 'none'`. Task 4 renders this shape; Task 5 reads/writes `startAnchor`/`endAnchor`; Task 6 reads/writes `bends`; Task 7 reads/writes `startCap`/`endCap`.

Mirrors the existing `tool === 'line' || tool === 'measurement'` branch (`canvas.tsx:2633-2641`) and the `placeLine` gesture's move/commit handlers (`canvas.tsx:1686-1700`, `1935-1976`), but swaps `snapMeasurePoint` for continuous boundary snapping and records anchors instead of just adjusting the endpoint.

- [ ] **Step 1: Add a connector-snap helper near `snapMeasurePoint`**

In `components/workspace/canvas.tsx`, right after the existing `snapMeasurePoint` function (ends at line 104), add:

```ts
/** Connector tool: snap to the nearest point on ANY object's outline
 *  within SNAP px (continuous boundary point, not fixed corners/mid —
 *  see lib/scene/connectors.ts). Returns the anchor to persist plus the
 *  resolved world point to draw at. */
function snapConnectorPoint(
  pt: Vec2,
  objects: Record<string, SceneObject>,
  zoom: number
): { point: Vec2; anchor: { objectId: string; t: number } | null } {
  const th = SNAP / zoom
  let best: { point: Vec2; t: number; objectId: string } | null = null
  let bestD = th
  for (const o of Object.values(objects)) {
    if (o.metadata.render === 'connector') continue // connectors don't anchor to connectors
    const r = nearestPointOnBoundary(o, pt)
    if (!r) continue
    const d = Math.hypot(r.point.x - pt.x, r.point.y - pt.y)
    if (d < bestD) {
      bestD = d
      best = { ...r, objectId: o.id }
    }
  }
  if (!best) return { point: pt, anchor: null }
  return { point: best.point, anchor: { objectId: best.objectId, t: best.t } }
}
```

Add the import at the top of `canvas.tsx`, alongside the other `lib/scene/*` imports:

```ts
import { nearestPointOnBoundary, pointAtBoundaryT } from '@/lib/scene/connectors'
```

- [ ] **Step 2: Add the blue snap-dot preview state**

Find where `placePreview`/preview-related `useState` hooks are declared near the top of the canvas component (same area as `strokeRef`/`setStroke`). Add:

```ts
  const [connectorSnapDot, setConnectorSnapDot] = useState<Vec2 | null>(null)
```

- [ ] **Step 3: Show/hide the dot on hover (not just while drawing)**

Find the canvas's general `onPointerMove` handler (the top-level one that also calls `axisLockDelta`/pan logic, separate from the gesture-specific move handling inside `if (g)` blocks — it runs even with no active gesture). Add, near its start:

```ts
    if (tool === 'connector' && !gestureRef.current) {
      const p = toCanvas(e.clientX, e.clientY)
      const r = snapConnectorPoint(p, store.pages[pageId]?.objects ?? {}, vpRef.current.zoom)
      setConnectorSnapDot(r.anchor ? r.point : null)
    } else if (connectorSnapDot) {
      setConnectorSnapDot(null)
    }
```

(If the handler already destructures `store`/`pageId`/`tool` locally, reuse those instead of re-fetching.)

- [ ] **Step 4: Render the dot**

Find the JSX section rendering other transient overlays (e.g. wherever `placePreview` or the measurement preview renders as an absolutely-positioned SVG element over the canvas). Add a sibling render, converting the canvas-space point to screen space with the same `toScreen`/viewport transform those overlays already use:

```tsx
      {connectorSnapDot && (
        <circle
          cx={connectorSnapDot.x}
          cy={connectorSnapDot.y}
          r={5}
          fill="var(--accent-blue)"
          stroke="white"
          strokeWidth={1.5}
          className="pointer-events-none"
        />
      )}
```

Place this inside whatever SVG/transform group already renders page-space overlays (so it inherits the pan/zoom transform) — match the exact wrapper the existing measurement rubber-band line uses.

- [ ] **Step 5: Start the gesture on pointer-down**

In the `onPointerDown` handler, right after the existing `if (tool === 'line' || tool === 'measurement') { ... }` block (`canvas.tsx:2633-2641`), add:

```ts
    if (tool === 'connector') {
      const snapped = snapConnectorPoint(point, store.pages[pageId]?.objects ?? {}, vpRef.current.zoom)
      setStroke([[snapped.point.x, snapped.point.y]])
      beginGesture('placeLine', e, { placeTool: 'connector', start: snapped.point, startAnchor: snapped.anchor })
      return
    }
```

This requires `startAnchor` to be a valid field on the gesture-state object type used by `beginGesture`/the `g.` destructuring — find that type (likely a union member for `'placeLine'` mode near line 247) and add `startAnchor?: { objectId: string; t: number } | null` to it.

- [ ] **Step 6: Snap the live end-point while dragging**

In the `placeLine` move handler (`canvas.tsx:1686-1700`), add an `else if` branch alongside the existing `measurement` one:

```ts
        } else if (g.placeTool === 'connector') {
          end = snapConnectorPoint(point, store.pages[pageId]?.objects ?? {}, g.startViewport.zoom).point
        }
```

- [ ] **Step 7: Commit with anchors on pointer-up**

In the `placeLine` commit handler (`canvas.tsx:1935-1976`), add a new branch in the `maker` selection (alongside the existing `line`/`measurement` ternary chain):

```ts
                : g.placeTool === 'connector'
                  ? () => {
                      const o = createGeometry('line', g.start)
                      o.metadata.render = 'connector'
                      o.metadata.startAnchor = g.startAnchor ?? undefined
                      o.metadata.bends = []
                      o.metadata.startCap = 'none'
                      o.metadata.endCap = 'none'
                      return o
                    }
```

Then, after `const b = ...` resolves the release point, before `store.addObject`, resolve the end anchor the same way the start was captured:

```ts
            if (g.placeTool === 'connector') {
              const endSnap = snapConnectorPoint(b, store.pages[pageId]?.objects ?? {}, vpRef.current.zoom)
              obj.metadata.endAnchor = endSnap.anchor ?? undefined
            }
```

(Insert this right before `obj.z = topZ(pageId)`.) Also clear `setConnectorSnapDot(null)` at the top of this commit block.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no errors.

- [ ] **Step 9: Manual browser check**

Run the dev server (`npm run dev` if not already running), open a page, place a rect shape, select the Connector tool, hover near the rect's edge — confirm a blue dot appears and tracks the nearest boundary point — then drag from that dot to empty canvas and release; confirm a line object is created. This is UI-only behavior verifiable by running the app per project convention (no automated UI test harness in this repo).

- [ ] **Step 10: Commit**

```bash
git add components/workspace/canvas.tsx
git commit -m "feat: connector tool draw gesture with boundary snapping"
```

---

### Task 4: Rendering — connector path with bends and arrowheads

**Files:**
- Modify: `lib/render/connector-path.ts`
- Modify: `components/objects/geometry.tsx:1021-1055` (line-kind rendering) and `lib/behaviors/registry.ts:352-355` (`connectorBehavior`, for consistent mint styling — only if `metadata.render === 'connector'` should also count; otherwise skip, since this feature doesn't use a `Behavior`, it uses `metadata.render` directly like `measurement` does)

**Interfaces:**
- Consumes: `metadata.render === 'connector'`, `metadata.bends: number[][]`, `metadata.startCap`/`endCap: 'none' | 'arrow'` (Task 3's output).
- Produces: visual rendering only — no new exported functions consumed elsewhere except `connectorPath`'s existing signature, extended to accept bends.

- [ ] **Step 1: Extend `connectorPath` to draw a bend-list polyline**

In `lib/render/connector-path.ts`, add a new exported function (keep the existing `connectorPath` signature untouched so `spring`/`damper`/`rope`/`wire` callers are unaffected):

```ts
/** Orthogonal elbow path for the connector tool: draws through every
 *  stored bend point in order. Empty bends = same L-shape as 'wire'. */
export function connectorElbowPath(
  x1: number,
  y1: number,
  bends: number[][],
  x2: number,
  y2: number
): string {
  const pts = [[x1, y1], ...bends, [x2, y2]]
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
}
```

- [ ] **Step 2: Wire it into the line-kind renderer**

In `components/objects/geometry.tsx`, inside the `kind === 'line'` block (starts line 1021), the code currently branches on `isSpecial = render && ['spring','damper','rope','wire'].includes(render)`. Add `'connector'` handling as its own case since it needs the bends array, which the others don't:

Replace:
```ts
    const isSpecial = render && ['spring', 'damper', 'rope', 'wire'].includes(render)
    const d = (pts.length > 2 && !isSpecial) 
      ? `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(p => `L ${p[0]} ${p[1]}`).join(' ')
      : connectorPath(render, a[0], a[1], b[0], b[1])
```

with:
```ts
    const isSpecial = render && ['spring', 'damper', 'rope', 'wire', 'connector'].includes(render)
    const bends = (object.metadata.bends as number[][] | undefined) ?? []
    const d =
      render === 'connector'
        ? connectorElbowPath(a[0], a[1], bends, b[0], b[1])
        : pts.length > 2 && !isSpecial
          ? `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map((p) => `L ${p[0]} ${p[1]}`).join(' ')
          : connectorPath(render, a[0], a[1], b[0], b[1])
```

Add `connectorElbowPath` to the existing `import { connectorPath } from '@/lib/render/connector-path'` line.

- [ ] **Step 3: Fixed connector styling + arrowhead markers**

In the same block, the stroke color/width ternary chain (around line 1050-1051) already checks `connector ? ... : isWire ? ... : stroke` — but that `connector` variable comes from `connectorBehavior(object.behaviors)` (physics springs/ropes/rods/dampers), a different thing from this feature's `metadata.render === 'connector'`. Rename references carefully: introduce a new local `const isElbowConnector = render === 'connector'` and extend the ternaries to check it FIRST (so this feature's fixed mint styling wins), e.g.:

```ts
stroke={render === 'measurement' ? 'var(--accent-rose)' : isElbowConnector ? 'var(--accent-mint)' : optics ? optics.color : connector ? 'var(--accent-mint)' : isWire ? 'var(--accent-amber)' : stroke}
strokeWidth={render === 'measurement' ? 1.5 : isElbowConnector ? 2.5 : optics ? optics.width : connector ? 2 : isBody(object.behaviors) ? 6 : isWire ? 2.5 : 2}
```

Then add SVG `<marker>` defs for arrowheads and reference them conditionally. Add just before the `<path>` element, inside the same `<svg>`:

```tsx
        {isElbowConnector && (
          <defs>
            <marker id={`arrow-start-${object.id}`} viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 10 0 L 0 5 L 10 10 z" fill="var(--accent-mint)" />
            </marker>
            <marker id={`arrow-end-${object.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-mint)" />
            </marker>
          </defs>
        )}
```

And on the `<path>` element itself, add:

```tsx
          markerStart={isElbowConnector && object.metadata.startCap === 'arrow' ? `url(#arrow-start-${object.id})` : undefined}
          markerEnd={isElbowConnector && object.metadata.endCap === 'arrow' ? `url(#arrow-end-${object.id})` : undefined}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no errors.

- [ ] **Step 5: Manual browser check**

Draw a connector between two shapes (from Task 3's flow), confirm it renders as a mint-colored L-shaped line (no bends yet — Task 6 adds bend dragging).

- [ ] **Step 6: Commit**

```bash
git add lib/render/connector-path.ts components/objects/geometry.tsx
git commit -m "feat: render connector tool as orthogonal elbow path"
```

---

### Task 5: Live reconnection on shape move/resize

**Files:**
- Modify: `lib/store/document.ts` (`updateObject`, `patchObject` area, lines ~204-264)

**Interfaces:**
- Consumes: `pointAtBoundaryT` from `lib/scene/connectors.ts` (Task 1); `metadata.startAnchor`/`endAnchor` (Task 3).
- Produces: after any `updateObject` call that changes `position`/`size`, every connector anchored to that object gets its `geometry.points`/`position`/`size` recomputed to match. No new exported function needed by later tasks — this is a self-contained side effect inside the store.

- [ ] **Step 1: Write `reprojectConnectors`**

In `lib/store/document.ts`, add near the top (after imports, before `patchObject`):

```ts
import { pointAtBoundaryT } from '@/lib/scene/connectors'

/** After `movedObjectId` changes position/size, snap back any connector's
 *  end(s) anchored to it (metadata.{start,end}Anchor). Keeps the connector's
 *  bend points where they were — only the anchored endpoint moves — so a
 *  connector attached at both ends stays visually attached without the
 *  user re-drawing it. */
function reprojectConnectors(page: DocState['pages'][string], movedObjectId: string): DocState['pages'][string] {
  let objects = page.objects
  let changed = false
  for (const obj of Object.values(page.objects)) {
    if (obj.metadata.render !== 'connector') continue
    const startAnchor = obj.metadata.startAnchor as { objectId: string; t: number } | undefined
    const endAnchor = obj.metadata.endAnchor as { objectId: string; t: number } | undefined
    if (startAnchor?.objectId !== movedObjectId && endAnchor?.objectId !== movedObjectId) continue

    const pts = obj.geometry.points ?? [[0, 0], [obj.size.w, 0]]
    let a = { x: obj.position.x + pts[0][0], y: obj.position.y + pts[0][1] }
    let b = { x: obj.position.x + pts[pts.length - 1][0], y: obj.position.y + pts[pts.length - 1][1] }
    const movedObj = objects[movedObjectId]
    if (!movedObj) continue
    if (startAnchor?.objectId === movedObjectId) a = pointAtBoundaryT(movedObj, startAnchor.t)
    if (endAnchor?.objectId === movedObjectId) b = pointAtBoundaryT(movedObj, endAnchor.t)

    const px = Math.min(a.x, b.x)
    const py = Math.min(a.y, b.y)
    const newPoints = [
      [a.x - px, a.y - py],
      [b.x - px, b.y - py],
    ]
    const newObj = {
      ...obj,
      position: { x: px, y: py },
      size: { w: Math.max(Math.abs(b.x - a.x), 2), h: Math.max(Math.abs(b.y - a.y), 2) },
      geometry: { ...obj.geometry, points: newPoints },
    }
    if (!changed) objects = { ...objects }
    objects[obj.id] = newObj
    changed = true
  }
  return changed ? { ...page, objects } : page
}
```

- [ ] **Step 2: Call it from `updateObject`**

Find `updateObject: (pageId, id, patch, { history = false } = {}) => { ... }` (around line 423). It almost certainly calls `set(...)` with a `patchObject`-derived state. After computing the new state but before/while calling `set`, add a follow-up pass. If `updateObject`'s body looks like:

```ts
      updateObject: (pageId, id, patch, { history = false } = {}) => {
        if (history) get().pushHistory(pageId)
        set((s) => patchObject(s, pageId, id, (obj) => ({ ...obj, ...patch })))
      },
```

change it to also reproject, only when the patch touches position or size:

```ts
      updateObject: (pageId, id, patch, { history = false } = {}) => {
        if (history) get().pushHistory(pageId)
        set((s) => patchObject(s, pageId, id, (obj) => ({ ...obj, ...patch })))
        if (patch.position || patch.size) {
          set((s) => {
            const page = s.pages[pageId]
            if (!page) return {}
            const next = reprojectConnectors(page, id)
            return next === page ? {} : { pages: { ...s.pages, [pageId]: next } }
          })
        }
      },
```

Adjust to match `updateObject`'s actual existing body exactly (read it first) rather than assuming — the goal is: after the normal patch commits, run one more `set` that reprojects connectors IF the patch changed `position` or `size`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no errors.

- [ ] **Step 4: Manual browser check**

Draw a connector between two shapes (both ends anchored). Drag one of the shapes across the canvas. Confirm the connector's endpoint follows it, staying on the shape's boundary at roughly the same relative position it was drawn from.

- [ ] **Step 5: Commit**

```bash
git add lib/store/document.ts
git commit -m "feat: reproject connector endpoints when anchored shapes move"
```

---

### Task 6: Orthogonal segment-drag reflow

**Files:**
- Modify: `components/workspace/canvas.tsx`

**Interfaces:**
- Consumes: `metadata.bends` (Task 3/4), `store.updateObject` (existing).
- Produces: dragging a connector's segment updates `metadata.bends` via `updateObject`. Nothing downstream depends on new exports — this is a closed interaction loop (pointer down on a segment → drag → commit via `updateObject`).

Selecting a connector object already works via the generic `handleObjectPointerDown` (Task 3/4 didn't change selection). This task adds: when a connector is selected, render small invisible-but-hoverable hit-strips along each segment; pointer-down on one starts a new gesture mode `'connectorReflow'` that drags that segment's fixed coordinate.

- [ ] **Step 1: Add hit-strips for segments when a connector is selected**

In `components/objects/geometry.tsx`'s line-kind render block (same area as Task 4), when `render === 'connector' && selected`, render an invisible wide stroke per segment for easier grabbing, with a `data-segment-index` and `data-axis` so the canvas pointer handler can identify which segment was grabbed:

```tsx
        {isElbowConnector && selected && (() => {
          const allPts = [[a[0], a[1]], ...bends, [b[0], b[1]]]
          return allPts.slice(0, -1).map((p, i) => {
            const q = allPts[i + 1]
            const axis = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]) ? 'h' : 'v'
            return (
              <line
                key={i}
                x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
                stroke="transparent"
                strokeWidth={14}
                data-connector-segment={i}
                data-connector-axis={axis}
                style={{ cursor: axis === 'h' ? 'ns-resize' : 'ew-resize', pointerEvents: 'stroke' }}
              />
            )
          })
        })()}
```

- [ ] **Step 2: Detect the segment pointer-down in canvas.tsx**

In `handleObjectPointerDown` (around line 2649), before the generic selection logic runs, check for the connector-segment case. Add near the top of the function, right after `if ((tool !== 'select' && editing) || e.button !== 0) return`:

```ts
    const segEl = (e.target as HTMLElement).closest('[data-connector-segment]') as HTMLElement | null
    if (segEl && editing) {
      e.stopPropagation()
      const segIndex = Number(segEl.dataset.connectorSegment)
      const axis = segEl.dataset.connectorAxis as 'h' | 'v'
      store.setSelection([id])
      beginGesture('connectorReflow', e, { connectorId: id, segIndex, axis })
      return
    }
```

Add `'connectorReflow'` as a new `GestureMode` union member (find that type definition, likely near line 247 alongside `'placeLine'`), with its state shape `{ connectorId: string; segIndex: number; axis: 'h' | 'v' }`.

- [ ] **Step 3: Handle the drag — move the segment, insert/remove bends**

In the pointer-move gesture switch (same `else if (g.mode === ...)` chain as `placeLine`), add:

```ts
      } else if (g.mode === 'connectorReflow') {
        const obj = store.pages[pageId]?.objects[g.connectorId]
        if (!obj) return
        const pts = obj.geometry.points ?? [[0, 0], [obj.size.w, 0]]
        const a = { x: obj.position.x + pts[0][0], y: obj.position.y + pts[0][1] }
        const b = { x: obj.position.x + pts[pts.length - 1][0], y: obj.position.y + pts[pts.length - 1][1] }
        const bends = ((obj.metadata.bends as number[][] | undefined) ?? []).map((p) => [...p])
        const allPts = [[a.x, a.y], ...bends, [b.x, b.y]]
        const p0 = allPts[g.segIndex]
        const p1 = allPts[g.segIndex + 1]
        // Move the dragged segment's free coordinate; endpoints of the
        // WHOLE connector never move — only interior bend points do. If a
        // segment endpoint is the connector's actual start/end (index 0 or
        // last), insert a new bend right after/before it instead of moving
        // the anchored point itself, so the connector never disconnects.
        const newCoord = g.axis === 'h' ? point.y : point.x
        const setCoord = (p: number[]) => (g.axis === 'h' ? [p[0], newCoord] : [newCoord, p[1]])
        const isStartAnchored = g.segIndex === 0
        const isEndAnchored = g.segIndex + 1 === allPts.length - 1
        const nextBends: number[][] = []
        for (let i = 1; i < allPts.length - 1; i++) nextBends.push(allPts[i])
        if (isStartAnchored) nextBends.splice(0, 0, setCoord(p0))
        else nextBends[g.segIndex - 1] = setCoord(nextBends[g.segIndex - 1])
        if (isEndAnchored) nextBends.push(setCoord(p1))
        else if (!isStartAnchored) nextBends[g.segIndex] = setCoord(nextBends[g.segIndex] ?? p1)
        setConnectorPreviewBends(nextBends)
      }
```

This is intentionally the simplest correct rule (insert a bend at the anchored end being dragged, otherwise move the existing bend coordinate) — it always keeps both endpoints fixed and the path orthogonal. Add a matching preview state:

```ts
  const [connectorPreviewBends, setConnectorPreviewBends] = useState<number[][] | null>(null)
```

and have `geometry.tsx`'s render read a live override when this object is the one being dragged (simplest: pass `previewBends` down as an optional prop from the object list only for the dragged id, falling back to `metadata.bends` otherwise) — OR, simpler and consistent with how `placeLine` previews via `strokeRef`/`setStroke` rather than per-object props: skip a live visual preview and commit directly on pointer-up only, re-rendering from the store each move via `updateObject` (no `history`) so it's cheap and matches existing patterns elsewhere in this file for continuous-drag mutations (e.g. the plain object-drag path at `canvas.tsx:2218`). Use this simpler approach: call `store.updateObject(pageId, g.connectorId, { metadata: { ...obj.metadata, bends: nextBends } })` directly inside the move handler instead of a separate preview state, and drop `connectorPreviewBends` entirely.

- [ ] **Step 4: Commit on pointer-up**

In the gesture-end handler (same `else if` chain as `placeLine`'s commit block), add:

```ts
      } else if (g.mode === 'connectorReflow') {
        store.pushHistory(pageId)
      }
```

(The bends were already committed live via `updateObject` calls during the move in Step 3; pointer-up just finalizes history so the whole drag undoes as one step — match whichever existing drag gesture, e.g. plain object move, already defers its `pushHistory` to pointer-up for the same reason, and follow that exact call site pattern instead of guessing.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no errors.

- [ ] **Step 6: Manual browser check**

Select a drawn connector, hover over its horizontal segment (cursor should show `ns-resize`), drag it up/down — confirm the segment moves and new vertical segments appear at its former ends, endpoints staying fixed to their anchored shapes. Repeat for a vertical segment (`ew-resize`, dragged left/right). Confirm Undo reverts the whole drag in one step.

- [ ] **Step 7: Commit**

```bash
git add components/workspace/canvas.tsx components/objects/geometry.tsx
git commit -m "feat: draggable orthogonal segment reflow for connectors"
```

---

### Task 7: Inspector — arrowhead cap controls

**Files:**
- Modify: `components/workspace/inspector.tsx`

**Interfaces:**
- Consumes: `object.metadata.startCap`/`endCap` (Task 3), `store.updateObject` (existing).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Find the per-object-kind section pattern**

Read how the inspector renders a section conditional on `object.metadata.render === 'measurement'` or similar (search for how `render` metadata is branched on elsewhere in `inspector.tsx`, near the geometry-kind-specific sections rather than the generic `BehaviorsSection`). Add a new section following that exact pattern, gated on `object.geometry.kind === 'line' && object.metadata.render === 'connector'`.

- [ ] **Step 2: Write the section**

```tsx
function ConnectorCapsSection({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const setCap = (which: 'startCap' | 'endCap', value: 'none' | 'arrow') =>
    updateObject(pageId, object.id, { metadata: { ...object.metadata, [which]: value } }, { history: true })

  const Row = ({ label, field }: { label: string; field: 'startCap' | 'endCap' }) => (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[0.6875rem] text-muted-foreground">{label}</span>
      <select
        className="flex-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[0.6875rem]"
        value={(object.metadata[field] as string | undefined) ?? 'none'}
        onChange={(e) => setCap(field, e.target.value as 'none' | 'arrow')}
      >
        <option value="none">None</option>
        <option value="arrow">Arrow</option>
      </select>
    </div>
  )

  return (
    <div>
      <SectionTitle>Connector</SectionTitle>
      <Row label="Start cap" field="startCap" />
      <Row label="End cap" field="endCap" />
    </div>
  )
}
```

- [ ] **Step 3: Mount it**

Find where the inspector composes its sections for a selected object (the top-level component that renders `BehaviorsSection` and other per-kind sections). Add:

```tsx
{object.geometry.kind === 'line' && object.metadata.render === 'connector' && (
  <ConnectorCapsSection pageId={pageId} object={object} />
)}
```

placed near wherever the `measurement`-specific section (if any) is mounted, for consistency; otherwise place it directly above `BehaviorsSection`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: no errors.

- [ ] **Step 5: Manual browser check**

Select a drawn connector, confirm the Inspector shows "Connector" with Start cap / End cap dropdowns, switch one to "Arrow", confirm an arrowhead marker renders at that end on the canvas (from Task 4's marker wiring).

- [ ] **Step 6: Commit**

```bash
git add components/workspace/inspector.tsx
git commit -m "feat: connector arrowhead cap controls in inspector"
```

---

## Self-Review Notes

- **Spec coverage:** req 1 (ignores pen settings) → Task 4 Step 3. req 2/3 (boundary snap dot, both ends) → Task 1 + Task 3. req 4 (stays connected on move) → Task 5. req 5 (arrowheads per end) → Task 3 (data) + Task 4 (render) + Task 7 (UI). req 6 (orthogonal reflow, always-on, never disconnects) → Task 4 (render) + Task 6 (drag).
- **Naming collision:** confirmed `Tool = 'connector'` doesn't collide with anything existing; `metadata.render = 'connector'` doesn't collide with the `connectorBehavior()` helper's return value because Task 4 introduces a distinctly-named local (`isElbowConnector`) rather than overloading the existing `connector` variable.
- **Type consistency:** `{ objectId: string; t: number }` for anchors and `number[][]` for bends are used identically across Tasks 3, 4, 5, 6.
