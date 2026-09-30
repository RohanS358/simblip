import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const inc = run('tm', { input: '1011' }), all1 = run('tm', { input: '111' })
  const pal = 'start: q0\naccept: qa\nblank: _\nq0,a -> q1,_,R\nq0,b -> q2,_,R\nq0,_ -> qa,_,S\nq1,a -> q1,a,R\nq1,b -> q1,b,R\nq1,_ -> q3,_,L\nq2,a -> q2,a,R\nq2,b -> q2,b,R\nq2,_ -> q4,_,L\nq3,a -> q5,_,L\nq3,_ -> qa,_,S\nq4,b -> q5,_,L\nq4,_ -> qa,_,S\nq5,a -> q5,a,L\nq5,b -> q5,b,L\nq5,_ -> q0,_,R'
  const p1 = run('tm', { spec: pal, input: 'abba' }), p2 = run('tm', { spec: pal, input: 'abb' })
  return lesson({
    title: 'Turing machines',
    kicker: 'ENCT 203 · Theory of Computation · Chapter 4',
    subtitle: 'An infinite tape, a moving head and a finite rulebook: the simplest machine that can compute anything a computer can.',
    sections: [
      sec('def', '4.1', 'The machine', { eyebrow: 'Definition',
        body: `<p>A ${term('Turing machine')} has an infinite tape of cells, a head that reads and writes one cell, and a finite control. Each step: read the symbol, then (depending on state and symbol) write a symbol, move Left, Right or Stay, and change state. It halts in an accepting or rejecting state. Its description is a table of rules <code>state, read → state, write, move</code>.</p>`,
        figs: [lab('tm', { input: '1011' }, 'Binary increment: walk to the right end, then add 1 moving left.', ['tape', 'steps'], { caption: 'incrementing 1011', name: 'inc' })],
        qs: [q('tape', 'What can a Turing machine do that a finite automaton cannot?', ['Write to its tape and revisit cells — unbounded read/write memory.', 'That is what makes it a general computer.'], [['Read the input.', 'A DFA reads too.'], ['Have states.', 'So does a DFA.']])] }),
      sec('comp', '4.2', 'Computing with a Turing machine', { eyebrow: 'Functions',
        body: `<p>Beyond accepting strings, a TM can <em>compute</em>: the tape at halt is the output. The increment machine turns 1011 (eleven) into <b>${inc.tape}</b> (twelve) and 111 into <b>${all1.tape}</b>. In the same style you can build machines for addition, copying, comparison and multiplication; composing them gives any algorithm.</p>`,
        worked: [step('Trace the carry in 1011 + 1.', '', { toc: 'Task' }), step('Scan right to the blank, step back; 1 + 1 = 0 carry 1, 1 + 1 = 0 carry 1, then 0 + 1 = 1 stop.', '1011+1=1100', { hero: true, toc: 'Increment' })],
        qs: [q('inc', 'What does the increment machine leave on the tape for input 111?', ['1000.', 'All carries propagate to a new leading 1.'], [['1110.', 'That is not 7 + 1.'], ['111.', 'Nothing would change.']])] }),
      sec('pal', '4.3', 'A decider: palindromes', { eyebrow: 'Accepting a language',
        body: `<p>This machine checks whether a string over {a, b} is a palindrome: erase the first symbol, remember it in the state, run to the far end, compare with the last symbol, erase that too, return to the start and repeat. abba → <b>${p1.outcome}</b>, abb → <b>${p2.outcome}</b>. A finite automaton cannot do this; neither can a PDA on its own for all palindromes of unknown middle — the TM simply moves back and forth.</p>`,
        figs: [lab('tm', { spec: pal, input: 'abba' }, 'Each round strips a matching pair.', ['outcome'], { caption: 'abba', name: 'pal' })],
        qs: [q('pal2', 'Why does this machine erase symbols as it matches them?', ['Erasing marks what has been checked so the head knows where the unmatched middle begins.', 'The tape is its working memory.'], [['To save space.', 'The tape is infinite.'], ['Because blanks are accepted.', 'Unrelated.']])] }),
      sec('var', '4.4', 'Variants that add no power', { eyebrow: 'Robustness',
        body: `<p>Multiple tapes, a two-way infinite tape, nondeterminism, a stay move, even extra heads: each can be simulated by a plain single-tape TM (possibly slower). Every reasonable model of computation — lambda calculus, recursive functions, RAM machines — turns out equivalent. That consistency is the evidence behind the Church–Turing thesis.</p>`,
        qs: [q('multi', 'Does a two-tape Turing machine recognise more languages than a one-tape one?', ['No — it can be simulated by a single tape, only slower.', 'Extra tapes change speed, not computability.'], [['Yes, twice as many.', 'Same class.'], ['Only with nondeterminism.', 'Also the same.']])] }),
      sec('hier', '4.5', 'Unrestricted grammars and the hierarchy', { eyebrow: 'Top of the ladder',
        body: `<p>Unrestricted (type-0) grammars have productions α → β with no constraint; they generate exactly the recursively enumerable languages, those a TM can accept (possibly running forever on non-members). A TM that always halts decides a <em>recursive</em> language. Type-1 context-sensitive, type-2 context-free and type-3 regular grammars complete the Chomsky hierarchy.</p>`,
        probs: [pr('p1', '<p>Match each class to its machine: regular, context-free, context-sensitive, recursively enumerable.</p>', 'Regular — finite automaton; context-free — pushdown automaton; context-sensitive — linear-bounded automaton; recursively enumerable — Turing machine.')],
        qs: [q('re', 'A language is recursively enumerable if…', ['Some Turing machine accepts exactly its strings (it may loop on others).', 'A decider must always halt; an acceptor need not.'], [['A TM decides it and always halts.', 'That is recursive (decidable).'], ['It is finite.', 'Not required.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>TM = finite control + unbounded tape; rules: state, read → state, write, move.</li><li>It computes functions and decides languages; variants are equivalent.</li></ul>` }),
    ],
  })
}
