// Scene recipes — the "teacher" the small model learns from.
//
// Each recipe is a function of a random source that returns
//     { prompts: string[], script: string }
// The script is what a GOOD author would write, not the minimum that runs:
//
//   • parts are NAMED (R1, R2, Vs, Bob) so plots and notes can refer to them
//   • the quantity that matters is PLOTTED (graph.plot)
//   • a NOTE says what to look at, with the real numbers worked out
//   • the knobs worth turning are SLIDERS bound to the part (targetObjectId)
//   • coordinates appear only where they are meaningful: bodies in a mechanics
//     box. Circuits take none (the layout engine draws them), and graph / note /
//     sliders take none (the composition pass places them) — so the model never
//     does arithmetic about a board it cannot see.
//
// Every script a recipe emits is run through the real app and scored
// (lib/ai/quality/score.ts) before it may become training data, so a recipe bug
// cannot teach the model something that does not run.

// ── Randomness ──────────────────────────────────────────────────────────────

export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r = () => next()
  r.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1))
  r.pick = (arr) => arr[Math.floor(next() * arr.length)]
  r.chance = (p) => next() < p
  r.shuffle = (arr) => { const c = [...arr]; for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [c[i], c[j]] = [c[j], c[i]] } return c }
  return r
}

const R_VALUES = [47, 68, 100, 120, 150, 180, 220, 270, 330, 390, 470, 560, 680, 820, 1000, 1200, 1500, 1800, 2200, 2700, 3300, 3900, 4700, 5600, 6800, 8200, 10000]
const V_VALUES = [1.5, 3, 4.5, 5, 6, 9, 12, 15, 18, 24]
const C_VALUES = [1e-6, 2.2e-6, 4.7e-6, 1e-5, 4.7e-5, 1e-4, 2.2e-4, 1e-3]
const L_VALUES = [0.01, 0.022, 0.047, 0.1, 0.22, 0.47, 1]

/** Human number: 1000 → "1 kΩ", 4.7e-6 → "4.7 µF". */
export const fmt = {
  ohm: (r) => (r >= 1e6 ? `${r / 1e6} MΩ` : r >= 1000 ? `${r / 1000} kΩ` : `${r} Ω`),
  farad: (c) => (c >= 1e-3 ? `${c * 1e3} mF` : c >= 1e-6 ? `${+(c * 1e6).toPrecision(3)} µF` : `${+(c * 1e9).toPrecision(3)} nF`),
  henry: (l) => (l >= 1 ? `${l} H` : `${+(l * 1e3).toPrecision(3)} mH`),
  num: (x, d = 3) => String(+Number(x).toPrecision(d)),
}
const ohmWord = (r) => (r >= 1000 ? `${r / 1000}k` : `${r}`)

// ── Prompt phrasing ─────────────────────────────────────────────────────────
// The same scene is asked for the way a student, a teacher, and someone who
// has never heard the word "simulation" would ask. A model trained on one voice
// fails the other two.

export function phrase(r, topic, { detail = '', plain = '' } = {}) {
  const d = detail ? ` ${detail}` : ''
  const t = [
    `Build ${topic}${d}.`,
    `Make ${topic}${d}.`,
    `Show me ${topic}${d}.`,
    `Simulate ${topic}${d}.`,
    `Create ${topic}${d} so I can experiment with it.`,
    `I want to see ${topic}${d}.`,
    `Can you set up ${topic}${d}?`,
    `Set up a classroom demo of ${topic}${d}.`,
    `${cap(topic)}${d}.`,
    `Draw ${topic}${d} and let me play with the numbers.`,
    `Help me understand ${topic}${d} — build it so I can watch it.`,
  ]
  if (plain) t.push(plain, plain, `${plain} Show me.`)
  return r.pick(t)
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// ── Script pieces ───────────────────────────────────────────────────────────

const note = (text) => `var note = create("note", { text: ${JSON.stringify(text)} });`
const slider = (v, o) =>
  `var ${v} = create("slider", { min: ${o.min}, max: ${o.max}, step: ${o.step}, value: ${o.value}, label: ${JSON.stringify(o.label)}, targetParamName: ${JSON.stringify(o.param)}, targetObjectId: ${o.target} });`
const lines = (...l) => l.flat().filter(Boolean).join('\n')

// ── Circuits (drawn by the rail / annealer layout) ──────────────────────────

function seriesResistors(r) {
  const n = r.int(2, 6)
  const V = r.pick(V_VALUES)
  const Rs = Array.from({ length: n }, () => r.pick(R_VALUES.slice(0, 17)))
  const total = Rs.reduce((a, b) => a + b, 0)
  const I = V / total
  const meter = r.chance(0.5)
  const names = Rs.map((_, i) => `r${i + 1}`)
  const withMeter = meter ? 'ammeter' : null
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vs" });`,
    names.map((v, i) => `var ${v} = create("resistor", { R: ${Rs[i]}, name: "R${i + 1}" });`),
    withMeter && `var am = create("ammeter", {});`,
    `connect(bat.positive, ${withMeter ? 'am.a' : 'r1.a'});`,
    withMeter && `connect(am.b, r1.a);`,
    names.slice(0, -1).map((v, i) => `connect(${v}.b, ${names[i + 1]}.a);`),
    `connect(${names[n - 1]}.b, bat.negative);`,
    `graph.plot(${names[0]}.I);`,
    note(`**Series circuit.** The same current flows through every resistor: I = V / (R1+…+R${n}) = ${V} / ${fmt.num(total)} = ${fmt.num(I * 1000)} mA. The voltages across the resistors add up to the supply, ${V} V.`),
    slider('vs', { min: 1, max: 30, step: 1, value: V, label: 'Supply voltage (V)', param: 'V', target: 'bat' }),
    slider('rs', { min: 50, max: 10000, step: 50, value: Rs[0], label: 'R1 (ohm)', param: 'R', target: 'r1' })
  )
  const topic = `a series circuit with a ${V} V battery and ${n} resistors`
  return {
    prompts: [
      phrase(r, topic, { detail: `(${Rs.map(fmt.ohm).join(', ')})`, plain: 'Why does the same current go through every resistor in a row? Show me.' }),
      phrase(r, `${n} resistors in series on a ${V} volt battery`),
      phrase(r, 'a series circuit', { plain: `Make a simple circuit with ${n} resistors one after another.` }),
    ],
    script,
  }
}

