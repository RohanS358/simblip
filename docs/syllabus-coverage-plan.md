# SIMBLIP — Syllabus Coverage Plan

Goal: make SIMBLIP a complete simulator for the four Year-I courses whose PDFs live in
`public/`:

| # | Course | Code | Focus |
|---|--------|------|-------|
| 1 | Fundamentals of Electrical & Electronics Engg. | ENEX 101 | DC/AC circuits, diodes, transistors, op-amps |
| 2 | Engineering Physics | ENSH 102 | Oscillation, heat, optics, fields, EM, quantum |
| 3 | Electrical Circuits & Machines | ENEE 154 | Transients, frequency response, transformers, machines |
| 4 | Digital Logic | ENEX 152 | Gates, combinational, sequential, registers/counters |

Everything below follows the non-negotiable architecture: **geometry + behaviors + a
solver per domain**. A "new component" is never special-cased UI — it is a palette row
(`lib/scene/factory.ts`), terminal map + defaults + stamp (`lib/circuit/engine.ts`),
a glyph (`components/objects/geometry.tsx`), and optionally a doodle recognizer rule.
The inspector, world builder and AI importer pick it up from the registry for free.

---

## Current coverage (what already works)

- **Mechanics** — rigid/static bodies, spring, rope, rod, damper, hinge, motor, force
  fields (expression-driven), graphs bound to sim channels. Covers pendulums,
  spring–mass, damped/forced oscillation, projectile.
- **Circuits (MNA, transient)** — battery, AC source, R, bulb, C, L, switch, fuse,
  ground, voltmeter, ammeter, probe. Covers KVL/KCL, series/parallel, RC/RL/RLC
  transients, capacitor charge/discharge.
- **Electronics** — diode, LED, BJT (β switch model), MOSFET, ideal op-amp. Covers
  rectifier basics, clipper/clamper, inverting/non-inverting/summing amps.
- **Digital (fixpoint logic pass)** — AND/OR/XOR/NAND/NOR/NOT (2–8 inputs), D-FF,
  JK-FF, SR latch, MUX (2:1/4:1), half/full adder, decoder (2:4/3:8), comparator,
  clock, input, output, logic probe.
- **Registered, not live** — `heatSource`, `sensor` behaviors.

---

## Gap analysis by syllabus

### Syllabus 1 — ENEX 101
Missing: independent current source; the four controlled sources (VCVS, CCVS, VCCS,
CCCS); potentiometer (max-power-transfer lab); Zener diode (regulated supply);
waveform-selectable source (sine/square/triangle — function generator);
transformer incl. center-tapped (full-wave rectifier); three-phase source with
wye/delta; power measurement (real/reactive/apparent — wattmeter); phasor view;
RMS/average readouts on scope; PNP/PMOS complements (CMOS-as-logic practical).

