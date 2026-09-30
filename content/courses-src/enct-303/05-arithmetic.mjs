import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const nc = run('numconv', { n: -5, bits: 8 }), bo = run('booth', { bits: 4, m: 7, q: -3 }), ie = run('ieee754', { value: 5.75 }), ie2 = run('ieee754', { value: -0.15625 })
  return lesson({
    title: 'Integer and floating-point arithmetic',
    kicker: 'ENCT 303 · Computer Organization and Architecture · Chapter 5',
    subtitle: 'How a fixed number of bits represents negatives and fractions, and how the ALU adds, multiplies and divides them.',
    sections: [
      sec('signed', '5.1', 'Signed integers', { eyebrow: 'Negative numbers',
        body: `<p>${term('Sign–magnitude')} spends one bit on the sign (two zeros, awkward adders). ${term("1's complement")} inverts all bits (still two zeros). ${term("2's complement")} is universal: invert and add 1. There is one zero, addition works the same for signed and unsigned numbers, and an <em>n</em>-bit word covers −2ⁿ⁻¹ … 2ⁿ⁻¹−1. To widen a number, copy the sign bit leftwards (sign extension).</p>`,
        figs: [lab('numconv', { n: -5, bits: 8 }, `−5 in 8 bits: sign-magnitude, 1's and 2's complement side by side (2's = ${nc.twos}).`, ['ones', 'twos'], { caption: 'encodings of −5', name: 'nc' })],
        qs: [q('range', 'Range of an 8-bit two’s-complement integer?', ['−128 … +127.', 'One more negative than positive value, because zero uses a non-negative pattern.'], [['−127 … +127.', 'That is sign–magnitude (with two zeros).'], ['0 … 255.', 'That is unsigned.']])],
        worked: [step('Represent −5 in 8 bits. Start with +5.', '00000101', { toc: 'Positive' }), step('Invert every bit, then add 1.', '11111010 + 1 = 11111011', { hero: true, toc: 'Negate' })] }),
      sec('addsub', '5.2', 'Addition, subtraction and overflow', { eyebrow: 'The adder',
        body: `<p>Subtraction is addition of the two’s complement: A − B = A + (¬B) + 1, so one adder does both. <b>Overflow</b> occurs when the true result does not fit: adding two positives gives a negative (or two negatives a positive). Hardware detects it as “carry into the sign bit ≠ carry out of the sign bit”. The carry flag is for unsigned overflow; the overflow flag is for signed.</p>`,
        worked: [step('Add 100 + 50 in 8-bit two’s complement.', '01100100 + 00110010 = 10010110', { toc: 'Sum' }), step('Two positives gave a negative pattern (−106): signed overflow.', '\\text{overflow}', { hero: true, toc: 'Overflow' })],
        qs: [q('ovf', 'When can adding a positive and a negative number overflow?', ['Never — the result lies between the two operands.', 'Overflow needs operands of the same sign.'], [['Whenever the carry flag is set.', 'Carry is an unsigned notion.'], ['When the result is zero.', 'Zero is always representable.']])] }),
      sec('booth', '5.3', 'Multiplication: shift-and-add and Booth', { eyebrow: 'Multiplying',
        body: `<p>Schoolbook binary multiplication adds a shifted copy of the multiplicand for each 1 in the multiplier. ${term("Booth's algorithm")} multiplies signed numbers directly and skips runs of 1s: it inspects pairs of multiplier bits (Q₀, Q₋₁) — 10 subtracts M, 01 adds M, 00/11 do nothing — then shifts arithmetically right. Watch 7 × (−3) with 4 bits: the answer ${bo.product} appears as ${bo.binary}.</p>`,
        figs: [lab('booth', { bits: 4, m: 7, q: -3 }, 'Booth’s algorithm, step by step.', ['product', 'binary'], { caption: '7 × (−3)', name: 'booth' })],
        qs: [q('boothpair', 'In Booth’s algorithm, the bit pair Q₀Q₋₁ = 10 means…', ['Subtract the multiplicand (a run of 1s begins).', '10 marks the start of a block of ones, handled by one subtraction instead of many additions.'], [['Add the multiplicand.', 'That is 01 (end of a run).'], ['Do nothing.', 'That is 00 or 11.']])],
        probs: [pr('p-booth', '<p>Use Booth’s algorithm for 7 × (−3) with 4-bit operands.</p>', `Result <b>${bo.product}</b> = ${bo.binary} in 8 bits (two's complement of 21 is 11101011).`, { verify: lab('booth', { bits: 4, m: 7, q: -3 }, 'The table.', ['product'], { caption: 'answer', name: 'ans' }) })] }),
      sec('div', '5.4', 'Division', { eyebrow: 'Dividing',
        body: `<p>Restoring division mirrors long division: shift the remainder left bringing down the next dividend bit, subtract the divisor, and if the result is negative restore (add back) and record a 0, otherwise record a 1. Non-restoring division avoids the restore step by adding instead of subtracting in the next cycle. Either takes one step per quotient bit.</p>`,
        worked: [step('Divide 7 (0111) by 2 (0010), 4 bits.', '', { toc: 'Task' }), step('Quotient bits by repeated subtract/restore: 0011 with remainder 1.', '7 = 3\\times2+1', { hero: true, toc: 'Result' })],
        qs: [q('restore', 'In restoring division, when is the divisor added back?', ['When the subtraction gave a negative remainder.', 'The quotient bit is 0 and the remainder is restored.'], [['When the quotient is complete.', 'No.'], ['Always.', 'Only after a failed subtraction.']])] }),
      sec('float', '5.5', 'Floating point: IEEE 754', { eyebrow: 'Fractions',
        body: `<p>A floating-point number is ±1.f × 2ᵉ stored as <b>sign | biased exponent | fraction</b>. Single precision uses 1 + 8 + 23 bits with bias 127; double uses 1 + 11 + 52 with bias 1023. The leading 1 is implicit. Step through 5.75: it is 101.11₂ = 1.0111 × 2², the exponent stored is 2 + 127 = 129, and the hex word is <b>${ie.hex}</b>.</p>`,
        figs: [lab('ieee754', { value: 5.75 }, `5.75 → 0x${ie.hex}`, ['hex', 'biased'], { caption: '5.75 in binary32', name: 'f1' }), lab('ieee754', { value: -0.15625 }, `−0.15625 → 0x${ie2.hex}`, ['hex'], { caption: '−0.15625', name: 'f2' })],
        qs: [q('bias', 'Why is the exponent stored with a bias?', ['So it is always non-negative and floating-point numbers compare like integers.', 'The bias 127 turns exponents −126…127 into 1…254.'], [['To save a sign bit for the mantissa.', 'The sign has its own bit.'], ['To make it twice as precise.', 'Precision comes from the fraction.']])],
        probs: [pr('p-ieee', '<p>Encode −0.15625 in IEEE 754 single precision.</p>', `−0.15625 = −1.25 × 2⁻³. Sign 1, exponent −3 + 127 = 124, fraction .01₂. Word = <b>0x${ie2.hex}</b>.`)] }),
      sec('fparith', '5.6', 'Floating-point arithmetic', { eyebrow: 'Operations',
        body: `<p>To <b>add</b>: align the exponents by shifting the smaller number right, add the significands, normalise, round. To <b>multiply</b>: add exponents (subtract one bias), multiply significands, normalise. Division subtracts exponents. Because results are rounded, floating-point addition is not associative, and subtracting nearly equal numbers loses digits (cancellation).</p>`,
        qs: [q('align', 'The first step of floating-point addition is…', ['Align the exponents by shifting the smaller operand’s significand right.', 'Only numbers with equal exponents can have their significands added.'], [['Multiply the significands.', 'That is multiplication.'], ['Round the result.', 'Rounding is the last step.']])] }),
    ],
  })
}