function parallelResistors(r) {
  const n = r.int(2, 4)
  const V = r.pick(V_VALUES)
  const Rs = Array.from({ length: n }, () => r.pick(R_VALUES.slice(0, 17)))
  const g = Rs.reduce((a, b) => a + 1 / b, 0)
  const Req = 1 / g
  const names = Rs.map((_, i) => `r${i + 1}`)
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vs" });`,
    `var am = create("ammeter", {});`,
    names.map((v, i) => `var ${v} = create("resistor", { R: ${Rs[i]}, name: "R${i + 1}" });`),
    `connect(bat.positive, am.a);`,
    names.map((v) => `connect(am.b, ${v}.a);`),
    names.map((v) => `connect(${v}.b, bat.negative);`),
    `graph.plot(am.I);`,
    note(`**Parallel circuit.** Every branch sees the full ${V} V, and the branch currents add. 1/R = ${Rs.map((x) => `1/${x}`).join(' + ')}, so the equivalent resistance is ${fmt.num(Req)} Ω and the ammeter reads ${fmt.num((V / Req) * 1000)} mA. Adding a branch always lowers the total resistance.`),
    slider('rs', { min: 50, max: 10000, step: 50, value: Rs[0], label: 'R1 (ohm)', param: 'R', target: 'r1' })
  )
  return {
    prompts: [
      phrase(r, `${n} resistors in parallel across a ${V} V battery`, { detail: 'with an ammeter for the total current' }),
      phrase(r, 'a parallel circuit', { plain: 'Why does adding more branches make the battery work harder? Show me a parallel circuit.' }),
      phrase(r, `a parallel bank of ${n} resistors (${Rs.map(fmt.ohm).join(', ')})`),
    ],
    script,
  }
}

function divider(r) {
  const V = r.pick([5, 9, 12, 15, 24])
  const R1 = r.pick([1000, 2200, 4700, 10000])
  const R2 = r.pick([1000, 2200, 3300, 4700, 10000])
  const Vout = (V * R2) / (R1 + R2)
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vin" });`,
    `var r1 = create("resistor", { R: ${R1}, name: "R1" });`,
    `var r2 = create("resistor", { R: ${R2}, name: "R2" });`,
    `var vm = create("voltmeter", {});`,
    `connect(bat.positive, r1.a);`,
    `connect(r1.b, r2.a);`,
    `connect(r2.b, bat.negative);`,
    `connect(vm.a, r1.b);`,
    `connect(vm.b, r2.b);`,
    `graph.plot(r2.V);`,
    note(`**Voltage divider.** Vout = Vin · R2 / (R1 + R2) = ${V} · ${fmt.num(R2)} / ${fmt.num(R1 + R2)} = ${fmt.num(Vout)} V. The meter reads the share of the supply that falls across R2; make R2 bigger and its share grows.`),
    slider('s2', { min: 500, max: 20000, step: 500, value: R2, label: 'R2 (ohm)', param: 'R', target: 'r2' }),
    slider('s1', { min: 500, max: 20000, step: 500, value: R1, label: 'R1 (ohm)', param: 'R', target: 'r1' })
  )
  return {
    prompts: [
      phrase(r, `a voltage divider on a ${V} V supply`, { detail: `with R1 = ${fmt.ohm(R1)} and R2 = ${fmt.ohm(R2)}, measuring the output` }),
      phrase(r, 'a voltage divider', { plain: 'How do I get a smaller voltage out of a bigger battery? Build it.' }),
      phrase(r, `a potential divider with ${fmt.ohm(R1)} and ${fmt.ohm(R2)}`, { detail: 'and a voltmeter across the second resistor' }),
    ],
    script,
  }
}

function seriesParallel(r) {
  const V = r.pick(V_VALUES)
  const R1 = r.pick([100, 220, 330, 470])
  const R2 = r.pick([220, 330, 470, 680, 1000])
  const R3 = r.pick([220, 330, 470, 680, 1000])
  const Rp = (R2 * R3) / (R2 + R3)
  const Rt = R1 + Rp
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vs" });`,
    `var r1 = create("resistor", { R: ${R1}, name: "R1" });`,
    `var r2 = create("resistor", { R: ${R2}, name: "R2" });`,
    `var r3 = create("resistor", { R: ${R3}, name: "R3" });`,
    `connect(bat.positive, r1.a);`,
    `connect(r1.b, r2.a);`,
    `connect(r1.b, r3.a);`,
    `connect(r2.b, bat.negative);`,
    `connect(r3.b, bat.negative);`,
    `graph.plot(r1.I);`,
    note(`**Series + parallel.** R2 and R3 share the voltage across them: their parallel value is ${fmt.num(Rp)} Ω. Add R1 in series and the total is ${fmt.num(Rt)} Ω, so the battery supplies ${fmt.num((V / Rt) * 1000)} mA, all of which flows through R1 and then splits between R2 and R3.`),
    slider('s3', { min: 100, max: 2000, step: 50, value: R3, label: 'R3 (ohm)', param: 'R', target: 'r3' })
  )
  return {
    prompts: [
      phrase(r, `a series-parallel circuit: R1 = ${fmt.ohm(R1)} in series with R2 = ${fmt.ohm(R2)} and R3 = ${fmt.ohm(R3)} in parallel`, { detail: `on ${V} V` }),
      phrase(r, 'a circuit with a resistor in series with two parallel resistors'),
      phrase(r, 'a mixed series and parallel circuit', { plain: 'Show me how current splits after the first resistor.' }),
    ],
    script,
  }
}

function rcCharging(r) {
  const V = r.pick([5, 9, 12])
  const R = r.pick([470, 1000, 2200, 4700, 10000])
  const C = r.pick([1e-6, 4.7e-6, 1e-5, 4.7e-5, 1e-4, 1e-3])
  const tau = R * C
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vs" });`,
    `var sw = create("switch", { closed: 1, name: "S1" });`,
    `var r = create("resistor", { R: ${R}, name: "R" });`,
    `var c = create("capacitor", { C: ${C}, name: "C" });`,
    `connect(bat.positive, sw.a);`,
    `connect(sw.b, r.a);`,
    `connect(r.b, c.a);`,
    `connect(c.b, bat.negative);`,
    `graph.plot(c.V);`,
    note(`**RC charging.** The capacitor voltage climbs toward ${V} V along an exponential with time constant τ = R·C = ${fmt.num(R)} Ω × ${fmt.farad(C)} = ${fmt.num(tau)} s. After 1 τ it is at 63%, after 5 τ it is full. A bigger R or C stretches the curve.`),
    slider('rs', { min: 100, max: 20000, step: 100, value: R, label: 'R (ohm)', param: 'R', target: 'r' }),
    slider('cs', { min: C / 4, max: C * 4, step: C / 4, value: C, label: 'C (farad)', param: 'C', target: 'c' })
  )
  return {
    prompts: [
      phrase(r, `an RC circuit charging a ${fmt.farad(C)} capacitor through ${fmt.ohm(R)} from a ${V} V battery`, { detail: 'and plot the capacitor voltage' }),
      phrase(r, 'a capacitor charging through a resistor', { plain: 'How does a capacitor fill up with charge over time?' }),
      phrase(r, 'RC charging with a switch'),
    ],
    script,
  }
}

