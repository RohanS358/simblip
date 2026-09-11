# SimScript Component Reference

Full reference for every `create()` kind, its defaults, and its anchors. Code + description only.

---

## `create(kind, props)` — universal rules

```javascript
var obj = create("resistor", { R: 330, x: 0, y: 0 });
```

- `kind` is case-insensitive.
- `x`/`y` are relative to script origin. **Only non-zero `x` or `y` counts as "explicit position"** — `{x:0,y:0}` or omitted still lets the auto-layout engine reposition the object once it's wired via `connect()`.
- `rotation` (degrees) or `dir: "up"|"down"|"left"` (→ -90/90/180; anything else/omitted = 0). **Optics, waves, and quantum kinds ignore rotation/dir entirely — always 0.**
- Any prop that is not positional (`x, y, width, height, rotation, dir, name, z`) and not one of the **styling props** below becomes a **live parameter** on circuit-symbol kinds (electrical values like `R`, `V`, `beta`...). So `create("resistor", { R: 330, fill: "#f00" })` sets a resistance *and* a fill, with no collision.
- Returns a Proxy-wrapped handle: **any property you access on it that isn't a reserved name (`id`, `pageId`, `set`, `vx`,`vy`,`ax`,`ay`,`V`,`I`,`P`,`omega`,`angle`,`x`,`y`,`ke`,`pe`,`speed`) becomes an anchor descriptor**, e.g. `q1.base`, `myThing.whateverName`.

```javascript
obj.set({ R: 470 });          // updates a circuit parameter
obj.set({ x: 300, y: 150 });  // repositions
obj.set({ mass: 20 });        // behavior params route automatically: any key an attached
                              // behavior declares (mass, friction, restitution, vx, vy,
                              // stiffness, q, f, Ex, Bz…) is written into THAT behavior,
                              // the one the solver actually reads.
```

```javascript
addproperty(obj, "rigidBody");                 // attach a behavior; mass defaults to 1
addproperty(obj, "rigidBody", { mass: 5 });    // optional third arg sets behavior params
```

```javascript
connect(a.anchorName, b.anchorName, "wire"); // wire/rope/rod/spring/damper/custom
```

- Anchor resolution checks the **raw anchor name first**, then an `input`→`in` / `output`→`out` normalized form — so `input1`, `in1`, `a` all land on the same terminal for `resistor`/`bulb`/gates. Any of the documented synonyms is safe.
- Auto-layout only triggers on components left at (0,0)-relative position. Layout strategy is picked from the topology:
  - **Series loop/chain of supply + passives** (battery→resistor→bulb→battery, ammeters count as series elements): textbook rectangle — supply vertical on the left, components across the top row then back along the bottom row; wires route orthogonally around the loop.
  - **Parallel bank** (one supply, every component wired straight across it): supply on the left, each branch vertical, side by side between the two rails.
  - **Single-transistor / op-amp circuits** (net-aware): terminals are grouped into electrical nets; the collector load stacks above the device toward VCC, the emitter network below toward GND, the bias divider sits left of the base, input coupling walks in from the signal source on the left, output coupling walks out to the right, decoupling parts and the supply sit at the far left. Works for BJT, MOSFET and op-amp (in−/out/in+ take the base/collector/emitter roles).
  - `voltmeter`/`probe`/`wattmeter` float above the component they measure; `gnd` hangs below its neighbour. Neither breaks loop detection.
  - **Transistor/op-amp circuits**: collector/drain chain above, emitter/source chain below, bias network to the left.
  - **Digital**: left-to-right by BFS depth from source nodes.
  - Anything else (series-parallel meshes) falls back to the BFS grid, so prefer giving explicit `x`/`y` for complex meshes.

```javascript
graph.plot(yVar, xVarOrStyle, style); // one graph per page; calls after the first add series
// graph.plot(block.vy)                     -> vy vs time, line
// graph.plot(block.vy, "bar")              -> vy vs time, bar
// graph.plot(block.vy, block.vx)           -> vy vs vx, line
// graph.plot(resistor.V, resistor.I, "scatter")
```
Do not `create("graph", ...)` directly for charting — it uses an incompatible parameter schema (`sourceId`/`yChannels`) vs. what `graph.plot()` writes (`series`/`xChannel`/`plot_style`).

---

## Circuit symbols

All get an `electricalNode` behavior automatically. Default size `96 × 48` unless noted. Create by kind name directly — **not** `create("symbol", {symbol:"..."})`.

### Electrical

