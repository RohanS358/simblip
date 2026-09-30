import { lesson } from '../kit.mjs'
export default ({ lab, scr, q, pr, step, sec, term, run }) => {
  const k = run('kmap', { vars: 4, minterms: '0 1 2 5 6 7 8 9 10 14' })
  const k3 = run('kmap', { vars: 3, minterms: '1 3 5 7' })
  const gate = (kind, label) => scr(`var a = create("input", { value: 1, name: "A" });
var b = create("input", { value: 0, name: "B" });
var g = create("${kind}", { name: "${label}" });
var y = create("output", { name: "Y" });
connect(a.out, g.in1, "wire");
connect(b.out, g.in2, "wire");
connect(g.out, y.in, "wire");
var s_a = create("slider", { min: 0, max: 1, step: 1, value: 1, label: "A", targetObjectId: a, targetParamName: "value" });
var s_b = create("slider", { min: 0, max: 1, step: 1, value: 0, label: "B", targetObjectId: b, targetParamName: "value" });
var tt = create("truthtable", { inputs: a.id + ";" + b.id, outputs: y.id });`, `Flip A and B; the table lists all four rows.`, { caption: label })
  return lesson({
    title: 'Gates, Boolean algebra and Karnaugh maps',
    kicker: 'ENEX 152 · Digital Logic · Gates, Boolean algebra and K-maps',
    subtitle: 'Six gates, a handful of algebra rules and one picture (the K-map) — enough to design and shrink any combinational circuit.',
    sections: [
      sec('gates', '2.1', 'The basic gates', { eyebrow: 'Building blocks',
        body: `<p>AND outputs 1 only if <i>all</i> inputs are 1; OR if <i>any</i> is 1; NOT inverts; NAND and NOR are the inverted AND/OR; XOR is 1 when the inputs <i>differ</i>. NAND and NOR are <b>universal</b>: any circuit can be built from one of them alone. Try the AND gate: only A = B = 1 lights the output.</p>`,
        figs: [gate('and-gate', 'AND')],
        qs: [q('xor', 'XOR output is 1 when…', ['The inputs differ.', '0⊕1 = 1⊕0 = 1.'], [['Both inputs are 1.', 'That gives 0.'], ['Both inputs are 0.', 'That gives 0.']])] }),
      sec('nand', '2.2', 'Universality of NAND', { eyebrow: 'One gate is enough',
        body: `<p>NAND with its inputs tied together is NOT. NAND followed by a NOT-made-of-NAND is AND. By De Morgan, NAND with inverted inputs is OR. Hence chip makers stock one kind of gate and wire it up to do everything.</p>`,
        figs: [gate('nand-gate', 'NAND')],
        qs: [q('uni', 'How do you get NOT from a NAND gate?', ['Tie both inputs together.', 'NAND(A, A) = A′.'], [['Leave one input unconnected.', 'Floating inputs are undefined.'], ['Use two NANDs in parallel.', 'Does not invert.']])] }),
      sec('alg', '2.3', 'Boolean algebra', { eyebrow: 'Rules for simplifying',
        body: `<table><thead><tr><th>Law</th><th>Form</th></tr></thead><tbody><tr><td>Identity</td><td>A + 0 = A, A·1 = A</td></tr><tr><td>Null</td><td>A + 1 = 1, A·0 = 0</td></tr><tr><td>Complement</td><td>A + A′ = 1, A·A′ = 0</td></tr><tr><td>Absorption</td><td>A + AB = A</td></tr><tr><td>De Morgan</td><td>(AB)′ = A′ + B′, (A + B)′ = A′B′</td></tr></tbody></table>`,
        worked: [step('Simplify F = AB + AB′.', '', { toc: 'Start' }), step('Factor A: A(B + B′).', '', { toc: 'Factor' }), step('B + B′ = 1, so F = A.', 'F=A', { hero: true, toc: 'Complement' })],
        qs: [q('dm', '(A + B)′ equals…', ['A′·B′.', 'De Morgan.'], [['A′ + B′.', 'That is (AB)′.'], ['A·B.', 'No.']])],
        probs: [pr('p-abs', '<p>Simplify F = A + A′B.</p>', 'A + A′B = A + B (absorption variant). <b>F = A + B</b>.')] }),
      sec('sop', '2.4', 'Sum of products and minterms', { eyebrow: 'From a truth table to a circuit',
        body: `<p>Every truth table is an OR of ${term('minterms')} (AND terms for each row where F = 1). This <b>sum of products</b> (SOP) is correct but usually bigger than needed. Shorthand F = Σm(1, 3, 5, 7) lists the rows. Dually, the product of maxterms (POS) uses rows where F = 0.</p>`,
        worked: [step('F = 1 at minterms 1, 3, 5, 7 of three variables (A, B, C).', '', { toc: 'Rows' }), step('Those are the rows with C = 1, so F = C.', 'F=C', { hero: true, toc: 'Pattern' })],
        qs: [q('mt', 'How many minterms can a 4-variable function have at most?', ['16.', '2⁴ rows.'], [['8.', 'That is for 3 variables.'], ['4.', 'That is the variable count.']])] }),
      sec('kmap', '2.5', 'Karnaugh maps', { eyebrow: 'Simplify by sight',
        body: `<p>A K-map lays the truth table out so that neighbouring cells differ in one variable (Gray-code order, wrapping around the edges). Circle rectangular groups of 1s of size 1, 2, 4, 8, 16 — the larger, the simpler — and each group gives one product term with only the variables that stay constant. For the minterms 1, 3, 5, 7 the four cells form one group: F = <b>${k3.sop}</b>. The default 4-variable example minimises to <b>${k.sop}</b> (${k.terms} terms).</p>`,
        figs: [lab('kmap', { vars: 4, minterms: '0 1 2 5 6 7 8 9 10 14' }, 'Coloured rings are the groups; the caption lists the result.', ['sop', 'terms'], { caption: 'four-variable K-map', name: 'km' }), lab('kmap', { vars: 3, minterms: '1 3 5 7' }, 'One group of four cells.', ['sop'], { caption: 'F = Σm(1,3,5,7)', name: 'km3' })],
        worked: [step('Four adjacent 1s in a row or square share two constant variables, so a group of 4 removes two variables.', '', { toc: 'Group' }), step('A group of 2ᵏ cells eliminates k variables.', '', { hero: true, toc: 'Rule' })],
        qs: [q('grp', 'A group of 8 cells on a 4-variable map gives a term with…', ['1 variable.', '8 = 2³ eliminates 3 of 4 variables.'], [['3 variables.', 'That is a group of 2.'], ['4 variables.', 'That is a single cell.']])] }),
      sec('dc', '2.6', 'Don’t-cares', { eyebrow: 'Free choices',
        body: `<p>Some input combinations never occur (a BCD digit never exceeds 9). Mark them X: you may treat each X as 1 if it lets a group grow, or 0 if not. This often yields a much simpler circuit. Only <i>include</i> an X in a group when it helps.</p>`,
        qs: [q('x', 'A don’t-care condition lets you…', ['Treat it as 0 or 1, whichever simplifies.', 'Free choice for unused inputs.'], [['Ignore the whole function.', 'Only the X cells.'], ['Always set it to 1.', 'Only when it helps.']])] }),
    ],
  })
}
