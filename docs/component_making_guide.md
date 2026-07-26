# SIMBLIP — Component Making Guide

**Audience: an agent (or developer) asked to build a new component from a client requirement.**
Read this before writing any code. It explains what a "component" *is* in SIMBLIP, the four
recipes for building one, the design language it must speak, the mechanisms it must use, and
every registry that must (or must not) be touched. When in doubt, find the closest existing
component named in each section and copy its shape.

---

## 1. The spirit — what a component IS

The founding rule of the codebase (see `docs/architecture.md`):

> **The simulation engine is the product; the notebook is the environment it lives in.
> Whatever the user draws can become reality. Nothing on the canvas is special-cased.**

Every single thing on a page — a sticky note, a pen stroke, a resistor, a bouncing mass, a
C++ IDE — is the **same data structure**: a `SceneObject` =

```
GEOMETRY (dumb shape)  +  BEHAVIORS (attached meaning)  +  PARAMETERS (content)
```

- A circle is just a drawing. Attach a `rigidBody` behavior → it falls and collides in Play.
- A zigzag line with a `spring` behavior IS a spring. The user could draw the line and attach
  the behavior by hand; the palette "Spring" component only saves those clicks.
- **A palette component is nothing special — it is a factory preset**: base geometry with
  behaviors pre-attached and sizes/params pre-filled. Never build a component the user
  couldn't assemble manually from geometry + inspector.

Corollaries you must respect:

1. **Never special-case object identity.** Renderers key off `geometry.kind` (one registry);
   styling keys off the *behavior list* (`isBody()`, `connectorBehavior()`), never off "this
   is the Mass component". A `metadata.render` string may pick a *visual variant*
   (`'ground'`, `'motor'`, `'lens'`…) but never changes what the object *is*.
2. **Meaning comes from behaviors; solvers read behaviors.** A new physical capability is a
   new `BehaviorType` + a solver that consumes it — the editor core (canvas, selection,
   undo, persistence, inspector) never changes.
3. **The AI is only an assistant.** It emits the same primitives + behaviors a user places
   manually. Nothing in a component may depend on the AI; the AI tool catalog is *derived*
   from the component registry automatically (`lib/ai/tools.ts` maps over `COMPONENTS`).
4. **Constraints come from spatial relationships.** A spring attaches to whatever its
   endpoints touch; a hinge pins the bodies it overlaps; a wire joins the terminals it
   touches. Drawing the system IS wiring the system — never add explicit "connect A to B"
   data to a component.

---

## 2. The object model (memorize this)

Defined in `lib/scene/types.ts`:

```ts
interface SceneObject {
  id: string          // uid()
  name: string        // autoName('Mass') → "Mass 1", "Mass 2"…
  geometry: Geometry  // { kind, points?, symbol?, domain? }
  position: Vec2      // top-left of bbox, page coords
  size: { w; h }
  rotation: number    // degrees, edit-time only
  z: number           // Date.now() % 1e6 at creation (stacking = recency)
  behaviors: Behavior[]                    // meaning
  parameters: Record<string, ParamValue>   // content (note text, latex, spec JSON…)
  metadata: Record<string, unknown>        // render variant, ink style, colors…
}
```

- **Params are typed**: `num(expr)` / `str(value)` / `bool(value)` helpers from
  `lib/scene/types.ts`. A `NumericParam` holds a user-editable **expression** (`"5"`,
  `"m*2"`, `"density*volume"`) plus a cached `value` evaluated against the page's variable
  scope — this is how editing a variable bends a *running* simulation. Use expressions for
  anything physical/tunable; use `str` for content blobs (text, latex, JSON specs).
- **Geometry kinds** (`GeometryKind`): shape-ish (`circle rect polygon line stroke symbol`)
  all render through one `GeometryObject`; widget-ish (`text note formula graph table
  cashflow truthtable code dsa`) each get their own renderer card.
- **Behaviors** are Unity-style components: `{ id, type, enabled, params }`. Their specs
  (label, allowed geometry, param list with defaults, hint text, `live` flag) live in ONE
  table: `lib/behaviors/registry.ts` → `BEHAVIOR_SPECS`. The inspector's Add Behavior menu,
  the world builder, and the AI import path all read that table.

