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
  /** One tool, arguments taken straight from the words — no model needed. */
  | { kind: 'direct'; tool: string; args: Record<string, unknown> }
  | { kind: 'agent'; tools: string[] }

const QUICK: [RegExp, string][] = [
  [/^(?:please\s+)?(?:run|play|start|go|resume|press play)(?:\s+(?:it|this|that|the\s+(?:simulation|sim|scene|circuit|experiment)|simulation))?\s*[.!]*$/i, 'scene.run'],
  [/^(?:please\s+)?(?:pause|freeze|hold on|hold it)(?:\s+(?:it|this|the\s+(?:simulation|sim)))?\s*[.!]*$/i, 'scene.pause'],
  [/^(?:please\s+)?(?:stop|reset|restart|rewind)(?:\s+(?:it|this|the\s+(?:simulation|sim|scene)))?\s*[.!]*$/i, 'scene.reset'],
  [/^(?:please\s+)?(?:undo|undo (?:that|it|the last (?:change|thing))|take that back|revert (?:that|it))\s*[.!]*$/i, 'scene.undo'],
  [/^(?:please\s+)?(?:redo|redo (?:that|it)|put it back)\s*[.!]*$/i, 'scene.redo'],
  [/^(?:please\s+)?(?:quiz me|review(?: my)?(?: flash)?\s*cards?|flash\s*cards?|what(?:'s| is) due|cards? due)\s*[.!?]*$/i, 'learn.cards.next'],
  [/^(?:what(?:'s| is| do i have)\s+(?:on\s+)?(?:this|the)\s+page|describe\s+(?:this|the)\s+page|what(?:'s| is) here)\s*\??$/i, 'scene.describe'],
]

/** Asks for a number out of a running or finished simulation. */
const MEASURE_RE =
  /\b(?:how (?:fast|far|high|long|much|hot|big)|what(?:'s| is| are) the (?:current|voltage|speed|velocity|position|power|energy|period|frequency|force|reading|value|amplitude|max(?:imum)?|min(?:imum)?)|measure|reading|current (?:through|in)|voltage (?:across|at))\b/i

const PAGES_RE =
  /\b(?:(?:open|go to|switch to|show)\s+(?:the\s+|my\s+)?(?:\w+\s+)?(?:page|board|notebook)|(?:new|blank|create (?:a )?)\s*(?:page|board|document)|list\s+(?:my\s+)?pages|what pages|which pages)\b/i

const CARDS_RE = /\b(?:(?:make|create|write|add)\s+(?:me\s+)?(?:\d+\s+)?(?:some\s+)?flash\s*cards?|flash\s*cards?\s+(?:for|about|on)|remember this)\b/i
const HINT_RE = /\b(?:hint|i(?:'m| am) stuck|i don'?t get|give me a clue)\b/i
const MASTERY_RE = /\b(?:what should i (?:study|revise)|weakest|my (?:mastery|progress)|test tomorrow|exam tomorrow)\b/i
const MNEMONIC_RE = /\b(?:mnemonic|acronym|how (?:do i|to|can i) (?:remember|memori[sz]e))\b/i
const LESSON_RE = /\b(?:find (?:the )?(?:lesson|notes?|chapter)|(?:lesson|notes?|chapter) (?:on|about)|in (?:the|my) (?:course|syllabus))\b/i

/** "teach me Ohm's law", "give me a video lesson on diodes" → a film of the course lesson. */
const TEACH_RE = /^(?:please\s+)?(?:(?:can you\s+)?teach\s+(?:me|us)(?:\s+about)?|(?:give|make|show)\s+(?:me|us)\s+(?:a\s+)?(?:(?:video|animated|interactive)\s+)?(?:lesson|video|animation)\s+(?:on|about|of)|animate|walk\s+(?:me|us)\s+through)\s+(?:the\s+|a\s+|an\s+)?(.{3,80}?)\s*[.!?]*$/i

export function routeAct(prompt: string, hasPage: boolean): ActPlan | null {
  const p = prompt.trim()
  const teach = TEACH_RE.exec(p)
  if (teach) return { kind: 'direct', tool: 'teach.lesson', args: { topic: teach[1].replace(/\s+(?:with|using|in)\s+(?:a\s+)?(?:video|animation|visuals?).*$/i, '').trim() } }
  for (const [re, tool] of QUICK) if (re.test(p)) return { kind: 'quick', tool }
  if (PAGES_RE.test(p)) return { kind: 'agent', tools: ['page.list', 'page.open', 'page.create'] }
  if (CARDS_RE.test(p)) return { kind: 'agent', tools: ['course.search', 'learn.cards.create'] }
  if (HINT_RE.test(p)) return { kind: 'agent', tools: ['learn.hint', 'course.search'] }
  if (MASTERY_RE.test(p)) return { kind: 'agent', tools: ['learn.mastery.get', 'learn.cards.next'] }
  if (MNEMONIC_RE.test(p)) return { kind: 'agent', tools: ['learn.mnemonic'] }
  if (LESSON_RE.test(p)) return { kind: 'agent', tools: ['course.search'] }
  // A measurement needs a page that has something on it.
  if (hasPage && MEASURE_RE.test(p)) return { kind: 'agent', tools: ['scene.measure', 'scene.describe', 'scene.run'] }
  return null
}
