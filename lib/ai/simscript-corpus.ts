// SimScript training corpus — the pipeline that teaches a LOCAL LLM to write
// simulations. Pure module (no store, no React): it runs in the /api/train
// route on the server and in the browser alike.
//
// Three artifacts come out of here:
//   • SIMSCRIPT_SYSTEM_PROMPT — the condensed language card a model runs with
//   • buildDataset()          — chat-format samples (system/user/assistant)
//     covering EVERY create() kind plus full scenarios, for fine-tuning
//   • buildModelfile()        — an Ollama Modelfile that bakes the prompt in
//
// Every sample is linted (lib/ai/simscript-lint.ts) before it is emitted, so
// the dataset can never teach the model syntax the runtime would reject.

// ── Kind catalog ─────────────────────────────────────────────────────────────
// One row per create() kind. `a`/`b` are the anchor names the wiring samples
// use. Keep in sync with lib/scene/simscript.ts and the reference doc.

export interface KindInfo {
  kind: string
  domain:
    | 'electrical'
    | 'electronics'
    | 'digital'
    | 'mechanics'
    | 'optics'
    | 'waves'
    | 'quantum'
    | 'widget'
    | 'shape'
  label: string
  /** default params worth showing in the sample */
  params?: Record<string, number | string>
  /** two-terminal wiring anchors (circuit kinds) */
  a?: string
  b?: string
  /** skip the auto-generated sample (covered by a scenario instead) */
  scenarioOnly?: boolean
}

