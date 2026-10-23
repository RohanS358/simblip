// Scene recipes: for the most common thing a student asks to see — "three resistors in parallel", "two bulbs in
// series" — a model that is asked to write the SimScript sometimes gets the TOPOLOGY wrong (a ring of resistors
// that is really a series loop), and then the lesson explains parallel circuits over a picture of a series one.
// These are exact, so for these requests the script is written here and the model is not asked.
// Pure: text in, SimScript (or null: not a recipe, ask the model) out.

const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 }
/** Anything else in the request means it is not a plain resistor/bulb circuit — leave it to the model. */
const OTHER = /\b(capacitor|inductor|diode|led|transistor|op-?amp|switch|fuse|coil|ac |transformer|gate|potentiometer|bridge|mesh|wheatstone)\b/

const SPREAD = [100, 220, 330, 470, 680, 1000]

// ── Multi-pin circuits ──────────────────────────────────────────────────────
// A transistor has three pins and an op-amp five; a small model wires the pins it thinks of (the base) and leaves the rest
// floating, which is a picture of an amplifier and not one. These are the textbook circuits, every pin wired, with
// instruments named so the lesson can point at them. Each is checked by running it (recipes.test.mjs): no floating pins,
// and the readings are the textbook values.

const gainOf = (t: string, fallback: number) => {
  const m = /\bgain\s*(?:of|=|is)?\s*(\d+(?:\.\d+)?)/.exec(t) ?? /\b(\d+(?:\.\d+)?)\s*(?:x|times)\s*(?:gain|amplif)/.exec(t)
  return m ? Math.min(100, Math.max(2, Number(m[1]))) : fallback
}

export function multiPinRecipe(t: string): string | null {
  // Differential pair (before "amplifier" generally): the long-tailed pair, two transistors sharing an emitter resistor.
  if (/\b(differential (amplifier|pair|amp)|long[- ]tailed pair|diff[- ]?amp)\b/.test(t) && !/op-?amp/.test(t)) {
    return [
      'var vcc = create("battery", { V: 12, name: "vcc" });',
      'var vee = create("battery", { V: 12, name: "vee" });',
      'var rc1 = create("resistor", { R: 4700, name: "rc1" });',
      'var rc2 = create("resistor", { R: 4700, name: "rc2" });',
      'var q1 = create("bjt", { beta: 100, name: "q1" });',
      'var q2 = create("bjt", { beta: 100, name: "q2" });',
      'var rt = create("resistor", { R: 10000, name: "rt" });',
      'var vin = create("ac-source", { V: 0.1, f: 500, name: "vin" });',
      'var vo1 = create("voltmeter", { name: "vo1" });',
      'var vo2 = create("voltmeter", { name: "vo2" });',
      'var g = create("gnd", { name: "g" });',
      'connect(vcc.positive, rc1.a, "wire");',
      'connect(vcc.positive, rc2.a, "wire");',
      'connect(rc1.b, q1.collector, "wire");',
      'connect(rc2.b, q2.collector, "wire");',
      'connect(q1.emitter, rt.a, "wire");',
      'connect(q2.emitter, rt.a, "wire");',
      'connect(rt.b, vee.negative, "wire");',
      'connect(vin.positive, q1.base, "wire");',
      'connect(vin.negative, g.a, "wire");',
      'connect(q2.base, g.a, "wire");',
      'connect(vcc.negative, g.a, "wire");',
      'connect(vee.positive, g.a, "wire");',
      'connect(vo1.a, rc1.a, "wire");',
      'connect(vo1.b, rc1.b, "wire");',
      'connect(vo2.a, rc2.a, "wire");',
      'connect(vo2.b, rc2.b, "wire");',
    ].join('\n')
  }
  // Common-emitter amplifier: bias resistor to the base, load resistor in the collector, ammeter reading the collector current.
  if (/\b(common[- ]emitter|transistor amplifier|bjt amplifier|npn amplifier|amplifier (?:using|with) (?:a |an )?(?:bjt|transistor))\b/.test(t)) {
    return [
      'var vcc = create("battery", { V: 12, name: "vcc" });',
      'var rc = create("resistor", { R: 2200, name: "rc" });',
      'var rb = create("resistor", { R: 470000, name: "rb" });',
      'var q = create("bjt", { beta: 100, name: "q" });',
      'var ic = create("ammeter", { name: "ic" });',
      'var vce = create("voltmeter", { name: "vce" });',
      'var g = create("gnd", { name: "g" });',
      'connect(vcc.positive, rc.a, "wire");',
      'connect(rc.b, ic.a, "wire");',
      'connect(ic.b, q.collector, "wire");',
      'connect(vcc.positive, rb.a, "wire");',
      'connect(rb.b, q.base, "wire");',
      'connect(q.emitter, g.a, "wire");',
      'connect(vcc.negative, g.a, "wire");',
      'connect(vce.a, q.collector, "wire");',
      'connect(vce.b, q.emitter, "wire");',
    ].join('\n')
  }
  // Op-amp amplifiers: ideal op-amp (supply pins left off), the gain set by two resistors, the output on a voltmeter.
  if (/\b(non[- ]?inverting)\b/.test(t) && /\b(op-?amp|amplifier)\b/.test(t)) {
    const gain = gainOf(t, 11)
    return [
      'var vin = create("battery", { V: 0.5, name: "vin" });',
      'var op = create("opamp", { name: "op" });',
      `var rf = create("resistor", { R: ${Math.round((gain - 1) * 1000)}, name: "rf" });`,
      'var rg = create("resistor", { R: 1000, name: "rg" });',
      'var vout = create("voltmeter", { name: "vout" });',
      'var g = create("gnd", { name: "g" });',
      'connect(vin.positive, op.positive, "wire");',
      'connect(vin.negative, g.a, "wire");',
      'connect(op.out, rf.a, "wire");',
      'connect(rf.b, op.negative, "wire");',
      'connect(op.negative, rg.a, "wire");',
      'connect(rg.b, g.a, "wire");',
      'connect(vout.a, op.out, "wire");',
      'connect(vout.b, g.a, "wire");',
    ].join('\n')
  }
  if (/\b(inverting (op-?amp|amplifier)|op-?amp (inverting )?amplifier|op-?amp)\b/.test(t) && !/\b(comparator|integrator|differentiator|schmitt|buffer|follower)\b/.test(t)) {
    const gain = gainOf(t, 10)
    return [
      'var vin = create("battery", { V: 0.5, name: "vin" });',
      'var rin = create("resistor", { R: 1000, name: "rin" });',
      'var op = create("opamp", { name: "op" });',
      `var rf = create("resistor", { R: ${Math.round(gain * 1000)}, name: "rf" });`,
      'var vout = create("voltmeter", { name: "vout" });',
      'var g = create("gnd", { name: "g" });',
      'connect(vin.positive, rin.a, "wire");',
      'connect(rin.b, op.negative, "wire");',
      'connect(op.negative, rf.a, "wire");',
      'connect(rf.b, op.out, "wire");',
      'connect(op.positive, g.a, "wire");',
      'connect(vin.negative, g.a, "wire");',
      'connect(vout.a, op.out, "wire");',
      'connect(vout.b, g.a, "wire");',
    ].join('\n')
  }
  return null
}

