# Subject labs (Step Lab engines), Block Simulator and animated diagrams

Three additions that let the computer-engineering syllabus be taught by *running* things, using the existing object model (geometry + behaviors + parameters), SimScript and the course pipeline. Nothing here has a special-case in the canvas, the AI or the course reader beyond being one more registered kind.

Engine list (generated, always current): [steplab-engines.md](steplab-engines.md) · syllabus coverage: [curriculum/computer.md](curriculum/computer.md) · adding another engineering field: [curriculum/README.md](curriculum/README.md).

## 0. Packages: labs belong to subjects, not to one big widget

There is no "Step Lab" component in the palette. Every engine is its own component (`lab-<engine>`, e.g. *Page replacement*, *DFA*, *Subnetting*) filed under the **subject package** that ships it. A package is what a course ships with and what a user enables in Settings → Packages, so a field of science is added by adding packages, never by growing a shared catalogue.

| Piece | Where |
|---|---|
| Package list (id, name, colour, courses) and which engine group each belongs to | `lib/steplab/packages.ts` |
| Engines of one package | `enginesOfPackage(id)` in `lib/steplab/registry.ts` |
| Palette components, one per engine | `labComponents()` in `lib/scene/factory.ts` |
| Package cards (toggle, featured parts, `courses`) | `lib/packages/registry.ts` (generated from the list above) |

Current packages: Operating Systems, Architecture, Data Communication, Networks, Theory of Computation, Numerical Methods, Statistics & Data, Simulation, Artificial Intelligence, Graphics, Databases, Control Systems — plus the existing Digital and DSA packages, which gain their engines (number systems and K-maps; sorting, trees and graphs). Disabling a package hides its components from the palette and the Ctrl+K search. A card's topic picker only switches between engines **of the same package**.

To add a field (e.g. civil): add its packages to `LAB_PACKAGES`, map its engine groups in `GROUP_PACKAGE`, write the engines; palette, settings and AI catalogue follow. The one shared piece is the renderer (`components/objects/steplab.tsx`, geometry kind `steplab`), which draws any engine's frames and knows no subject.

## 1. The engine contract

A large part of the syllabus is an *algorithm acting on state*: a scheduler filling a Gantt chart, a cache choosing a victim, a DFA reading a string. A widget per topic would be ~70 widgets. Instead:

```
params (strings on the object)  →  engine.run(params)  →  Trace  →  renderer
```

- **Engine** (`lib/steplab/engines/*.ts`): a *pure* function `run(params) → Trace`. No React, no store, no DOM.
- **Trace** = `{ w, h, frames[], summary }`. A frame is `{ draw: Prim[], note }`; a primitive is `rect | text | line | circle | poly` with a design-system tone (`idle blue mint amber rose violet dim`). `summary` holds the named results (`avgWT: "4.33"`).
- **Renderer** (`components/objects/steplab.tsx`): draws the current frame, plays/steps/scrubs (←/→/space), shows the note as a caption, shows the summary as result chips on the last frame, and has a settings drawer (engine picker + per-engine parameters with hints) plus a `?` help panel. It knows nothing about any algorithm.
- **Registry** (`lib/steplab/registry.ts`): `ENGINES`, `getEngine`, `runEngine(params)`. `runEngine` fills defaults, honours `optional` empties and **never throws** — a bad input becomes a sentence for the student.

Because engines are pure, the **lesson lint gate runs every figure headless** and checks that the numbers a lesson quotes equal the numbers the engine produces (`expect`), exactly as it checks meter readings on circuits.

### Direct manipulation

The card is operated on its face; Properties is only the full list.

| Mechanism | Where | Example |
|---|---|---|
| **Click a primitive** — `act(prim, { do: … })` in `lib/steplab/draw.ts`; interpreted by `lib/steplab/act.ts` | engines | K-map cell: 0 → 1 → X; Hamming/CRC bit: put the error here; line-code/modulation bit: flip it; search maze square: wall on/off; automaton input tape, 8085 program listing, number-systems value: click and type in place |
| `edit` on a long parameter | any | opens a code box over the picture (Ctrl+Enter runs, Esc cancels) — programs, specs, grammars, matrices |
| **Title handle** — `PRIMARY` in `lib/steplab/quick.ts` | every engine | click the picture's title to edit its main input |
| **On-face controls** — `QUICK` in `lib/steplab/quick.ts` | every engine | dropdowns, sliders (`[name, min, max, step]`), small text boxes and ✎ buttons for long inputs |

Acts: `edit`, `cycle`, `toggle` (list membership, optional third state), `step`, `set` (put it here / click again to clear), `char` (flip one character of a text or grid parameter). A test checks every act, quick control and title handle names a real parameter of its engine.

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