export const KIND_CATALOG: KindInfo[] = [
  // electrical
  { kind: 'battery', domain: 'electrical', label: 'battery', params: { V: 9 }, a: 'positive', b: 'negative' },
  { kind: 'ac-source', domain: 'electrical', label: 'AC source', params: { V: 12, f: 50 }, a: 'positive', b: 'negative' },
  { kind: 'current-source', domain: 'electrical', label: 'current source', params: { I: 0.01 }, a: 'positive', b: 'negative' },
  { kind: 'resistor', domain: 'electrical', label: 'resistor', params: { R: 220 }, a: 'a', b: 'b' },
  { kind: 'bulb', domain: 'electrical', label: 'bulb', params: { R: 20 }, a: 'a', b: 'b' },
  { kind: 'capacitor', domain: 'electrical', label: 'capacitor', params: { C: 0.001 }, a: 'a', b: 'b' },
  { kind: 'inductor', domain: 'electrical', label: 'inductor', params: { L: 0.1 }, a: 'a', b: 'b' },
  { kind: 'potentiometer', domain: 'electrical', label: 'potentiometer', params: { R: 1000, ratio: 0.5 }, a: 'top', b: 'bottom' },
  { kind: 'switch', domain: 'electrical', label: 'switch', params: { closed: 1 }, a: 'a', b: 'b' },
  { kind: 'fuse', domain: 'electrical', label: 'fuse', params: { Imax: 1 }, a: 'a', b: 'b' },
  { kind: 'gnd', domain: 'electrical', label: 'ground reference', a: 'terminal' },
  { kind: 'voltmeter', domain: 'electrical', label: 'voltmeter', a: 'a', b: 'b' },
  { kind: 'ammeter', domain: 'electrical', label: 'ammeter', a: 'a', b: 'b' },
  { kind: 'wattmeter', domain: 'electrical', label: 'wattmeter', scenarioOnly: true },
  { kind: 'probe', domain: 'electrical', label: 'probe', a: 'terminal' },
  { kind: 'vcvs', domain: 'electrical', label: 'voltage-controlled voltage source', params: { gain: 2 }, scenarioOnly: true },
  { kind: 'vccs', domain: 'electrical', label: 'voltage-controlled current source', params: { gm: 0.01 }, scenarioOnly: true },
  { kind: 'ccvs', domain: 'electrical', label: 'current-controlled voltage source', params: { r: 100 }, scenarioOnly: true },
  { kind: 'cccs', domain: 'electrical', label: 'current-controlled current source', params: { beta: 2 }, scenarioOnly: true },
  { kind: 'transformer', domain: 'electrical', label: 'transformer', params: { n: 2 }, scenarioOnly: true },
  { kind: 'transformer-ct', domain: 'electrical', label: 'center-tapped transformer', params: { n: 2 }, scenarioOnly: true },
  { kind: 'three-phase-source', domain: 'electrical', label: '3-phase source', params: { V: 220, f: 50 }, scenarioOnly: true },
  { kind: 'dc-machine', domain: 'electrical', label: 'DC machine', params: { Ra: 2, k: 0.5 }, a: 'positive', b: 'negative' },
  { kind: 'electric-motor', domain: 'electrical', label: 'electric motor', a: 'positive', b: 'negative' },
  { kind: 'induction-motor', domain: 'electrical', label: 'induction motor', scenarioOnly: true },
  { kind: 'pressure-plate', domain: 'electrical', label: 'pressure plate', a: 'a', b: 'b' },
  // electronics
  { kind: 'diode', domain: 'electronics', label: 'diode', params: { Vf: 0.7 }, a: 'anode', b: 'cathode' },
  { kind: 'led', domain: 'electronics', label: 'LED', params: { Vf: 2 }, a: 'anode', b: 'cathode' },
  { kind: 'zener', domain: 'electronics', label: 'zener diode', params: { Vz: 5.1 }, a: 'anode', b: 'cathode' },
  { kind: 'bjt', domain: 'electronics', label: 'NPN transistor', params: { beta: 100 }, scenarioOnly: true },
  { kind: 'bjt-pnp', domain: 'electronics', label: 'PNP transistor', params: { beta: 100 }, scenarioOnly: true },
  { kind: 'mosfet', domain: 'electronics', label: 'N-MOSFET', params: { Vt: 2 }, scenarioOnly: true },
  { kind: 'mosfet-pmos', domain: 'electronics', label: 'P-MOSFET', params: { Vt: 2 }, scenarioOnly: true },
  { kind: 'opamp', domain: 'electronics', label: 'op-amp', scenarioOnly: true },
  // digital
  { kind: 'input', domain: 'digital', label: 'logic input', params: { value: 1 } },
  { kind: 'clock', domain: 'digital', label: 'clock', params: { f: 1 } },
  { kind: 'output', domain: 'digital', label: 'logic output' },
  { kind: 'logic-probe', domain: 'digital', label: 'logic probe' },
  { kind: 'and-gate', domain: 'digital', label: 'AND gate' },
  { kind: 'or-gate', domain: 'digital', label: 'OR gate' },
  { kind: 'xor-gate', domain: 'digital', label: 'XOR gate' },
  { kind: 'nand-gate', domain: 'digital', label: 'NAND gate' },
  { kind: 'nor-gate', domain: 'digital', label: 'NOR gate' },
  { kind: 'not-gate', domain: 'digital', label: 'NOT gate' },
  { kind: 'd-ff', domain: 'digital', label: 'D flip-flop' },
  { kind: 'jk-ff', domain: 'digital', label: 'JK flip-flop', scenarioOnly: true },
  { kind: 't-ff', domain: 'digital', label: 'T flip-flop', scenarioOnly: true },
  { kind: 'sr-latch', domain: 'digital', label: 'SR latch', scenarioOnly: true },
  { kind: 'tristate', domain: 'digital', label: 'tri-state buffer', scenarioOnly: true },
  { kind: 'mux', domain: 'digital', label: '2:1 multiplexer', scenarioOnly: true },
  { kind: 'demux', domain: 'digital', label: '1:2 demultiplexer', scenarioOnly: true },
  { kind: 'encoder', domain: 'digital', label: 'encoder', scenarioOnly: true },
  { kind: 'half-adder', domain: 'digital', label: 'half adder', scenarioOnly: true },
  { kind: 'full-adder', domain: 'digital', label: 'full adder', scenarioOnly: true },
  { kind: 'decoder', domain: 'digital', label: 'decoder', scenarioOnly: true },
  { kind: 'comparator', domain: 'digital', label: 'comparator', scenarioOnly: true },
  { kind: 'seven-seg', domain: 'digital', label: '7-segment display', scenarioOnly: true },
  { kind: 'bcd-7seg', domain: 'digital', label: 'BCD-to-7-segment driver', scenarioOnly: true },
  { kind: 'register4', domain: 'digital', label: '4-bit shift register', scenarioOnly: true },
  { kind: 'counter4', domain: 'digital', label: '4-bit counter', scenarioOnly: true },
  // mechanics (explicit x/y!)
  { kind: 'mass', domain: 'mechanics', label: 'mass (ball)', params: { mass: 2 } },
  { kind: 'block', domain: 'mechanics', label: 'block', params: { mass: 5 } },
  { kind: 'beam', domain: 'mechanics', label: 'beam', params: { mass: 3 } },
  { kind: 'wheel', domain: 'mechanics', label: 'wheel', params: { mass: 2 } },
  { kind: 'ground', domain: 'mechanics', label: 'ground' },
  { kind: 'spring', domain: 'mechanics', label: 'spring', scenarioOnly: true },
  { kind: 'rope', domain: 'mechanics', label: 'rope', scenarioOnly: true },
  { kind: 'rod', domain: 'mechanics', label: 'rod', scenarioOnly: true },
  { kind: 'damper', domain: 'mechanics', label: 'damper', scenarioOnly: true },
  { kind: 'hinge', domain: 'mechanics', label: 'hinge', scenarioOnly: true },
  { kind: 'motor', domain: 'mechanics', label: 'motor', scenarioOnly: true },
  { kind: 'charge', domain: 'mechanics', label: 'charged ball', params: { q: 1 }, scenarioOnly: true },
  { kind: 'efield', domain: 'mechanics', label: 'E-field region', scenarioOnly: true },
  { kind: 'bfield', domain: 'mechanics', label: 'B-field region', scenarioOnly: true },
  { kind: 'dielectric', domain: 'mechanics', label: 'dielectric medium', scenarioOnly: true },
  { kind: 'heat-block', domain: 'mechanics', label: 'heat source block' },
  { kind: 'torsion-pendulum', domain: 'mechanics', label: 'torsion pendulum', scenarioOnly: true },
  { kind: 'reference-point', domain: 'mechanics', label: 'reference point', scenarioOnly: true },
  // optics
  { kind: 'light-source', domain: 'optics', label: 'light source', scenarioOnly: true },
  { kind: 'thin-lens', domain: 'optics', label: 'thin lens', scenarioOnly: true },
  { kind: 'optical-mirror', domain: 'optics', label: 'mirror', scenarioOnly: true },
  { kind: 'optical-screen', domain: 'optics', label: 'screen', scenarioOnly: true },
  { kind: 'slit', domain: 'optics', label: 'slit', scenarioOnly: true },
  // waves & quantum
  { kind: 'wave-source', domain: 'waves', label: 'wave source', scenarioOnly: true },
  { kind: 'wave-boundary', domain: 'waves', label: 'wave boundary', scenarioOnly: true },
  { kind: 'transmission-line', domain: 'waves', label: 'transmission line' },
  { kind: 'quantum-well', domain: 'quantum', label: 'quantum well' },
  { kind: 'tunnel-barrier', domain: 'quantum', label: 'tunnel barrier' },
  // widgets
  { kind: 'note', domain: 'widget', label: 'sticky note', scenarioOnly: true },
  { kind: 'text', domain: 'widget', label: 'text block', scenarioOnly: true },
  { kind: 'formula', domain: 'widget', label: 'formula', scenarioOnly: true },
  { kind: 'table', domain: 'widget', label: 'table', scenarioOnly: true },
  { kind: 'graph', domain: 'widget', label: 'graph', scenarioOnly: true },
  { kind: 'truthtable', domain: 'widget', label: 'truth table', scenarioOnly: true },
  { kind: 'cashflow', domain: 'widget', label: 'cash-flow diagram' },
  { kind: 'dsa', domain: 'widget', label: 'DSA Lab (C++ visualizer)', scenarioOnly: true },
  { kind: 'system', domain: 'widget', label: 'system boundary', scenarioOnly: true },
  { kind: 'code', domain: 'widget', label: 'SimScript IDE' },
  { kind: 'gridtable', domain: 'widget', label: 'grid table', scenarioOnly: true },
  { kind: 'chart', domain: 'widget', label: 'chart', scenarioOnly: true },
  { kind: 'surface3d', domain: 'widget', label: '3D surface plot', scenarioOnly: true },
  { kind: 'slider', domain: 'widget', label: 'slider control', scenarioOnly: true },
  { kind: 'button', domain: 'widget', label: 'button control', scenarioOnly: true },
  { kind: 'trigger', domain: 'widget', label: 'conditional trigger', scenarioOnly: true },
  { kind: 'picture', domain: 'widget', label: 'placed image', scenarioOnly: true },
  // bare shapes
  { kind: 'rect', domain: 'shape', label: 'rectangle', scenarioOnly: true },
  { kind: 'circle', domain: 'shape', label: 'circle', scenarioOnly: true },
  { kind: 'line', domain: 'shape', label: 'line' },
  { kind: 'polygon', domain: 'shape', label: 'polygon' },
]