function rcLowpass(r) {
  const V = r.pick([1, 5, 10])
  const f = r.pick([50, 100, 500, 1000, 5000])
  const R = r.pick([470, 1000, 2200, 4700, 10000])
  const C = r.pick([1e-8, 1e-7, 4.7e-7, 1e-6, 1e-5])
  const fc = 1 / (2 * Math.PI * R * C)
  const script = lines(
    `var src = create("ac-source", { V: ${V}, f: ${f}, name: "Vin" });`,
    `var r = create("resistor", { R: ${R}, name: "R" });`,
    `var c = create("capacitor", { C: ${C}, name: "C" });`,
    `connect(src.positive, r.a);`,
    `connect(r.b, c.a);`,
    `connect(c.b, src.negative);`,
    `graph.plot(c.V);`,
    note(`**RC low-pass filter.** The cutoff is fc = 1 / (2π·R·C) = ${fmt.num(fc)} Hz. The source runs at ${f} Hz, so the output is ${f < fc ? 'passed almost unchanged' : f > fc ? 'attenuated and lagging' : 'down to 70%'}. Move the frequency across fc and watch the amplitude fall.`),
    slider('fs', { min: 10, max: 10000, step: 10, value: f, label: 'Frequency (Hz)', param: 'f', target: 'src' }),
    slider('rs', { min: 100, max: 20000, step: 100, value: R, label: 'R (ohm)', param: 'R', target: 'r' })
  )
  return {
    prompts: [
      phrase(r, `an RC low-pass filter with ${fmt.ohm(R)} and ${fmt.farad(C)} driven at ${f} Hz`, { detail: 'plotting the output across the capacitor' }),
      phrase(r, 'a low-pass filter', { plain: 'How does a circuit block high frequencies but let low ones through?' }),
      phrase(r, `a first-order RC filter on a ${V} V AC source`),
    ],
    script,
  }
}

function rlCircuit(r) {
  const V = r.pick([6, 9, 12])
  const R = r.pick([22, 47, 100, 220])
  const L = r.pick([0.047, 0.1, 0.22, 0.47])
  const tau = L / R
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vs" });`,
    `var sw = create("switch", { closed: 1, name: "S1" });`,
    `var r = create("resistor", { R: ${R}, name: "R" });`,
    `var l = create("inductor", { L: ${L}, name: "L" });`,
    `connect(bat.positive, sw.a);`,
    `connect(sw.b, r.a);`,
    `connect(r.b, l.a);`,
    `connect(l.b, bat.negative);`,
    `graph.plot(l.I);`,
    note(`**RL circuit.** An inductor resists a sudden change in current, so the current rises gradually to V/R = ${fmt.num(V / R * 1000)} mA with time constant τ = L/R = ${fmt.henry(L)} / ${R} Ω = ${fmt.num(tau * 1000)} ms.`),
    slider('ls', { min: 0.01, max: 1, step: 0.01, value: L, label: 'L (henry)', param: 'L', target: 'l' }),
    slider('rs', { min: 10, max: 500, step: 10, value: R, label: 'R (ohm)', param: 'R', target: 'r' })
  )
  return {
    prompts: [
      phrase(r, `an RL circuit with ${fmt.henry(L)} and ${fmt.ohm(R)} on ${V} V`, { detail: 'and plot the inductor current' }),
      phrase(r, 'an inductor and a resistor in series', { plain: 'Why does the current in a coil take time to build up?' }),
    ],
    script,
  }
}

function rlcSeries(r) {
  const V = r.pick([5, 10, 12])
  const R = r.pick([10, 22, 47, 100])
  const L = r.pick([0.01, 0.022, 0.047, 0.1])
  const C = r.pick([1e-6, 4.7e-6, 1e-5, 1e-4])
  const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C))
  const f = Math.round(f0 / 10) * 10 || 50
  const script = lines(
    `var src = create("ac-source", { V: ${V}, f: ${f}, name: "Vs" });`,
    `var r = create("resistor", { R: ${R}, name: "R" });`,
    `var l = create("inductor", { L: ${L}, name: "L" });`,
    `var c = create("capacitor", { C: ${C}, name: "C" });`,
    `connect(src.positive, r.a);`,
    `connect(r.b, l.a);`,
    `connect(l.b, c.a);`,
    `connect(c.b, src.negative);`,
    `graph.plot(r.I);`,
    note(`**Series RLC.** Resonance is at f0 = 1 / (2π√(LC)) = ${fmt.num(f0)} Hz, where the inductor and capacitor cancel and only R=${R} Ω limits the current (${fmt.num(V / R * 1000)} mA). The source is set near f0: slide the frequency away and the current collapses.`),
    slider('fs', { min: Math.max(10, Math.round(f0 / 4)), max: Math.round(f0 * 3), step: 10, value: f, label: 'Frequency (Hz)', param: 'f', target: 'src' }),
    slider('rs', { min: 5, max: 200, step: 5, value: R, label: 'R (ohm)', param: 'R', target: 'r' })
  )
  return {
    prompts: [
      phrase(r, `a series RLC circuit (R=${fmt.ohm(R)}, L=${fmt.henry(L)}, C=${fmt.farad(C)}) on an AC source`, { detail: 'near resonance' }),
      phrase(r, 'a resonant circuit', { plain: 'Show me resonance — why does a radio pick one station?' }),
      phrase(r, 'a series RLC circuit and plot the current'),
    ],
    script,
  }
}

function ledResistor(r) {
  const V = r.pick([5, 9, 12])
  const Vf = r.pick([1.8, 2, 2.1, 3.2])
  const I = r.pick([0.01, 0.015, 0.02])
  const R = Math.max(10, Math.round((V - Vf) / I / 10) * 10)
  const script = lines(
    `var bat = create("battery", { V: ${V}, name: "Vs" });`,
    `var sw = create("switch", { closed: 1, name: "S1" });`,
    `var r = create("resistor", { R: ${R}, name: "R1" });`,
    `var led = create("led", { Vf: ${Vf}, name: "D1" });`,
    `connect(bat.positive, sw.a);`,
    `connect(sw.b, r.a);`,
    `connect(r.b, led.anode);`,
    `connect(led.cathode, bat.negative);`,
    `graph.plot(r.I);`,
    note(`**LED with a current-limiting resistor.** An LED drops about ${Vf} V and has almost no resistance of its own, so the resistor must take the rest: R = (${V} − ${Vf}) / ${I * 1000} mA = ${R} Ω. Without it the current would be limited only by the wires.`),
    slider('rs', { min: 50, max: 1000, step: 10, value: R, label: 'R1 (ohm)', param: 'R', target: 'r' })
  )
  return {
    prompts: [
      phrase(r, `an LED on a ${V} V battery with a resistor and a switch`),
      phrase(r, 'an LED circuit', { plain: 'Why does an LED need a resistor? Show me.' }),
      phrase(r, `a current-limiting resistor for a ${Vf} V LED at ${I * 1000} mA from ${V} V`),
    ],
    script,
  }
}

