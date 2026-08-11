# Shaper/Connector Merge — Design Spec

## Problem

Shaper and Connector currently exist as two separate tools with overlapping
purpose. Shaper is a freehand-drawing tool (draw a rough stroke, it
auto-straightens to orthogonal segments as you go, and un-snapped strokes get
sketch-recognized into shapes or scribble-deleted). Connector is a
click/drag point-to-point tool that snaps to shape boundaries, persists
anchors, stays attached as shapes move, and supports draggable orthogonal
segment reflow and arrowhead caps.

The user wants ONE tool: shaper's freehand gesture and full existing
behavior, PLUS connector's snapping/anchoring/reflow powers, PLUS the
ability to snap to circuit-symbol terminals (not just generic shape
boundaries) and automatically become an electrically-live `wire` when both
ends land on terminals.

## Decisions

1. **One draw gesture, polymorphic result.** The user always draws with
   today's shaper gesture (freehand stroke, auto-straightens as you go).
   What the committed object becomes is decided by what its two endpoints
   actually landed on at commit time — not by a mode switch or a different
   drag interaction. The path itself (its bends, its trace) is exactly what
   the user drew and auto-straightened, unmodified by snapping — snapping
   only affects which points the two ends are pinned to.
2. **Snap targets: shape boundaries AND circuit terminals, nearest wins.**
   While shaper is active and hovering, show the existing blue snap dot at
   whichever is closer: the continuous nearest point on a shape's boundary
   (existing `nearestPointOnBoundary`), or a circuit terminal (existing
   `nearestTerminal`) if a circuit symbol is nearby. Terminals use the
   existing tighter `SNAP` radius from `lib/circuit/engine.ts` (dense
   pin spacing); generic boundaries keep the connector tool's existing
   (larger) snap radius.
3. **Commit-time behavior branching**, based on what each end snapped to:
   - **Both ends on circuit terminals** → commit as an anchored connector
     object AND attach the `wire` `BehaviorType`, so it's electrically live
     and solved by `lib/circuit/engine.ts` exactly like today's dedicated
     wire-drawing path.
   - **At least one end on a shape/terminal but not both terminals** →
     commit as today's connector object (anchored end(s), mint styling,
     draggable orthogonal reflow, arrowhead caps). No `wire` behavior.
   - **Neither end snapped** → shaper's existing behavior, completely
     unchanged: sketch-recognition, scribble-delete, or plain
     orthogonal-straightened stroke, whichever already applies today.
4. **Standalone connector tool is removed.** `'connector'` is deleted from
   the `Tool` union, along with its toolbar/dock button, keymap shortcut
   (`X`), and cursor entry. Shaper absorbs all of its user-facing
   capability. Existing connector objects already on canvas keep
   rendering/reprojecting/reflowing exactly as before — only the tool that
   *creates* new ones changes.

## Data model changes

`metadata.startAnchor` / `metadata.endAnchor` gain a discriminant to support
terminal anchoring alongside the existing boundary anchoring:

```ts
type ConnectorAnchor =
  | { kind: 'boundary'; objectId: string; t: number }   // existing shape-boundary anchor
  | { kind: 'terminal'; objectId: string; terminalId: string } // circuit-symbol pin
```

Existing anchors created before this change have no `kind` field; treat a
missing `kind` as `'boundary'` (backward compatible, no migration needed —
`metadata: Record<string, unknown>` already tolerates this).

## Reprojection

`reprojectConnectors` (`lib/store/document.ts`) branches on `anchor.kind`:
- `'boundary'` → existing `pointAtBoundaryT` path, unchanged.
- `'terminal'` → resolve via the circuit engine's existing
  `terminalWorld(obj, terminal)` helper instead.

## Rendering precedence

A connector-family object that also carries the `wire` behavior is
electrically meaningful, so `wire`'s existing amber styling and current-flow
overlay take precedence over the connector-family mint styling. The
`isElbowConnector`-vs-`isWire` styling check in `geometry.tsx` must put the
`wire` check first when both are present on the same object (this ordering
doesn't exist yet since no object has ever had both — it needs to be added
explicitly, not assumed).

## Explicitly out of scope / unchanged

- Freehand sketch-recognition and scribble-delete logic — untouched.
- The `wire` behavior type and the circuit solver itself — untouched.
- `pen` tool — untouched.
- `connectorElbowPath` / segment-reflow drag math — untouched; only the
  anchor-resolution layer feeding it (boundary vs. terminal) changes.
- No new snap-target types beyond shape boundaries and circuit terminals
  (e.g. no snapping to other connectors' bend points).

## Migration notes

- Any documentation/UI copy referencing "Connector tool" as a separate tool
  should be removed or updated to describe this merged shaper capability.
- The design spec and implementation plan from the original connector-tool
  feature (`docs/superpowers/specs/2026-08-11-connector-tool-design.md`,
  `docs/superpowers/plans/2026-08-11-connector-tool.md`) remain historically
  accurate for what was built then; this document supersedes them for the
  tool's user-facing shape going forward, but doesn't invalidate the
  underlying connector-object data model / rendering code they produced,
  which this merge reuses rather than replaces.
