import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const b = run('bayes', { prior: 0.01, sensitivity: 0.9, specificity: 0.91 }), f = run('fuzzy', { temp: 28 })
  return lesson({
    title: 'Logic, Bayes and fuzzy reasoning',
    kicker: 'ENCT 351 · Artificial Intelligence · Chapter 3',
    subtitle: 'Representing what an agent knows — exactly, probably, or vaguely.',
    sections: [
      sec('kb', '3.1', 'Knowledge-based agents and logic', { eyebrow: 'Symbols',
        body: `<p>A ${term('knowledge-based agent')} stores sentences in a knowledge base and infers new ones. ${term('Propositional logic')} uses true/false statements with ¬ ∧ ∨ → ↔; ${term('first-order (predicate) logic')} adds objects, predicates and quantifiers: ∀x Human(x) → Mortal(x). Inference rules: modus ponens, resolution. Semantic networks, frames and knowledge graphs store facts as nodes and links.</p>`,
        worked: [step('KB: Human(Socrates); ∀x Human(x) → Mortal(x). Instantiate x = Socrates.', '', { toc: 'Facts' }), step('Modus ponens gives Mortal(Socrates).', '\\text{Human(S)},\\ \\text{Human(S)}\\to\\text{Mortal(S)}\\ \\vdash\\ \\text{Mortal(S)}', { hero: true, toc: 'Inference' })],
        figs: [dia(`direction: right
[Socrates] as s #blue
[Human] as h #mint
[Mortal] as m #amber
s -> h : is a
h -> m : implies`, 'A tiny semantic network.', { caption: 'a knowledge graph fragment' })],
        qs: [q('fol', 'What does first-order logic add over propositional logic?', ['Objects, predicates and quantifiers (∀, ∃).', 'It can say something about all members of a class.'], [['Probabilities.', 'That is another extension.'], ['Nothing.', 'It is far more expressive.']])] }),
      sec('bayes', '3.2', "Bayes' theorem", { eyebrow: 'Updating beliefs',
        body: `<p>P(H | E) = P(E | H) · P(H) / P(E). A disease affects 1% of people; a test detects it 90% of the time (sensitivity) and correctly clears 91% of healthy people (specificity). What is the chance you have it given a positive test? Count 1000 people: 10 are sick, 9 of them test positive; of 990 healthy, 9% = 89.1 also test positive. Of about 98 positives, 9 are truly sick: <b>${(Number(b.posterior) * 100).toFixed(1)}%</b>. A low prior keeps the posterior small even for a decent test.</p>`,
        figs: [lab('bayes', { prior: 0.01, sensitivity: 0.9, specificity: 0.91 }, 'Counting people makes the formula obvious.', ['posterior', 'truePositives', 'falsePositives'], { caption: 'Bayes by counting', name: 'by' })],
        qs: [q('prior', 'Why is the posterior so low even though the test is 90% sensitive?', ['The condition is rare (1%), so false positives outnumber true positives.', 'The prior matters as much as the test.'], [['The test is unreliable.', 'It is good; the prior is tiny.'], ['Probabilities cannot be updated.', 'That is the whole point of Bayes.']])],
        probs: [pr('p-by', '<p>Prior 1%, sensitivity 90%, specificity 91%. Find P(disease | positive).</p>', `True positives 9, false positives 89.1 → 9 / 98.1 = <b>${b.posterior}</b> ≈ ${(Number(b.posterior) * 100).toFixed(1)}%.`, { verify: lab('bayes', { prior: 0.01, sensitivity: 0.9, specificity: 0.91 }, 'The last frame.', ['posterior'], { caption: 'answer', name: 'ans' }) })] }),
      sec('net', '3.3', 'Bayesian networks', { eyebrow: 'Many variables',
        body: `<p>A ${term('Bayesian network')} is a directed acyclic graph where each node holds P(node | parents). It encodes a joint distribution compactly as a product: P(x₁…xₙ) = ∏ P(xᵢ | parents(xᵢ)). Example: Burglary → Alarm ← Earthquake; Alarm → JohnCalls. Evidence on a leaf updates beliefs about causes.</p>`,
        figs: [dia(`direction: down
[Burglary] as b #rose
[Earthquake] as e #amber
[Alarm] as a #violet
[John calls] as j #blue
[Mary calls] as m #blue
b -> a
e -> a
a -> j
a -> m`, 'Arrows point from cause to effect.', { caption: 'a Bayesian network' })],
        worked: [step('P(B) = 0.001, P(E) = 0.002. Alarm probabilities given (B,E) are listed in its table.', '', { toc: 'Tables' }), step('The full joint factorises as P(B)P(E)P(A|B,E)P(J|A)P(M|A) — 5 small tables instead of one with 2⁵ entries.', '2^5=32\\ \\text{vs}\\ 1+1+4+2+2=10', { hero: true, toc: 'Compactness' })],
        qs: [q('bn', 'Why are Bayesian networks compact?', ['Each node needs only its conditional table given its parents.', 'Independence assumptions are built into the graph.'], [['They store no probabilities.', 'They store many.'], ['They ignore dependencies.', 'They encode them.']])] }),
      sec('fuzzy', '3.4', 'Fuzzy logic', { eyebrow: 'Degrees of truth',
        body: `<p>Real concepts are vague: 28 °C is somewhat warm and a little hot. ${term('Fuzzy sets')} give each value a membership in [0, 1]. A ${term('fuzzy inference system')} has four steps: fuzzify the input (here μ<sub>cold</sub> = ${f.muCold}, μ<sub>warm</sub> = ${f.muWarm}, μ<sub>hot</sub> = ${f.muHot}), fire the rules (IF warm THEN fan medium…) with strength min(condition), aggregate the clipped outputs, and ${term('defuzzify')} by centroid — here a fan speed of <b>${f.speed}%</b>.</p>`,
        figs: [lab('fuzzy', { temp: 28 }, 'Four frames: sets, fuzzify, rules, defuzzify.', ['muWarm', 'muHot', 'speed'], { caption: 'fuzzy control of a fan', name: 'fz' })],
        qs: [q('mu', 'A fuzzy membership value of 0.7 means…', ['The element belongs to the set to degree 0.7.', 'It is not a probability.'], [['70% chance of belonging.', 'Membership is a degree of truth, not a chance.'], ['It is definitely a member.', 'That would be 1.']])] }),
      sec('summary', '3.5', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Logic: exact. Probability: uncertainty about facts. Fuzzy: vagueness in concepts.</li><li>Bayes: posterior ∝ likelihood × prior; Bayesian nets factorise the joint.</li></ul>` }),
      sec('ex', '3.6', 'Try it', { eyebrow: 'Practice',
        probs: [pr('p2', '<p>Fuzzy fan controller: temperature 35 °C. Which rules fire most strongly?</p>', 'At 35 °C μ<sub>hot</sub> is about 0.67 and μ<sub>warm</sub> about 0 — the “hot → fan high” rule dominates; run the card with temp 35 to see.', { verify: lab('fuzzy', { temp: 35 }, 'temp 35.', ['muHot', 'speed'], { caption: 'temperature 35', name: 'hot' }) })],
        qs: [q('rules', 'In fuzzy inference each rule fires with strength…', ['The membership of its condition (min for AND).', 'The consequent set is clipped at that height.'], [['Always 1.', 'Then it would be crisp.'], ['The square of the output.', 'No.']])] }),
    ],
  })
}