export const KNOWN_KINDS = new Set<string>([
  ...KIND_CATALOG.map((k) => k.kind),
  // aliases accepted by create()
  'lens', 'lightsource', 'mirror', 'screen', 'wavesource', 'waveboundary', 'transmissionline',
  'quantumwell', 'tunnelbarrier', 'heatblock', 'torsionpendulum', 'truth-table', 'dsa-lab',
  'dsalab', 'ide', 'simscript',
  'grid-table', 'graph3d', 'surface-3d', '3d', 'image', 'img',
])

// ── System prompt ────────────────────────────────────────────────────────────

export const SIMSCRIPT_SYSTEM_PROMPT = `You are the simulation author inside SIMBLIP, an engineering notebook whose canvas is scripted with SimScript (JavaScript-flavoured). You turn a request into a scene: components, wiring, physics, plots, notes.

OUTPUT RULES
- Reply with SimScript code ONLY. No markdown fences, no prose before or after.
- Use var. End statements with ;. Comments with //.

API
var obj = create(kind, props)         // make a component; props: params + x,y,width,height,rotation,name
connect(a.anchor, b.anchor)           // wire two terminals ("wire" default)
connect(a.centre, b.centre, type)     // type: "wire"|"rope"|"rod"|"spring"|"damper"
addproperty(obj, behavior, params?)   // e.g. addproperty(shape, "rigidBody", { mass: 5 })
obj.set({ ... })                      // update params later (mass, R, V, x, y, ...)
graph.plot(obj.channel)               // plot vs time; graph.plot(y, x) for y-vs-x; styles "line"|"bar"|"scatter"
var k = 25;                           // bare numbers become page variables

LAYOUT
- CIRCUITS: do NOT pass x/y — the auto-layout engine draws the schematic (series loops, parallel banks, amplifiers). Just create and connect.
- MECHANICS/OPTICS/WAVES: DO pass x/y (canvas px, +y is down). There is NO auto-layout here — omit x/y and every body stacks on one pixel and explodes apart. Put ground below falling bodies. Optics sit left-to-right on one axis (same y).
- ANY scene with 2+ mechanics/optics/waves components: create the system FIRST, before anything else, sized to fit what you're about to place — var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 360 }); (domain: mechanics|electrical|electronics|digital|waves|quantum; optics also uses "optics"). Then every component's x/y goes a bit inside those bounds (roughly 40..width-40, 40..height-40) — NOT scattered across the whole page. The system is not decoration: its Play/Step/Reset only simulates what's inside it (by centre), so a component placed outside the box you declared is silently dropped from the run. A single lone component (one region, one probe) does not need a system.

WHEN THE TOPIC IS NOT SIMULATABLE (read this before writing anything)
- The KINDS list below is the WHOLE engine. There is no thermodynamics, no phase change, no chemistry, no molecular/particle-scale matter, no economics, no biology. If the request is about something not in that list, DO NOT approximate it with unrelated components.
- Concretely: "states of matter" is NOT three blocks joined by springs; "diffusion" is NOT bouncing balls; "the water cycle" is NOT a wave source. A scene whose components do not mean what the question is about teaches the student something false, which is worse than no scene.
- In that case emit ONLY a note stating what is being shown and that the written explanation carries the answer:
  var n = create("note", { x: 0, y: 0, width: 420, text: "States of matter is a thermal/molecular topic — SIMBLIP's engine has no thermodynamic model, so the written answer covers it instead." });
  Emit nothing else. A short honest note is a correct answer here; an invented mechanics scene is not.

MAKE IT EXPERIMENTABLE
- When a quantity is worth varying (mass, k, R, V, speed, angle), add a slider bound to the object:
  var sl = create("slider", { x: 0, y: 420, min: 1, max: 50, value: 10, label: "Mass", targetParamName: "mass", targetObjectId: block });
  targetObjectId takes the create() handle itself. Without it the slider drives nothing.
- Pair a scene with a graph of the quantity being studied, so a slider change is visible as a change in the curve.

MAKING A SCENE ACTUALLY MOVE (a scene that draws but does not simulate is a failure)
- spring/rope/rod/damper ARE the constraint. They do nothing until BOTH ends are attached — the physics binds them to whatever body each endpoint touches. Always connect both ends.
- To join two physical bodies you MUST name the type: connect(a.centre, b.centre, "rod"). Plain connect() makes a "wire", which is ELECTRICAL and applies zero force — the bodies just fall apart.
- Give bodies something to rest on or hang from: create("ground", …) below them, or a hinge/rod above. A body with no support falls off-canvas in about a second (fine only if free fall IS the question).
- A hinge is a fixed pivot: hang a rod from it for a pendulum.

KINDS (create) — params in ()
- electrical: battery(V) ac-source(V,f) current-source(I) resistor(R) bulb(R) capacitor(C) inductor(L) potentiometer(R,ratio) switch(closed) fuse(Imax) gnd voltmeter ammeter wattmeter probe vcvs(gain) vccs(gm) ccvs(r) cccs(beta) transformer(n) three-phase-source(V,f) dc-machine electric-motor induction-motor pressure-plate
- electronics: diode(Vf) led(Vf) zener(Vz) bjt(beta) bjt-pnp mosfet(Vt) mosfet-pmos opamp(gain)
- digital: input(value) clock(f) output logic-probe and/or/xor/nand/nor/not-gate d-ff jk-ff t-ff sr-latch tristate mux demux encoder decoder half-adder full-adder comparator seven-seg bcd-7seg register4 counter4(mod)
- mechanics: mass(mass) block(mass) beam wheel ground spring rope rod damper hinge motor(speed) charge(q,vx,vy) efield(Ex,Ey) bfield(Bz) dielectric(epsr,sigma,mur) heat-block torsion-pendulum reference-point — rigidBody props: mass,friction,restitution,vx,vy,omega,showTrail
- optics: light-source thin-lens(f) optical-mirror optical-screen slit
- waves/quantum: wave-source wave-boundary transmission-line quantum-well tunnel-barrier
- widgets: note(text,color) text(text) formula(latex) table(headers,data,summary) truthtable(inputs,outputs) cashflow dsa(source: C++ code) system(domain) code(source)
- shapes: rect circle line polygon (then addproperty to make them physical)

ANCHORS (connect)
- battery/sources: .positive .negative — resistor/bulb/capacitor/switch/fuse: .a .b — diode/led/zener: .anode .cathode
- bjt: .base .collector .emitter — mosfet: .gate .drain .source — opamp: .inp .inn .out — potentiometer: .top .wiper .bottom
- gates: .in1 .in2 .out — not/tristate: .in .out — flip-flops: .d/.j/.k/.t .clk .q — full-adder: .a .b .cin .sum .cout — counter4: .clk .q0..q3 — mux: .in0 .in1 .sel .out
- gnd/probe: .terminal — mechanics/shapes: .centre
- Never create("graph") — always graph.plot(). Never create("symbol").

CHANNELS for graph.plot: mechanics .x .y .vx .vy .speed .swing .angle .omega .ke — electrical .V .I .P
- .swing = angle about the pivot (USE THIS for a pendulum). .angle = the body's own spin — flat 0 for a bob on a rod, so plotting it draws a dead line.
table: headers "SN;x;y;z=x+y" (name=expr makes a live formula column), data rows "1;2;\\n2;5;" or [[1,2],[2,5]].`

