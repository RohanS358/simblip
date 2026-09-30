import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const d = run('cfg', { grammar: 'S -> aSb | ab', string: 'aaabbb' }), ex = run('cfg', { grammar: 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a', string: 'a+a*a' })
  return lesson({
    title: 'Grammars, parse trees and pushdown automata',
    kicker: 'ENCT 203 · Theory of Computation · Chapter 3',
    subtitle: 'Add one stack to a finite automaton and it can count and match brackets — exactly the power of a grammar.',
    sections: [
      sec('cfg', '3.1', 'Context-free grammars', { eyebrow: 'Rewriting rules',
        body: `<p>A ${term('context-free grammar')} has variables (S, E…), terminals (a, b, +…), productions A → α, and a start variable. A string is in the language if the start variable can be rewritten into it. The grammar <code>S → aSb | ab</code> generates aⁿbⁿ — the language no finite automaton can recognise. Deriving aaabbb: <b>${d.derivation}</b>.</p>`,
        figs: [lab('cfg', { grammar: 'S -> aSb | ab', string: 'aaabbb' }, 'Each step rewrites the leftmost variable; the last frame adds the parse tree.', ['steps', 'derivation'], { caption: 'deriving aaabbb', name: 'g1' })],
        qs: [q('gen', 'Which language does S → aSb | ab generate?', ['aⁿbⁿ for n ≥ 1.', 'Each use of aSb adds one a on the left and one b on the right.'], [['a*b*.', 'Unequal counts are not generated.'], ['(ab)*.', 'Those are not nested.']])] }),
      sec('tree', '3.2', 'Parse trees and ambiguity', { eyebrow: 'Structure',
        body: `<p>A ${term('parse tree')} shows which productions built a string. A grammar is ${term('ambiguous')} if some string has two different parse trees — a real problem for compilers, because the tree is the meaning. The classic fix is to encode precedence in layers of variables: E → E+T | T, T → T*F | F, F → (E) | a. Then a+a*a has exactly one tree, with * binding tighter than +.</p>`,
        figs: [lab('cfg', { grammar: 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a', string: 'a+a*a' }, 'The tree shows the multiplication grouped under the addition.', ['derivation'], { caption: 'unambiguous expression grammar', name: 'g2' })],
        qs: [q('amb', 'A grammar is ambiguous when…', ['Some string has more than one parse tree.', 'Different trees can mean different values.'], [['It has no start symbol.', 'Unrelated.'], ['It generates no strings.', 'Not the definition.']])] }),
      sec('nf', '3.3', 'Simplification and normal forms', { eyebrow: 'Clean-up',
        body: `<p>Before analysis, remove useless variables, ε-productions and unit productions (A → B). ${term('Chomsky normal form')} allows only A → BC and A → a; ${term('Greibach normal form')} only A → aα. Any CFL (without ε) has grammars in both forms. BNF is the notation compilers use for language syntax.</p>`,
        worked: [step('Convert S → aSb | ab to Chomsky normal form.', '', { toc: 'Task' }), step('Introduce A → a, B → b and split: S → AC | AB, C → SB.', 'S\\to AC\\mid AB,\\ C\\to SB,\\ A\\to a,\\ B\\to b', { hero: true, toc: 'CNF' })],
        qs: [q('cnf', 'A production allowed in Chomsky normal form is…', ['A → BC (two variables) or A → a (one terminal).', 'Nothing else.'], [['A → aBc.', 'Mixed and too long.'], ['A → ε (in general).', 'Removed before CNF.']])] }),
      sec('pda', '3.4', 'Pushdown automata', { eyebrow: 'A stack for memory',
        body: `<p>A ${term('PDA')} is an NFA with a stack. A move depends on the state, the input symbol (or ε) and the top of the stack, and changes the state and replaces the top with a string. To recognise aⁿbⁿ: push an A for every a, pop one for every b, accept if the stack returns to its bottom marker Z. Watch the stack on the right.</p>`,
        figs: [lab('pda', { input: 'aaabbb' }, 'Top of the stack is the highlighted cell.', ['accepted'], { caption: 'aaabbb is accepted', name: 'p1' }), lab('pda', { input: 'aabbb' }, 'One b too many: the stack runs dry.', ['accepted'], { caption: 'aabbb is rejected', name: 'p2' })],
        qs: [q('stack', 'What lets a PDA check aⁿbⁿ but not a DFA?', ['The stack stores an unbounded count of a’s.', 'Its memory grows with the input.'], [['More states.', 'Finite states cannot count without bound.'], ['A second tape.', 'That would be a Turing machine.']])],
        probs: [pr('p-pda', '<p>Does the PDA in the figure accept aabbb?</p>', `No. After aa, two A’s are pushed; the first two b’s pop them; the third b finds only Z on the stack, so no move is possible: <b>rejected</b>.`, { verify: lab('pda', { input: 'aabbb' }, 'Trace it.', ['accepted'], { caption: 'answer', name: 'ans' }) })] }),
      sec('eq', '3.5', 'CFG ⇔ PDA, closure and limits', { eyebrow: 'Equivalence',
        body: `<p>Context-free languages are exactly those accepted by PDAs: a grammar becomes a PDA that guesses derivations on its stack, and a PDA becomes a grammar whose variables stand for “go from state p to q popping this symbol”. CFLs are closed under union, concatenation and star, but <em>not</em> under intersection or complement. The pumping lemma for CFLs (pump two places at once) shows aⁿbⁿcⁿ is not context-free. Context-sensitive grammars (α → β with |α| ≤ |β|) sit one level above.</p>`,
        qs: [q('abc', 'Is aⁿbⁿcⁿ context-free?', ['No — one stack can match two counts but not three.', 'The CFL pumping lemma proves it.'], [['Yes, S → aSbSc.', 'That generates a different language.'], ['Yes, it is regular.', 'Not even that.']])] }),
      sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>CFG generates, PDA recognises: same class.</li><li>Ambiguity lives in the grammar; layering operators removes it.</li><li>CNF: A → BC | a.</li></ul>` }),
    ],
  })
}
