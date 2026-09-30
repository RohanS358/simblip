import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Software process models',
  kicker: 'ENCT 352 · Software Engineering · Chapters 1–2',
  subtitle: 'Building software is not just coding: a process decides what is built, in what order, and how surprises are handled.',
  sections: [
    sec('why', '1.1', 'Why software engineering', { eyebrow: 'The problem',
      body: `<p>Software is ${term('complex')}, changes constantly and is invisible, so large projects fail for management reasons more often than technical ones: unclear requirements, poor estimates, weak testing. ${term('Software engineering')} applies systematic, measurable methods to develop, operate and maintain software. Key attributes of good software: <b>maintainable, dependable, efficient, usable</b>.</p>`,
      qs: [q('attr', 'Which attribute does most of the lifetime cost depend on?', ['Maintainability.', 'Most software spends most of its life being changed.'], [['Colour scheme.', 'Cosmetic.'], ['Lines of code.', 'A result, not a goal.']])] }),
    sec('water', '1.2', 'Waterfall', { eyebrow: 'Plan-driven',
      body: `<p>Phases run in sequence: requirements → design → implementation → testing → deployment → maintenance, each signed off before the next. Good when requirements are stable and well understood (e.g. safety-critical specs). Weakness: a mistake found late is expensive, and the customer sees nothing until the end.</p>`,
      figs: [dia(`direction: right
[Requirements] as r
[Design] as d
[Implementation] as i
[Testing] as t
[Deploy] as p
r -> d
d -> i
i -> t
t -> p
@0 r -> d
@1 d -> i
@2 i -> t
@3 t -> p
loop 1`, 'The token flows one way; there is no loop back.', { caption: 'waterfall' })],
      qs: [q('wf', 'Waterfall suits projects where…', ['Requirements are stable and well understood.', 'The plan can be fixed up front.'], [['Requirements change weekly.', 'Iterative methods fit better.'], ['Nothing is known.', 'Needs exploration.']])] }),
    sec('iter', '1.3', 'Incremental and spiral', { eyebrow: 'Learn as you build',
      body: `<p><b>Incremental</b>: deliver working slices; each increment adds features and gets feedback. <b>Spiral</b>: each loop = plan → risk analysis → build prototype → evaluate; risk drives the next loop, so it suits large, uncertain projects. <b>Prototyping</b> builds a throw-away model to clarify requirements.</p>`,
      figs: [dia(`direction: right
[Plan] as p
[Risk analysis] as r
[Build] as b
[Evaluate] as e
p -> r
r -> b
b -> e
e -> p : next loop
@0 p -> r
@1 r -> b
@2 b -> e
@3 e -> p
loop 3`, 'Each trip around the loop reduces risk.', { caption: 'spiral' })],
      qs: [q('sp', 'The spiral model is driven by…', ['Risk analysis.', 'Each loop targets the biggest remaining risk.'], [['Documentation volume.', 'Not the driver.'], ['Fixed phases.', 'That is waterfall.']])] }),
    sec('agile', '1.4', 'Agile and Scrum', { eyebrow: 'Short cycles',
      body: `<p>The Agile manifesto values working software, customer collaboration and responding to change over plans and paperwork. <b>Scrum</b>: a product owner keeps a prioritised backlog; every 1–4 week sprint the team pulls items, holds a daily stand-up, delivers an increment, then runs a review and retrospective. <b>XP</b> adds practices: pair programming, test-first, continuous integration.</p>`,
      figs: [dia(`mode: sequence
[Product owner] as po
[Team] as t
[Stakeholders] as s
po -> t : sprint backlog
t -> t : daily stand-up
t -> po : working increment
po -> s : sprint review
s --> po : feedback
po -> t : next sprint
@0 po -> t : sprint backlog
@1 t -> t : daily stand-up
@2 t -> po : working increment
@3 po -> s : sprint review
@4 s -> po : feedback`, 'One sprint, replayed.', { caption: 'a sprint' })],
      qs: [q('scrum', 'At the end of a sprint the team should have…', ['A potentially shippable increment.', 'Working software, however small.'], [['A finished design document.', 'Not the goal.'], ['Nothing until release.', 'That is waterfall thinking.']])] }),
    sec('est', '1.5', 'Effort estimation: COCOMO', { eyebrow: 'Numbers',
      body: `<p>Basic COCOMO (organic projects): effort E = 2.4·(KLOC)^1.05 person-months, development time T = 2.5·E^0.38 months. It is an estimate from size, so it is only as good as the size guess.</p>`,
      worked: [step('A 32 KLOC organic project. Effort:', 'E=2.4\\cdot32^{1.05}=91\\ \\text{PM}', { toc: 'Effort' }), step('Time.', 'T=2.5\\cdot91^{0.38}=14\\ \\text{months}', { toc: 'Time' }), step('Average team size = E/T.', '\\tfrac{91}{14}\\approx6.5', { hero: true, toc: 'Team' })],
      qs: [q('coc', 'Doubling code size in COCOMO (exponent 1.05) raises effort by…', ['A bit more than double.', '2^1.05 ≈ 2.07.'], [['Exactly double.', 'Exponent is above 1.'], ['Four times.', 'That needs an exponent of 2.']])],
      probs: [pr('p-coc', '<p>A 10 KLOC organic project. Find the effort.</p>', '2.4·10^1.05 = 2.4 × 11.22 = <b>26.9 person-months</b>.')] }),
    sec('choose', '1.6', 'Choosing a process', { eyebrow: 'Fit to the project',
      body: `<table><thead><tr><th>Situation</th><th>Lean towards</th></tr></thead><tbody><tr><td>Fixed, well-known requirements</td><td>Waterfall</td></tr><tr><td>Changing requirements, keen users</td><td>Agile / Scrum</td></tr><tr><td>Large, risky, novel</td><td>Spiral</td></tr><tr><td>Need early feedback on UI</td><td>Prototyping</td></tr></tbody></table>`,
      qs: [q('ch', 'A start-up unsure what customers want should prefer…', ['Short iterations with frequent feedback.', 'Agile reduces the cost of being wrong.'], [['A detailed two-year plan.', 'It would be wrong by month two.'], ['No process at all.', 'Chaos is not agility.']])] }),
  ],
})
