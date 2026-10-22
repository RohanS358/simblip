// The listening half of the teacher, as pure functions: which objects a circled region
// means, what to say about them with no model at all, what to ask a model when there is one,
// and how a student's answer ("this is tough") changes the pace of the lesson.
// No store, no DOM — the runtime in tutor.ts does the talking.

export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Placed {
  id: string
  name: string
  position: { x: number; y: number }
  size: { w: number; h: number }
  kind: string
  params?: Record<string, number | string>
}

/** Objects a circled region (in CANVAS coordinates) is about, most-covered first.
 *  An object counts if the circle covers a good part of it, or encloses its centre; a tiny
 *  circle / a tap picks whatever is under it, else the nearest thing within reach. */
export function pickObjects(objs: Placed[], r: Rect, reach = 90): Placed[] {
  const area = (o: Placed) => Math.max(1, o.size.w * o.size.h)
  const overlap = (o: Placed) => {
    const w = Math.min(r.right, o.position.x + o.size.w) - Math.max(r.left, o.position.x)
    const h = Math.min(r.bottom, o.position.y + o.size.h) - Math.max(r.top, o.position.y)
    return w > 0 && h > 0 ? w * h : 0
  }
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2
  const centreIn = (o: Placed) => {
    const x = o.position.x + o.size.w / 2, y = o.position.y + o.size.h / 2
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  const hit = objs
    .map((o) => ({ o, cover: overlap(o) / area(o), inside: centreIn(o) }))
    .filter((x) => x.cover >= 0.25 || x.inside)
    .sort((a, b) => b.cover - a.cover)
    .map((x) => x.o)
  // A circle drawn round the whole picture is a section, not a thing: cap what we explain at a few.
  if (hit.length) return hit.slice(0, 6)
  const near = objs
    .map((o) => ({ o, d: Math.hypot(o.position.x + o.size.w / 2 - cx, o.position.y + o.size.h / 2 - cy) - Math.max(o.size.w, o.size.h) / 2 }))
    .filter((x) => x.d <= reach)
    .sort((a, b) => a.d - b.d)
  return near.length ? [near[0].o] : []
}

/** A plain sentence for each kind of thing a lesson puts on the board. */
const BLURB: Record<string, string> = {
  battery: 'a battery. It is the pump of the circuit: it pushes the electric current round the loop',
  resistor: 'a resistor. It resists the flow of current, like a narrow, rough section of pipe',
  bulb: 'a bulb. Current flowing through it makes it glow',
  switch: 'a switch. Closed, it completes the loop so current can flow; open, it leaves a gap and the current stops',
  ammeter: 'an ammeter. It measures how much current flows past it each second',
  voltmeter: 'a voltmeter. It measures the push (the voltage) across a part of the circuit',
  wattmeter: 'a wattmeter. It measures how much power a part of the circuit is using',
  capacitor: 'a capacitor. It stores a little electric charge, like a tiny tank',
  inductor: 'an inductor. It resists sudden changes in current',
  diode: 'a diode. It lets current through in one direction only',
  mass: 'a ball (a mass). Its weight and how it moves are worked out by the simulator',
  block: 'a block. The simulator works out how it slides, falls and collides',
  ground: 'the ground. Things that fall come to rest on it',
  spring: 'a spring. It pulls or pushes back harder the more you stretch or squeeze it',
  graph: 'a graph. It draws how a quantity changes while the simulation runs',
  slider: 'a slider. Drag it to change a value, and watch how everything else reacts',
  formula: 'a formula. It says in symbols how the quantities are connected',
  text: 'a note of text that names or explains what is nearby',
  note: 'a note that explains what is nearby',
  table: 'a table of numbers',
  chart: 'a chart of values',
  'light-source': 'a lamp that sends out a beam of light',
  mirror: 'a mirror. Light bounces off it, and the angle in equals the angle out',
  'thin-lens': 'a lens. It bends light so the beams meet at a point called the focus',
  lens: 'a lens. It bends light so the beams meet at a point called the focus',
  screen: 'a screen that catches the light so you can see where it lands',
  system: 'the boundary of the experiment. Everything inside it runs together',
  line: 'a wire or line that joins two parts',
  connector: 'a wire or line that joins two parts',
}
const PARAM_WORDS: Record<string, string> = { V: 'voltage', R: 'resistance', I: 'current', C: 'capacitance', L: 'inductance', mass: 'mass', k: 'stiffness', f: 'focal length', closed: 'closed' }

/** What to say with no model: what the thing is, and what it is set to. */
export function fallbackExplain(objs: Placed[]): string {
  if (!objs.length) return "I can't see anything there. Try circling a part of the picture, or tap one of the parts."
  const first = objs[0]
  const blurb = BLURB[first.kind.toLowerCase()]
  const set = Object.entries(first.params ?? {})
    .filter(([k, v]) => k in PARAM_WORDS && (typeof v === 'number' || typeof v === 'string'))
    .slice(0, 2)
    .map(([k, v]) => (k === 'closed' ? (Number(v) ? 'The switch is closed' : 'The switch is open') : `its ${PARAM_WORDS[k]} is ${v}`))
  const head = blurb ? `That is ${blurb}.` : `That is ${first.name ? `the ${first.name}` : `a ${first.kind}`}.`
  const tail = set.length ? ` Right now ${set.join(' and ').replace(/^The/, 'the')}.` : ''
  const more = objs.length > 1 ? ` You have also circled ${objs.length - 1} other ${objs.length === 2 ? 'part' : 'parts'}; ask about one at a time and I will go into each.` : ''
  return head + tail + more
}

// ── pace: what "this is tough" changes ──────────────────────────────────────

export type Feel = 'got-it' | 'tough' | 'easy' | 'again'
export type Depth = 'simple' | 'normal' | 'deep'
export interface Pace { depth: Depth; speed: number }
export const START_PACE: Pace = { depth: 'normal', speed: 1 }

const clampSpeed = (s: number) => Math.min(1.5, Math.max(0.6, Math.round(s * 100) / 100))

/** The new pace after an answer, what the teacher says about it, and whether to say it again. */
export function adapt(p: Pace, feel: Feel): { pace: Pace; line: string; reexplain: boolean } {
  switch (feel) {
    case 'tough':
      return { pace: { depth: 'simple', speed: clampSpeed(p.speed - 0.2) }, line: "No problem, that's a tricky one. I'll slow down and put it more simply.", reexplain: true }
    case 'again':
      return { pace: p, line: "Of course. Let me say it a different way.", reexplain: true }
    case 'easy':
      return { pace: { depth: p.depth === 'simple' ? 'normal' : 'deep', speed: clampSpeed(p.speed + 0.2) }, line: "Great, you're ahead of me! I'll move a little faster and go deeper.", reexplain: false }
    default:
      return { pace: p, line: 'Lovely. On we go.', reexplain: false }
  }
}

/** Check in at the start of a new chapter, not more often than every `gap` beats, and straight away
 *  after two misses in a row (a student who is guessing is not following). */
export function shouldCheckIn(opts: { beatIsChapter: boolean; sinceLast: number; missesInRow: number; gap?: number }): boolean {
  if (opts.missesInRow >= 2) return true
  return opts.beatIsChapter && opts.sinceLast >= (opts.gap ?? 10)
}

// ── prompts for a model, when there is one ─────────────────────────────────

const DEPTH_STYLE: Record<Depth, string> = {
  simple: 'Use the simplest everyday words, one short sentence at a time, and one familiar comparison (water pipes, a playground, a bicycle). No formulas.',
  normal: 'Use clear words a Class 8 or 9 student knows. One everyday comparison is welcome.',
  deep: 'The student is doing well: add the reason underneath, and mention the formula or number if it helps.',
}

export function explainPrompts(a: {
  depth: Depth
  lesson: string
  section: string
  saying: string
  thing: string
  question?: string
  mode: 'what' | 'simpler' | 'more' | 'answer'
}): { system: string; user: string } {
  const task =
    a.mode === 'simpler' ? 'The student found this hard. Explain the same idea again, differently and more simply.'
    : a.mode === 'more' ? 'The student wants more. Go one step deeper than before.'
    : a.mode === 'answer' ? "Answer the student's question."
    : 'The student circled part of the board. Say what that part is and what it is doing here.'
  return {
    system: `You are a warm, encouraging teacher speaking aloud to one student in Class 8 or 9. ${DEPTH_STYLE[a.depth]} Reply in at most 3 short sentences, plain text, no lists, no markdown, no greeting. Speak straight to the student as "you" — never say "the student". Never say the student is wrong; if they have a misconception, say why it is a natural thing to think. If you are not sure of something, say less rather than guess.`,
    user: [
      `Lesson: ${a.lesson}. Part: ${a.section}.`,
      a.saying ? `You were just saying: "${a.saying}"` : '',
      a.thing ? `On the board (what the student circled):\n${a.thing}` : '',
      a.question ? `The student asks: "${a.question}"` : '',
      task,
    ].filter(Boolean).join('\n\n'),
  }
}

/** Keep a spoken answer short enough to say: at most `n` sentences, no stray markup. */
export function speakable(text: string, n = 3): string {
  const clean = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim()
  const parts = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
  return parts.slice(0, n).join(' ').trim()
}

/** With no model: restate a section in fewer words — the first sentence of each thing that was said. */
export function simplerFromNarration(lines: string[]): string {
  const firsts = lines.map((l) => l.split(/(?<=[.!?])\s+/)[0]).filter(Boolean).slice(0, 3)
  return firsts.length ? `Let me say it in fewer words. ${firsts.join(' ')}` : "Let's look at the picture again, slowly."
}