---

## 3. Which recipe? (decision tree)

A client request maps to exactly one of four recipes. Pick the *smallest* one that works.

| Client asks for… | Recipe | Example precedents |
|---|---|---|
| A preset of existing geometry + existing behaviors ("a pendulum bob", "a heavier wheel") | **A — palette preset** (data only, ~10 lines) | Mass, Block, Wheel, Ground, Charged Ball |
| A new *physical capability* the engines don't have ("buoyancy", "friction ramp", "diffraction grating") | **B — new behavior (+ solver hook)** | `torsionSpring`, `charge`, `efield`, `slit`, `quantumWell` |
| A new *interactive card/widget* with its own UI ("a matrix calculator", "a Gantt chart") | **C — new geometry kind + renderer** | Formula, Graph, Table, Cash Flow, Truth Table, DSA Lab |
| A new *circuit part* ("a relay", "a 555 timer") | **D — new symbol** | resistor, op-amp, D flip-flop, 7-seg display |

Hybrids exist (Electric Motor = symbol + hinge behavior; Truth Table = widget that *reads*
the circuit) — compose recipes, don't invent a fifth.

---

## 4. Recipe A — palette preset (geometry + existing behaviors)

**The default answer.** Touch ONE file: `lib/scene/factory.ts`.

Add an entry to the `COMPONENTS` array using the domain helper (`mech`, `optic`, `wave`,
`quantum`, `econ`) or a plain `ComponentDef` object:

```ts
mech('pendulum-bob', 'Pendulum Bob', (p) => {
  const o = baseObject('circle', p, autoName('Bob'))
  o.size = { w: 50, h: 50 }
  const rb = createBehavior('rigidBody')
  rb.params.mass = num('2')            // override a default param
  return withBehaviors(o, rb)
}),
```

Rules learned from the existing entries:

- `baseObject(kind, position, autoName(label))` then set `size`, `geometry.points` (for
  lines: `[[0,0],[len,0]]` and `size {w: len, h: 2}`), params, metadata.
- `metadata.render = '<variant>'` **only** if `geometry.tsx` already has (or you add) that
  visual variant (`ground`, `hinge`, `motor`, `spring`, `rope`, `damper`, `field`, `charge`,
  `lens`, `mirror`, `slit`, `reference-point`, `system`, …).
- Multiple behaviors compose: `withBehaviors(o, createBehavior('rigidBody'), createBehavior('motor'))`.
- Tiny "marker" components (hinge 22×22, light source 24×24) stay tiny; region components
  (fields 260×180) stay large. Match the physical metaphor.

**Everything downstream is automatic.** The palette panel, Ctrl+K command search, the
canvas "/" menu (`lib/scene/insertables.ts` maps over `COMPONENTS`), the local-AI tool
catalog (`lib/ai/tools.ts`), undo, persistence, and clone-on-share all pick the new entry
up with zero extra edits. This is the whole point of the registry design — if you find
yourself editing the palette UI to add a component, you are doing it wrong.

---

## 5. Recipe B — new behavior (new physical meaning)

Adding a domain capability = **rows in a table + a solver that reads them**. The editor
never changes. Steps, in order:

1. **Type** — add the name to the `BehaviorType` union in `lib/scene/types.ts` with a
   one-line comment saying what geometry it rides and what it does (follow the existing
   comment style there — every type has one).
2. **Spec** — add a `BehaviorSpec` row to `BEHAVIOR_SPECS` in `lib/behaviors/registry.ts`:
   - `geometry`: which kinds it can attach to (`['rect']`, `CONNECTOR`, `BODYLIKE`, or `[]`
     for any). The inspector's Add Behavior menu filters on this.
   - `params`: name + human label **with units** + default *expression*. Defaults should be
     the canonical textbook case (the slit defaults to the classic d=40µm/a=12µm double
     slit; the wave boundary defaults to air→glass εr2=4). Clients are students — defaults
     must demo something meaningful with zero edits.
   - `hint`: one teaching sentence shown in the menu. Look at `slit`/`quantumWell` hints —
     they state the physics AND the scale convention.
   - `live: true` only when a solver actually consumes it.
   The AI zod schema derives its behavior enum from this table (`BEHAVIOR_TYPES`) — do not
   duplicate the list anywhere.