// ── Scenario samples (hand-written, high-value) ──────────────────────────────

interface Sample {
  prompt: string
  script: string
}

const S = (prompt: string, script: string): Sample => ({ prompt, script: script.trim() + '\n' })

export const SCENARIOS: Sample[] = [
  S('Add a styled title and a red-filled rounded box behind it.', `
var box = create("rect", { x: 0, y: 0, width: 420, height: 90, fill: "#fee2e2", stroke: "#ef4444", strokeWidth: 2, radius: 16 });
var title = create("text", { x: 20, y: 24, text: "# Experiment 1", textColor: "#991b1b", align: "center" });`),

  S('Make a bar chart of quarterly sales.', `
var ch = create("chart", { type: "bar", labels: ["Q1", "Q2", "Q3", "Q4"], series: { Sales: [12, 19, 14, 22] } });`),

  S('Plot the 3D surface z = sin(x)*cos(y).', `
var s3 = create("surface3d", { formula: "sin(x)*cos(y)", axis: "z" });`),

  S('Add a 2x3 grid table with headers.', `
var gt = create("gridtable", { rows: 2, cols: 3, cells: [["Name", "Mass", "Speed"], ["Block", "20", "8"]] });`),

  S('Add a slider that controls the mass of a block in real time.', `
var block = create("block", { x: 0, y: 0, mass: 20 });
var sl = create("slider", { x: 0, y: 220, min: 1, max: 50, step: 1, value: 20, label: "Mass", targetParamName: "mass" });`),

  S('Add a button that toggles a value and a trigger that fires when speed passes 30.', `
var btn = create("button", { label: "Pulse", actionType: "toggle" });
var trg = create("trigger", { x: 0, y: 120, sourceParamName: "speed", condition: ">", threshold: 30, actionType: "toggle" });`),

  S('Dim a resistor and lock it so it cannot be dragged.', `
var r = create("resistor", { R: 470, opacity: 0.4, locked: true });`),

  S('Build a voltage divider: 9V battery with 1k and 2k resistors in series, and measure the output across the 2k.', `
var bat = create("battery", { V: 9 });
var r1 = create("resistor", { R: 1000, name: "R1" });
var r2 = create("resistor", { R: 2000, name: "R2" });
var vm = create("voltmeter", {});
connect(bat.positive, r1.a);
connect(r1.b, r2.a);
connect(r2.b, bat.negative);
connect(vm.a, r1.b);
connect(vm.b, r2.b);`),

  S('Make a simple circuit that lights a bulb from a battery through a switch.', `
var bat = create("battery", { V: 9 });
var sw = create("switch", { closed: 1 });
var bulb = create("bulb", { R: 20 });
connect(bat.positive, sw.a);
connect(sw.b, bulb.a);
connect(bulb.b, bat.negative);`),

  S('Two bulbs in parallel on a 12V battery, with an ammeter reading the total current.', `
var bat = create("battery", { V: 12 });
var am = create("ammeter", {});
var b1 = create("bulb", { R: 20, name: "B1" });
var b2 = create("bulb", { R: 30, name: "B2" });
connect(bat.positive, am.a);
connect(am.b, b1.a);
connect(am.b, b2.a);
connect(b1.b, bat.negative);
connect(b2.b, bat.negative);`),

  S('RC low-pass filter driven by a 50 Hz AC source; plot the capacitor voltage over time.', `
var src = create("ac-source", { V: 10, f: 50 });
var r = create("resistor", { R: 1000 });
var c = create("capacitor", { C: 0.000001 });
var g = create("gnd", {});
connect(src.positive, r.a);
connect(r.b, c.a);
connect(c.b, src.negative);
connect(g.terminal, src.negative);
graph.plot(c.V);`),

  S('Build a common-emitter BJT amplifier with a voltage-divider bias, input coupling capacitor and an emitter bypass capacitor.', `
var vcc = create("battery", { V: 12, name: "VCC" });
var sig = create("ac-source", { V: 0.05, f: 1000, name: "Vin" });
var q = create("bjt", { beta: 150 });
var r1 = create("resistor", { R: 22000, name: "R1" });
var r2 = create("resistor", { R: 10000, name: "R2" });
var rc = create("resistor", { R: 2200, name: "RC" });
var re = create("resistor", { R: 1000, name: "RE" });
var cin = create("capacitor", { C: 0.000001, name: "Cin" });
var ce = create("capacitor", { C: 0.0001, name: "CE" });
var g = create("gnd", {});
connect(vcc.positive, r1.a);
connect(vcc.positive, rc.a);
connect(rc.b, q.collector);
connect(r1.b, q.base);
connect(r2.a, q.base);
connect(r2.b, vcc.negative);
connect(q.emitter, re.a);
connect(re.b, vcc.negative);
connect(ce.a, q.emitter);
connect(ce.b, vcc.negative);
connect(sig.positive, cin.a);
connect(cin.b, q.base);
connect(sig.negative, vcc.negative);
connect(g.terminal, vcc.negative);`),

  S('LED with a current-limiting resistor on a 5V supply.', `
var bat = create("battery", { V: 5 });
var r = create("resistor", { R: 330 });
var led = create("led", { Vf: 2 });
connect(bat.positive, r.a);
connect(r.b, led.anode);
connect(led.cathode, bat.negative);`),

  S('Half-wave rectifier: AC source, diode, and a load resistor. Plot the load voltage.', `
var src = create("ac-source", { V: 12, f: 50 });
var d = create("diode", { Vf: 0.7 });
var load = create("resistor", { R: 1000 });
connect(src.positive, d.anode);
connect(d.cathode, load.a);
connect(load.b, src.negative);
graph.plot(load.V);`),

  S('Inverting op-amp amplifier with gain -10 (1k input resistor, 10k feedback).', `
var vin = create("ac-source", { V: 1, f: 100, name: "Vin" });
var rin = create("resistor", { R: 1000, name: "Rin" });
var rf = create("resistor", { R: 10000, name: "Rf" });
var op = create("opamp", {});
var g = create("gnd", {});
connect(vin.positive, rin.a);
connect(rin.b, op.inn);
connect(rf.a, op.inn);
connect(rf.b, op.out);
connect(op.inp, vin.negative);
connect(g.terminal, vin.negative);`),

  S('Build an AND gate with two inputs and an output indicator, then add a truth table for it.', `
var a = create("input", { value: 1, name: "A" });
var b = create("input", { value: 0, name: "B" });
var gate = create("and-gate", {});
var out = create("output", { name: "Q" });
connect(a.out, gate.in1);
connect(b.out, gate.in2);
connect(gate.out, out.in);
var tt = create("truthtable", { inputs: "A,B", outputs: "Q" });`),

  S('Wire a full adder from inputs A, B and Cin to sum and carry outputs.', `
var a = create("input", { value: 1, name: "A" });
var b = create("input", { value: 1, name: "B" });
var cin = create("input", { value: 0, name: "Cin" });
var fa = create("full-adder", {});
var sum = create("output", { name: "Sum" });
var cout = create("output", { name: "Cout" });
connect(a.out, fa.a);
connect(b.out, fa.b);
connect(cin.out, fa.cin);
connect(fa.sum, sum.in);
connect(fa.cout, cout.in);`),

  S('A clocked D flip-flop with a 1 Hz clock; probe the Q output.', `
var d = create("input", { value: 1, name: "D" });
var clk = create("clock", { f: 1 });
var ff = create("d-ff", {});
var q = create("logic-probe", { name: "Q" });
connect(d.out, ff.d);
connect(clk.out, ff.clk);
connect(ff.q, q.terminal);`),

  S('4-bit counter driven by a 2 Hz clock with logic probes on all four bits.', `
var clk = create("clock", { f: 2 });
var cnt = create("counter4", { mod: 16 });
var q0 = create("logic-probe", { name: "Q0" });
var q1 = create("logic-probe", { name: "Q1" });
var q2 = create("logic-probe", { name: "Q2" });
var q3 = create("logic-probe", { name: "Q3" });
connect(clk.out, cnt.clk);
connect(cnt.q0, q0.terminal);
connect(cnt.q1, q1.terminal);
connect(cnt.q2, q2.terminal);
connect(cnt.q3, q3.terminal);`),

  S('Drop a 2 kg ball onto the ground and plot its height and speed over time.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 560 });
var floor = create("ground", { x: 20, y: 500 });
var ball = create("mass", { x: 220, y: 100, mass: 2 });
graph.plot(ball.y);
graph.plot(ball.speed);`),

  S('Spring–mass oscillator: a block hanging from a spring anchored to the ground above, with a velocity plot.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 460 });
var anchor = create("ground", { x: 100, y: 80, width: 200 });
var block = create("block", { x: 160, y: 400, mass: 4 });
connect(anchor.centre, block.centre, "spring");
graph.plot(block.vy);`),

  S('Simple pendulum: a mass on a rod pinned by a hinge, released to swing. Plot its angle.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 400 });
var pivot = create("hinge", { x: 300, y: 120 });
var bob = create("mass", { x: 300, y: 340, mass: 1 });
connect(pivot.centre, bob.centre, "rod");
graph.plot(bob.swing);`),

  S('Simple pendulum I can experiment with — let me change the bob mass and watch the swing.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 500 });
var pivot = create("hinge", { x: 320, y: 100 });
var bob = create("mass", { x: 320, y: 340, mass: 1 });
connect(pivot.centre, bob.centre, "rod");
var mSlider = create("slider", { x: 60, y: 460, min: 1, max: 20, step: 1, value: 1, label: "Bob mass (kg)", targetParamName: "mass", targetObjectId: bob });
graph.plot(bob.swing);`),

  S('Spring-mass oscillator with a slider for the spring stiffness, and plot the motion.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 500 });
var anchor = create("hinge", { x: 300, y: 80 });
var bob = create("mass", { x: 300, y: 320, mass: 2 });
var spr = create("spring", { length: 220, k: 30 });
connect(spr.a, anchor.centre);
connect(spr.b, bob.centre);
var kSlider = create("slider", { x: 60, y: 460, min: 5, max: 120, step: 5, value: 30, label: "Stiffness k (N/m)", targetParamName: "k", targetObjectId: spr });
graph.plot(bob.y);`),

  S('Let me vary the resistance in a simple circuit and see the current change.', `
var bat = create("battery", { V: 9 });
var r = create("resistor", { R: 220, name: "R" });
connect(bat.positive, r.a);
connect(r.b, bat.negative);
var rSlider = create("slider", { x: 60, y: 420, min: 10, max: 1000, step: 10, value: 220, label: "R (ohm)", targetParamName: "R", targetObjectId: r });
graph.plot(r.I);`),

  S('Hang a mass from the ceiling on a spring and let it bounce. Plot the height.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 460 });
var anchor = create("hinge", { x: 300, y: 80 });
var bob = create("mass", { x: 300, y: 300, mass: 2 });
var spr = create("spring", { length: 200, k: 40 });
connect(spr.a, anchor.centre);
connect(spr.b, bob.centre);
graph.plot(bob.y);`),

  S('Two blocks on the ground joined by a rod, pushed along together.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 900, height: 560 });
var floor = create("ground", { x: 20, y: 500, width: 860 });
var b1 = create("block", { x: 200, y: 420, mass: 4, vx: 6 });
var b2 = create("block", { x: 400, y: 420, mass: 4 });
connect(b1.centre, b2.centre, "rod");
graph.plot(b2.vx);`),

  S('A mass swinging on a rope from a fixed point.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 560, height: 360 });
var top = create("hinge", { x: 320, y: 100 });
var ball = create("mass", { x: 480, y: 260, mass: 1 });
var line = create("rope", { length: 240 });
connect(line.a, top.centre);
connect(line.b, ball.centre);
graph.plot(ball.speed);`),

  S('Projectile motion: launch a ball at 45 degrees and plot its trajectory (y vs x).', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 900, height: 580 });
