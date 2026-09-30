import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const d1 = run('dfa', { input: '1101' }), d2 = run('dfa', { input: '0101' })
  const enfa = 'start: q0\naccept: q2\nq0,a -> q0\nq0,e -> q1\nq1,b -> q2'
  return lesson({
    title: 'DFA and NFA',
    kicker: 'ENCT 203 · Theory of Computation · Chapter 2 (automata)',
    subtitle: 'The simplest computer: a finite number of states and no memory beyond “where am I?”.',
    sections: [
      sec('dfa', '2.1', 'Deterministic finite automata', { eyebrow: 'The machine',
        body: `<p>A ${term('DFA')} is five things: states Q, alphabet Σ, a transition function δ: Q × Σ → Q, a start state and a set of accepting states. Read the input left to right; each symbol moves exactly one arrow; accept if you end in an accepting state. The machine below accepts binary strings that end in 01: input 1101 → <b>${d1.accepted}</b>, 0101 → <b>${d2.accepted}</b>.</p>`,
        figs: [lab('dfa', { input: '1101' }, 'Double circle = accepting. The highlighted arrow is the one just taken.', ['accepted', 'path'], { caption: 'strings ending in 01', name: 'dfa' })],
        qs: [q('det', 'Why is a DFA called deterministic?', ['From each state, each symbol leads to exactly one next state.', 'There is never a choice.'], [['It always accepts.', 'It accepts only its language.'], ['It has one state.', 'It has several.']])] }),
      sec('design', '2.2', 'Designing a DFA', { eyebrow: 'A method',
        body: `<p>Decide what the states must <em>remember</em>, name one state per distinct situation, then add a transition for every state–symbol pair. For “ends in 01” the machine needs to remember only: nothing useful yet (q0), last symbol was 0 (q1), last two were 01 (q2). For “even number of 1s” two states suffice: even, odd.</p>`,
        figs: [lab('dfa', { spec: 'start: even\naccept: even\neven,0 -> even\neven,1 -> odd\nodd,0 -> odd\nodd,1 -> even', input: '1011' }, 'Two states count parity of 1s.', ['accepted'], { caption: 'an even number of 1s', name: 'even' })],
        qs: [q('states', 'Minimum number of states for “strings with an even number of 1s”?', ['2.', 'Even and odd are all it needs to remember.'], [['1.', 'One state cannot tell even from odd.'], ['3.', 'Not needed.']])],
        probs: [pr('p-dfa', '<p>Design a DFA over {0,1} accepting strings that end in 01. Does it accept 0101?</p>', `Use the three-state machine in Figure 2.1.1. 0101 ends in 01, so it is <b>${d2.accepted === 'yes' ? 'accepted' : 'rejected'}</b>.`, { verify: lab('dfa', { input: '0101' }, 'Run it.', ['accepted'], { caption: 'answer', name: 'ans' }) })] }),
      sec('nfa', '2.3', 'Nondeterministic finite automata', { eyebrow: 'Guessing',
        body: `<p>An ${term('NFA')} may have several transitions on the same symbol (or none). It accepts if <em>some</em> sequence of choices reaches an accepting state — equivalently it is in a <em>set</em> of states at once. NFAs are often far easier to write: “the second-to-last symbol is 1” needs 3 NFA states but 4 DFA states. Remarkably NFAs recognise exactly the same languages as DFAs.</p>`,
        figs: [lab('nfa', { input: '0110' }, 'Several states can be active at once.', ['accepted'], { caption: 'second-to-last symbol is 1', name: 'nfa' })],
        qs: [q('same', 'Are NFAs more powerful than DFAs?', ['No — every NFA has an equivalent DFA, though possibly exponentially larger.', 'Subset construction proves it.'], [['Yes, they recognise more languages.', 'They recognise exactly the regular languages.'], ['No, because NFAs cannot be simulated.', 'They can, by tracking the set of states.']])] }),
      sec('sub', '2.4', 'NFA to DFA: the subset construction', { eyebrow: 'Converting',
        body: `<p>Make each DFA state a <em>set</em> of NFA states. Start with {start}; for each set and symbol, the next set is the union of all NFA moves. A set is accepting if it contains an accepting NFA state. An NFA with <i>n</i> states gives at most 2ⁿ DFA states.</p>`,
        worked: [step('NFA: q0 loops on 0,1; on 1 also goes to q1; q1 goes to q2 on 0 or 1; q2 accepts.', '', { toc: 'NFA' }), step('From {q0} on 1: {q0, q1}. On 0 from {q0, q1}: {q0, q2}. So DFA states include {q0}, {q0,q1}, {q0,q2}, {q0,q1,q2}.', '\\delta(\\{q_0\\},1)=\\{q_0,q_1\\}', { hero: true, toc: 'Subsets' })],
        qs: [q('exp', 'An NFA with 5 states needs at most how many DFA states?', ['32 (2⁵).', 'Every subset of states can occur.'], [['5.', 'That would never need conversion.'], ['10.', 'Not the bound.']])] }),
      sec('eps', '2.5', 'ε-transitions', { eyebrow: 'Free moves',
        body: `<p>An ε-NFA may change state without reading any symbol. Before and after each input symbol, follow all ε-arrows (the ${term('ε-closure')}). Below, from q0 the ε-arrow to q1 means the machine may already “be in” q1, so it accepts aab (a a then b via q1 → q2) but not aa.</p>`,
        figs: [lab('nfa', { spec: enfa, input: 'aab' }, 'The active set includes the ε-closure.', ['accepted'], { caption: 'aab is accepted', name: 'eps1' }), lab('nfa', { spec: enfa, input: 'aa' }, 'aa never reaches q2.', ['accepted'], { caption: 'aa is rejected', name: 'eps2' })],
        qs: [q('clos', 'The ε-closure of a state is…', ['The set of states reachable using only ε-moves (including itself).', 'Used before and after each symbol.'], [['The empty set.', 'It contains the state itself.'], ['The accepting states.', 'Unrelated.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>DFA: one move per symbol. NFA: a set of possible moves. Same power.</li><li>Design by asking what must be remembered.</li><li>Subset construction: up to 2ⁿ states.</li></ul>` }),
    ],
  })
}
