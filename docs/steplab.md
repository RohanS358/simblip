# Step Lab, Block Simulator and animated diagrams

Three additions that let the computer-engineering syllabus be taught by *running* things, using the existing object model (geometry + behaviors + parameters), SimScript and the course pipeline. Nothing here has a special-case in the canvas, the AI or the course reader beyond being one more registered kind.

Engine list (generated, always current): [steplab-engines.md](steplab-engines.md) · syllabus coverage: [curriculum/computer.md](curriculum/computer.md) · adding another engineering field: [curriculum/README.md](curriculum/README.md).

## 1. Step Lab — one widget, many algorithms

A large part of the syllabus is an *algorithm acting on state*: a scheduler filling a Gantt chart, a cache choosing a victim, a DFA reading a string. A widget per topic would be ~70 widgets. Instead:

```
params (strings on the object)  →  engine.run(params)  →  Trace  →  renderer
```

- **Engine** (`lib/steplab/engines/*.ts`): a *pure* function `run(params) → Trace`. No React, no store, no DOM.
- **Trace** = `{ w, h, frames[], summary }`. A frame is `{ draw: Prim[], note }`; a primitive is `rect | text | line | circle | poly` with a design-system tone (`idle blue mint amber rose violet dim`). `summary` holds the named results (`avgWT: "4.33"`).
- **Renderer** (`components/objects/steplab.tsx`): draws the current frame, plays/steps/scrubs (←/→/space), shows the note as a caption, shows the summary as result chips on the last frame, and has a settings drawer (engine picker + per-engine parameters with hints) plus a `?` help panel. It knows nothing about any algorithm.
- **Registry** (`lib/steplab/registry.ts`): `ENGINES`, `getEngine`, `runEngine(params)`. `runEngine` fills defaults, honours `optional` empties and **never throws** — a bad input becomes a sentence for the student.

Because engines are pure, the **lesson lint gate runs every figure headless** and checks that the numbers a lesson quotes equal the numbers the engine produces (`expect`), exactly as it checks meter readings on circuits.

### Adding an engine (≈ 40 lines)

1. Add `{ id, label, group, blurb, params: ParamDef[], run }` to a file in `lib/steplab/engines/` (helpers in `lib/steplab/draw.ts`: `box cells arrow dot poly bits layoutBinary drawTree makePlot framesFrom trace`; parsing in `types.ts`: `pnum pstr plist pnums prows`).
2. **Parameter names must not be SimScript reserved props** (`x y z width height name rotation dir fill stroke opacity radius color align locked hidden`) — the kit throws if they are.
3. Add a textbook-value test to `lib/steplab/steplab.test.mjs`.
4. `node scripts/build-engine-docs.mjs` (docs) and `node scripts/build-curriculum.mjs` (the matrix fails if a row names an engine that does not exist).
5. The AI sees it automatically: the prompt's engine card is generated from the registry (`stepLabCard()` in `lib/ai/simscript-corpus.ts`).

### SimScript

```javascript
var lab = create("steplab", { engine: "sched", algo: "rr", quantum: 2,
                              procs: "P1,0,5;P2,1,3;P3,2,8", width: 600, height: 440 });
```
Every non-reserved prop becomes a string parameter; `engine` selects the function. Params live on the object, so the student can edit them in the card, the inspector (Lab section: topic, parameters, results) or by script.

## 2. Block simulator (`engine: "blocks"`)

Simulink-style continuous-system blocks using the same drawing model: `const step ramp sine pulse gain sum mult integrator tf pid delay sat scope`. RK4 integration, algebraic-loop detection, and overshoot / settling-time / steady-state readouts in the summary. Used for feedback control, the analog-computer view of ODEs and simulation & modelling.

## 3. Diagram v2 — sequence, UML, stores, animation

`diagram(source)` (see [../simscript-component-reference.md](../simscript-component-reference.md)) gained:

| Feature | Syntax |
|---|---|
| Sequence mode | `mode: sequence` then `[Client] as c`, `c -> s : GET /`, `s --> c : 200`, self-message `s -> s : render` |
| UML class box | `{Order \| id : int ; total : money \| pay() ; cancel()}` — name \| attributes \| methods, `;` separates lines |
| Data store | `[\|Orders DB\|]` |
| Animation | `@1.5+0.8 c -> s : SYN` — a token travels that arrow at t = 1.5 s for 0.8 s and the arrow lights up |
| Looping | `loop 12` — restart every 12 s (0 = play once). A sequence with no `@` lines plays its messages one after another |

Animation is a `flow` **behavior**: a pure function of the run clock (`lib/physics/flow.ts`: `timelineTime`, `activeToken`, `isLit`, `pointAlong`), synced to the DOM each frame by `syncFlow` from `lib/physics/world.ts`. Stepping back (`stepBack`) and stopping reset it, so it is scrubbable like any simulation. Tokens and lit windows are stored in the connector's `metadata.flow*` so a saved page replays identically.

## 4. The course pipeline

Lessons are authored offline and lint-gated; runtime never generates them.

```
content/courses-src/<course>/course.mjs + NN-lesson.mjs   (kit: lab() dia() cpp() scr() q() pr() step() sec())
      │  node scripts/build-courses.mjs [course-id …]
      ▼
content/courses/<course>/*.json  (CourseDoc)  →  lint-course.mjs  →  publish-course.mjs
```

The kit's `lab()` runs the engine at build time, pins its summary with `expect`, and prose reads its numbers from `run()` — a quoted result cannot drift from the figure. `content/courses-src/fin.mjs` does the same for engineering-economics arithmetic.

## 5. What the DSA Lab interpreter can and cannot run

The C++ interpreter (`lib/dsa`) is a teaching subset. It runs structs/classes with methods and constructors, references, pointers, `new`/`delete`, arrays, recursion and the STL containers. It does **not** implement inheritance, virtual functions, templates, operator overloading, destructors, `scanf`, `FILE*`, or faithful overload resolution / default arguments, and `printf` supports only simple `%d`/`%s`. Lessons on those topics use UML and sequence diagrams instead and never pin output the interpreter cannot produce correctly.

## 6. Existing components this builds on

| Area | Where | How it works |
|---|---|---|
| Mechanics, fields, optics, waves, quantum | `lib/physics`, `lib/optics`, `lib/waves`, `lib/quantum` | [physics-engine.md](physics-engine.md) — objects + behaviors compiled into one SI world, 120 Hz loop |
| Circuits (analog, digital) | `lib/circuit` | Modified nodal analysis, BDF2 transients, logic solver for gates/flip-flops/counters |
| Graphs | `lib/…/graph` | [graph-engine.md](graph-engine.md) — ring-buffer bus, any channel |
| Formulas | `lib/formula` | [formula-engine.md](formula-engine.md) — every numeric parameter takes an expression |
| DSA Lab | `lib/dsa` | C++-subset interpreter with step trace and data-structure views |
| Cash flow | `lib/econ` | PW/FW/AW/IRR/B-C from a cash-flow spec |
| Tables / charts / truth tables / text | `components/objects` | Excel-style formulas, bar/line/pie, truth-table generator |
| Walkthroughs / courses | `lib/walkthrough`, `lib/store/course.ts` | [course-mode.md](course-mode.md) |