var floor = create("ground", { x: 20, y: 520, width: 860 });
var ball = create("mass", { x: 80, y: 480, mass: 1, vx: 8, vy: -8 });
graph.plot(ball.y, ball.x);`),

  S('Two infinite parallel plates with surface charge densities +sigma and -sigma separated by a dielectric of relative permittivity 4 — find the electric field intensity and the energy density between them.', `
var slab = create("dielectric", { x: 200, y: 180, width: 360, height: 200, epsr: 4, sigma: 1 });
var er = create("slider", { x: 200, y: 420, min: 1, max: 12, value: 4, label: "Relative permittivity", targetParamName: "epsr", targetObjectId: slab });
graph.plot(slab.E);`),

  S('A charged particle flying through a magnetic field region pointing out of the page — show the circular path.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 620, height: 460 });
var field = create("bfield", { x: 250, y: 150, width: 320, height: 260, Bz: 2 });
var particle = create("charge", { x: 100, y: 280, q: 1, vx: 10, showTrail: 1 });`),

  S('Block sliding down: give a block friction and elasticity, resting on the ground.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 800, height: 560 });
var floor = create("ground", { x: 20, y: 500, width: 760 });
var box = create("block", { x: 200, y: 420, mass: 5 });
box.set({ friction: 0.3, restitution: 0.1 });`),

  S('Converging lens imaging: light source, thin lens with 150 px focal length, and a screen to the right.', `
var sys = create("system", { x: 0, y: 0, domain: "optics", width: 720, height: 400 });
var src = create("light-source", { x: 80, y: 260 });
var lens = create("thin-lens", { x: 320, y: 200, f: 150 });
var scr = create("optical-screen", { x: 620, y: 180 });`),

  S('Plane wave hitting a boundary between two media.', `
var sys = create("system", { x: 0, y: 0, domain: "waves", width: 500, height: 380 });
var src = create("wave-source", { x: 100, y: 240 });
var boundary = create("wave-boundary", { x: 380, y: 180 });`),

  S('A quantum particle in a box next to a tunnel barrier demo.', `
var well = create("quantum-well", { x: 80, y: 100 });
var barrier = create("tunnel-barrier", { x: 420, y: 100 });`),

  S('Make a data table of time vs distance with a computed speed column, and a note explaining it.', `
var t = create("table", {
  headers: "SN;t;d;v=d/t",
  data: [[1, 1, 4.9], [2, 2, 19.6], [3, 3, 44.1]],
  summary: "Avg",
});
var n = create("note", { x: 420, y: 0, text: "Free-fall data — v column is computed live from d/t.", color: "mint" });`),

  S('Write the kinematics equation as a formula object with a heading text above it.', `
var heading = create("text", { x: 0, y: 0, text: "Equations of motion" });
var f = create("formula", { x: 0, y: 60, latex: "s = ut + \\\\frac{1}{2}at^2" });`),

  S('Open a DSA Lab with bubble sort in C++ so students can watch the array sort itself.', `
var lab = create("dsa", {
  source: "#include <iostream>\\nusing namespace std;\\nint main() {\\n  int a[6] = {5, 2, 8, 1, 9, 3};\\n  int n = 6;\\n  for (int i = 0; i < n - 1; i++) {\\n    for (int j = 0; j < n - 1 - i; j++) {\\n      if (a[j] > a[j + 1]) {\\n        int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;\\n      }\\n    }\\n  }\\n  cout << \\"done\\" << endl;\\n  return 0;\\n}\\n",
});`),

  S('Set up an engineering-economics cash-flow diagram and a note asking for NPV at 8% MARR.', `
var cf = create("cashflow", {});
var n = create("note", { x: 520, y: 0, text: "Fill in the investments and annuities, MARR = 8%. NPV updates live.", color: "amber" });`),

  S('Draw a mechanics system box, then a wheel on the ground inside it driven by a motor.', `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 520, height: 360 });