| kind | description | default params | anchors |
|---|---|---|---|
| `battery` | DC voltage source | `V:9` | `positive`/`plus`, `negative`/`minus` |
| `ac-source` | AC voltage source | `V:12, f:1, wave:0` | `positive`, `negative` |
| `current-source` | Ideal current source | `I:0.01` | `positive`, `negative` |
| `resistor` | Resistor | `R:100` | `input1`/`a`/`in` (0), `input2`/`b`/`out` (1) |
| `bulb` | Resistive lamp load | `R:20` | `input1`/`a` (0), `input2`/`b` (1) |
| `capacitor` | Capacitor | `C:0.001` | `positive`/`a` (0), `negative`/`b` (1) |
| `inductor` | Inductor | `L:0.1` | `a` (0), `b` (1) |
| `potentiometer` | 3-terminal pot | `R:1000, ratio:0.5` | `top` (0), `wiper`/`w` (1), `bottom` (2) |
| `switch` | On/off switch | `closed:1` | `a` (0), `b` (1) |
| `fuse` | Overcurrent fuse | `Imax:1` | `a` (0), `b` (1) |
| `gnd` | Ground reference | — | `terminal`/`a` (single pin) |
| `voltmeter` | Voltage probe/meter | — | `a` (0), `b` (1) |
| `ammeter` | Current probe/meter | — | `a` (0), `b` (1) |
| `wattmeter` | Power meter, 4-terminal | — | `current+`/`ip` (0), `current-` (1), `voltage+`/`vp` (2), `voltage-`/`vn` (3); default h `80` |
| `probe` | Generic single-pin probe | — | `terminal`/`a` |
| `vcvs` | Voltage-controlled voltage source | `gain:2` | `ctrl+`/`ctrlp` (0), `ctrl-`/`ctrln` (1), `out` (2), `out-` (3) |
| `vccs` | Voltage-controlled current source | `gm:0.01` | same layout as `vcvs` |
| `ccvs` | Current-controlled voltage source | `r:100` | same layout as `vcvs` |
| `cccs` | Current-controlled current source | `beta:2` | same layout as `vcvs` |
| `transformer` | 2-winding transformer | `n:2` | `primary+`/`p1` (0), `primary-`/`p2` (1), `secondary+`/`s1` (2), `secondary-`/`s2` (3); default h `80` |
| `transformer-ct` | Center-tapped transformer | `n:2` | `p1` (0), `p2` (1), `s1` (2), `ct` (3), `s2` (4); default h `90` |
| `three-phase-source` | 3-phase supply | `V:220, f:50` | `a`(0), `b`(1), `c`(2), `n`/`neutral`(3); default h `80` |
| `dc-machine` | DC motor/generator | `Ra:2, k:0.5, J:0.02, load:0, friction:0.001` | `positive`, `negative` |
| `electric-motor` | Alias family of `dc-machine` | same as `dc-machine` | generic `_t2` anchors |
| `pressure-plate` | Mechanical-electrical trigger | — | `a` (0), `b` (1) |

### Electronics

| kind | description | default params | anchors | default h |
|---|---|---|---|---|
| `diode` | Rectifier diode | `Vf:0.7` | `anode`/`a` (0), `cathode`/`k` (1) | 48 |
| `led` | Light-emitting diode | `Vf:2` | `anode`/`a` (0), `cathode`/`k` (1) | 48 |
| `zener` | Zener diode | `Vf:0.7, Vz:5.1` | `anode` (0), `cathode` (1) | 48 |
| `bjt` | NPN transistor | `beta:100` | `base`/`b` (0), `collector`/`c` (1), `emitter`/`e` (2) | 72 |
| `bjt-pnp` | PNP transistor | `beta:100` | same as `bjt` | 72 |
| `mosfet` | NMOS transistor | `Vt:2` | `gate`/`g` (0), `drain`/`d` (1), `source`/`s` (2) | 72 |
| `mosfet-pmos` | PMOS transistor | `Vt:2` | same as `mosfet` | 72 |
| `opamp` | Operational amplifier | `gain:100000` | `in+`/`inp`/`positive` (0), `in-`/`inn`/`negative` (1), `out`/`output` (2) | 72 |

### Digital

