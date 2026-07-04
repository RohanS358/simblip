# SIMBLIP — Architecture

## What SIMBLIP is

**The simulation engine is the product; the notebook is the environment it lives in.**
The founding philosophy: *whatever the user draws can become reality.* There is no distinction
between notes and simulations — everything is an object on one canvas, and any object can be
given physical meaning.

## The core idea: geometry + behaviors

```
Sketch → Recognized Shape → (attach behaviors) → Physical Object → Play
```

Every scene object is **dumb geometry** (circle, rect, polygon, line, stroke, text, symbol…)
plus a list of **behaviors** — components in the Unity sense:

```
Circle
├── (nothing)      → it's a drawing
├── Rigid Body     → it falls, collides, has mass/friction/elasticity
├── Static Body    → immovable collider (ground, wall)
├── Motor          → drives its rotation
├── Force Field    → fx/fy expressions applied every frame
├── Electrical Node / Heat Source / Sensor → registered today, solvers per module
```

A zigzag pen stroke is recognized as a spring and gets a `spring` behavior — the user could
attach the same behavior to a plain line by hand. **The AI is only an assistant**: it returns
the same primitives + behaviors a user places manually, validated against a schema, imported
through ordinary store actions. The engine never depends on it.

## Layered architecture

```
┌───────────────────────────────────────────────────────────┐
│ UI Shell — sidebar · toolbar · transport · palette ·      │
│            inspector · AI panel                           │
├───────────────────────────────────────────────────────────┤
│ Canvas Runtime — infinite viewport, gesture FSM,          │
│                  geometry renderers, element registry     │
├───────────────────────────────────────────────────────────┤
│ Domain Engines (pure TS) — scene graph · behavior         │
│   registry · sketch recognition · formula engine ·        │
│   WORLD RUNTIME (Matter.js) · simulation bus              │
├───────────────────────────────────────────────────────────┤
│ State (Zustand) — workspace tree · page docs · history    │
├───────────────────────────────────────────────────────────┤
│ Persistence — localStorage adapter → Supabase (same shape)│
└───────────────────────────────────────────────────────────┘
```

## Core decisions and WHY

| Decision | Why |
|---|---|
| One `SceneObject` = geometry + behaviors | No special cases, ever. A note, a sketch and a motorized wheel differ only in data. New domains (thermal, optics) add behavior types + solvers — the editor core never changes. |
| **Play mode simulates the scene as drawn** (Unity model) | Edit → Play → Pause → Step → Reset. `buildWorld()` compiles the page into ONE Matter.js world; nothing is regenerated from templates. Reset discards the runtime; the edited scene was never mutated. |
| Constraints come from **spatial relationships** | A spring whose endpoint touches a mass attaches to it; a hinge pins whatever bodies it overlaps; nothing found = world anchor. Drawing the system IS wiring the system. |
| Parameters are expressions, **compiled once, evaluated every frame** | `k`, motor speed, force fields and gravity `g` re-read the page scope each tick — editing a variable bends a *running* experiment. `compileExpr` caches the parse so 120 Hz stays cheap. |
| Physics writes transforms **straight to the DOM** | ObjectViews register their wrapper element; the runtime sets `transform` at display rate. React renders nothing at 60 Hz; graphs read ring buffers at ≤12 Hz. |
| Matter.js (+ poly-decomp) as rigid-body backend | Contact-rich scenes (stacks, wheels, linkages, concave collision meshes from sketches) are exactly what it does well. It hides behind `buildWorld`; a different solver (or a worker) swaps in without touching the editor. |
| Sketch recognition upgrades **geometry only** | A wrong guess costs nothing — meaning still comes from behaviors the user attaches. Recognition is a convenience, not a gate. |
| AI returns Simulation JSON of primitives+behaviors | Same contract as manual building; zod-validated; imported via undoable store actions. Assistant, never dependency. |
| Component palette = factory presets | A "Mass" is a circle with a rigidBody attached — nothing the user couldn't draw. Electrical/electronics/digital symbols are placeable and editable today; their solvers plug in as modules. |

## Data flow (one Play frame)

```
rAF ─ accumulator ─▶ evaluate live exprs (g, k, motor, forces) against page scope
                  ─▶ Matter.Engine.update (fixed 120 Hz steps)
                  ─▶ element registry: write body transforms to DOM
                  ─▶ simulation bus: push {x, y, vx, vy, angle, ω, KE} per body
graphs (≤12 Hz) ◀── ring buffers                    transport clock (≤6 Hz) ◀──
```

## Extension path

A new domain module ships: behavior specs (`lib/behaviors`), a solver keyed off those behaviors
(like `lib/physics/world.ts`), palette entries, optional symbol glyphs. The scene graph, canvas,
inspector, undo, persistence and AI contract already handle it.
