# SIMBLIP — Component Guide

## Shell

- **`WorkspaceShell`** — composes sidebar, canvas, transport, toolbar, palette, inspector,
  AI panel around one active page. Tears down the running world on page switch.
- **`Transport`** — Unity-style Play/Pause/Step/Reset + sim clock, top-center. The product's
  heartbeat; glows mint while a world is live.
- **`Toolbar`** — floating, bottom-center. Select/Pen/Circle/Rect/Line/Text/Note/Formula/Graph
  (keys V P C R L T N F G), plus palette and AI toggles. Tools are data.
- **`Palette`** — the component library (Mechanics live; Electrical/Electronics/Digital as
  editable symbols until their solvers land). A component is geometry + pre-attached behaviors;
  placement stays armed for repeated drops.
- **`Inspector`** — the conversion surface. Name, Transform, content Parameters, and the
  **Behaviors** section: add/enable/remove behaviors, edit their expression params with live
  values and errors. Variables tab edits the page scope.
- **`Sidebar`** — notebook → section → page tree, inline rename, calm hairline styling.
- **`AiPanel`** — chat; assistant may attach a Simulation JSON card. Only the explicit
  "Add to canvas" imports it — through normal undoable actions.

## Canvas

- **`InfiniteCanvas`** — viewport transform, dot grid, wheel pan / ctrl+wheel zoom-to-cursor,
  space-drag pan, marquee, move, resize, undo/redo keys. Pen strokes run through sketch
  recognition on release (circle/rect/line/spring/polygon). During Play, edit gestures lock;
  selection stays available for inspection.
- **`ObjectView`** — universal wrapper. Registers its element with the world runtime (which
  drives its transform during Play); edit rotation renders on an inner div so the two styles
  never fight.

## Object renderers (`components/objects`)

| Geometry kind | Renders |
|---|---|
| `circle`/`rect`/`polygon`/`stroke` | SVG shape; fill/stroke reflect attached behaviors (blue = rigid body, gray = static, plain = drawing). Special renders: ground hatching, hinge pin, motor spokes, orientation tick on dynamic circles |
| `line` | plain line, thick beam (if rigid), or connector path — spring zigzag / rope sag / damper piston (`lib/render/connector-path.ts`, shared with the runtime) |
| `symbol` | schematic glyph table (resistor, capacitor, gates…) + first param readout; labeled box fallback |
| `note` / `text` | editable content blocks |
| `formula` | KaTeX display, double-click to edit |
| `graph` | recharts line chart fed from the simulation bus (any body: x, y, vx, vy, speed, angle, ω, KE) |

## Conventions

- No component reads mathjs/Matter/localStorage directly — engines and stores only.
- Renderers resolve by `geometry.kind` through one registry; behavior-specific *styling* keys
  off the behavior list, never off object identity.
- shadcn primitives reused as-is; skinning happens in `globals.css` tokens.
- Every interactive element: focus ring, `aria-label`, keyboard reachable.
