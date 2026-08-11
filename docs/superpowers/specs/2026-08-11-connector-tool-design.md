# Connector Tool — Design Spec

## Problem

We need a new drawing tool that draws connector/wire-style lines between shapes:
diagram-style connectors (draw.io/Visio-like) that snap to shape boundaries, stay
attached as shapes move, support arrowhead ends, and can be reflowed as orthogonal
elbow connectors by dragging a segment perpendicular to itself.

## Naming collision (resolved)

The codebase already has a tool called `shaper` (`lib/store/document.ts`,
`components/workspace/toolbar.tsx`) — but it means freehand-ink auto-straighten/
smooth (like Shift+pen), governed by normal pen settings (color/thickness). It is
unrelated to this feature and is left untouched.

**Decision:** the new tool gets its own id, `connector`. No rename or behavior
change to the existing `shaper` ink tool.

## Requirements

1. Connector strokes are NOT affected by pen settings (color/thickness) — fixed
   default look, same as the existing `wire` behavior ignores pen styling.
2. While the `connector` tool is active and the cursor hovers near any shape, show
   a blue-filled dot at the **nearest point on that shape's boundary** to the
   cursor (continuous, not discrete fixed points) — this is the snap point you can
   start drawing from.
3. The connector's other end can snap the same way to a different shape's
   boundary.
4. Once both ends are anchored to shapes, the connector stays attached as either
   shape moves/resizes — the line reprojects and adjusts automatically.
5. Each end (start/end) can be independently toggled to an arrowhead via the
   Inspector.
6. The connector is an orthogonal "elbow" connector (draw.io style): rendered as
   alternating horizontal/vertical segments. Dragging a straight segment
   perpendicular to its own orientation moves that segment; the connector inserts
   or removes bends as needed to stay fully orthogonal and keep both endpoints
   fixed — it must never visually disconnect. This reflow behavior applies to
   every connector, whether or not its ends are anchored to shapes.

## Architecture

Kept as a **separate system** from `lib/circuit/engine.ts`'s wire/terminal logic
(which stays scoped to fixed component terminals for circuit diagrams). The new
connector reuses the *concepts* (snap-radius lookup, behavior-driven line
rendering) but not the terminal data model, since it needs arbitrary
boundary-point snapping and persisted user-adjustable bends, neither of which the
circuit engine supports today.

### Tool

- Add `'connector'` to the `Tool` union in `lib/store/document.ts`, alongside
  existing tools. Wired into toolbar/dock the same way other line-drawing tools
  are.

### Geometry & data model

- Connector objects are `Geometry.kind === 'line'` with a new
  `BehaviorType: 'connector'` (distinct from `'wire'`).
- `metadata.bends: Point[]` — ordered intermediate orthogonal bend points.
  Empty array = direct L-shaped/straight route between endpoints (current
  Manhattan-path default).
- `metadata.startCap` / `metadata.endCap`: `'none' | 'arrow'`, independent.
- `metadata.startAnchor` / `metadata.endAnchor`: optional
  `{ objectId: string, t: number }`, where `t` (0–1) parametrizes position around
  the anchored shape's boundary. Unanchored ends just use the literal point.

### Snapping

- New helper, `nearestPointOnBoundary(shape, cursorPos)`, generalizing the
  existing `nearestTerminal` snap-radius pattern (`lib/circuit/engine.ts`) to walk
  a shape's actual geometric boundary (rect edge, circle circumference, polygon
  edge) rather than fixed terminal defs.
- Active only while the `connector` tool is selected. Renders the blue snap dot
  and captures `{ objectId, t }` on drag-start/drag-end when in range.

### Live reconnection

- Wherever object moves/resizes are committed today (`updateObject` or
  equivalent), after the mutation, recompute the world position of any connector
  endpoint anchored to that object (`t` → boundary point in current world
  coordinates). Bend points are held at their existing object-local coordinates
  unchanged — only the anchored endpoint(s) reproject; the interior bend shape
  stays exactly as the user last set it rather than reflowing proportionally.

### Orthogonal reflow rendering

- Extend `lib/render/connector-path.ts`'s existing Manhattan/`wire` path case to
  support N stored bends instead of one fixed L-turn, driven by
  `metadata.bends`.
- Segment drag interaction (in `canvas.tsx`'s pointer state machine): dragging a
  horizontal segment vertically (or vice versa) updates that segment's fixed
  coordinate and inserts/removes bend points so all segments remain axis-aligned
  and both endpoints stay fixed to their anchors.

### Inspector

- New "Connector" section in the per-behavior switch in
  `components/workspace/inspector.tsx`, shown when the selected object's behavior
  is `connector`: two dropdowns, Start cap / End cap, writing
  `metadata.startCap`/`endCap`.

### Persistence

- Uses existing object mutation paths (`updateObject`/store actions) — no new
  persistence mechanism. Undo/redo and sync apply automatically.

## Out of scope (YAGNI)

- Curved/rounded elbow corners.
- Auto-routing around obstacles.
- Discrete fixed connection points (Visio-style N dots per shape) — continuous
  nearest-boundary-point only.
- Any change to the existing `shaper` (ink) tool or `wire` (circuit) behavior.