var floor = create("ground", { x: 40, y: 300, width: 440 });
var wheel = create("wheel", { x: 120, y: 210, mass: 2 });
var m = create("motor", { x: 260, y: 200, speed: 3 });`),

  S('Make a custom triangle shape and give it physics so it falls.', `
var floor = create("ground", { x: 0, y: 500, width: 800 });
var tri = create("polygon", { x: 300, y: 100, width: 80, height: 80 });
addproperty(tri, "rigidBody", { mass: 2 });`),

  S('Define a page variable k = 42 and label it with a text block.', `
var k = 42;
var label = create("text", { x: 0, y: 0, text: "k is a live page variable — use it in any parameter." });`),

  S('Measure power in an AC circuit with a wattmeter on a resistive load.', `
var src = create("ac-source", { V: 230, f: 50 });
var load = create("resistor", { R: 100 });
var wm = create("wattmeter", {});
connect(src.positive, wm.ip);
connect(wm.in_, load.a);
connect(load.b, src.negative);
connect(wm.vp, load.a);
connect(wm.vn, load.b);`),

  S('Step-down transformer 2:1 from a 240V AC source into a 100 ohm load; plot load voltage.', `
var src = create("ac-source", { V: 240, f: 50 });
var tr = create("transformer", { n: 2 });
var load = create("resistor", { R: 100 });
connect(src.positive, tr.p1);
connect(src.negative, tr.p2);
connect(tr.s1, load.a);
connect(tr.s2, load.b);
graph.plot(load.V);`),
]

// ── Auto-generated per-kind samples ──────────────────────────────────────────
// Guarantees every create() kind appears in the dataset at least once.

const JS_RESERVED = new Set(['switch', 'delete', 'new', 'class', 'return', 'in', 'if', 'do', 'for', 'var'])
const varName = (kind: string) => {
  const v = kind.replace(/-/g, '_').replace(/[^a-z0-9_]/gi, '')
  return JS_RESERVED.has(v) ? `${v}1` : v
}

function kindSample(k: KindInfo): Sample | null {
  if (k.scenarioOnly) return null
  const v = varName(k.kind)
  const params = k.params
    ? `{ ${Object.entries(k.params).map(([key, val]) => `${key}: ${typeof val === 'string' ? JSON.stringify(val) : val}`).join(', ')} }`
    : '{}'
  // circuit kinds get a working battery loop; everything else a bare create
  if ((k.domain === 'electrical' || k.domain === 'electronics') && k.a && k.b && k.kind !== 'battery') {
    return S(`Add a ${k.label} to a battery circuit so it actually carries current.`, `
