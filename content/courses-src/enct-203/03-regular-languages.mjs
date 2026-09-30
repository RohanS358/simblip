import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => lesson({
  title: 'Regular expressions and the pumping lemma',
  kicker: 'ENCT 203 · Theory of Computation · Chapter 2 (regular languages)',
  subtitle: 'A notation for exactly the languages finite automata recognise — and a test for what they cannot.',
  sections: [
    sec('re', '2.7', 'Regular expressions', { eyebrow: 'Notation',
      body: `<p>Regular expressions describe languages with three operators: union <code>a|b</code> (or +), concatenation <code>ab</code>, star <code>a*</code>. Examples over {0,1}: <code>(0|1)*01</code> = ends in 01; <code>1*(01*01*)*</code>… = even number of 0s. A language is regular exactly when a regular expression, a DFA, or an NFA describes it (Kleene’s theorem).</p>`,
      figs: [dia(`direction: right
[Regular expression] as re #blue
[ε-NFA] as nfa #mint
[DFA] as dfa #amber
re -> nfa : Thompson construction
nfa -> dfa : subset construction
dfa -> re : state elimination`, 'The three descriptions are interchangeable.', { caption: 'Kleene’s theorem' })],
      qs: [q('ends', 'Which expression describes binary strings ending in 01?', ['(0|1)*01', 'Anything, then 0, then 1.'], [['01(0|1)*', 'That starts with 01.'], ['(01)*', 'Only repeated 01.']])] }),
    sec('conv', '2.8', 'From expression to automaton', { eyebrow: 'Constructions',
      body: `<p>Build the ε-NFA piece by piece (Thompson): a single symbol is two states joined by that symbol; union adds a new start with ε-arrows to both machines; concatenation links the first’s accept to the second’s start by ε; star adds ε-loops and a bypass. The pieces are machines you can run — the one below is the result for <code>a*b</code>.</p>`,
      figs: [lab('nfa', { spec: 'start: s\naccept: f\ns,a -> s\ns,b -> f', input: 'aaab' }, 'a*b accepts any number of a’s then one b.', ['accepted'], { caption: 'a*b', name: 'ab' })],
      worked: [step('Does a*b accept aaab? Follow the loops on a, then b to the accepting state.', '', { toc: 'Run' }), step('Yes: a a a loop in s, b moves to f and the input ends there.', 's \\xrightarrow{aaa} s \\xrightarrow{b} f', { hero: true, toc: 'Accepted' })],
      qs: [q('star', 'Which strings does a*b accept?', ['b, ab, aab, aaab … (any number of a’s, then one b).', 'The star allows zero or more a’s.'], [['Only ab.', 'Star allows more.'], ['Any string of a’s and b’s.', 'Must end with exactly one b.']])] }),
    sec('closure', '2.9', 'Closure properties', { eyebrow: 'What regular languages survive',
      body: `<p>Regular languages are closed under union, concatenation, star, complement (swap accepting and non-accepting states of a DFA), intersection (product construction) and reversal. Closure gives proofs by construction: if L is regular then so is “strings in L that are not of even length”.</p>`,
      qs: [q('comp', 'How do you build a DFA for the complement of a regular language?', ['Swap accepting and non-accepting states (in a complete DFA).', 'Every string now ends where it used to reject.'], [['Reverse all arrows.', 'That reverses the language.'], ['Delete the start state.', 'Not meaningful.']])],
      probs: [pr('p1', '<p>Write a regular expression for binary strings containing the substring 11.</p>', '<b>(0|1)*11(0|1)*</b> — anything, then 11, then anything.')] }),
    sec('pump', '2.10', 'The pumping lemma', { eyebrow: 'Proving a language is NOT regular',
      body: `<p>If L is regular there is a length <i>p</i> such that any string s ∈ L with |s| ≥ p can be split s = xyz with |xy| ≤ p, |y| ≥ 1, and xyⁱz ∈ L for every i ≥ 0. Why: a DFA with p states reading p symbols must repeat a state (pigeonhole), so the loop between can be repeated or removed. To prove L is <em>not</em> regular, pick a string that cannot be pumped.</p>`,
      worked: [step('Claim: L = {aⁿbⁿ} is not regular. Suppose it were, with pumping length p; take s = aᵖbᵖ.', '', { toc: 'Assume' }), step('Since |xy| ≤ p, y consists only of a’s. Pumping up (i = 2) gives more a’s than b’s.', 'xy^2z = a^{p+|y|}b^p\\notin L', { hero: true, toc: 'Contradiction' }), step('So L is not regular — it needs to count, which a finite memory cannot.', '', { toc: 'Conclusion' })],
      qs: [q('anbn', 'Why can no finite automaton recognise aⁿbⁿ?', ['It would need to remember an unbounded count of a’s.', 'Only a fixed number of states, so some count is forgotten.'], [['The alphabet is too large.', 'The alphabet is tiny.'], ['The language is finite.', 'It is infinite.']])] }),
    sec('decide', '2.11', 'Decision algorithms', { eyebrow: 'Questions with answers',
      body: `<p>For regular languages most questions are decidable by algorithm: is L empty (is an accepting state reachable?), finite, equal to another language (minimise both DFAs; compare), does a string belong (just run it).</p>`,
      figs: [lab('dfa', { spec: 'start: a\naccept: c\na,0 -> b\na,1 -> a\nb,0 -> b\nb,1 -> b\nc,0 -> c\nc,1 -> c', input: '0' }, 'State c is unreachable, so this machine accepts nothing: the language is empty.', ['accepted'], { caption: 'emptiness check', name: 'emp' })],
      qs: [q('empty', 'How do you test whether a DFA’s language is empty?', ['Check whether any accepting state is reachable from the start.', 'Graph search.'], [['Run every string.', 'There are infinitely many.'], ['Count the states.', 'Number of states does not decide it.']])] }),
    sec('summary', '2.12', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Regular expression ⇔ NFA ⇔ DFA.</li><li>Closed under union, concatenation, star, complement, intersection.</li><li>Pumping lemma shows non-regularity (aⁿbⁿ).</li></ul>` }),
  ],
})
