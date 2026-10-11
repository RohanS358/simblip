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

const PAGES_RE =
  /\b(?:(?:open|go to|switch to|show)\s+(?:the\s+|my\s+)?(?:\w+\s+)?(?:page|board|notebook)|(?:new|blank|create (?:a )?)\s*(?:page|board|document)|list\s+(?:my\s+)?pages|what pages|which pages)\b/i

export function routeAct(prompt: string, hasPage: boolean): ActPlan | null {
  const p = prompt.trim()
  for (const [re, tool] of QUICK) if (re.test(p)) return { kind: 'quick', tool }
  if (PAGES_RE.test(p)) return { kind: 'agent', tools: ['page.list', 'page.open', 'page.create'] }
  // A measurement needs a page that has something on it.
  if (hasPage && MEASURE_RE.test(p)) return { kind: 'agent', tools: ['scene.measure', 'scene.describe', 'scene.run'] }
  return null
}
