import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'Languages, logic and proof',
  kicker: 'ENCT 203 · Theory of Computation · Chapter 1',
  subtitle: 'The vocabulary everything else is built on: strings, languages, and how to be sure a claim is true.',
  sections: [
    sec('alpha', '1.1', 'Alphabets, strings and languages', { eyebrow: 'Vocabulary',
      body: `<p>An ${term('alphabet')} Σ is a finite set of symbols, e.g. {0, 1}. A ${term('string')} is a finite sequence of them; ε is the empty string and Σ* the set of all strings. A ${term('language')} is any subset of Σ* — for example “all binary strings ending in 01”. The whole subject asks: <em>how complicated a machine is needed to recognise a given language?</em></p>`,
      worked: [step('Over Σ = {0, 1} how many strings have length exactly 3?', '', { toc: 'Question' }), step('Two choices for each of three positions.', '2^3 = 8', { hero: true, toc: 'Count' })],
      qs: [q('eps', 'What is the length of the empty string ε?', ['0.', 'It contains no symbols.'], [['1.', 'It has no symbol at all.'], ['Undefined.', 'It is perfectly well defined.']])] }),
    sec('ops', '1.2', 'Operations on languages', { eyebrow: 'Building new ones',
      body: `<p>From languages L and M: ${term('union')} L ∪ M, ${term('concatenation')} LM (a string of L followed by one of M) and the ${term('Kleene star')} L* (zero or more strings of L joined). If L = {a, b} then L* contains ε, a, b, aa, ab, … — every string over {a, b}.</p>`,
      figs: [dia(`direction: right
[L = {a}] as l #blue
[M = {b}] as m #mint
[L ∪ M = {a, b}] as u #amber
[LM = {ab}] as c #violet
[L* = {ε, a, aa, aaa, …}] as s #rose
l -> u
m -> u
l -> c
m -> c
l -> s`, 'Three ways to combine languages.', { caption: 'language operations' })],
      qs: [q('star', 'Does L* always contain ε?', ['Yes — zero repetitions give the empty string.', 'Even if L itself does not contain ε.'], [['Only if ε ∈ L.', 'Star allows zero copies.'], ['Never.', 'It always does.']])] }),
    sec('logic', '1.3', 'Propositional logic and inference', { eyebrow: 'Reasoning',
      body: `<p>Statements combine with ¬ (not), ∧ (and), ∨ (or), → (implies), ↔ (iff). Key rules: <em>modus ponens</em> (from P and P → Q, conclude Q), <em>modus tollens</em> (from ¬Q and P → Q, conclude ¬P). De Morgan: ¬(P ∧ Q) = ¬P ∨ ¬Q. Predicate logic adds ∀ (for all) and ∃ (there exists).</p>`,
      worked: [step('Premises: “if it rains the match is cancelled” (R → C) and “the match was not cancelled” (¬C).', '', { toc: 'Given' }), step('Modus tollens gives ¬R.', 'R\\to C,\\ \\neg C\\ \\vdash\\ \\neg R', { hero: true, toc: 'Conclusion' })],
      qs: [q('mp', 'From P → Q and Q, what can you conclude about P?', ['Nothing — that is the fallacy of affirming the consequent.', 'Q may have other causes.'], [['P is true.', 'Affirming the consequent.'], ['P is false.', 'Also unjustified.']])] }),
    sec('proof', '1.4', 'Proof techniques', { eyebrow: 'Being sure',
      body: `<p>Direct proof; ${term('contradiction')} (assume the opposite and derive an absurdity — e.g. √2 is irrational); ${term('induction')} (prove a base case and that n ⇒ n+1); the ${term('pigeonhole principle')} (n+1 pigeons in n holes: some hole has two — the engine behind the pumping lemma); ${term('diagonalisation')} (build an object that differs from the i-th item in the i-th place — proves the reals are uncountable and the halting problem undecidable).</p>`,
      worked: [step('Prove 1 + 2 + … + n = n(n+1)/2 by induction.', '', { toc: 'Claim' }), step('Base n = 1: 1 = 1·2/2 ✓. Step: assume it for n; adding n+1 gives n(n+1)/2 + (n+1) = (n+1)(n+2)/2, the formula for n+1.', '\\tfrac{n(n+1)}2+(n+1)=\\tfrac{(n+1)(n+2)}2', { hero: true, toc: 'Induction' })],
      qs: [q('pig', 'Among 13 people, at least two share a birth month because of…', ['The pigeonhole principle.', '13 people, 12 months.'], [['Induction.', 'No.'], ['Contradiction only.', 'The principle is the point.']])],
      probs: [pr('p1', '<p>How many strings of length ≤ 2 are there over {a, b}?</p>', '1 (ε) + 2 + 4 = <b>7</b>.'), pr('p2', '<p>Let L = {ab}. List the first four strings of L*.</p>', 'ε, ab, abab, ababab.')] }),
    sec('hier', '1.5', 'The road ahead: the Chomsky hierarchy', { eyebrow: 'Map',
      body: `<p>Four classes of language, each needing a stronger machine: regular (finite automaton) ⊂ context-free (pushdown automaton) ⊂ context-sensitive (linear-bounded automaton) ⊂ recursively enumerable (Turing machine). The rest of the course climbs this ladder.</p>`,
      figs: [dia(`direction: right
[Regular ↔ finite automaton] as a #mint
[Context-free ↔ pushdown automaton] as b #blue
[Context-sensitive ↔ linear-bounded automaton] as c #amber
[Recursively enumerable ↔ Turing machine] as d #rose
a -> b : add a stack
b -> c : bounded tape
c -> d : unbounded tape
@0 a -> b : more memory
@1.2 b -> c : more memory
@2.4 c -> d : more memory
loop 4`, 'Each class needs strictly more memory than the one inside it.', { caption: 'the Chomsky hierarchy' })],
      qs: [q('ladder', 'Which machine recognises exactly the context-free languages?', ['A pushdown automaton.', 'A finite control plus one stack.'], [['A finite automaton.', 'Regular only.'], ['A Turing machine.', 'Far more.']])] }),
    sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>A language is a set of strings over an alphabet; ∪, concatenation and * build new ones.</li><li>Proofs: direct, contradiction, induction, pigeonhole, diagonalisation.</li></ul>` }),
  ],
})
