// Which requests need TOOLS rather than a generated scene or a written answer?
//
// Pure regex, zero latency, no model call — the same stance as
// lib/ai/route-intent.ts. Two tiers:
//
//   quick  — "run it", "undo": the answer is one tool call with no arguments.
//            A model would only add delay and a chance to get it wrong, so
//            these never reach one.
//   agent  — "how fast is the ball?", "open my circuits page": needs a model
//            to pick arguments from what is on the page, but only from the
//            handful of tools that could possibly apply. A 1–2B model shown
//            40 tools picks badly (and the 103-tool agent this app once had
//            spent 17,981 prompt tokens on schemas alone), so it is shown ≤ 4.
//
// Anything else returns null and falls through to the existing lanes.

export type ActPlan =
  | { kind: 'quick'; tool: string }
  | { kind: 'agent'; tools: string[] }

const QUICK: [RegExp, string][] = [
  [/^(?:please\s+)?(?:run|play|start|go|resume|press play)(?:\s+(?:it|this|that|the\s+(?:simulation|sim|scene|circuit|experiment)|simulation))?\s*[.!]*$/i, 'scene.run'],
  [/^(?:please\s+)?(?:pause|freeze|hold on|hold it)(?:\s+(?:it|this|the\s+(?:simulation|sim)))?\s*[.!]*$/i, 'scene.pause'],
  [/^(?:please\s+)?(?:stop|reset|restart|rewind)(?:\s+(?:it|this|the\s+(?:simulation|sim|scene)))?\s*[.!]*$/i, 'scene.reset'],
  [/^(?:please\s+)?(?:undo|undo (?:that|it|the last (?:change|thing))|take that back|revert (?:that|it))\s*[.!]*$/i, 'scene.undo'],
  [/^(?:please\s+)?(?:redo|redo (?:that|it)|put it back)\s*[.!]*$/i, 'scene.redo'],
  [/^(?:what(?:'s| is| do i have)\s+(?:on\s+)?(?:this|the)\s+page|describe\s+(?:this|the)\s+page|what(?:'s| is) here)\s*\??$/i, 'scene.describe'],
]

/** Asks for a number out of a running or finished simulation. */
const MEASURE_RE =
  /\b(?:how (?:fast|far|high|long|much|hot|big)|what(?:'s| is| are) the (?:current|voltage|speed|velocity|position|power|energy|period|frequency|force|reading|value|amplitude|max(?:imum)?|min(?:imum)?)|measure|reading|current (?:through|in)|voltage (?:across|at))\b/i

/** A drawing, sketch, photo or diagram the person wants read ("read my drawing", "what did you read?"). */
const SKETCH_READ_RE =
  /\b(?:(?:read|recogni[sz]e|scan|interpret|understand|check|look at|analy[sz]e|identify)\s+(?:my|this|the|that)\s+(?:hand[- ]?drawn\s+|circuit\s+)?(?:drawing|sketch|circuit(?:\s+diagram)?|diagram|photo|picture|image|scribble)|what (?:did you|have you|do you) (?:read|see|recogni[sz]e|make of)|is my (?:drawing|sketch|circuit|diagram) (?:right|correct|ok(?:ay)?|wired)|what(?:'s| is) wrong with my (?:drawing|sketch|circuit|diagram))\b/i

/** Turn a drawing or photo into a live simulation. */
const SKETCH_BUILD_RE =
  /\b(?:(?:turn|convert|make|build|change|transform)\s+(?:my|this|the|that)\s+(?:hand[- ]?drawn\s+)?(?:drawing|sketch|photo|picture|image|diagram|circuit)\s+in?to\s+(?:a\s+)?(?:live\s+|working\s+|real\s+)?(?:circuit|simulation|sim|scene)|simulate\s+(?:my|this|the|that)\s+(?:drawing|sketch|photo|picture|image|diagram)|make\s+(?:it|my\s+(?:drawing|sketch|circuit|diagram))\s+live|bring\s+(?:my|this)\s+(?:drawing|sketch)\s+to\s+life)\b/i

/** "Why does the LED not light?" "why isn't my circuit working": a "why" with something NOT happening, about a circuit. Answered by reading the circuit, not by guessing. */
const WHY_BROKEN_RE =
  /\bwhy\b[^?.!]{0,60}(?:n't|\bnot\b|\bnever\b|\boff\b|\bdead\b|\bdark\b|\bdim\b)/i
const WHY_SUBJECT_RE = /\b(?:led|light(?:s|ing)?|bulb|lamp|glow(?:s|ing)?|circuit|work(?:s|ing)?|current|flow(?:s|ing)?)\b/i

const PAGES_RE =
  /\b(?:(?:open|go to|switch to|show)\s+(?:the\s+|my\s+)?(?:\w+\s+)?(?:page|board|notebook)|(?:new|blank|create (?:a )?)\s*(?:page|board|document)|list\s+(?:my\s+)?pages|what pages|which pages)\b/i

export function routeAct(prompt: string, hasPage: boolean): ActPlan | null {
  const p = prompt.trim()
  for (const [re, tool] of QUICK) if (re.test(p)) return { kind: 'quick', tool }
  if (PAGES_RE.test(p)) return { kind: 'agent', tools: ['page.list', 'page.open', 'page.create'] }
  // Drawings and photos: reading one, building one, and "why does my circuit not work" (which needs the reading).
  if (SKETCH_BUILD_RE.test(p)) return { kind: 'agent', tools: ['sketch.to_scene', 'sketch.recognize', 'scene.describe'] }
  if (SKETCH_READ_RE.test(p)) return { kind: 'agent', tools: ['sketch.recognize', 'sketch.to_scene', 'scene.describe'] }
  if (hasPage && WHY_BROKEN_RE.test(p) && WHY_SUBJECT_RE.test(p)) return { kind: 'agent', tools: ['sketch.recognize', 'scene.describe', 'scene.measure'] }
  // A measurement needs a page that has something on it.
  if (hasPage && MEASURE_RE.test(p)) return { kind: 'agent', tools: ['scene.measure', 'scene.describe', 'scene.run'] }
  return null
}