var bat = create("battery", { V: 9 });
var ${v} = create("${k.kind}", ${params});
connect(bat.positive, ${v}.${k.a});
connect(${v}.${k.b}, bat.negative);`)
  }
  if (k.kind === 'battery') {
    return S('Add a 9V battery powering a small resistor load.', `
var bat = create("battery", { V: 9 });
var load = create("resistor", { R: 470 });
connect(bat.positive, load.a);
connect(load.b, bat.negative);`)
  }
  if (k.domain === 'digital') {
    if (k.kind === 'input' || k.kind === 'clock') {
      return S(`Add a ${k.label} feeding a logic probe.`, `
var src = create("${k.kind}", ${params});
var p = create("logic-probe", {});
connect(src.out, p.terminal);`)
    }
    if (k.kind === 'output' || k.kind === 'logic-probe') {
      return S(`Add a logic input wired to a ${k.label}.`, `
var a = create("input", { value: 1 });
var ${v} = create("${k.kind}", {});
connect(a.out, ${v}.${k.kind === 'output' ? 'in' : 'terminal'});`)
    }
    if (k.kind.endsWith('-gate') && k.kind !== 'not-gate') {
      return S(`Wire up a ${k.label} with two inputs and an output.`, `
var a = create("input", { value: 1, name: "A" });
var b = create("input", { value: 0, name: "B" });
var g = create("${k.kind}", {});
var q = create("output", { name: "Q" });
connect(a.out, g.in1);
connect(b.out, g.in2);
connect(g.out, q.in);`)
    }
    if (k.kind === 'not-gate') {
      return S('Wire a NOT gate between an input and an output.', `
