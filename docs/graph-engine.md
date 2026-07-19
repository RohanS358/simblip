# SIMBLIP — Graph Engine

## Purpose

Live plots of any simulation channel: velocity vs time, angle vs time, y vs x (trajectories),
later voltage/current/frequency response. Graphs are first-class canvas objects.

## Architecture

```
physics loop (120 Hz) ──▶ Simulation Bus (ring buffers, outside React)
                                   │  subscribe(objectId)
Graph object (React) ◀── throttled reads ≤ 15 Hz ── requestAnimationFrame gate
```

- **Simulation Bus** (`lib/physics/bus.ts`): per-simulation ring buffer of `{t, channels}`
  samples (~2000 points ≈ 30 s at 60 Hz sampling). Lives outside React so 120 Hz physics never
  causes React renders.
- **Graph object**: a `SceneObject` of type `graph` whose parameters are
  `{ sourceId, xChannel ("t" or any channel), yChannels[] }`. It polls the bus on a throttled
  rAF and re-renders a recharts `LineChart`.
- **Why recharts**: already installed (shadcn chart stack), SVG output matches the DOM canvas,
  themable via CSS tokens. If profiling shows SVG limits (>5k visible points), the renderer
  swaps to canvas2d behind the same graph object — object schema doesn't change.
- **Downsampling**: buffers are decimated to ≤ 300 drawn points (min/max preserving) before
  render; the eye can't use more at canvas-object size, and it keeps repaint under 2 ms.

## UX rules

- Graphs bind to a simulation via the Inspector (source dropdown lists page simulations).
- Multiple series per graph; colors come from the chart token palette.
- Pause/clear follow the source simulation's controls.
- Resizable like any object; "detached window" mode is roadmap (portal to a floating panel).

## 3D view

Toggled per-graph via the `view` param (`'2d' | '3d'`, header cube icon, `components/objects/graph.tsx`).
Appears once 3 or more series/formulas are bound. Renders in `components/objects/graph-3d.tsx`.

- **Data model**: no new binding UI — the first three entries of the existing `panels` array
  (built from `series` + `formulas`, same as 2D) become the X, Y(up), Z axes of **one** parametric
  trajectory, instead of each panel being plotted against `xChannel`. `rows` (the merged
  live-sample + formula-column data) is unchanged and fully shared with the 2D path.
- **Renderer**: `@react-three/fiber` + `@react-three/drei` (`Canvas`, `Line`, `Grid`, `Html`,
  `OrbitControls`), `frameloop="demand"` so idle 3D graphs don't run a render loop. First use of
  three.js in the object-rendering pipeline — previously three/`@react-three/fiber` were only used
  decoratively on the landing page.
- **Autoscale**: each axis is independently min/max-normalized into a fixed `[-2.5, 2.5]` display
  cube (`SIZE = 5` in `graph-3d.tsx`) — arbitrary/mixed units plot legibly without manual ranges.
- **Pan/orbit**: `OrbitControls` with `enablePan`/`enableRotate`/`enableZoom`. The canvas wrapper
  uses the same `onPointerDown={(e) => e.stopPropagation()}` + `touchAction: 'none'` pattern the
  2D chart wrapper already uses, so orbit/pan drags don't fight the canvas object's own drag/resize.
- **Height coloring**: the trajectory line and integral curtain are vertex-colored by the Y-axis
  value via a sequential ramp seeded from the design system's `--chart-1` hue
  (`lib/render/theme-color.ts`, `color-mix(in oklch, var(--chart-1) N%, var(--card))`, same pattern
  as `geometry.tsx`'s `bodyFill`) — gives depth legibility that a flat single color can't, and
  re-resolves automatically on theme change via `next-themes`.
- **Calculus overlays translate, not reuse**, since "slope" and "area under the curve" aren't
  literally 3D concepts:
  - *Derivative* → the tangent/**velocity vector** r′(t) at a point, drawn with `THREE.ArrowHelper`
    (arrow length ∝ speed). No mouse-hover equivalent to recharts' free `activeLabel` exists over a
    rotatable 3D scene, so a **slider scrubs the point** instead (`graph-3d.tsx` local state, not an
    object param).
  - *Integral* → a shaded **curtain** between the curve and the floor of the plotted Y-range over
    `[intA, intB]` (existing bound-expression params, reused as-is), area computed as trapezoids of
    height × horizontal distance traveled in the XZ base — the direct 3D generalization of the 2D
    `integrate()` trapezoid loop.
  - `stacked` (small multiples) has no 3D equivalent and is hidden in 3D mode; `measure` (RMS/peak
    readouts) is unaffected since it only reads `rows`, independent of view.
