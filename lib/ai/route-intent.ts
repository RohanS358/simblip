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

export type Intent = 'simulate' | 'explain' | 'both' | 'edit'

/** Changing something that already exists, rather than building something
 *  new. The verbs alone are not enough — "add a graph" is a build on an empty
 *  board and an edit when a mass is selected — so classifyIntent only returns
 *  'edit' when the caller says a page/selection is attached. That keeps this
 *  conservative: with no context, nothing routes to edit and every existing
 *  behaviour is unchanged. */
const EDIT_RE = new RegExp(
  [
    // direct mutation verbs
    'change|edit|modify|update|adjust|tweak|fix|correct|replace|rename',
    'move|shift|align|resize|rotate|scale|reposition|centre|center',
    'delete|remove|get rid of|clear',
    'recolou?r|colou?r it|make it|set the|set its|increase|decrease|double|halve',
    // referring to what is already there
    'this (?:page|slide|note|object|one)|these|the selected|selection',
  ].join('|'),
  'i'
)

/** Does this ask to change what is already on the page? */
export function wantsEdit(prompt: string, hasContext: boolean): boolean {
  return hasContext && EDIT_RE.test(prompt)
}

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
    // data structures & algorithms -> the DSA Lab runs the C++ and animates it.
    // Without this clause every one of these routed to explain and the lab was
    // unreachable: even "open a DSA lab with merge sort" came back as prose.
    'sort|sorting|search|binary tree|\\bbst\\b|\\bheap\\b|linked list|\\bstack\\b|\\bqueue\\b',
    'traversal|traverse|\\bbfs\\b|\\bdfs\\b|breadth-?first|depth-?first|dijkstra|shortest path',
    'recursion|recursive|backtrack|memoi[sz]|dynamic programming|\\bdsa\\b|data structure',
    'algorithm|hash ?map|hash ?table|unordered_map|\\bmap\\b|\\bdeque\\b|priority ?queue',
    'array|vector|pointer|struct|c\\+\\+|cpp',
    // engineering economics -> the cashflow card draws the timeline AND
    // computes PW/FW/AW/IRR/BC live, so these are buildable, not just prose.
    'cash ?flow|\\bnpv\\b|\\birr\\b|\\bmarr\\b|present worth|future worth|annual worth',
    'payback period|salvage|annuit|depreciat|benefit.{0,5}cost|capital recovery',
    'engineering econom|rate of return|time value of money|compound interest',
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

/** Asks for a slide deck. A deck is WRITTEN output: its content is prose the
 *  explain lane produces, so this must beat BUILD_ONLY_RE even though every
 *  natural phrasing opens with a build verb ("make me slides on...").
 *
 *  Measured failure this fixes: "make me slides on different states of matter
 *  and their related graphs" matched BUILD_ONLY_RE on "make", routed to
 *  simulate-only, and came back as three blocks joined by springs — with an
 *  empty deck, because slide-building consumes the explain lane's blocks and
 *  that lane never ran.
 *
 *  `slide` alone is not enough: a block SLIDING down an incline is mechanics,
 *  so the noun is matched only in its deck sense (plural, or next to a deck
 *  word), never as the verb. */
const SLIDES_RE =
  /\bslides\b|\bslide deck\b|\bdeck\b|\bpresentation\b|\bpowerpoint\b|\bppt\b|\bpptx\b/i

/**
 * Does this prompt ask for a presentation?
 *
 * Separate from the lane router because it answers a different question:
 * `classifyIntent` decides how to GENERATE, this decides what to DO with the
 * result. A deck still needs the explain lane's prose behind it, so the two
 * compose rather than compete.
 */
export function wantsSlides(prompt: string): boolean {
  return SLIDES_RE.test(prompt)
}

/** Written deliverables that open with a build verb. "Make me notes on X" and
 *  "make me slides on X" are requests for prose, not for canvas objects —
 *  the same trap BUILD_ONLY_RE fell into, one noun wider. */
const WRITTEN_DELIVERABLE_RE = /\bnotes?\b|\bsummary\b|\bsummarise\b|\bsummarize\b|\breport\b|\bessay\b/i

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
export function classifyIntent(prompt: string, hasContext = false): Intent {
  const p = prompt.trim()
  // An edit beats every other lane: the user is pointing at something on
  // their page and asking for it to change, which neither a fresh scene nor a
  // derivation answers. Gated on context so this can never fire by accident.
  if (wantsEdit(p, hasContext)) return 'edit'
  // A slide deck is written output, so it counts as a written artefact even
  // though "make me slides..." opens with a build verb. Same for "make me
  // notes/a summary on X" — but NOT "add a note" (a canvas object), which is
  // why this needs the topic preposition rather than the noun alone.
  //
  // The preposition is load-bearing: "make me notes ON the states of matter"
  // asks for writing about a topic, while "add a note summarising the
  // experiment" asks for a note object on the canvas. Matching the bare noun
  // would swallow the second and break the simulate lane.
  const asksForWriting = WRITTEN_DELIVERABLE_RE.test(p) && /\b(?:on|about|for|covering)\b/i.test(p)
  const written = WRITTEN_ARTEFACT_RE.test(p) || wantsSlides(p) || asksForWriting
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