| kind | description | default params | anchors | default h |
|---|---|---|---|---|
| `input` | Logic input source | `value:0` | `output`/`out`/`q` (single pin) | 48 |
| `clock` | Clock pulse source | `f:1` | `output`/`out`/`q` | 48 |
| `output` | Logic output indicator | — | `input`/`in`/`d` | 48 |
| `logic-probe` | Digital state probe | — | `terminal`/`a` | 48 |
| `and-gate`/`or-gate`/`xor-gate`/`nand-gate`/`nor-gate` | 2-input logic gate | — | `input1`/`in1`/`a` (0), `input2`/`in2`/`b` (1), `output`/`out` (2) | 48 |
| `not-gate` | Inverter | — | `input`/`in` (0), `output`/`out` (1) | 48 |
| `d-ff` | D flip-flop | — | `d` (0), `clk`/`clock` (1), `q`/`output` (2) | 48 |
| `t-ff` | T flip-flop | — | `t` (0), `clk`/`clock` (1), `q`/`output` (2) | 48 |
| `jk-ff` | JK flip-flop | — | `j` (0), `clk`/`clock` (1), `k` (2), `q`/`output` (3) | 80 |
| `sr-latch` | SR latch | — | `s` (0), `r` (1), `q`/`output` (2) | 48 |
| `tristate` | Tri-state buffer | — | `input`/`in` (0), `enable`/`en` (1), `output`/`out` (2) | 48 |
| `mux` | 2:1 multiplexer | — | `in0` (0), `in1` (1), `sel` (2), `output`/`out` (3) | 80 |
| `demux` | 1:2 demultiplexer | — | `input`/`in` (0), `sel` (1), `out0` (2), `out1` (3) | 80 |
| `encoder` | Priority encoder | — | `in0`-`in3` (0-3), `out0` (4), `out1` (5) | 96 |
| `half-adder` | Half adder | — | `a` (0), `b` (1), `sum`/`s` (2), `carry`/`cout` (3) | 72 |
| `full-adder` | Full adder | — | `a` (0), `b` (1), `cin` (2), `sum`/`s` (3), `carry`/`cout` (4) | 80 |
| `decoder` | 2:4 decoder | — | `a` (0), `b` (1), `y0`-`y3` (2-5) | 96 |
| `comparator` | Magnitude comparator | — | `a` (0), `b` (1), `lt` (2), `eq` (3), `gt` (4) | 80 |
| `seven-seg` | 7-segment display | — | `a`-`g` (0-6) | 150 |
| `bcd-7seg` | BCD-to-7seg driver | — | `a`-`d` (0-3), `qa`-`qg` (4-10) | 150 |
| `counter4` | 4-bit counter | `mod:16, dir:0` | `clk`/`clock` (0), `q0`-`q3` (1-4) | 90 |
| `register4` | 4-bit shift register | — | `sin` (0), `clk`/`clock` (1), `sout` (2) | 100 |
| `induction-motor` | AC induction motor | `R2:5, X:8, poles:4, f:50, J:0.05, load:0, friction:0.001` | `a`(0),`b`(1),`c`(2),`n`/`neutral`(3) | 80 |

---

## Mechanics components