function rectifier(r) {
  const V = r.pick([6, 9, 12])
  // Not 60 Hz: the engine steps at 120 Hz, so a 60 Hz source is sampled exactly at its
  // zero crossings and looks DEAD (Nyquist). 50 and 100 Hz are safe.
  const f = r.pick([50, 100])
  const R = r.pick([470, 1000, 2200])
  const smooth = r.chance(0.5)
  const C = r.pick([1e-5, 4.7e-5, 1e-4])
  const script = lines(
    `var src = create("ac-source", { V: ${V}, f: ${f}, name: "Vin" });`,
    `var d = create("diode", { Vf: 0.7, name: "D1" });`,
    `var load = create("resistor", { R: ${R}, name: "Load" });`,
    smooth && `var c = create("capacitor", { C: ${C}, name: "C1" });`,
    `connect(src.positive, d.anode);`,
    `connect(d.cathode, load.a);`,
    smooth && `connect(d.cathode, c.a);`,
    `connect(load.b, src.negative);`,
    smooth && `connect(c.b, src.negative);`,
    `graph.plot(load.V);`,
    note(smooth
      ? `**Half-wave rectifier with a smoothing capacitor.** The diode passes only the positive half-cycles. The capacitor charges to the peak (${fmt.num(V - 0.7)} V) and holds the load voltage up between peaks — the ripple shrinks as C grows.`
      : `**Half-wave rectifier.** The diode passes only the positive half-cycles of the ${f} Hz source, so the load sees pulses of up to ${fmt.num(V - 0.7)} V (the peak minus the diode's 0.7 V drop) and nothing for the other half.`),
    smooth
      ? slider('cs', { min: 1e-6, max: 1e-3, step: 1e-5, value: C, label: 'Smoothing C (farad)', param: 'C', target: 'c' })
      : slider('rs', { min: 100, max: 5000, step: 100, value: R, label: 'Load (ohm)', param: 'R', target: 'load' })
  )
  return {
    prompts: [
      phrase(r, `a half-wave rectifier on a ${V} V ${f} Hz source${smooth ? ' with a smoothing capacitor' : ''}`, { detail: 'plotting the load voltage' }),
      phrase(r, 'a rectifier', { plain: 'How do you turn AC into DC with a diode?' }),
      phrase(r, `a diode, a ${fmt.ohm(R)} load and an AC source${smooth ? ', then smooth it' : ''}`),
    ],
    script,
  }
}

function bulbsSeriesParallel(r) {
  const V = r.pick([6, 9, 12])
  const parallel = r.chance(0.55)
  const R1 = r.pick([10, 15, 20, 30])
  const R2 = r.pick([10, 15, 20, 30])
  const script = parallel
    ? lines(
        `var bat = create("battery", { V: ${V}, name: "Vs" });`,
        `var am = create("ammeter", {});`,
        `var b1 = create("bulb", { R: ${R1}, name: "B1" });`,
        `var b2 = create("bulb", { R: ${R2}, name: "B2" });`,
        `connect(bat.positive, am.a);`,
        `connect(am.b, b1.a);`,
        `connect(am.b, b2.a);`,
        `connect(b1.b, bat.negative);`,
        `connect(b2.b, bat.negative);`,
        `graph.plot(b1.I);`,
        note(`**Two bulbs in parallel.** Each bulb gets the full ${V} V, so each shines at full brightness: ${fmt.num(V / R1 * 1000)} mA and ${fmt.num(V / R2 * 1000)} mA. If one burns out the other keeps working — this is how houses are wired.`),
        slider('rs', { min: 5, max: 100, step: 5, value: R1, label: 'B1 resistance (ohm)', param: 'R', target: 'b1' })
      )
    : lines(
        `var bat = create("battery", { V: ${V}, name: "Vs" });`,
        `var sw = create("switch", { closed: 1, name: "S1" });`,
        `var b1 = create("bulb", { R: ${R1}, name: "B1" });`,
        `var b2 = create("bulb", { R: ${R2}, name: "B2" });`,
        `connect(bat.positive, sw.a);`,
        `connect(sw.b, b1.a);`,
        `connect(b1.b, b2.a);`,
        `connect(b2.b, bat.negative);`,
        `graph.plot(b1.I);`,
        note(`**Two bulbs in series.** The same ${fmt.num(V / (R1 + R2) * 1000)} mA flows through both, and the ${V} V is shared between them, so each is dimmer than a lone bulb. If one fails the circuit is broken and both go out.`),
        slider('rs', { min: 5, max: 100, step: 5, value: R1, label: 'B1 resistance (ohm)', param: 'R', target: 'b1' })
      )
  return {
    prompts: [
      phrase(r, parallel ? `two bulbs in parallel on a ${V} V battery with an ammeter` : `two bulbs in series on a ${V} V battery with a switch`),
      phrase(r, parallel ? 'a parallel lighting circuit' : 'a series lighting circuit', { plain: parallel ? 'Why do the other lights stay on when one bulb burns out?' : 'Why do both bulbs go out when one is removed?' }),
    ],
    script,
  }
}

function invertingOpamp(r) {
  const Rin = r.pick([1000, 2200, 4700, 10000])
  const gain = r.pick([2, 5, 10, 20])
  const Rf = Rin * gain
  const Vin = r.pick([0.1, 0.2, 0.5])
  const f = r.pick([100, 500, 1000])
  const script = lines(
    `var vin = create("ac-source", { V: ${Vin}, f: ${f}, name: "Vin" });`,
    `var rin = create("resistor", { R: ${Rin}, name: "Rin" });`,
    `var rf = create("resistor", { R: ${Rf}, name: "Rf" });`,
    `var op = create("opamp", {});`,
    `var g = create("gnd", {});`,
    `connect(vin.positive, rin.a);`,
    `connect(rin.b, op.inn);`,
    `connect(rf.a, op.inn);`,
    `connect(rf.b, op.out);`,
    `connect(op.inp, vin.negative);`,
    `connect(g.terminal, vin.negative);`,
    `graph.plot(op.V);`,
    note(`**Inverting amplifier.** The gain is −Rf/Rin = −${fmt.num(Rf)} / ${fmt.num(Rin)} = −${gain}, so a ${Vin} V input becomes ${fmt.num(Vin * gain)} V flipped upside down. The op-amp holds its − input at virtual ground, which is why only the resistors set the gain.`),
    slider('fs', { min: 50, max: 2000, step: 50, value: f, label: 'Frequency (Hz)', param: 'f', target: 'vin' }),
    slider('rfs', { min: 1000, max: Rf * 3, step: 1000, value: Rf, label: 'Rf (ohm)', param: 'R', target: 'rf' })
  )
  return {
    prompts: [
      phrase(r, `an inverting op-amp amplifier with gain −${gain}`, { detail: `(Rin = ${fmt.ohm(Rin)}, Rf = ${fmt.ohm(Rf)})` }),
      phrase(r, 'an op-amp amplifier', { plain: 'How does an op-amp make a small signal bigger? Build one.' }),
    ],
    script,
  }
}

