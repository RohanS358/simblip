# SIMBLIP — Physics Engine

## Philosophy

The engine is a **digital laboratory**: the user constructs the physical system out of drawn
primitives, attaches behaviors, and presses Play. The exact scene starts simulating — nothing
is templated or regenerated.

## The world runtime (`lib/physics/world.ts`)

`buildWorld(pageId)` compiles the page into one Matter.js world:

| Scene | World |
|---|---|
| circle/rect + `rigidBody` | dynamic body (mass, friction, restitution, v₀, ω₀) |
| any shape + `staticBody` | immovable collider |
| polygon/stroke + body behavior | **collision mesh** via poly-decomp (concave OK) |
| line + `rigidBody` | thin beam |
| line + `spring/rope/rod/damper` | constraint attached to whatever each endpoint touches |
| circle + `hinge` | revolute joint pinning the bodies it overlaps (or one body ↔ world) |
| `motor` on a body | angular velocity driven each frame |
| `force` on a body | fx/fy expressions applied each frame |

**Constraints from spatial relationships** is the load-bearing UX decision: dragging a spring
so its end touches a mass *is* the connection. No wiring dialog, no ports (explicit anchors can
come later for precision work).

## Loop & determinism

- Fixed timestep 120 Hz with an accumulator under one rAF; display rate never changes physics.
- Play/Pause/Step(2 sub-steps)/Reset — Unity transport semantics.
- Reset discards the runtime wholesale. The document store was never touched during Play, so
  the scene returns exactly as edited (transforms were DOM-only overrides).

## Live expressions

Behavior params are **compiled once at Play** (`compileExpr`) and evaluated **every frame**
against the page scope plus `t`:

- gravity: page variable `g` (m/s², Earth default), so `g = 1.62` mid-run moves the lab to the Moon
- spring `k` → constraint stiffness via `k/(k+400)` (Matter's 0–1 stiffness; documented approximation)
- motor `speed`, force `fx/fy` — can reference `t` for driven/forced systems

## Units

`PPM = 100` (100 px = 1 m). The bus reports SI: x, y (m, y up), vx, vy, speed (m/s),
angle (rad), ω (rad/s), KE (J). Velocity conversion accounts for Matter's px-per-frame velocity.

## DOM sync, not React

ObjectViews register their wrapper elements; the runtime writes `transform` (delta translate +
delta rotate — edit rotation lives on an inner div so the two never conflict) and rewrites
connector SVG paths (`path[data-connector]`) directly. On Reset those attributes are restored
from the document state. React is out of the 60 Hz path entirely.

## Roadmap

- Explicit connection anchors/ports; gear constraints; pulleys with rope-over-wheel
- Worker-side stepping behind the same `buildWorld` contract
- Electrical module: MNA solver keyed off `electricalNode` behaviors on symbols
- Digital: event-driven propagation; Thermal/Optics: field solvers — all as behavior + solver pairs