Physics behaviors already attached — **no `addproperty()` needed**. Anchors resolve via `.centre` (or terminals if the shape has any, which most mechanics kinds don't — use `.centre`).

```javascript
var block = create("block", { x: 0, y: 0, mass: 20 }); // mass MUST be set here, not later
```

| kind | shape | size | behavior(s) |
|---|---|---|---|
| `mass` | circle | 70×70 | `rigidBody` |
| `block` | rect | 110×80 | `rigidBody` |
| `beam` | rect | 260×16 | `rigidBody` |
| `wheel` | circle | 100×100 | `rigidBody` |
| `ground` | rect | 480×26 | `staticBody` |
| `spring` | line | 150×2 | `spring` |
| `rope` | line | 150×2 | `rope` |
| `rod` | line | 150×2 | `rod` |
| `damper` | line | 120×2 | `damper` |
| `hinge` | circle | 22×22 | `hinge` |
| `motor` | circle | 80×80 | `rigidBody` + `motor` |
| `charge` | circle | 46×46 | `rigidBody` + `charge` |
| `efield` | rect | 260×180 | `efield` |
| `bfield` | rect | 260×180 | `bfield` |
| `heatblock` / `heat-block` | rect | 100×100 | `staticBody` + `heatSource` |
| `torsionpendulum` / `torsion-pendulum` | circle | 22×22 | `hinge` + `torsionSpring` |
| `reference-point` | circle | 20×20 | `rigidBody` |

Behavior params can be passed straight in `create()` props (any name the behavior's spec declares): `create("block", { x: 0, y: 0, mass: 20, friction: 0.3, vx: 8 })`, `create("charge", { q: 2, vx: 10, showTrail: 1 })`, `create("bfield", { Bz: 2 })`, `create("thin-lens", { f: 150 })`. `.set({ mass: N })` also reaches the behavior now.

Readable properties for `graph.plot()`: `.vx .vy .ax .ay .x .y .ke .pe .speed .omega .angle`.

---

## Optics components

Rotation/dir ignored (always 0). Rendered as vertical/point elements you position along an optical axis.

| kind | shape | size | behavior |
|---|---|---|---|
| `light-source` / `lightsource` | circle | 24×24 | `lightSource` |
| `thin-lens` / `lens` | vertical line | 2×120 | `thinLens` |
| `mirror` / `optical-mirror` | vertical line | 2×120 | `opticalMirror` |
| `screen` / `optical-screen` | vertical line | 2×160 | `opticalScreen` |
| `slit` | vertical line | 2×200 | `slit` |

## Waves components

| kind | shape | size | behavior |
|---|---|---|---|
| `wave-source` / `wavesource` | circle | 24×24 | `waveSource` |
| `wave-boundary` / `waveboundary` | vertical line | 2×120 | `waveBoundary` |
| `transmission-line` / `transmissionline` | horizontal line | 220×2 | `transmissionLine` |

## Quantum components

| kind | shape | size | behavior |
|---|---|---|---|
| `quantum-well` / `quantumwell` | rect | 260×160 | `quantumWell` |
| `tunnel-barrier` / `tunnelbarrier` | rect | 260×140 | `tunnelBarrier` |

---

## Canvas / data objects

Every one of these is built by the same factory the tool dock and palette use
(`lib/scene/factory.ts`), so a kind added to the app is scriptable the same day.

```javascript
var t = create("table", {                                            // 380x260, Excel-style formula table
  headers: "SN;t;d;v=d/t",           // or array; "name=expr" = live formula column
  data: [[1, 1, 4.9], [2, 2, 19.6]], // or "1;1;4.9\n2;2;19.6"
  summary: "Avg",                    // Sum|Avg|Min|Max|Count|Stddev|Stderr|First|Last|Range|None
});
var gt = create("gridtable", {                                       // 360x220 transparent Canva / MS Word grid table
  rows: 2, cols: 3,
  cells: [["Name","Mass","Speed"], ["Block","20","8"]],  // 2-D array or pre-encoded JSON
  transparent: 1,
});                                  // rows/cols WITHOUT cells generates that many empty cells
var ch = create("chart", {                                           // 380x280 bar/line/area/scatter/pie
  type: "bar",                       // or chartType
  labels: ["Q1","Q2","Q3","Q4"],     // or "Q1;Q2;Q3;Q4"
  series: { Sales: [12, 19, 14, 22] },   // or [["Sales",[…]],…] or "Sales|12;19;14;22"
});
var s3 = create("surface3d", { formula: "sin(x)*cos(y)", axis: "z" }); // 420x340 3D surface / implicit plotter
                                     // aliases: "graph3d", "surface-3d", "3d"; `formulas: [...]` for several
var sld = create("slider", { min: 0, max: 100, step: 1, value: 50, label: "Mass",
                             targetObjectId: block,                  // REQUIRED — a create() handle
                             targetParamName: "mass" });             // 240x80 real-time control slider
                             // Without targetObjectId a control falls back to a page variable nothing
                             // reads: it renders, it drags, and it drives nothing. Same for button/trigger.
var btn = create("button", { label: "Pulse", actionType: "toggle" }); // 160x54 interactive click button
var trg = create("trigger", { condition: ">", threshold: 50,
                              actionType: "toggle" });               // 230x90 conditional comparison trigger
var pic = create("picture", { src: "opfs:<fileId>" });               // placed raster image ("image"/"img")
                                     // a bare id is accepted — "abc" becomes "opfs:abc"
var n = create("note", { text: "reminder", color: "amber" });        // 220x180, color default "amber"
var tx = create("text", { text: "# Heading" });                      // 320x48 markdown text block
var f = create("formula", { latex: "s = ut + \\frac{1}{2}at^2" });    // 300x96 KaTeX + solver
var cf = create("cashflow", {});                                     // 480x300, empty spec pre-filled
var tt = create("truthtable", { inputs: "A,B", outputs: "Q" });      // 320x260
var lab = create("dsa", { source: "int main() { ... }" });           // 980x620 DSA Lab (aliases: "dsa-lab")
var sys = create("system", { domain: "mechanics" });                 // 460x320 dashed system boundary
var ide = create("code", { source: "// SimScript…" });               // 420x300 nested SimScript IDE (alias "ide")
```

Any parameter the factory declares for a kind is settable by name, even if it
is not listed above — that is what keeps this list from going stale.

---

## Styling — works on EVERY kind

The same appearance props apply to a resistor, a text block and a slider alike.
They are never confused with live parameters, so `create("resistor", { R: 330,
fill: "#f00" })` sets a 330 Ω resistance **and** a red fill.

| prop | meaning |
|---|---|
| `fill` / `fillColor` | body fill, any CSS colour |
| `stroke` / `strokeColor` | outline colour |
| `strokeWidth` | outline width in px |
| `radius` / `cornerRadius` | corner rounding in px |
| `opacity` / `fillOpacity` | `0`–`1` **or** `0`–`100`; both normalise to percent |
| `textColor` | text colour |
| `align` | `left` \| `center` \| `right` |
| `verticalAlign` / `valign` | `top` \| `middle` \| `bottom` |
| `lineHeight`, `letterSpacing` | text metrics (letterSpacing is a % of font size) |
| `locked` | `true` pins the object against dragging/editing |
| `hidden` | `true` hides it without deleting it |
| `flipH`, `flipV` | mirror horizontally / vertically |
| `z` | explicit stacking order |

```javascript
var box   = create("rect", { width: 420, height: 90, fill: "#fee2e2",
                             stroke: "#ef4444", strokeWidth: 2, radius: 16, opacity: 0.5 });
var title = create("text", { text: "# Experiment 1", textColor: "#991b1b", align: "center" });
var r     = create("resistor", { R: 470, opacity: 0.4, locked: true });
```

Text content itself is markdown — `#` headings, `**bold**`, lists and checkboxes
all render, so `create("text", { text: "# Title" })` produces a real heading.

---

`dsa` is the **DSA Lab**: a C++ IDE that interprets the `source` prop line by line and animates memory blocks, pointer arrows, the recursion tree, and measured Big-O analysis. Pass complete C++ (a `main()`, or loose top-level statements) in `source`; it re-runs automatically on every edit.

### Interactive Control Tools & UI Extensions
- **Slider (`slider`)**: Available in the sidebar Tools panel. Binds to page variables or component properties with live, real-time value sync as the thumb moves.
- **Button (`button`)**: Available in the sidebar Tools panel. Executes set, toggle, or step actions on click.
- **Trigger (`trigger`)**: Available in the sidebar Tools panel. Monitors page variables or component properties against operators (`==`, `>`, `<`, `>=`, `<=`, `!=`) and threshold values, executing target actions when satisfied.
- **Grid Table (`gridtable`)**: Placed from the tool dock. Features a transparent background, Canva/MS Word style cell grid, direct cell editing when selected, row/column management, and resizable column width splitters.
- **Fullscreen Viewport Expansion**: Tables, Grid Tables, DSA Lab, Code IDE, Cashflow diagrams, Graphs, Truth Tables, and System Enclosures include a **Fullscreen** toggle button on selection. Expanding fills the entire canvas viewport while keeping topbar, sidebars, and dock accessible.
- **Internal Resizable Sections**: Split panes and column dividers (such as DSA Lab code/visualization splitters and Grid Table columns) feature interactive drag handles for custom panel sizing.
- **Subject Component Package System**: Components are organized into subject packages (`mechanics`, `electrical`, `electronics`, `digital`, `optics`, `waves`, `quantum`, `economics`, `dsa`). Toggleable in **Settings → Packages**, hiding or showing subject modules across the palette, dock, and search.

Do **not** `create("graph", {...})` for a chart — use `graph.plot(...)` (see top of doc).

---

## Generic shapes (fallback)

`rect`, `circle`, `line`, `polygon` — anything unrecognized also falls here. Default size `80×60`. No behaviors attached; use `addproperty()` to give them physics.

```javascript
var shape = create("rect", { x: 0, y: 0, width: 40, height: 40 });
addproperty(shape, "rigidBody", { mass: 2 });

// line/polygon take explicit vertices, relative to the object's position
var tri = create("polygon", { points: [[0, 0], [80, 0], [40, 60]] });
```

All four accept the full styling set (`fill`, `stroke`, `strokeWidth`, `radius`,
`opacity`, `locked`, …) like every other kind.

---

## Training a local LLM on SimScript

The whole language ships as a training pipeline (`/api/train/simscript`, UI on `/train`):

- `GET /api/train/simscript` — instruction→SimScript dataset as chat JSONL, one sample per component kind plus full scenarios, **lint-gated** (every sample passes `lib/ai/simscript-lint.ts` before export).
- `?format=modelfile` — Ollama Modelfile with the condensed language card baked in: `ollama create simblip-simscript -f Modelfile`.
- `?format=prompt` — the bare system prompt (`SIMSCRIPT_SYSTEM_PROMPT` in `lib/ai/simscript-corpus.ts`).
- `?format=check` — lint report over the corpus.

Keep `lib/ai/simscript-corpus.ts` (KIND_CATALOG + scenarios) in sync with this document when kinds change.