function transformerStepDown(r) {
  const Vp = r.pick([120, 230, 240])
  const n = r.pick([2, 4, 10, 20])
  const R = r.pick([10, 22, 47, 100])
  const script = lines(
    `var src = create("ac-source", { V: ${Vp}, f: 50, name: "Mains" });`,
    `var tr = create("transformer", { n: ${n} });`,
    `var load = create("resistor", { R: ${R}, name: "Load" });`,
    `connect(src.positive, tr.p1);`,
    `connect(src.negative, tr.p2);`,
    `connect(tr.s1, load.a);`,
    `connect(tr.s2, load.b);`,
    `graph.plot(load.V);`,
    note(`**Step-down transformer.** With a ${n}:1 turns ratio the secondary voltage is ${Vp} / ${n} = ${fmt.num(Vp / n)} V, and the secondary current is ${n} times the primary current. Power in ≈ power out: ${fmt.num((Vp / n) ** 2 / R)} W into the ${R} Ω load.`),
    slider('ns', { min: 1, max: 30, step: 1, value: n, label: 'Turns ratio', param: 'n', target: 'tr' })
  )
  return {
    prompts: [
      phrase(r, `a ${n}:1 step-down transformer from a ${Vp} V AC source into a ${R} Ω load`),
      phrase(r, 'a transformer', { plain: 'How does a phone charger turn mains voltage into a small voltage?' }),
    ],
    script,
  }
}

// ── Digital ─────────────────────────────────────────────────────────────────

function gate(r) {
  const kinds = [['and-gate', 'AND', (a, b) => a & b], ['or-gate', 'OR', (a, b) => a | b], ['xor-gate', 'XOR', (a, b) => a ^ b], ['nand-gate', 'NAND', (a, b) => 1 - (a & b)], ['nor-gate', 'NOR', (a, b) => 1 - (a | b)]]
  const [kind, name, fn] = r.pick(kinds)
  const a = r.int(0, 1)
  const b = r.int(0, 1)
  const script = lines(
    `var a = create("input", { value: ${a}, name: "A" });`,
    `var b = create("input", { value: ${b}, name: "B" });`,
    `var gate = create("${kind}", {});`,
    `var q = create("output", { name: "Q" });`,
    `connect(a.out, gate.in1);`,
    `connect(b.out, gate.in2);`,
    `connect(gate.out, q.in);`,
    `var tt = create("truthtable", { inputs: "A,B", outputs: "Q" });`,
    note(`**${name} gate.** With A = ${a} and B = ${b} the output is Q = ${fn(a, b)}. ${name === 'AND' ? 'AND is 1 only when both inputs are 1.' : name === 'OR' ? 'OR is 1 when at least one input is 1.' : name === 'XOR' ? 'XOR is 1 when the inputs differ.' : name === 'NAND' ? 'NAND is the opposite of AND — it is 0 only when both inputs are 1.' : 'NOR is 1 only when both inputs are 0.'} Click the inputs to toggle them and compare with the truth table.`)
  )
  return {
    prompts: [
      phrase(r, `a ${name} gate with two inputs and a truth table`),
      phrase(r, `a ${name} gate`, { plain: `How does a ${name} gate decide its output? Let me flip the inputs.` }),
    ],
    script,
  }
}

function halfAdder(r) {
  const a = r.int(0, 1)
  const b = r.int(0, 1)
  const script = lines(
    `var a = create("input", { value: ${a}, name: "A" });`,
    `var b = create("input", { value: ${b}, name: "B" });`,
    `var ha = create("half-adder", {});`,
    `var s = create("output", { name: "Sum" });`,
    `var c = create("output", { name: "Carry" });`,
    `connect(a.out, ha.a);`,
    `connect(b.out, ha.b);`,
    `connect(ha.sum, s.in);`,
    `connect(ha.carry, c.in);`,
    note(`**Half adder.** It adds two single bits: Sum = A XOR B and Carry = A AND B. ${a} + ${b} = ${a + b}, so Sum = ${a ^ b} and Carry = ${a & b}. Only 1 + 1 produces a carry.`)
  )
  return { prompts: [phrase(r, 'a half adder with two inputs'), phrase(r, 'a circuit that adds two bits', { plain: 'How does a computer add 1 + 1?' })], script }
}

function counter(r) {
  const f = r.pick([1, 2, 4])
  const script = lines(
    `var clk = create("clock", { f: ${f} });`,
    `var cnt = create("counter4", { mod: 16 });`,
    `var q0 = create("logic-probe", { name: "Q0" });`,
    `var q1 = create("logic-probe", { name: "Q1" });`,
    `var q2 = create("logic-probe", { name: "Q2" });`,
    `var q3 = create("logic-probe", { name: "Q3" });`,
    `connect(clk.out, cnt.clk);`,
    `connect(cnt.q0, q0.terminal);`,
    `connect(cnt.q1, q1.terminal);`,
    `connect(cnt.q2, q2.terminal);`,
    `connect(cnt.q3, q3.terminal);`,
    note(`**4-bit binary counter.** Each clock pulse (${f} Hz) adds 1. Q0 toggles every pulse, Q1 every two, Q2 every four, Q3 every eight — together they count 0000 to 1111 (0 to 15) and then wrap around.`),
    slider('fs', { min: 1, max: 10, step: 1, value: f, label: 'Clock (Hz)', param: 'f', target: 'clk' })
  )
  return { prompts: [phrase(r, `a 4-bit counter driven by a ${f} Hz clock with probes on every bit`), phrase(r, 'a binary counter', { plain: 'Show me how binary counting works.' })], script }
}

function dflipflop(r) {
  const f = r.pick([1, 2])
  const script = lines(
    `var d = create("input", { value: 1, name: "D" });`,
    `var clk = create("clock", { f: ${f} });`,
    `var ff = create("d-ff", {});`,
    `var q = create("logic-probe", { name: "Q" });`,
    `connect(d.out, ff.d);`,
    `connect(clk.out, ff.clk);`,
    `connect(ff.q, q.terminal);`,
    note(`**D flip-flop.** On each rising clock edge the flip-flop copies D to Q and then holds it, ignoring D until the next edge. Change D between edges and Q does not move — that is memory.`)
  )
  return { prompts: [phrase(r, 'a D flip-flop with a clock and a probe on Q'), phrase(r, 'a flip-flop', { plain: 'How does a circuit remember one bit?' })], script }
}

// ── Mechanics (bodies carry coordinates; the box is the frame) ──────────────