3. **Solver** — make an engine consume it. Existing engine styles, pick the matching one:
   - **Time-stepping bodies/constraints** → `lib/physics/world.ts` `buildWorld()` compiles
     the page into one Matter.js world; behaviors become bodies, constraints, per-frame
     forces. Params are compiled once (`compileExpr`) and evaluated against the page scope
     every frame.
   - **Reactive pure-function tracer** (no clock) → optics: `lib/optics/engine.ts`
     `traceRays(pageObjects)` re-runs whenever anything moves; the light-source renderer
     draws the result. Zero state, zero teardown.
   - **Closed-form formula objects** → waves (`lib/waves/engine.ts`), quantum
     (`lib/quantum/engine.ts`): the renderer evaluates formulas from behavior params and
     draws a plot inline. Animation, if any, reads the shared runtime clock
     (`useRuntimeStore(s => s.time)`) and freezes outside Play.
   - **Network solver** → circuits: `lib/circuit/engine.ts` (MNA + logic pass), keyed off
     `electricalNode`/`wire` behaviors and terminal touching.
4. **Render styling** — if the behavior changes how geometry should *look*, key it off the
   behavior list inside `components/objects/geometry.tsx` (like `hasHeat`, `bareInk`,
   `connectorBehavior`) or add a `metadata.render` variant. Never a new geometry kind for a
   look.
5. **Palette preset(s)** — Recipe A entries so users can drop it pre-attached.
6. **Channels (optional)** — if the thing produces measurable output the Graph should plot,
   register its channels in `lib/scene/channels.ts` (`channelsFor`) and push samples on the
   simulation bus like `world.ts sample()` does.

---

## 6. Recipe C — new widget (new geometry kind with its own renderer)

For interactive cards: Formula, Graph, Table, Cash Flow, Truth Table, Code, DSA Lab. This
is the most expensive recipe — confirm Recipes A/B can't express the requirement first.

### Files to touch (the complete checklist)