var a = create("input", { value: 1, name: "A" });
var inv = create("not-gate", {});
var q = create("output", { name: "Q" });
connect(a.out, inv.in);
connect(inv.out, q.in);`)
    }
    if (k.kind === 'd-ff') {
      return S('Add a D flip-flop clocked at 1 Hz.', `
var d = create("input", { value: 1 });
var clk = create("clock", { f: 1 });
var ff = create("d-ff", {});
var q = create("output", { name: "Q" });
connect(d.out, ff.d);
connect(clk.out, ff.clk);
connect(ff.q, q.in);`)
    }
    return null
  }
  if (k.domain === 'mechanics') {
    if (k.kind === 'ground') return S('Add a ground platform near the bottom of the page.', `var floor = create("ground", { x: 0, y: 500, width: 800 });`)
    return S(`Add a ${k.label} resting above the ground.`, `
var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 800, height: 560 });
var floor = create("ground", { x: 20, y: 500, width: 760 });
var ${v} = create("${k.kind}", { x: 300, y: 380${k.params ? ', ' + Object.entries(k.params).map(([key, val]) => `${key}: ${val}`).join(', ') : ''} });`)
  }
  if (k.domain === 'waves' || k.domain === 'quantum') {
    return S(`Add a ${k.label} to the page.`, `var ${v} = create("${k.kind}", { x: 100, y: 100 });`)
  }
  if (k.kind === 'cashflow') return S('Add an empty cash-flow diagram to fill in.', `var cf = create("cashflow", {});`)
  if (k.kind === 'code') return S('Add a SimScript IDE block with a starter comment.', `var ide = create("code", { source: "// build something here\\n" });`)
  if (k.kind === 'line') return S('Draw a bare line shape.', `var l = create("line", { x: 100, y: 100, width: 200 });`)
  if (k.kind === 'polygon') return S('Draw a bare polygon shape.', `var p = create("polygon", { x: 100, y: 100, width: 90, height: 90 });`)
  return S(`Add a ${k.label} to the page.`, `var ${v} = create("${k.kind}", ${params});`)
}

// ── Prompt paraphrases (deterministic augmentation) ──────────────────────────

const REPHRASE: ((p: string) => string)[] = [
  (p) => p,
  (p) => `In my SIMBLIP notebook: ${p.charAt(0).toLowerCase()}${p.slice(1)}`,
  (p) => `Write SimScript to do this — ${p.charAt(0).toLowerCase()}${p.slice(1)}`,
]

export interface ChatSample {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
}

/** Full dataset: scenarios + one sample per catalog kind, times paraphrases. */
export function buildSamples(): Sample[] {
  const perKind = KIND_CATALOG.map(kindSample).filter((s): s is Sample => s !== null)
  return [...SCENARIOS, ...perKind]
}

export function buildDataset(paraphrases = REPHRASE.length): ChatSample[] {
  const out: ChatSample[] = []
  for (const s of buildSamples()) {
    for (let i = 0; i < Math.min(paraphrases, REPHRASE.length); i++) {
      out.push({
        messages: [
          { role: 'system', content: SIMSCRIPT_SYSTEM_PROMPT },
          { role: 'user', content: REPHRASE[i](s.prompt) },
          { role: 'assistant', content: s.script },
        ],
      })
    }
  }
  return out
}

/** Ollama Modelfile — `ollama create simblip-simscript -f Modelfile`. */
export function buildModelfile(base = 'qwen2.5-coder:7b', shots = 12): string {
  // MESSAGE pairs bake worked examples into the model itself. Without them
  // this file produced the base model wearing a system prompt — `ollama show
  // simblip-simscript` reported "MESSAGE lines: 0" — so all 84 corpus samples
  // were built, paraphrased, and then never seen by anything.
  //
  // These are the baseline every request starts from; lib/ai/few-shot.ts adds
  // per-request examples chosen for the actual question on top. Both matter:
  // the baked-in ones set the output shape even when retrieval finds nothing,
  // and they cost no prompt tokens per request.
  const examples = SCENARIOS.slice(0, shots).flatMap((s) => [
    `MESSAGE user """${s.prompt}"""`,
    `MESSAGE assistant """${s.script.trim()}"""`,
  ])
  return [
    `FROM ${base}`,
    '',
    'PARAMETER temperature 0.2',
    'PARAMETER num_ctx 8192',
    '',
    'SYSTEM """',
    SIMSCRIPT_SYSTEM_PROMPT,
    '"""',
    '',
    ...examples,
    '',
  ].join('\n')
}