function pendulum(r) {
  const L = r.int(14, 30) * 10
  const m = r.pick([0.5, 1, 1.5, 2, 3, 4, 5, 8])
  const side = r.pick([-1, 1])
  const T = 2 * Math.PI * Math.sqrt(L / 1000 / 9.81)
  const px = 230
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: ${L + 190} });`,
    `var pivot = create("hinge", { x: ${px}, y: 70 });`,
    `var bob = create("mass", { x: ${px + side * Math.round(L * 0.5)}, y: ${70 + Math.round(L * 0.866)}, mass: ${m}, name: "Bob" });`,
    `connect(pivot.centre, bob.centre, "rod");`,
    `graph.plot(bob.swing);`,
    note(`**Simple pendulum.** The bob is released from the side. For small swings the period is T = 2π√(L/g) = ${fmt.num(T)} s for a rod of ${L / 1000} m — it does not depend on the mass. Change the mass and the curve stays put.`),
    slider('ms', { min: 0.5, max: 20, step: 0.5, value: m, label: 'Bob mass (kg)', param: 'mass', target: 'bob' })
  )
  return {
    prompts: [
      phrase(r, 'a simple pendulum', { detail: `with a ${m} kg bob, plotting its angle` }),
      phrase(r, 'a pendulum', { plain: 'Does a heavier swing go back and forth faster? Show me.' }),
      phrase(r, `a pendulum with a rod of length ${L / 1000} m`),
    ],
    script,
  }
}

function springMass(r) {
  const k = r.int(2, 30) * 5
  const m = r.pick([0.5, 1, 1.5, 2, 3, 4, 6])
  const T = 2 * Math.PI * Math.sqrt(m / k)
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 480 });`,
    `var anchor = create("hinge", { x: 230, y: 80 });`,
    `var bob = create("mass", { x: 230, y: 340, mass: ${m}, name: "Bob" });`,
    `var spr = create("spring", { length: 220, k: ${k}, name: "Spring" });`,
    `connect(spr.a, anchor.centre);`,
    `connect(spr.b, bob.centre);`,
    `graph.plot(bob.y);`,
    note(`**Mass on a spring.** The spring pulls back in proportion to the stretch (F = −kx), so the mass oscillates with period T = 2π√(m/k) = 2π√(${m}/${k}) = ${fmt.num(T)} s. A stiffer spring is quicker; a heavier mass is slower.`),
    slider('ks', { min: 5, max: 150, step: 5, value: k, label: 'Stiffness k (N/m)', param: 'k', target: 'spr' }),
    slider('ms', { min: 0.5, max: 10, step: 0.5, value: m, label: 'Mass (kg)', param: 'mass', target: 'bob' })
  )
  return {
    prompts: [
      phrase(r, `a ${m} kg mass hanging from a spring with k = ${k} N/m`, { detail: 'and plot its height' }),
      phrase(r, 'a spring-mass oscillator', { plain: 'Why does a bouncing spring keep going up and down? Show me.' }),
      phrase(r, 'a mass bouncing on a spring so I can change the stiffness'),
    ],
    script,
  }
}

function dampedOscillator(r) {
  const k = r.int(4, 16) * 5
  const c = r.pick([0.5, 1, 2, 3, 4, 6, 8, 10])
  const m = r.pick([1, 1.5, 2, 3])
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 480 });`,
    `var anchor = create("hinge", { x: 230, y: 80 });`,
    `var bob = create("mass", { x: 230, y: 340, mass: ${m}, name: "Bob" });`,
    `var spr = create("spring", { length: 220, k: ${k}, name: "Spring" });`,
    `var dmp = create("damper", { length: 220, damping: ${c}, name: "Damper" });`,
    `connect(spr.a, anchor.centre);`,
    `connect(spr.b, bob.centre);`,
    `connect(dmp.a, anchor.centre);`,
    `connect(dmp.b, bob.centre);`,
    `graph.plot(bob.y);`,
    note(`**Damped oscillator.** The damper removes energy in proportion to the speed (F = −cv), so each swing is smaller than the last. With c = ${c} the motion ${c > 2 * Math.sqrt(k * m) ? 'is overdamped: it creeps back without oscillating' : 'is underdamped: it oscillates while the amplitude decays'}. Raise c to see it settle faster.`),
    slider('cs', { min: 0, max: 30, step: 1, value: c, label: 'Damping c (N·s/m)', param: 'damping', target: 'dmp' })
  )
  return {
    prompts: [phrase(r, 'a damped spring-mass oscillator', { detail: 'with a slider for the damping' }), phrase(r, 'a spring that bounces less and less', { plain: 'Why does a bouncing spring eventually stop?' })],
    script,
  }
}

function freeFall(r) {
  const m = r.pick([0.5, 1, 1.5, 2, 3, 5, 8])
  const h = r.int(10, 40) * 10
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 560 });`,
    `var floor = create("ground", { x: 20, y: 500, width: 420 });`,
    `var ball = create("mass", { x: 230, y: ${500 - h - 40}, mass: ${m}, name: "Ball" });`,
    `graph.plot(ball.y);`,
    `graph.plot(ball.speed);`,
    note(`**Free fall.** Gravity accelerates the ball at g = 9.81 m/s² whatever its mass, so its speed grows steadily until it hits the floor and bounces. Compare the height and speed curves: speed is largest just before each impact.`),
    slider('ms', { min: 0.5, max: 20, step: 0.5, value: m, label: 'Ball mass (kg)', param: 'mass', target: 'ball' })
  )
  return {
    prompts: [phrase(r, `a ${m} kg ball dropped from a height onto the ground`, { detail: 'plotting height and speed' }), phrase(r, 'a falling ball', { plain: 'Does a heavy ball fall faster than a light one? Show me.' })],
    script,
  }
}

function projectile(r) {
  const v = r.int(4, 16)
  const ang = r.int(4, 14) * 5
  const vx = +(v * Math.cos((ang * Math.PI) / 180)).toFixed(1)
  const vy = -+(v * Math.sin((ang * Math.PI) / 180)).toFixed(1)
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 900, height: 480 });`,
    `var floor = create("ground", { x: 20, y: 420, width: 860 });`,
    `var ball = create("mass", { x: 70, y: 380, mass: 1, vx: ${vx}, vy: ${vy}, showTrail: 1, name: "Ball" });`,
    `graph.plot(ball.y, ball.x);`,
    note(`**Projectile motion.** The ball leaves at ${v} m/s and ${ang}° above the horizontal: the horizontal speed stays ${fmt.num(Math.abs(vx))} m/s while gravity changes the vertical speed, so the path is a parabola. Change the launch speed and watch the range grow.`),
    slider('vxs', { min: 2, max: 20, step: 1, value: Math.round(Math.abs(vx)), label: 'Horizontal speed (m/s)', param: 'vx', target: 'ball' })
  )
  return {
    prompts: [phrase(r, `projectile motion: a ball launched at ${v} m/s and ${ang} degrees`, { detail: 'with its trail' }), phrase(r, 'a ball thrown through the air', { plain: 'What shape is the path of a thrown ball? Show me.' })],
    script,
  }
}

function collision(r) {
  const m1 = r.pick([1, 2, 3, 4, 6])
  const m2 = r.pick([1, 2, 3, 4, 6, 8, 10])
  const v = r.int(2, 10)
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 700, height: 360 });`,
    `var floor = create("ground", { x: 20, y: 300, width: 660 });`,
    `var a = create("block", { x: 120, y: 240, mass: ${m1}, vx: ${v}, name: "A" });`,
    `var b = create("block", { x: 420, y: 240, mass: ${m2}, name: "B" });`,
    `graph.plot(a.vx);`,
    `graph.plot(b.vx);`,
    note(`**Collision.** Block A (${m1} kg) moves at ${v} m/s toward block B (${m2} kg) at rest. Momentum is conserved: ${m1}×${v} = ${m1 * v} kg·m/s before and after. A heavier B takes more of the momentum and A may bounce back.`),
    slider('mb', { min: 1, max: 16, step: 1, value: m2, label: 'Mass of B (kg)', param: 'mass', target: 'b' })
  )
  return {
    prompts: [phrase(r, `a ${m1} kg block hitting a ${m2} kg block at rest`, { detail: 'and plot both velocities' }), phrase(r, 'a collision between two blocks', { plain: 'What happens when a moving block hits a still one?' })],
    script,
  }
}

