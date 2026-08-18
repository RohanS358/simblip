// Which lane does a question belong in?
//
// SimScript builds SCENES. It cannot express a derivation, and that single
// mismatch was the whole problem: asked to "derive Gauss's law", the model
// still had to answer in create() calls, so it invented create("shape") and
// decNumber.toString(2) and derived nothing. Measured on the course's own
// 100-question set (public/100_Questions_All_Subjects.md): 44 derivations,
// 37 numericals, 19 short notes — most questions are not simulations at all.
//
// So route first, generate second:
//
//   "bouncing ball"          -> simulate  : SimScript, runs on the canvas
//   "derive Gauss's law"     -> explain   : Markdown + LaTeX, lands as notes
//   "RLC response, plot it"  -> both      : explanation AND a scene
//
// This is a pure function on the prompt text — no model call, no latency. A
// classifier round would cost more than the generation it is routing.

export type Intent = 'simulate' | 'explain' | 'both'

/** Asks for worked mathematics: a derivation, a proof, a calculation. */
const EXPLAIN_RE = new RegExp(
  [
    // derivation / proof verbs
    'derive|derivation|prove|proof|show that|obtain the expression|starting from',
    // calculation verbs
    'calculate|compute|determine|find the|evaluate|convert|simplify|verify',
    // exposition verbs
    'explain|describe|state and|differentiate between|compare|distinguish',
    'define|discuss|what is|why does|how does',
  ].join('|'),
  'i'
)

/** Names something that can actually be built and run on the canvas. */
const SIMULATE_RE = new RegExp(
  [
    // mechanics
    'pendulum|oscillat|spring|projectile|collision|bounce|bouncing|falling|free fall',
    'inclined plane|friction|damped|mass on|block|pulley|rotat',
    // circuits & electronics
    'circuit|resistor|capacitor|inductor|rlc|r-l-c|voltage divider|rectifier',
    'transistor|bjt|mosfet|diode|op-?amp|amplifier|filter|oscillator',
    // digital
    'gate|flip-?flop|counter|multiplexer|decoder|adder|register|latch|truth table',
    // machines, optics, fields
    'motor|transformer|generator|lens|mirror|diffraction|interference|grating',
    'magnetic field|electric field|charge moving|wave',
    // explicit asks
    'simulate|simulation|animate|plot|graph|draw|build|show me',
  ].join('|'),
  'i'
)

/** Verbs that only ever mean "put a scene on the canvas". When one of these
 *  leads the prompt there is nothing to explain — the user is asking for an
 *  object, not an answer.
 *
 *  `design` is deliberately absent. In a course context "Design a mod-6
 *  counter and draw its timing diagram" is an exam question, not a build
 *  order: routing it to simulate-only silently dropped the state table and
 *  timing diagram that carry most of the marks. */
const BUILD_ONLY_RE = /^\s*(?:simulate|animate|build|create|make|add|place|put)\b/i

/** Deliverables that are written, not built. If a prompt asks for one of
 *  these it needs the explain lane no matter which verb opened it — a truth
 *  table, a state diagram or a K-map is an answer, not a canvas object. */
const WRITTEN_ARTEFACT_RE =
  /truth table|timing diagram|state (?:table|diagram|reduction)|excitation|transition table|k-?map|karnaugh|characteristic table|state machine|phasor diagram|power triangle|bode|waveform/i

/**
 * Route a prompt to a lane.
 *
 * Bias note: when a question both explains AND names simulatable hardware
 * ("derive the torque equation of a DC motor"), it routes to `both` — the
 * derivation is the answer and the motor is worth showing beside it. That is
 * the common shape of an exam question, so getting it wrong in the safe
 * direction (an extra scene) beats losing the derivation entirely.
 */
export function classifyIntent(prompt: string): Intent {
  const p = prompt.trim()
  const written = WRITTEN_ARTEFACT_RE.test(p)
  if (BUILD_ONLY_RE.test(p) && !written) return 'simulate'

  const explains = EXPLAIN_RE.test(p) || written
  const simulates = SIMULATE_RE.test(p)

  if (explains && simulates) return 'both'
  if (explains) return 'explain'
  if (simulates) return 'simulate'
  // Nothing matched: a bare noun phrase ("a pendulum", "Thevenin's theorem").
  // Explaining is the safer default — a wrong explanation is readable and
  // fixable, a wrong scene is silently dead.
  return 'explain'
}
