import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'Decidability, complexity and the compiler link',
  kicker: 'ENCT 203 · Theory of Computation · Chapters 5–6',
  subtitle: 'Some questions no program can answer; others can be answered, but not quickly. And why every compiler is a pair of these machines.',
  sections: [
    sec('ct', '5.1', 'The Church–Turing thesis and universal machines', { eyebrow: 'What “computable” means',
      body: `<p>The ${term('Church–Turing thesis')}: anything computable by an algorithm is computable by a Turing machine. It cannot be proved (“algorithm” is informal) but every model ever proposed agrees. A ${term('universal Turing machine')} takes the encoding of any machine M and an input w on its tape and simulates M on w — the idea of the stored-program computer.</p>`,
      figs: [dia(`direction: right
[Description of M] as m #blue
[Input w] as w #mint
[Universal machine U] as u #violet
(Result of M on w) as r
m -> u
w -> u
u -> r : simulate step by step
@0 m -> u : code
@1 w -> u : data
@2 u -> r : output
loop 4`, 'One machine that runs all machines.', { caption: 'the universal machine' })],
      qs: [q('utm', 'A universal Turing machine corresponds to…', ['A general-purpose stored-program computer.', 'Programs are just data on the tape.'], [['A single-purpose circuit.', 'The opposite.'], ['A finite automaton.', 'Far too weak.']])] }),
    sec('halt', '5.2', 'The halting problem', { eyebrow: 'The limit',
      body: `<p>Is there a program H(P, x) that always correctly says whether program P halts on input x? No. Suppose H existed and build D(P): run H(P, P); if H says “halts”, loop forever; otherwise halt. Now ask about D(D): if H(D, D) says it halts then D loops; if it says it loops then D halts. Either way H is wrong — a contradiction, by diagonalisation. So the halting problem is ${term('undecidable')}, and by reduction so are many others (does this program ever print “hello”? do two programs compute the same function?).</p>`,
      figs: [dia(`direction: down
[Assume H(P, x) decides halting] as h #blue
[Build D(P): if H(P, P) says halts → loop; else → halt] as d #amber
<What does D(D) do?> as q #violet
[If it halts, H said “halts”, so D loops] as a #rose
[If it loops, H said “loops”, so D halts] as b #rose
(Contradiction: H cannot exist) as c
h -> d
d -> q
q -> a : halts?
q -> b : loops?
a -> c
b -> c`, 'The self-referential trick behind the proof.', { caption: 'why no halting decider exists' })],
      qs: [q('halt', 'What does the halting problem show?', ['No algorithm can decide, for every program and input, whether it halts.', 'Some well-defined questions are beyond any computer.'], [['Programs cannot halt.', 'Most do.'], ['Only slow computers loop.', 'Looping is independent of speed.']])] }),
    sec('classes', '5.3', 'Time complexity: P and NP', { eyebrow: 'How fast',
      body: `<p>${term('P')} is the set of problems solvable in polynomial time by a deterministic machine (sorting, shortest path). ${term('NP')} is the set whose solutions can be <em>checked</em> in polynomial time (equivalently solved in polynomial time by a nondeterministic machine): factoring, Hamiltonian cycle, SAT. Clearly P ⊆ NP; whether P = NP is the most famous open problem. A problem is ${term('NP-complete')} if it is in NP and every NP problem reduces to it in polynomial time: solve one fast and you solve them all.</p>`,
      worked: [step('Verifying a proposed Hamiltonian cycle in a graph of n vertices means checking each consecutive pair is an edge and every vertex appears once.', '', { toc: 'Verify' }), step('That is O(n) — polynomial — so the problem is in NP. Finding one by trying all orders takes up to n! steps.', 'O(n)\\ \\text{check}\\ \\text{vs}\\ n!\\ \\text{search}', { hero: true, toc: 'Why NP' })],
      qs: [q('np', 'What is special about NP-complete problems?', ['Every problem in NP reduces to them; a fast algorithm for one would give one for all.', 'They are the hardest problems in NP.'], [['They are unsolvable.', 'They are solvable, just apparently slow.'], ['They are in P.', 'Unknown, and widely doubted.']])] }),
    sec('lex', '6.1', 'The compiler link: lexical analysis = DFA', { eyebrow: 'Theory at work',
      body: `<p>A compiler’s first phase, the lexical analyser, turns characters into tokens (identifiers, numbers, keywords). Each token class is a regular expression; the scanner is a DFA built from them. Here a tiny DFA recognises identifiers: a letter then letters or digits.</p>`,
      figs: [lab('dfa', { spec: 'start: s\naccept: id\ns,l -> id\ns,d -> bad\nid,l -> id\nid,d -> id\nbad,l -> bad\nbad,d -> bad', input: 'lldl' }, 'l = letter, d = digit. Input “l d l”: identifier.', ['accepted'], { caption: 'identifier scanner', name: 'id' })],
      qs: [q('lexq', 'Which automaton underlies a lexical analyser?', ['A DFA built from the token regular expressions.', 'Regular languages suffice for tokens.'], [['A pushdown automaton.', 'That is for nested syntax.'], ['A Turing machine.', 'Overkill.']])] }),
    sec('parse', '6.2', 'Syntax analysis = CFG and PDA', { eyebrow: 'Structure',
      body: `<p>The parser checks that the token stream fits the language’s context-free grammar and builds a parse tree. ${term('Top-down')} (recursive descent, LL) expands from the start symbol; ${term('bottom-up')} (shift–reduce, LR) reduces the input back to the start symbol using a stack — a PDA. Nested brackets and blocks need the stack, which is why a regular expression alone cannot parse a program.</p>`,
      figs: [lab('cfg', { grammar: 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a', string: '(a+a)*a' }, 'The parse tree of an expression with brackets.', ['derivation'], { caption: 'parsing (a+a)*a', name: 'pt' })],
      probs: [pr('p1', '<p>Why is a parser built on a context-free grammar rather than a regular expression?</p>', 'Programs have arbitrarily nested constructs — brackets, blocks, function calls — and matching them needs unbounded memory (a stack). Regular languages cannot do that (the pumping lemma argument for aⁿbⁿ), context-free ones can.')],
      qs: [q('llr', 'Bottom-up parsing uses a stack to…', ['Hold symbols waiting to be reduced by a grammar rule.', 'Shift pushes a token; reduce replaces a rule’s right-hand side by its variable.'], [['Store the whole program.', 'Not the purpose.'], ['Replace the lexer.', 'Different phase.']])],
      worked: [step('Stack-based check of (a+a)*a: shift (, a, reduce a→F→T→E, shift +, a, reduce, reduce E+T→E, shift ), reduce (E)→F, and so on.', '', { toc: 'Shift–reduce' }), step('Finally reduce T*F → T → E: the whole input is the start symbol.', 'E', { hero: true, toc: 'Accept' })] }),
    sec('summary', '6.3', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Halting is undecidable; some problems are solvable but not efficiently (NP-complete).</li><li>Compilers: lexer = DFA, parser = PDA/CFG.</li></ul>` }),
  ],
})