function incline(r) {
  const ang = r.int(2, 8) * 5
  const mu = r.int(0, 10) * 0.05
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 640, height: 420 });`,
    `var floor = create("ground", { x: 20, y: 360, width: 600 });`,
    `var ramp = create("beam", { x: 80, y: 250, width: 420, height: 14, rotation: ${ang} });`,
    `addproperty(ramp, "staticBody");`,
    `var blk = create("block", { x: 130, y: 170, mass: 2, friction: ${mu}, name: "Block" });`,
    `graph.plot(blk.speed);`,
    note(`**Block on an incline.** Gravity pulls the block down the slope with g·sin θ = ${fmt.num(9.81 * Math.sin((ang * Math.PI) / 180))} m/s² (θ = ${ang}°); friction opposes it with μ·g·cos θ. ${mu >= Math.tan((ang * Math.PI) / 180) ? 'Here friction is big enough to hold the block still.' : 'Here the block slides; more friction means a smaller acceleration.'}`),
    slider('fs', { min: 0, max: 1, step: 0.05, value: mu, label: 'Friction coefficient', param: 'friction', target: 'blk' })
  )
  return {
    prompts: [phrase(r, `a block sliding down a ${ang}° ramp with friction ${mu}`), phrase(r, 'an inclined plane', { plain: 'Why does a block slide down a slope slower when it is rough?' })],
    script,
  }
}

function ropeSwing(r) {
  const L = r.int(18, 30) * 10
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 560, height: ${L + 140} });`,
    `var top = create("hinge", { x: 320, y: 80 });`,
    `var ball = create("mass", { x: ${320 + Math.round(L * 0.7)}, y: ${80 + Math.round(L * 0.7)}, mass: 1, name: "Ball" });`,
    `var line = create("rope", { length: ${L} });`,
    `connect(line.a, top.centre);`,
    `connect(line.b, ball.centre);`,
    `graph.plot(ball.speed);`,
    note(`**Swinging on a rope.** The ball trades height for speed: it is fastest at the bottom of the swing and momentarily stops at the top. The rope can only pull, never push, so it goes slack if the ball is thrown too high.`)
  )
  return { prompts: [phrase(r, 'a ball swinging on a rope', { detail: 'and plot its speed' }), phrase(r, 'a swing', { plain: 'Where is a swing fastest?' })], script }
}

function chargeInField(r) {
  const B = r.pick([1, 2, 3])
  const v = r.pick([6, 10, 14])
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 620, height: 460 });`,
    `var field = create("bfield", { x: 250, y: 150, width: 320, height: 260, Bz: ${B} });`,
    `var particle = create("charge", { x: 100, y: 280, q: 1, vx: ${v}, showTrail: 1, name: "Particle" });`,
    `graph.plot(particle.y, particle.x);`,
    note(`**Charge in a magnetic field.** Inside the field the force is perpendicular to the velocity, so the particle moves on a circle of radius r = mv/(qB) — it speeds neither up nor down. A stronger field (B = ${B}) bends the path more tightly.`),
    slider('bs', { min: 0.5, max: 6, step: 0.5, value: B, label: 'Field B', param: 'Bz', target: 'field' })
  )
  return { prompts: [phrase(r, 'a charged particle entering a magnetic field', { detail: 'showing its circular path' }), phrase(r, 'a magnetic field bending a moving charge', { plain: 'Why does a magnet bend the path of a moving charge?' })], script }
}

// ── Optics / waves ──────────────────────────────────────────────────────────

function lensImaging(r) {
  const f = r.int(6, 26) * 10
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "optics", width: 760, height: 360 });`,
    `var src = create("light-source", { x: 80, y: 190, name: "Source" });`,
    `var lens = create("thin-lens", { x: 340, y: 130, f: ${f}, name: "Lens" });`,
    `var scr = create("optical-screen", { x: 660, y: 130, name: "Screen" });`,
    note(`**Converging lens.** Rays from the source bend toward a point on the other side. The focal length is f = ${f} px; a source placed beyond f makes a real image you can catch on the screen. Slide f and watch the focus move.`),
    slider('fs', { min: 60, max: 300, step: 10, value: f, label: 'Focal length f (px)', param: 'f', target: 'lens' })
  )
  return { prompts: [phrase(r, `a converging lens with focal length ${f} focusing light onto a screen`), phrase(r, 'a lens forming an image', { plain: 'How does a magnifying glass bend light to a point?' })], script }
}

function waveBoundary(r) {
  const script = lines(
    `var sys = create("system", { x: 0, y: 0, domain: "waves", width: 500, height: 380 });`,
    `var src = create("wave-source", { x: 100, y: 240, name: "Source" });`,
    `var boundary = create("wave-boundary", { x: 380, y: 180, name: "Boundary" });`,
    note(`**Wave at a boundary.** When a wave meets a change of medium, part of it is reflected and part is transmitted. The frequency stays the same but the wavelength changes, because the speed is different on the two sides.`)
  )
  return { prompts: [phrase(r, 'a plane wave hitting a boundary between two media'), phrase(r, 'a wave reflecting and passing through', { plain: 'What happens to a wave when it enters a new material?' })], script }
}

