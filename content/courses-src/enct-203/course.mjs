export default {
  id: 'enct-203', code: 'ENCT 203', title: 'Theory of Computation', subject: 'computing', semester: 3, program: 'computer',
  description: 'Languages, automata, grammars and Turing machines — every machine drawn, every string run through it.',
  order: ['01-languages-proofs', '02-finite-automata', '03-regular-languages', '04-cfg-pda', '05-turing-machines', '06-decidability-compilers'],
  lessons: {
    '01-languages-proofs': { path: '1 Formal Language, Logic and Proof', title: 'Languages, logic and proof' },
    '02-finite-automata': { path: '2 Finite Automata and Regular Language', title: 'DFA and NFA' },
    '03-regular-languages': { path: '2 Finite Automata and Regular Language', title: 'Regular expressions and the pumping lemma' },
    '04-cfg-pda': { path: '3 Context Free Grammar and Pushdown Automata', title: 'Grammars, parse trees and pushdown automata' },
    '05-turing-machines': { path: '4 Turing Machine', title: 'Turing machines' },
    '06-decidability-compilers': { path: '5–6 Decidability, Complexity, Compilers', title: 'Decidability, complexity and the compiler link' },
  },
}
