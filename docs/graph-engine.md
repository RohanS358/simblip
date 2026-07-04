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