### Syllabus 2 — ENSH 102 (largest gap — three whole domains absent)
Missing: torsion spring (torsion pendulum); resonance/Q-factor readouts;
**electrostatics** (point charges, dipole, E-field & potential visualization);
**charged-particle motion** in E/B field regions (cyclotron, eddy-current intuition);
**optics engine** — ray optics (lens, mirror, slit) and wave optics (single/double
slit intensity, grating, Newton's rings, thin films, polarization);
**thermal solver** (conduction through walls, Fourier's law, Newton's cooling);
**quantum demos** (particle in a box, barrier tunneling — 1D Schrödinger plots);
acoustics (Sabine reverberation — formula-level); EM plane-wave visualization.

### Syllabus 3 — ENEE 154
Missing: dependent sources (shared with S1); transformer with turns ratio + coupling
(OC/SC tests, regulation, efficiency); **frequency-response analyzer** (Bode
magnitude/phase, bandwidth, Q); filters are then free (RLC + analyzer); two-port
parameter extraction (Z/Y/ABCD/h); B-H hysteresis demo; **DC machine**
(motor/generator with back-EMF, torque — bridges circuit solver ↔ physics world);
induction motor torque-slip model; stepper motor. Transients themselves ✅ already live.

### Syllabus 4 — ENEX 152
Missing: T flip-flop; DEMUX; encoder + priority encoder; BCD/4:10 decoder option;
**7-segment display + BCD-to-7seg decoder**; **4-bit shift register**
(SISO/SIPO/PISO/PIPO via mode param); **4-bit counter** (async/sync, up/down, mod-n
via params); tri-state buffer; **timing-diagram view** (digital channels stacked in
the graph object); truth-table/K-map helper panel (nice-to-have).

---

## Build phases — one by one, each independently shippable

Ordered so every phase reuses what the previous one built, and circuit/digital wins
(cheap: registry + stamp + glyph) land before new solvers (expensive).

### Phase A — Circuit solver completions (S1 + S3 core) ~small/medium — ✅ DONE
1. `current-source` — independent I source. MNA: current injection at nodes (no extra row).
2. `vcvs`, `vccs`, `ccvs`, `cccs` — 4-terminal symbols `[ctrl+, ctrl−, out+, out−]`;
   VCCS is a plain G-stamp, VCVS/CCVS/CCCS need one extra MNA row each (same pattern
   as `battery`'s `vsrcRow`).
3. `zener` — diode stamp + reverse breakdown branch at `Vz`.
4. `potentiometer` — 3-terminal, `ratio` param, two internal R stamps.
5. `ac-source` waveform param (`sine | square | triangle`) → function generator for free.
6. `transformer` — 4-terminal ideal (turns ratio `n`, optional coupling `k`), plus
   `center-tap` variant (6-terminal) for full-wave rectifier labs.
7. `three-phase-source` — 3 (or 4 with neutral) terminals, 120° phase-shifted sines;
   wye/delta demos become drawable.
8. `pnp` / `pmos` params on existing bjt/mosfet (a `polarity` param, mirrored model).

**How**: for each — TERMINALS + DEFAULTS row in `lib/circuit/engine.ts`, stamp in the
MNA assembly, current readback in the measurement pass, palette row in `factory.ts`,
glyph in `geometry.tsx`.

### Phase B — Digital completions (S4) ~small — ✅ DONE
1. `t-ff` — trivial next to JK.
2. `demux` — 1:2/1:4 via `inputs` param (mirror of mux).
3. `encoder` — 4:2 / 8:3, plus `priority` param.
4. `seven-seg` — display object (7 input pins, lit-segment glyph) + `bcd-7seg` decoder chip.
5. `register4` — 4-bit shift register; `mode` param SISO/SIPO/PISO/PIPO decides pins used.
6. `counter4` — 4-bit counter; params: `mod`, `dir` (up/down), `sync` (0 = ripple).
   Stateful like the FFs (clock-edge update in the sequential pass).
7. `tristate` — buffer with enable (drives or floats; logic pass treats float as Z).
8. Timing-diagram mode on the graph object: bind multiple logic-probe channels, render
   stacked square traces. This is a graph rendering mode, not a new solver.

### Phase C — Measurement & analysis layer (S1 + S3) ~medium — ◐ PARTIAL
Done: oscilloscope readouts (RMS/avg/peak-peak/frequency/period) as a toggle on
every graph object; wattmeter (landed in Phase A). Deferred (larger, lower
ROI right now than the still-0%-covered physics domains): phasor diagram
object, frequency-response/Bode sweep, two-port extractor.
1. **Oscilloscope readouts** — RMS, average, peak, frequency, period computed over the
   graph window (pure post-processing of existing channels).
2. `wattmeter` — 4-terminal (V pair + I pair); computes P, Q, S, pf from the solver.
3. **Phasor diagram object** — new canvas object that renders live phasors of chosen
   channels once the circuit is in sinusoidal steady state.
4. **Frequency-response analyzer** — panel that reruns the linear MNA over a log
   frequency sweep (complex impedance version of the existing stamps) → Bode
   magnitude/phase into a graph object. Unlocks filters, bandwidth, Q, resonance.
5. **Two-port extractor** — mark 4 terminals, tool runs the solver twice with test
   sources, reports Z/Y/ABCD/h. (Lowest priority in this phase.)

### Phase D — Fields & charged particles (S2 electrostatics + EM) ~medium — ✅ DONE
Coulomb pairwise forces (`charge` behavior), uniform E/B field regions
(`efield`/`bfield`), torsion-spring hinges. Field-line visualization is a
simple decorative overlay (arrows/dots), not a computed potential map.
Faraday EMF-into-circuit demo deferred.
1. `charge` behavior (param `q`) attachable to bodies — Coulomb pair forces inside the
   existing physics world.
2. `efield` / `bfield` region behaviors on rects/circles — apply `qE` and `qv×B` to
   charged bodies each step (cyclotron, deflection, precipitator demos).
3. **Field visualization overlay** — field lines / potential color map computed from
   the charges on the page (render layer, no new solver).
4. `torsionSpring` behavior (κ, rest angle) on hinges — torsion pendulum.
5. Faraday demo: flux through a marked loop from `bfield` regions → EMF channel that
   can drive the circuit solver (magnet-through-coil preset).

### Phase E — Optics engine (S2 optics) ~large, new solver — ✅ DONE (geometric core)
New `lib/optics/engine.ts`: 2D ray tracer, pure function of the scene (no
time-stepping needed). `light-source` (circle, aims via rotation, fires a
parallel bundle), `thin-lens` (paraxial, verified converges parallel rays to
the focal point), `mirror` (specular reflection), `screen` (absorbs + marks
hit point), `slit` (1–2 gaps, for geometric single/double-slit demos). All
four primitives verified against hand-derived expected geometry. Deferred:
prism (needs real two-surface Snell's law), polarizer as a simulated element
(Malus's law is just `I=I0cos²θ`, already plottable as a graph formula with
zero new code). Wave-optics intensity curves (diffraction/interference
patterns) likewise need no new engine — they're formulas in the existing
Graph object.
1. New domain `optics` + `lib/optics/engine.ts` (2D ray tracer: source → refract/
   reflect at surfaces, Snell + focal-plane thin-lens model).
2. Components: `light-source` (beam/point, wavelength param), `thin-lens` (f), `mirror`
   (plane/spherical), `prism`, `screen` (catches rays, shows image position), `slit`.
3. Wave-optics parametric sims (analytic intensity curves into graph objects, plus a
   fringe render on the screen object): single slit, double slit, grating, Newton's
   rings, thin film. These are formulas + rendering — no PDE solver needed.
4. `polarizer` (Malus's law chain) and fiber-optics acceptance-angle demo.

### Phase F — Thermal solver (S2 heat) ~medium — ✅ DONE
`heatSource` behavior is live: Fourier conduction between Matter-touching
bodies (reuses the physics engine's own collision pairs), Newton cooling
toward the page's `ambient` variable, `temp` graph channel, heat-map tint
(blue↔red) on the body. Composite-wall demo = several heatSource blocks
placed touching in a row; no dedicated preset built.
1. Make `heatSource` live: each participating body gets temperature state; conduction
   between touching bodies via Fourier's law (k, area, thickness params), Newton's-law
   cooling to ambient, optional Stefan radiation term.
2. `thermometer` sensor behavior → graph channels (make `sensor` live here).
3. Composite-wall preset (thermal resistance in series — building-science lab).
4. Heat-map tint on bodies while simulating.

### Phase G — Machines (S3 back half) ~medium/large — ◐ PARTIAL
Done: `dc-machine` — the flagship piece, self-contained in the circuit
engine (armature = back-EMF k·ω in series with Ra, exactly like a diode's
on-state companion model but state-driven; shaft dynamics J·dω/dt =
T_em−load−friction·ω integrated alongside it, no separate physics body
needed). Verified: motor spin-up converges to the exact analytical
steady-state ω, loading correctly slows it and raises current, and the same
component generates power into a resistor when driven externally (negative
`load`) — motor and generator are the same model. Deferred: induction-motor
torque-slip curve, stepper, transformer OC/SC guided presets (the Phase-A
transformer already supports building the test circuit manually), B-H
hysteresis loop.
1. `dc-machine` component — the flagship cross-domain piece: electrical terminals in
   the MNA (back-EMF `k·ω` as a controlled source) + a shaft in the physics world
   (torque `k·I`). Motor and generator fall out of the same model. Load it with the
   existing mechanics (flywheel, belt via rod/rope) — speed/torque/current curves live.
2. Transformer tests (OC/SC) as guided presets on the Phase-A transformer with series
   R/L to model copper/iron losses → regulation & efficiency labs.
3. `induction-motor` — torque-slip analytic model (params R2, X, poles, f) driving a
   physics shaft; torque-slip curve in a graph.
4. `stepper` — pulse-input driven angular steps. B-H hysteresis loop demo object.

### Phase H — Quantum & wave demos (S2 modern physics) ~small/medium — ✅ DONE (verified, zero new code)
The formula engine wraps mathjs's full library (sin/cos/sinh/tanh/sqrt/exp/
factorial/pi all present, confirmed against the sandboxed instance in
lib/formula/engine.ts), so every item here is already plottable in the
existing Graph object or displayable in a Formula object, with page
variables standing in for constants (ħ, m, etc.):
- Particle in a box: `sqrt(2/L)*sin(n*pi*x/L)` (wavefunction), squared for
  probability density, `n^2*pi^2*hbar^2/(2*m*L^2)` for energy levels.
- Barrier tunneling: `1/(1+(V0^2*sinh(k2*L)^2)/(4*E*(V0-E)))` for T.
- EM plane wave: `E0*sin(k*x-w*t)`.
- Sabine reverberation: `0.161*V/A`.
All five verified numerically against the actual engine. No new component
needed — this phase was a coverage gap in documentation, not code.
1. Particle-in-a-box object: n, L params → wavefunction & probability density plots,
   energy-level diagram.
2. Barrier tunneling: E vs V₀, plots T/R coefficients + wavefunction sketch.
3. EM plane-wave visualization object (E ⊥ B animated); Poynting readout.
4. Sabine reverberation calculator as a formula template (acoustics is formula-level,
   no solver justified).

---

## Suggested order & why

**A → B → C → D → F → E → G → H.**
A and B are pure registry work on live solvers — maximum syllabus coverage per line of
code, and they complete S4 almost entirely. C turns existing sims into *measurable*
labs (that's what the practicals grade). D and F extend the physics world without a
new engine. E is the one genuinely new engine — schedule it when the registry pattern
is well-worn. G is the showpiece (two engines coupled) and depends on A's transformer
and D's field work. H is self-contained demos, anytime filler.

After each phase: add the new components to doodle recognition where a natural sketch
exists, and to the AI importer examples so "draw me a full-wave rectifier" works.