export function circuitRecipe(request: string): string | null {
  const t = request.toLowerCase().replace(/ω/g, ' ohm').replace(/\s+/g, ' ')
  const multi = multiPinRecipe(t)
  if (multi) return multi
  if (OTHER.test(t)) return null
  const arrangement = /\bparallel\b/.test(t) ? 'parallel' : /\bseries\b/.test(t) ? 'series' : null
  if (!arrangement) return null
  // "series and parallel" together is a mixed network: not a recipe
  if (/\bparallel\b/.test(t) && /\bseries\b/.test(t)) return null
  const counted = /\b(two|three|four|five|six|[2-6])\s+(?:identical\s+|equal\s+|similar\s+)?(?:\d+(?:\.\d+)?\s*k?\s*(?:ohm|ohms)?\s*)?(resistor|bulb|lamp)s?\b/.exec(t)
  if (!counted) return null
  const n = COUNTS[counted[1]]
  const kind = counted[2] === 'resistor' ? 'resistor' : 'bulb'
  const volts = /(\d+(?:\.\d+)?)\s*v(?:olts?)?\b/.exec(t)
  const V = volts ? Math.min(48, Math.max(1, Number(volts[1]))) : 9
  const given = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(k)?\s*ohms?\b/g)].map((m) => Number(m[1]) * (m[2] ? 1000 : 1))
  const R = (i: number) => (given.length === n ? given[i] : given.length === 1 ? given[0] : given.length > 1 ? given[i % given.length] : arrangement === 'parallel' ? SPREAD[i] : 100)
  const idx = Array.from({ length: n }, (_, i) => i + 1)
  const parts = idx.map((i) => `var r${i} = create("${kind}", { R: ${R(i - 1)}, name: "r${i}" });`)
  if (arrangement === 'series') {
    return [
      `var bat = create("battery", { V: ${V}, name: "bat" });`,
      ...parts,
      `var am = create("ammeter", { name: "am" });`,
      `connect(bat.positive, am.a, "wire");`,
      `connect(am.b, r1.a, "wire");`,
      ...idx.slice(1).map((i) => `connect(r${i - 1}.b, r${i}.a, "wire");`),
      `connect(r${n}.b, bat.negative, "wire");`,
    ].join('\n')
  }
  // parallel: one ammeter for the total and one in each branch, so the student can watch the current SPLIT
  return [
    `var bat = create("battery", { V: ${V}, name: "bat" });`,
    `var at = create("ammeter", { name: "at" });`,
    ...parts,
    ...idx.map((i) => `var a${i} = create("ammeter", { name: "a${i}" });`),
    `connect(bat.positive, at.a, "wire");`,
    ...idx.flatMap((i) => [`connect(at.b, a${i}.a, "wire");`, `connect(a${i}.b, r${i}.a, "wire");`, `connect(r${i}.b, bat.negative, "wire");`]),
  ].join('\n')
}
