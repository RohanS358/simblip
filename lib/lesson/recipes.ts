// Scene recipes: for the most common thing a student asks to see — "three resistors in parallel", "two bulbs in
// series" — a model that is asked to write the SimScript sometimes gets the TOPOLOGY wrong (a ring of resistors
// that is really a series loop), and then the lesson explains parallel circuits over a picture of a series one.
// These are exact, so for these requests the script is written here and the model is not asked.
// Pure: text in, SimScript (or null: not a recipe, ask the model) out.

const COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 }
/** Anything else in the request means it is not a plain resistor/bulb circuit — leave it to the model. */
const OTHER = /\b(capacitor|inductor|diode|led|transistor|op-?amp|switch|fuse|coil|ac |transformer|gate|potentiometer|bridge|mesh|wheatstone)\b/

const SPREAD = [100, 220, 330, 470, 680, 1000]

export function circuitRecipe(request: string): string | null {
  const t = request.toLowerCase().replace(/ω/g, ' ohm').replace(/\s+/g, ' ')
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