| # | File | Edit |
|---|---|---|
| 1 | `lib/scene/types.ts` | add `'mywidget'` to `GeometryKind` with a `// comment` |
| 2 | `components/objects/mywidget.tsx` | the renderer (see contract below) |
| 3 | `components/objects/index.tsx` | register in `OBJECT_RENDERERS` — the canvas never switches on kinds; this registry is the only wiring |
| 4 | `lib/scene/factory.ts` | `createGeometry()` case: default `size` + default `parameters` (and `COMPONENTS` entry if it belongs to a domain palette, like `cashflow`/`truth-table`/`dsa-lab` do) |
| 5 | `lib/scene/insertables.ts` | a `widget(...)` row with generous search `keywords` — this alone puts it in Ctrl+K **and** the canvas "/" menu |
| 6 | `components/workspace/canvas.tsx` | add the kind to `COMPONENT_UI_KINDS` if the card has text/buttons/tables that should follow the user's "Components UI scale" preference (every widget so far does) |
| 7 | `components/workspace/inspector.tsx` | *only if* it needs a custom options section (like `GraphOptions`/`CashflowOptions`); also add the kind to the exclusion list around `BehaviorsSection` if behaviors make no sense on it. Plain numeric params surface automatically in the Parameters section — string params do NOT (they're content, edited in-card) |
| 8 | Engine logic | any real computation goes in `lib/<domain>/…` as pure TS — **never** inside the component |

If SimScript should be able to `create()` it, also check `lib/scene/simscript.ts` kind
handling and document it in `simscript-component-reference.md`.

### The renderer contract

Every renderer is `ComponentType<ObjectRendererProps>` (`components/objects/types.ts`):

```ts
{ pageId: string; object: SceneObject; selected?: boolean }
```

Hard rules, all visible in `formula.tsx` / `truth-table.tsx` / `note.tsx` — the three best
templates (simple / page-reading / trivial respectively):

- `'use client'`, and open with a 2–5 line comment explaining what the card does and where
  its engine lives. Every existing renderer does this; match the voice.
- **Fill the wrapper**: root is `h-full w-full` — `ObjectView` owns position/size/rotation/
  z-index and registers the outer element with the physics runtime. You never read or write
  transforms.
- **Card look** (see §8): `rounded-xl bg-card/70 hairline` (or `bg-card/60`), optional
  header row `border-b border-border/60 px-3 py-1.5` with a lucide icon at `h-3.5 w-3.5
  text-muted-foreground` and the object name at `text-[11.5px] font-semibold`.
- **Read content** via the `getString`/`getNumber` helpers from `./types`; **write** via
  store actions only: `useDocStore(s => s.setStringParam)` etc. Call
  `pushHistory(pageId)` **before** a user-initiated mutation (one history entry per
  gesture, not per keystroke — formula pushes on entering edit mode, not on each char).
- **Stop gesture bleed-through**: any interactive area calls
  `onPointerDown={(e) => e.stopPropagation()}` — otherwise clicking a button drags the
  object. Inputs also `e.stopPropagation()` in `onKeyDown` so canvas shortcuts (V/P/space/
  delete) don't fire while typing. `Enter`/`Escape` exit editing.
- **`selected` gates secondary chrome**: floating action bars (formula's calculus bar
  hovers at `-top-11` in a `glass-strong` pill), hint lines
  (`text-[10.5px] text-muted-foreground`, e.g. "double-click to edit"). Unselected, the
  card is calm content only.
- **Empty state teaches**: a fresh drop must be usable/instructive immediately without the
  inspector — truth-table shows quick-pick chips or "Build a digital circuit with Input and
  Output components…"; formula shows how to write a solvable expression. Never render an
  empty box.
- **Reading the page**: subscribe narrowly —
  `useDocStore(s => s.pages[pageId]?.objects)` + `useMemo` for derived computation (truth
  table re-simulates when the circuit changes). For run-time data use the ring-buffer bus
  (`readBuffer`) at low Hz like `graph.tsx`, never per-frame React state.
- **Accessibility**: every interactive element gets `aria-label` (or visible text),
  `aria-pressed` on toggles, keyboard reachability. This is a stated convention in
  `docs/components.md`.
- **Never**: `localStorage`, Matter.js, mathjs, or fetch directly in a component — engines
  and stores only. No `window` at module top-level (SSR).

---

## 7. Recipe D — new circuit symbol

Symbols are ONE geometry kind (`symbol`) with `geometry.symbol = '<name>'` and
`geometry.domain`, an `electricalNode` behavior, and a default box of **96×48**.

1. **Factory row** — most symbols are one line in the big tuple array in
   `lib/scene/factory.ts`: `['electronics', 'relay', 'Relay', { coilR: '100' }]`. Params
   here become live numeric parameters (inspector-editable expressions).
2. **Glyph** — add SVG to the `GLYPHS` record in `components/objects/geometry.tsx`, drawn
   in the 96×48 box. House style: *"recognizable beats ornate"* — 2px strokes,
   `currentColor`, IEEE/IEC textbook shapes. Unknown symbols fall back to a labeled box, so
   the component works before the glyph exists.
3. **Terminals** — `terminalsOf()` in `lib/circuit/engine.ts` defines pin positions
   (fractions of the box). Wires bond to terminals within `SNAP` (14px): if a symbol packs
   ≥4 pins on one edge, give it a taller default via `TALL_SYMBOLS` in `factory.ts`
   (see the seven-seg comment there for the arithmetic).
4. **Solver stamp** — teach `lib/circuit/engine.ts` the device's MNA stamp (analog) or its
   logic function (digital pass).
5. **Channels** — if it has readings worth graphing, add a `BY_SYMBOL` entry in
   `lib/scene/channels.ts` (`probe: ['V']`, `dc-machine: ['V','I','P','omega','torque']`).
6. **Model options** — configurable structure (mux width, flip-flop model) goes through the
   inspector's Model dropdown maps (`inspector.tsx`), stored in the structural `inputs`
   param (excluded from the generic Parameters list).
7. **Physics coupling** — if it must exist in the mechanical world too, attach an extra
   behavior in its factory entry (pressure plate adds `staticBody`; electric motor adds
   `hinge`) and handle it in `lib/physics/world.ts` (see `makeBody`'s symbol case and
   `syncElectricMotors`).
8. **SimScript** — document the kind + params + anchors in
   `simscript-component-reference.md` so the AI corpus and users can script it.

---

## 9. Interactive Control Tools, Grid Tables, Fullscreen & Package Architecture

### Interactive Control Tools (`slider`, `button`, `trigger`)
- Exclusively hosted in the sidebar **Tools** panel under *Interactive Controls*.
- **Slider (`slider`)**: Dynamically binds to any component property or page variable with real-time value updates.
- **Button (`button`)**: Triggers set, toggle, or step actions on click.
- **Trigger (`trigger`)**: Monitors a target property or variable using condition operators (`==`, `>`, `<`, `>=`, `<=`, `!=`) and threshold values, executing target actions when triggered.

### Grid Table vs. Formula Table
- **Formula Table (`table`)**: Retained in the sidebar Tools panel for Excel-style live formula evaluations (`name=expr`), summary metrics (Avg, Sum, etc.), and data row operations.
- **Grid Table (`gridtable`)**: Accessible via the dock toolbar. Features a transparent Canva/MS Word style cell grid with direct inline editing, row/column addition/removal controls, and drag-to-resize column width handles.

### Fullscreen Viewport Expansion & Resizable Sections
- **Fullscreen Expansion**: Expandable widgets (`table`, `gridtable`, `dsa`, `code`, `cashflow`, `graph`, `truthtable`, and system enclosures) include an **Expand to Fullscreen** button on selection. Activating fills the entire canvas viewport with the component while leaving topbar, sidebar, and dock UI visible.
- **Internal Section Resizing**: Components with split panels (such as DSA Lab code/visualization splitters and Grid Table columns) incorporate interactive drag handles for custom panel width allocation.

### Subject Component Package System
- Subject components are organized into 9 domain packages: `mechanics`, `electrical`, `electronics`, `digital`, `optics`, `waves`, `quantum`, `economics`, `dsa`.
- Registered in `lib/packages/registry.ts` and managed in **Settings → Packages**.
- Toggling a package filters component availability across the sidebar component panel, search, palette, and dock.

---

## 10. Design language (non-negotiable)

Source of truth: `docs/design-system.md`. Direction: **"Apple designed MATLAB for
engineering students"** — precision instruments floating over calm paper.

- **Tokens only.** Colors are CSS variables: `var(--card)`, `var(--border)`,
  `var(--foreground)`, `var(--muted-foreground)`, `var(--ring)`, accents
  `--accent-blue|violet|mint|amber|rose`, chart series `--chart-1…5`. Never hex, never pure
  black/white. Tinting = `color-mix(in oklch, var(--accent-…) 18%, var(--card))` (see note
  fills, `bodyFill`). This is also what makes dark mode free.
- **Accent semantics**: blue = selection/primary/dynamic bodies · mint = simulation/running/
  logic-high · amber = variables/values · violet = AI · rose = errors/destructive. Gray =
  static/inactive. Chrome recedes; only *state* gets color.
- **Surfaces**: cards are `bg-card/60–70` + `.hairline`; floating chrome is `.glass` /
  `.glass-strong`; radius `rounded-xl` for cards, `rounded-md/lg` for controls; one soft
  shadow max. Never fork a shadcn primitive to restyle it — reuse `components/ui/*` as-is.
- **Type scale** (px): 10 micro-mono readouts · 10.5 hints · 11–11.5 labels/headers ·
  12–12.5 UI text · 13–13.5 content. Mono (`font-mono`, JetBrains) for code, expressions,
  numbers — with `tabular-nums` for live values. Section headers:
  `text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground`.
- **Motion**: micro-interactions ≤200ms, springs `{stiffness: 380, damping: 30}` on panels.
  **Nothing on the canvas itself animates except the simulation** — animation must never
  compete with physics for perceived motion. Continuous canvas animation is allowed only
  when driven by the runtime clock and frozen outside Play (wave source precedent).
- **Focus**: custom 2px accent ring offset 2 — never default outlines, never missing.

---

## 9. Mechanism rules (how components live in the notebook)

- **State**: everything goes through the Zustand doc store (`lib/store/document.ts`):
  `addObject`, `updateObject`, `setStringParam`, `setParam`, `pushHistory`, `setSelection`.
  This is what makes every component automatically undoable, persistable, syncable,
  clonable, and AI-importable. Bypass it and you break all five at once.
- **Play mode**: `buildWorld()` compiles the page into one Matter world; Reset discards the
  runtime — the edited scene is never mutated. The runtime writes transforms straight to
  registered DOM elements at display rate; React renders nothing at 60Hz. Components read
  run-time data only via `useRuntimeStore` (mode, clock) or ring buffers at ≤12Hz.
- **Expressions everywhere**: numeric behavior/content params re-evaluate against the page
  scope live. When adding params, always store the *expression* and let the store cache the
  value; never store a bare number that severs the variable link.
- **Insertion flows** you inherit for free once registered: palette panel, Ctrl+K command
  palette, canvas "/" menu, drag-drop placement (stays armed for repeated drops), sketch
  recognition inside System regions, AI tool calls, SimScript `create()`.
- **Sketch recognition upgrades geometry only** — never attach behaviors in
  `fromRecognition()` or any recognition path. A wrong guess must cost nothing.
- **Scale conventions**: mechanics 1000 px = 1 m (`PPM`, SI units on the bus); optics
  1 px = 1 µm (stated in behavior hints). State the convention in the behavior `hint` if
  you introduce one.

---

## 10. Pitfalls (each one has bitten this codebase before)

- Forgetting `stopPropagation` on pointer/key events → buttons drag the card, typing
  triggers canvas shortcuts.
- Adding a widget kind but skipping `COMPONENT_UI_KINDS` (canvas.tsx) → card text ignores
  the user's Components-UI-scale preference.
- Multi-pin symbols at default 48px height → pins land inside the wire SNAP radius and
  wires bond to the wrong pin (`TALL_SYMBOLS`).
- Numeric params named `inputs` → collides with the structural Model param the inspector
  excludes; pick another name.
- Styling off object identity ("if name === 'Mass'") instead of behaviors — breaks the
  draw-then-convert path, which must always produce an identical result to the palette.
- Duplicating a registry-derived list (behavior enum, component catalog, channels) instead
  of deriving — the AI schema and search *must* never drift from the registries.
- Per-frame `setState` from simulation data — use the bus/ring buffers; React is not the
  frame loop.
- Heavy per-keystroke history: push once per gesture/edit session.
- `create("graph")` vs `graph.plot()` in SimScript use different param schemas — check
  `simscript-component-reference.md` before touching graph params.

---

## 11. Quick file map

| Concern | File |
|---|---|
| Object model, param helpers (`num/str/bool`, `uid`) | `lib/scene/types.ts` |
| Behavior specs table + `createBehavior`, `isBody`, `specsForGeometry` | `lib/behaviors/registry.ts` |
| Factories: `baseObject`, `createGeometry`, `COMPONENTS` palette, systems | `lib/scene/factory.ts` |
| Insertables (Ctrl+K + "/" menu), `insertAt` | `lib/scene/insertables.ts` |
| Kind → renderer registry | `components/objects/index.tsx` |
| Renderer props + `getString`/`getNumber` | `components/objects/types.ts` |
| Shape/symbol/connector rendering, `GLYPHS`, behavior styling | `components/objects/geometry.tsx` |
| Widget renderer templates (simple → complex) | `note.tsx` → `formula.tsx` → `truth-table.tsx` → `graph.tsx` |
| Canvas wrapper (`ObjectView`), `COMPONENT_UI_KINDS` | `components/workspace/canvas.tsx` |
| Inspector: params, behaviors section, model dropdowns, per-kind options | `components/workspace/inspector.tsx` |
| Physics runtime (`buildWorld`, element registry, bus) | `lib/physics/world.ts` |
| Circuit solver, `terminalsOf`, SNAP | `lib/circuit/engine.ts` |
| Graphable channels per object | `lib/scene/channels.ts` |
| Doc store (objects, history, selection, viewports) | `lib/store/document.ts` |
| AI tool catalog (derived from `COMPONENTS`) | `lib/ai/tools.ts` |
| SimScript `create()` kinds + anchors reference | `simscript-component-reference.md` |
| Architecture & why | `docs/architecture.md` · design: `docs/design-system.md` · shell: `docs/components.md` |
