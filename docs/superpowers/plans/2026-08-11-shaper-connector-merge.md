# Shaper/Connector Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the standalone `connector` tool's snapping/anchoring/reprojection/reflow capability into the existing `shaper` tool, extend snapping to circuit-symbol terminals (not just shape boundaries), auto-attach the `wire` behavior when both ends land on terminals, and remove the standalone `connector` tool.

**Architecture:** `shaper` keeps its existing `'draw'` gesture (freehand stroke, live orthogonal-straightening via `g.orthoPts`) completely unchanged — the only new work is capturing a snap anchor at gesture-start and gesture-end, and branching the existing commit logic (`canvas.tsx`'s `g.mode === 'draw'` handler, ~line 2092) on what those two anchors resolved to. `snapConnectorPoint` (currently boundary-only) gains a terminal-snapping branch using the existing `nearestTerminal`/`terminalsOf`/`terminalWorld` circuit-engine helpers, returning a discriminated anchor (`{kind:'boundary', ...} | {kind:'terminal', ...}`). `reprojectConnectors` (`lib/store/document.ts`) branches on that discriminant. The narrower, flush-only `connectEnds` mechanism (system-boundary-gated, Shift-route-only) is deleted once the new path covers the same ground unconditionally. The standalone `connector` tool (`Tool` union entry, toolbar/dock buttons, keymap action, cursor case) is removed; existing connector objects already on canvas are untouched by this plan (their rendering/reprojection/reflow code is reused, not rewritten).

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand. No new dependencies.

## Global Constraints

- No new npm dependencies.
- The freehand-drawn path (its trace, its orthogonal-straightening) is NEVER altered by snapping — snapping only decides what the two endpoints are pinned to and what behavior the committed object gets. Do not force elbow/Manhattan routing onto a freehand-drawn shaper stroke.
- Existing shaper behavior when NEITHER end snaps (sketch-recognition, scribble-delete, plain stroke) must be byte-for-byte unchanged — this plan is purely additive for that case.
- Circuit terminal snapping happens everywhere shaper is active (no system-boundary gating, no Shift-only restriction) — this supersedes and replaces `connectEnds`, which must be deleted, not left dead.
- A committed object with BOTH ends on circuit terminals gets the `wire` `BehaviorType` attached (electrically live, solved by `lib/circuit/engine.ts`) IN ADDITION TO connector-family anchoring/rendering metadata (`startAnchor`/`endAnchor`, `metadata.render = 'connector'`) — it is not one or the other.
- An anchor's `kind` field: existing connector objects created before this change have no `kind` on their anchors — treat a missing `kind` as `'boundary'` everywhere an anchor is read (backward compatible, no data migration).
- When both `wire` behavior and `metadata.render === 'connector'` are present on the same object, `wire`'s existing amber styling/flow-overlay wins visually over connector's mint styling — add this precedence explicitly, don't assume existing code already orders it correctly (no object has ever had both until this plan).
- Verify each task with `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip` — this repo has no test runner beyond typecheck + manual QA.
- This repo currently has no browser-automation tooling available in the implementer's environment — hand-trace logic numerically and disclose honestly rather than claiming unverified visual confirmation.
- Stay scoped to files each task names. Never `git add -A`/`.` — stage explicitly by path, since this is frequently a shared/dirty working tree.

---

### Task 1: Terminal-aware snap helper + discriminated anchor type

**Files:**
- Modify: `components/workspace/canvas.tsx` (the `snapConnectorPoint` function, ~line 108-132)
- Modify: `lib/scene/connectors.ts` (add the anchor type export)

**Interfaces:**
- Consumes: `nearestPointOnBoundary` (existing, `lib/scene/connectors.ts`), `nearestTerminal`, `terminalsOf`, `terminalWorld`, `SNAP` (existing, `lib/circuit/engine.ts`).
- Produces: `ConnectorAnchor` type exported from `lib/scene/connectors.ts`:
  ```ts
  export type ConnectorAnchor =
    | { kind: 'boundary'; objectId: string; t: number }
    | { kind: 'terminal'; objectId: string; terminalId: string }
  ```
  and an updated `snapConnectorPoint(pt, objects, zoom): { point: Vec2; anchor: ConnectorAnchor | null }` in `canvas.tsx`, used by Tasks 2 and 4. `terminalId` is the terminal's array index (as a string) within `terminalsOf(obj)` — stable as long as `terminalsOf`'s ordering for that symbol/input-count doesn't change, which is how the existing circuit-wiring code already treats terminal identity (by index).

- [ ] **Step 1: Add `ConnectorAnchor` to `lib/scene/connectors.ts`**

Open `lib/scene/connectors.ts` and add near the top (after existing imports, before `nearestPointOnBoundary`):

```ts
export type ConnectorAnchor =
  | { kind: 'boundary'; objectId: string; t: number }
  | { kind: 'terminal'; objectId: string; terminalId: string }
```

- [ ] **Step 2: Extend `snapConnectorPoint` in `canvas.tsx` to also check terminals**

Read the current function first (it's at approximately line 108-132 as of this plan's writing, but confirm the exact current line numbers before editing — other work may have shifted them). Replace it with:

```ts
import { terminalsOf, terminalWorld, nearestTerminal, SNAP as CIRCUIT_SNAP } from '@/lib/circuit/engine'
import type { ConnectorAnchor } from '@/lib/scene/connectors'

/** Shaper's snap targets: the nearest point on ANY object's outline
 *  (continuous boundary point, lib/scene/connectors.ts), OR a circuit
 *  terminal if one is closer within its own (tighter) snap radius —
 *  terminals win within CIRCUIT_SNAP since components are small/dense.
 *  Returns the anchor to persist plus the resolved world point to draw at. */
function snapConnectorPoint(
  pt: Vec2,
  objects: Record<string, SceneObject>,
  zoom: number
): { point: Vec2; anchor: ConnectorAnchor | null } {
  const objList = Object.values(objects)

  // Terminals first, tighter radius, since dense pin layouts need it.
  const termSnap = CIRCUIT_SNAP / zoom
  let bestTerm: { point: Vec2; objectId: string; terminalId: string } | null = null
  let bestTermD = termSnap
  for (const o of objList) {
    if (o.geometry.kind !== 'symbol') continue
    const defs = terminalsOf(o)
    defs.forEach((t, i) => {
      const w = terminalWorld(o, t)
      const d = Math.hypot(w.x - pt.x, w.y - pt.y)
      if (d < bestTermD) {
        bestTermD = d
        bestTerm = { point: w, objectId: o.id, terminalId: String(i) }
      }
    })
  }
  if (bestTerm) {
    const t = bestTerm as { point: Vec2; objectId: string; terminalId: string }
    return { point: t.point, anchor: { kind: 'terminal', objectId: t.objectId, terminalId: t.terminalId } }
  }

  // Fall back to generic shape-boundary snapping (existing behavior).
  const th = SNAP / zoom
  let best: { point: Vec2; t: number; objectId: string } | null = null
  let bestD = th
  for (const o of objList) {
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
  return { point: best.point, anchor: { kind: 'boundary', objectId: best.objectId, t: best.t } }
}
```

Note `terminalsOf` uses `isElectrical`-style gating internally in the circuit engine's own helpers (`nearestTerminal`) but this new code calls `terminalsOf`/`terminalWorld` directly per-object rather than reusing `nearestTerminal` wholesale, because `nearestTerminal` doesn't return which terminal (index) was matched — only a world point. Confirm `terminalsOf`/`terminalWorld` are exported from `lib/circuit/engine.ts` (they are, per existing code) before relying on this.

Every existing call site of `snapConnectorPoint`'s returned `.anchor` (currently `{ objectId, t }`, now `ConnectorAnchor`) will have a type error until Task 2 updates them — that's expected and resolved in Task 2, not this task. Do NOT change any call sites in this task.

- [ ] **Step 3: Typecheck (errors expected, confirm they're ONLY at call sites)**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: errors only where `snapConnectorPoint`'s old anchor shape (`{objectId, t}`) is destructured elsewhere in `canvas.tsx` and `lib/store/document.ts` — these are Task 2/3's job. If you see errors in unrelated files, stop and investigate before proceeding — that would mean this task touched something it shouldn't have.

- [ ] **Step 4: Commit**

```bash
git add lib/scene/connectors.ts components/workspace/canvas.tsx
git commit -m "feat: extend connector snapping to circuit terminals with discriminated anchor type"
```

---

### Task 2: Wire up terminal anchors through the existing connector-object commit path (`placeLine`)

**Files:**
- Modify: `components/workspace/canvas.tsx` (the `g.mode === 'placeLine'` commit branch for `g.placeTool === 'connector'`, and the `startAnchor`/`endAnchor` reads throughout)
- Modify: `lib/store/document.ts` (`reprojectConnectors`)

**Interfaces:**
- Consumes: `ConnectorAnchor` (Task 1), updated `snapConnectorPoint` (Task 1).
- Produces: connector objects created via the (still-existing, not yet removed) `placeLine`/`connector` path now write `ConnectorAnchor`-shaped `startAnchor`/`endAnchor` instead of the old flat `{objectId, t}` shape. `reprojectConnectors` correctly reprojects both `kind: 'boundary'` and `kind: 'terminal'` anchors. This task fixes the type errors from Task 1 and is a stepping stone — Task 5 removes this whole `placeLine`/`connector` code path once Task 3 gives `shaper` equivalent-or-better capability.

This task exists so the codebase typechecks cleanly and terminal-snapping is provably correct (via the still-functioning standalone connector tool) BEFORE the more invasive Task 3 (shaper's own gesture) and Task 5 (deletion) land. Do not skip it to save time — it isolates the anchor-shape change from the gesture-merge change.

- [ ] **Step 1: Fix the `placeLine`/connector commit branch's `startAnchor` write**

Find the `g.mode === 'placeLine'` handler's `g.placeTool === 'connector'` maker (~line 2053-2060 as of this plan's writing):

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

No change needed here — `g.startAnchor` already flows through whatever type it's given at capture time (Step 2 fixes that). Confirm the `Gesture` interface's `startAnchor` field type (search for where `startAnchor?:` is declared, likely near the `GestureMode`/`Gesture` interface definition) and update it from `{ objectId: string; t: number } | null` to `ConnectorAnchor | null`, importing `ConnectorAnchor` from `lib/scene/connectors.ts`.

- [ ] **Step 2: Fix the pointer-down capture and the `endAnchor` write**

Find where `tool === 'connector'`'s pointer-down handler calls `snapConnectorPoint` and passes `startAnchor: snapped.anchor` to `beginGesture` (~line 2757-2762) — no change needed, it already just forwards whatever `snapConnectorPoint` returns (now `ConnectorAnchor | null` per Task 1).

Find where `endAnchor` gets set at commit time (inside the same `placeLine` handler, ~line 2082):
```ts
            if (g.placeTool === 'connector') {
              const endSnap = snapConnectorPoint(b, store.pages[pageId]?.objects ?? {}, vpRef.current.zoom)
              obj.metadata.endAnchor = endSnap.anchor ?? undefined
            }
```
No change needed here either — it already just forwards `endSnap.anchor`.

- [ ] **Step 3: Update `reprojectConnectors` in `lib/store/document.ts` to branch on anchor kind**

Read the current `reprojectConnectors` function. It currently does something like (confirm exact current code before editing — this is illustrative):

```ts
const startAnchor = obj.metadata.startAnchor as { objectId: string; t: number } | undefined
const endAnchor = obj.metadata.endAnchor as { objectId: string; t: number } | undefined
...
if (startAnchor?.objectId === movedObjectId) a = pointAtBoundaryT(movedObj, startAnchor.t)
if (endAnchor?.objectId === movedObjectId) b = pointAtBoundaryT(movedObj, endAnchor.t)
```

Change the cast and resolution to branch on `kind`, treating a missing `kind` as `'boundary'` for backward compatibility with connector objects created before this change:

```ts
import type { ConnectorAnchor } from '@/lib/scene/connectors'
import { terminalsOf, terminalWorld } from '@/lib/circuit/engine'

function resolveAnchorPoint(anchor: ConnectorAnchor | { objectId: string; t: number }, obj: SceneObject): Vec2 {
  const kind = 'kind' in anchor ? anchor.kind : 'boundary'
  if (kind === 'terminal') {
    const a = anchor as { objectId: string; terminalId: string }
    const idx = Number(a.terminalId)
    const defs = terminalsOf(obj)
    const t = defs[idx]
    return t ? terminalWorld(obj, t) : pointAtBoundaryT(obj, 0)
  }
  const a = anchor as { objectId: string; t: number }
  return pointAtBoundaryT(obj, a.t)
}
```

(`pointAtBoundaryT(obj, 0)` as the terminal-not-found fallback is a defensive no-op — it should only trigger if a terminal layout changed out from under a stale anchor, e.g. someone changed a gate's input count; picking boundary-t=0 avoids a crash without inventing new UX for an edge case outside this plan's scope.)

Then update the two call sites to use `resolveAnchorPoint(startAnchor, movedObj)` / `resolveAnchorPoint(endAnchor, movedObj)` instead of the direct `pointAtBoundaryT` calls, still gated by the existing `startAnchor?.objectId === movedObjectId` checks (unchanged).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: clean, no errors anywhere.

- [ ] **Step 5: Manual verification (no browser tooling — hand-trace)**

Trace: draw a connector (via the still-existing standalone connector tool) from a plain rect to a resistor symbol's terminal. Confirm `snapConnectorPoint` returns `{kind:'terminal', objectId, terminalId}` for the resistor end (terminal within `CIRCUIT_SNAP` radius) and `{kind:'boundary', objectId, t}` for the rect end. Confirm `reprojectConnectors` resolves the terminal end via `terminalWorld` when the resistor moves — pick concrete coordinates and trace it numerically in your task report.

- [ ] **Step 6: Commit**

```bash
git add components/workspace/canvas.tsx lib/store/document.ts
git commit -m "feat: connector anchor reprojection handles both boundary and terminal anchors"
```

---

### Task 3: Shaper's own draw gesture gains snap-endpoint capture

**Files:**
- Modify: `components/workspace/canvas.tsx`

**Interfaces:**
- Consumes: `snapConnectorPoint` (Task 1), `ConnectorAnchor` (Task 1).
- Produces: the `'draw'` gesture (used by both `pen` and `shaper`, but this task's new behavior is gated to `shaper` only) now captures a `ConnectorAnchor | null` at gesture-start (press point) and computes one again at gesture-end (release point) — stored on the gesture state and passed to the commit handler, WITHOUT altering the freehand trace itself. Task 4 consumes these captured anchors to decide the committed object's shape/behavior.

This is the core "shaper absorbs connector's snapping" change. It does NOT touch the orthogonal-straightening logic (`g.orthoPts` etc.) at all — only adds anchor capture alongside it.

- [ ] **Step 1: Add anchor fields to the gesture state**

Find the `Gesture` interface (or whatever the gesture-state type is called — confirm exact name; Task 2 already referenced adding `startAnchor: ConnectorAnchor | null` to it). Add a second field:

```ts
  endAnchor?: ConnectorAnchor | null
```

(`startAnchor` already exists from Task 2's type update — reuse it, don't duplicate.)

- [ ] **Step 2: Capture `startAnchor` when a shaper draw gesture begins**

Find the `tool === 'pen' || tool === 'shaper'` pointer-down handler (~line 2710-2714):

```ts
    if (tool === 'pen' || tool === 'shaper') {
      const p = toCanvas(e.clientX, e.clientY)
      setStroke([[p.x, p.y, inkPressure(e)]])
      beginGesture('draw', e)
      return
    }
```

Change it to capture a snap anchor ONLY when `tool === 'shaper'` (pen never snaps — this is a shaper-only capability per the design spec):

```ts
    if (tool === 'pen' || tool === 'shaper') {
      const p = toCanvas(e.clientX, e.clientY)
      const store2 = useDocStore.getState()
      const startAnchor =
        tool === 'shaper'
          ? snapConnectorPoint(p, store2.pages[pageId]?.objects ?? {}, vpRef.current.zoom).anchor
          : null
      const startPoint = startAnchor
        ? snapConnectorPoint(p, store2.pages[pageId]?.objects ?? {}, vpRef.current.zoom).point
        : p
      setStroke([[startPoint.x, startPoint.y, inkPressure(e)]])
      beginGesture('draw', e, { startAnchor })
      return
    }
```

(Calling `snapConnectorPoint` twice here is redundant — clean this up by capturing the full `{point, anchor}` result once into a local and reusing both fields, rather than the two-call version shown above, which was written for clarity of diff. Use your judgment on the exact refactor, but avoid the double-call in the final code.)

Use whatever variable name `store` already uses in this scope (this codebase's convention is `useDocStore.getState()` called fresh at each gesture-start site — check the immediately surrounding code for the established local name, likely just `store`, and don't introduce a `store2` unless there's a genuine shadowing conflict).

- [ ] **Step 3: Show the hover snap-dot for `shaper` too (not just `connector`)**

Find the always-live hover handler that currently only fires for `tool === 'connector'` (~line 3040, inside the JSX `onPointerMove` prop, not the `useCallback`'d one — this was a deliberate fix from the original connector-tool plan, see that plan's Task 3 notes if useful context). Change its gate from `tool === 'connector'` to `tool === 'connector' || tool === 'shaper'` — but since Task 5 removes `'connector'` as a tool entirely, for THIS task just add `shaper` alongside it (Task 5 will simplify this back down to a single check when it removes the `connector` branch):

```ts
        if ((tool === 'connector' || tool === 'shaper') && !gestureRef.current) {
```

Rename `connectorSnapDot` state/setter usages are NOT required in this task (keep the existing name — Task 5 can rename if desired, but it's not required for correctness).

- [ ] **Step 4: Capture `endAnchor` at commit time, without altering the drawn path**

Find the `g.mode === 'draw'` commit handler (~line 2092 as of this plan's writing — the one that runs `isScribble`, builds the `orthoPts`-based stroke object, and does sketch recognition). At the very top of this block, before any of the existing logic, compute the end-point snap (shaper only) and stash it locally:

```ts
      } else if (g.mode === 'draw') {
        {
          const points = strokeRef.current
          setStroke(null)
          if (!points || points.length < 2) return

          const endAnchor =
            store.tool === 'shaper'
              ? snapConnectorPoint(
                  { x: points[points.length - 1][0], y: points[points.length - 1][1] },
                  store.pages[pageId]?.objects ?? {},
                  vpRef.current.zoom
                ).anchor
              : null

          // ... existing isScribble / orthoPts / recognize logic follows, UNCHANGED ...
```

Do not modify `points` itself here — this only computes `endAnchor` for Task 4 to consume; it does not snap the actual last drawn point onto the terminal/boundary (per the design decision: "snapping only pins the endpoints" happens in Task 4's object-construction step, not by mutating the freehand trace).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: clean (this task only adds new local variables and a `beginGesture` option; it doesn't yet consume `startAnchor`/`endAnchor` in the commit branching — that's Task 4).

- [ ] **Step 6: Manual verification (hand-trace)**

Trace: select `shaper`, hover near a rect's boundary — confirm the existing hover-dot code path (now shared with connector's) fires for `shaper` too. Trace a press-start near a resistor terminal — confirm `g.startAnchor` captures `{kind:'terminal', ...}`. Trace releasing far from anything — confirm `endAnchor` computes to `null`. Document these traces in your report.

- [ ] **Step 7: Commit**

```bash
git add components/workspace/canvas.tsx
git commit -m "feat: shaper draw gesture captures start/end snap anchors alongside freehand trace"
```

---

### Task 4: Commit-time branching — plain stroke vs. connector vs. wire

**Files:**
- Modify: `components/workspace/canvas.tsx` (the `g.mode === 'draw'` commit handler, continuing from Task 3's insertion point)

**Interfaces:**
- Consumes: `g.startAnchor`/local `endAnchor` (Task 3), `createGeometry`, `createBehavior` (existing), `ConnectorAnchor` (Task 1).
- Produces: the actual polymorphic-commit behavior described in the design spec. Nothing further downstream depends on new exports — this is the task where the feature becomes user-visible end-to-end for `shaper`.

- [ ] **Step 1: Insert the branch immediately after Task 3's `endAnchor` computation, before the existing scribble/recognition logic**

The existing commit logic today (unchanged, for reference) is: check scribble-delete (pen only) → check `g.orthoPts`-routed commit (shift-routed or shaper) → else run sketch `recognize()`/domain-matching/custom-sketch logic. This task adds a NEW branch that takes priority over ALL of that, but ONLY when `store.tool === 'shaper'` AND at least one of `g.startAnchor`/`endAnchor` is non-null:

```ts
          if (store.tool === 'shaper' && (g.startAnchor || endAnchor)) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
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
            stampInkMeta(obj)
            obj.metadata.render = 'connector'
            obj.metadata.startAnchor = g.startAnchor ?? undefined
            obj.metadata.endAnchor = endAnchor ?? undefined
            obj.metadata.bends = []
            obj.metadata.startCap = 'none'
            obj.metadata.endCap = 'none'
            const bothTerminals = g.startAnchor?.kind === 'terminal' && endAnchor?.kind === 'terminal'
            if (bothTerminals) {
              obj.behaviors.push(createBehavior('wire'))
              obj.name = obj.name.replace(/^(Line|Stroke)/, 'Wire')
            }
            obj.z = topZ(pageId)
            store.addObject(pageId, obj)
            store.setSelection([obj.id])
            return null
          }
```

Note this uses `fromRecognition({kind: 'stroke', ...})` with the actual drawn `points` (freehand trace, straightened by `g.orthoPts` upstream if Shift/shaper-orthogonal-routing was active — that logic is untouched and already baked into `points` by the time this branch runs), NOT `createGeometry('line', ...)` with a synthetic two-point line like the standalone connector tool used — per the design decision that the freehand path itself is preserved, not replaced with a synthetic straight/elbow line. Confirm `fromRecognition`'s `kind: 'stroke'` path preserves `points` as multi-point geometry (it should, since this exact call shape is already used two blocks below for the non-snapped case) rather than reducing to 2 points.

This means a `metadata.render === 'connector'` object can now have >2 `geometry.points` (an actual freehand multi-point trace) rather than always exactly 2. **Confirmed safe** (verified directly in `geometry.tsx`'s `kind === 'line'` block during planning, current line ~1022-1031): `a`/`b` are computed as `pts[0]`/`pts[pts.length - 1]` — only the FIRST and LAST points are ever read by `connectorElbowPath`/`connectorPoints`, both for the rendered path and for the segment-reflow hit-strips (`geometry.tsx`'s `allPts = connectorPoints(a, bends, b)`, same pattern in `canvas.tsx`'s `connectorReflow` handler). Interior points from a freehand trace are simply never consulted by any connector-family code — they're inert extra data sitting in `geometry.points` between the two ends that matter. No collapsing-to-2-points workaround is needed; leave the full freehand trace in `geometry.points` as-is.

- [ ] **Step 2: Wire-behavior rendering precedence**

In `components/objects/geometry.tsx`'s line-kind rendering block, find where `isElbowConnector` and `isWire` are both computed. Confirm (or add, if not already true) that the stroke/strokeWidth ternary chains check `isWire` BEFORE `isElbowConnector`, so an object with both (new possibility from this task) renders with `wire`'s amber styling and flow-overlay, not connector's mint styling. Read the current ternary order carefully — do not assume; the original connector-tool plan ordered `isElbowConnector` first specifically to beat physics-connector styling, which is a DIFFERENT precedence question than this one (wire vs. elbow-connector). Both orderings can coexist correctly as long as the final chain is: `isWire` (highest) → `isElbowConnector` → physics `connector` → default `stroke`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: clean.

- [ ] **Step 4: Manual verification (hand-trace, cover all four cases)**

In your report, hand-trace all four commit scenarios with concrete coordinates:
1. Neither end snapped — confirm the new branch is skipped entirely (falls through to existing scribble/recognition logic, unchanged).
2. One end on a shape boundary, other end free — confirm `metadata.render = 'connector'`, one anchor set, no `wire` behavior, freehand trace preserved in `geometry.points`.
3. One end on a circuit terminal, other end on a plain shape boundary — confirm both anchors set with correct `kind`s, no `wire` behavior (not BOTH terminals).
4. Both ends on circuit terminals — confirm `wire` behavior attached, object renamed, both anchors `kind: 'terminal'`.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/canvas.tsx components/objects/geometry.tsx
git commit -m "feat: shaper commit branches into plain stroke / connector / wire based on snap anchors"
```

---

### Task 5: Remove `connectEnds` and the standalone `connector` tool

**Files:**
- Modify: `components/workspace/canvas.tsx` (delete `connectEnds` function and its 2 call sites; delete the `tool === 'connector'` pointer-down branch, the `placeLine`/`connector` maker branch, the `connector`-specific `endAnchor` commit code, and simplify the hover-dot gate from Task 3 back to a single `shaper` check)
- Modify: `lib/store/document.ts` (remove `'connector'` from the `Tool` union)
- Modify: `components/workspace/toolbar.tsx` (remove the connector `TOOLS` entry and unused `Waypoints` import if nothing else uses it)
- Modify: `components/workspace/sundial-dock.tsx` (remove the connector `PRIMARY_TOOLS` entry and unused `Waypoints` import if nothing else uses it)
- Modify: `lib/keymap.ts` (remove the `tool.connector` action)
- Modify: `lib/scene/tool-cursors.ts` (remove the `case 'connector':` — but keep `'shaper'` mapped to the crosshair cursor group if it isn't already; check current cursor assignment for `shaper`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Tool` union no longer includes `'connector'`. Nothing downstream depends on this task — it's the final cleanup.

This task is pure deletion/simplification — no new logic. Existing connector objects already on canvas (created by any user before this change, or during Tasks 2's manual testing) are NOT deleted or migrated; their `metadata.render === 'connector'` rendering/reprojection/reflow code in `geometry.tsx`/`lib/store/document.ts`/`lib/render/connector-path.ts` is entirely untouched and keeps working — only the TOOL that creates new ones via the old click-drag `placeLine` path is removed, since `shaper` now covers that (and more) via Tasks 3-4.

- [ ] **Step 1: Delete `connectEnds` and its call sites in `canvas.tsx`**

Delete the `connectEnds` function (~line 367-383). Find and remove its two call sites — both currently do `connectEnds(obj, all)` inside the domain-sketch/system-boundary branch (~line 2154, 2243 in the ORIGINAL pre-this-plan code — line numbers will have shifted after Tasks 2-4's edits, search for `connectEnds(` to find them). These call sites are inside the "Shift-routed orthogonal polylines" commit branch and the "any free line in a circuit system conducts" branch — both of those branches' SURROUNDING logic (the `g.orthoPts.length >= 2` check, the `obj.behaviors.push(createBehavior('wire'))` for the domain-sketch case, etc.) stays exactly as-is; only the `connectEnds(obj, all)` call and its `if (connectEnds(...)) { ... }` conditional wrapper are removed, since terminal snapping is now handled earlier and unconditionally by Task 4's new branch, which takes priority (runs first) for `shaper`. Confirm Task 4's new branch does in fact run BEFORE these older branches in the `g.mode === 'draw'` commit handler's control flow (it should, since Task 4 Step 1 says to insert it "immediately after Task 3's `endAnchor` computation, before the existing scribble/recognition logic") — if for some reason it doesn't, that's a bug from an earlier task to flag and fix here, not silently work around.

For the `pen` tool (not `shaper`), `connectEnds` was the ONLY terminal-snapping mechanism — pen strokes drawn inside a system boundary or Shift-routed still call the surrounding domain-sketch logic that decides to make them wires, but the connectEnds endpoint-flush behavior goes away for `pen` specifically (per the design spec: terminal-snap-to-wire upgrades only apply to `shaper`, `pen` is untouched). Confirm this is an acceptable, spec-consistent regression for `pen`'s minor endpoint-flush convenience (it is, per the design decision that pen is out of scope) and note it in your report rather than trying to preserve it — preserving it would require keeping `connectEnds` alive for `pen` only, which the design explicitly didn't ask for and would leave dead complexity.

- [ ] **Step 2: Remove the `tool === 'connector'` pointer-down branch**

Delete (~line 2757-2762 in pre-this-plan numbering, confirm current location):
```ts
    if (tool === 'connector') {
      const snapped = snapConnectorPoint(point, store.pages[pageId]?.objects ?? {}, vpRef.current.zoom)
      setStroke([[snapped.point.x, snapped.point.y]])
      beginGesture('placeLine', e, { placeTool: 'connector', start: snapped.point, startAnchor: snapped.anchor })
      return
    }
```

- [ ] **Step 3: Remove the `placeLine`/`connector` maker branch and its `endAnchor` write**

In the `g.mode === 'placeLine'` commit handler, remove the `g.placeTool === 'connector' ? () => {...}` ternary branch (falls through to the `null` default, same as if no matching `placeTool`), and remove the `if (g.placeTool === 'connector') { ... }` block that sets `obj.metadata.endAnchor` after `maker()` runs.

- [ ] **Step 4: Simplify the hover-dot gate back to `shaper`-only**

Change (from Task 3):
```ts
        if ((tool === 'connector' || tool === 'shaper') && !gestureRef.current) {
```
to:
```ts
        if (tool === 'shaper' && !gestureRef.current) {
```

- [ ] **Step 5: Remove `'connector'` from the `Tool` union**

In `lib/store/document.ts`, delete the line:
```ts
  | 'connector' // shape-to-shape orthogonal connector: snaps to boundary, stays attached
```

- [ ] **Step 6: Remove the toolbar/dock entries**

In `components/workspace/toolbar.tsx`, remove the `{ tool: 'connector', icon: Waypoints, ... }` entry from `TOOLS`. If `Waypoints` isn't used elsewhere in the file, remove it from the `lucide-react` import too (grep the file for `Waypoints` after removing the entry to confirm).

Repeat identically in `components/workspace/sundial-dock.tsx` for `PRIMARY_TOOLS`.

- [ ] **Step 7: Remove the keymap action**

In `lib/keymap.ts`, remove the `{ id: 'tool.connector', ... }` entry from `ACTIONS`.

- [ ] **Step 8: Update the cursor mapping**

In `lib/scene/tool-cursors.ts`'s `cursorForTool`, remove `case 'connector':`. Confirm `case 'shaper':` (or wherever `shaper` currently falls) still resolves sensibly — `shaper` should already have its own cursor behavior (it's a drawing tool distinct from generic crosshair tools); do not accidentally change `shaper`'s existing cursor assignment while removing the unrelated `connector` case.

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: clean. Pay special attention to any remaining reference to `Tool = 'connector'` as a string literal anywhere else in the codebase (grep `'connector'` across `components/` and `lib/` after this task — matches against `metadata.render === 'connector'` are fine and expected to remain everywhere, since that's the object discriminator, not the tool; only `Tool`-typed comparisons/values referencing the removed tool id are the concern).

- [ ] **Step 10: Manual verification (hand-trace)**

Confirm: selecting `shaper` and drawing near a shape boundary produces a connector-family object exactly as Task 4 verified, with no remaining code path depending on a `'connector'` tool selection. Confirm existing connector objects (if any exist from Task 2's manual testing) still render, reproject, and reflow correctly when their anchored shape moves or their segments are dragged — this exercises the UNCHANGED downstream code from the original connector-tool feature, so it should need no fixes; if it's broken, that's a sign this task deleted something it shouldn't have.

- [ ] **Step 11: Commit**

```bash
git add components/workspace/canvas.tsx lib/store/document.ts components/workspace/toolbar.tsx components/workspace/sundial-dock.tsx lib/keymap.ts lib/scene/tool-cursors.ts
git commit -m "refactor: remove standalone connector tool and connectEnds, superseded by shaper"
```

---

## Self-Review Notes

- **Spec coverage:** decision 1 (freehand path preserved, snapping only pins endpoints) → Task 3 Step 4 + Task 4 Step 1's explicit non-mutation of `points`. Decision 2 (boundary + terminal snapping, nearest wins) → Task 1. Decision 3 (terminal snapping upgraded everywhere, `connectEnds` removed) → Task 5 Step 1. Decision 4 (commit-time branching: plain/connector/wire) → Task 4. Decision 5 (standalone connector tool removed) → Task 5 Steps 2-8.
- **Type consistency:** `ConnectorAnchor` (Task 1) is the single anchor shape used identically across Tasks 2, 3, 4, and read by `reprojectConnectors` — no task introduces a competing shape.
- **Named risk resolved during planning:** the multi-point-geometry-vs-2-point question (does a freehand connector trace with >2 points break the elbow renderer/hit-strips?) was checked directly against the current `geometry.tsx` source while writing this plan — confirmed safe, since only `pts[0]`/`pts[last]` are ever read by connector-family code. No open risk remains in this plan requiring implementer judgment.