/** weight = how often the family is drawn. Circuits and mechanics dominate: they are what students ask for. */
export const RECIPES = [
  { id: 'series', domain: 'circuit', weight: 6, make: seriesResistors },
  { id: 'parallel', domain: 'circuit', weight: 5, make: parallelResistors },
  { id: 'divider', domain: 'circuit', weight: 6, make: divider },
  { id: 'series-parallel', domain: 'circuit', weight: 4, make: seriesParallel },
  { id: 'rc-charge', domain: 'circuit', weight: 5, make: rcCharging },
  { id: 'rc-lowpass', domain: 'circuit', weight: 4, make: rcLowpass },
  { id: 'rl', domain: 'circuit', weight: 3, make: rlCircuit },
  { id: 'rlc', domain: 'circuit', weight: 4, make: rlcSeries },
  { id: 'led', domain: 'circuit', weight: 4, make: ledResistor },
  { id: 'rectifier', domain: 'circuit', weight: 4, make: rectifier },
  { id: 'bulbs', domain: 'circuit', weight: 4, make: bulbsSeriesParallel },
  { id: 'opamp-inv', domain: 'circuit', weight: 3, make: invertingOpamp },
  { id: 'transformer', domain: 'circuit', weight: 2, make: transformerStepDown },
  { id: 'gate', domain: 'digital', weight: 5, make: gate },
  { id: 'half-adder', domain: 'digital', weight: 2, make: halfAdder },
  { id: 'counter', domain: 'digital', weight: 2, make: counter },
  { id: 'dff', domain: 'digital', weight: 2, make: dflipflop },
  { id: 'pendulum', domain: 'mechanics', weight: 6, make: pendulum },
  { id: 'spring-mass', domain: 'mechanics', weight: 6, make: springMass },
  { id: 'damped', domain: 'mechanics', weight: 3, make: dampedOscillator },
  { id: 'free-fall', domain: 'mechanics', weight: 4, make: freeFall },
  { id: 'projectile', domain: 'mechanics', weight: 4, make: projectile },
  { id: 'collision', domain: 'mechanics', weight: 4, make: collision },
  { id: 'incline', domain: 'mechanics', weight: 4, make: incline },
  { id: 'rope-swing', domain: 'mechanics', weight: 2, make: ropeSwing },
  { id: 'charge-b', domain: 'mechanics', weight: 2, make: chargeInField },
  { id: 'lens', domain: 'optics', weight: 3, make: lensImaging },
  { id: 'wave-boundary', domain: 'waves', weight: 1, make: waveBoundary },
]

/** Real people type "pls make pendulum" — not only complete sentences. */
function roughen(r, p) {
  if (r.chance(0.12)) p = p.toLowerCase().replace(/[.?]$/, '')
  if (r.chance(0.07)) p = r.pick(['pls ', 'hey, ', 'ok so ', 'quick one: ', 'for my physics homework: ']) + (p[0] === p[0].toUpperCase() ? p[0].toLowerCase() + p.slice(1) : p)
  if (r.chance(0.05)) p = p.replace(/ resistors?/, ' resistor').replace(/\bseries\b/, 'seires')
  return p
}

/** Draw `n` (prompt, script) pairs: recipe by weight, parameters by seed. */
export function generate(n, seed = 1) {
  const r = rng(seed)
  const total = RECIPES.reduce((a, b) => a + b.weight, 0)
  const out = []
  for (let i = 0; i < n; i++) {
    let x = r() * total
    const recipe = RECIPES.find((rc) => (x -= rc.weight) < 0) ?? RECIPES[0]
    const sub = rng(Math.floor(r() * 2 ** 31))
    const made = recipe.make(sub)
    out.push({ recipe: recipe.id, domain: recipe.domain, prompt: roughen(sub, sub.pick(made.prompts)), script: made.script })
  }
  return out
}

// ── Teaching material derived from a scene ──────────────────────────────────
// The same verified numbers that sit in a scene's note become (a) a plain-language
// explanation and (b) flash cards. Nothing here is invented: every figure was
// computed by the recipe that built the scene, so a card can never contradict
// the simulation next to it.

const unmd = (t) => t.replace(/\*\*/g, '')

/** The pieces of a generated script that carry meaning. */
export function dissect(script) {
  const noteText = /var note = create\("note", \{ text: (".*") \}\);/.exec(script)
  const sliders = [...script.matchAll(/label: "([^"]+)", targetParamName/g)].map((m) => m[1])
  return { note: noteText ? JSON.parse(noteText[1]) : '', sliders }
}

const TOPIC = {
  series: 'a series circuit', parallel: 'a parallel circuit', divider: 'a voltage divider', 'series-parallel': 'a series-parallel circuit',
  'rc-charge': 'a capacitor charging through a resistor', 'rc-lowpass': 'an RC low-pass filter', rl: 'an RL circuit', rlc: 'a series RLC circuit',
  led: 'an LED with a current-limiting resistor', rectifier: 'a half-wave rectifier', bulbs: 'two bulbs on a battery', 'opamp-inv': 'an inverting op-amp amplifier',
  transformer: 'a transformer', gate: 'a logic gate', 'half-adder': 'a half adder', counter: 'a binary counter', dff: 'a D flip-flop',
  pendulum: 'a pendulum', 'spring-mass': 'a mass on a spring', damped: 'a damped oscillator', 'free-fall': 'a falling ball', projectile: 'projectile motion',
  collision: 'a collision', incline: 'a block on a slope', 'rope-swing': 'a swing on a rope', 'charge-b': 'a charge in a magnetic field',
  lens: 'a converging lens', 'wave-boundary': 'a wave at a boundary',
}

/** A short spoken answer: what the note says, then how to explore it. */
export function explainSample(r, recipe, script) {
  const { note, sliders } = dissect(script)
  if (!note) return null
  const t = TOPIC[recipe] ?? 'this'
  const q = r.pick([
    `Explain how ${t} works.`, `How does ${t} work?`, `Can you explain ${t} to me simply?`, `Why does ${t} behave the way it does?`,
    `I don't get ${t}. Explain it with an example.`, `What should I look at in ${t}?`, `Teach me ${t}.`,
  ])
  const tryIt = sliders.length ? `\n\n**Try it:** build it in the notebook and move the "${sliders[0]}" slider — watch the graph change before you check the formula.` : '\n\n**Try it:** ask me to build it, then change the inputs and predict the result before you look.'
  return { prompt: q, answer: note + tryIt }
}

/** Flash cards as JSON, from the numbers in the note and the sliders. */
export function cardsSample(r, recipe, script) {
  const { note, sliders } = dissect(script)
  const sentences = unmd(note).split(/(?<=[.!?])\s+/).filter((x) => x.length > 25 && x.length < 220)
  if (sentences.length < 2) return null
  const head = unmd(note).split('.')[0]
  const cards = [
    { front: `What is the key idea of ${TOPIC[recipe] ?? 'this scene'}?`, back: sentences[0].replace(/^[A-Z][^.]*\.\s*/, '') || sentences[0] },
    ...sentences.slice(1, 3).map((x, i) => ({ front: `Recall (${i + 1}): ${head}. What follows?`, back: x })),
  ]
  if (sliders.length) cards.push({ front: `Predict: what happens when you change "${sliders[0]}"?`, back: 'Change it in the simulation and compare with your prediction — then explain any difference.' })
  const topic = TOPIC[recipe] ?? 'this'
  return {
    prompt: r.pick([`Make flash cards about ${topic}.`, `Give me ${cards.length} flashcards on ${topic}.`, `Quiz cards for ${topic}, please.`]),
    answer: cards.map((c) => JSON.stringify(c)).join('\n'),
  }
}
