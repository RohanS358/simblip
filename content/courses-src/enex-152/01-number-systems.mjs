import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const a = run('numconv', { n: 25 })
  const n = run('numconv', { n: -25, bits: 8 })
  const six = run('numconv', { n: -6, bits: 4 })
  return lesson({
    title: 'Number systems, codes and complements',
    kicker: 'ENEX 152 · Digital Logic · Introduction',
    subtitle: 'Hardware has two states, so every number, letter and sign is a pattern of 0s and 1s. Learn the patterns.',
    sections: [
      sec('digital', '1.1', 'Why binary', { eyebrow: 'Two states',
        body: `<p>An analog signal varies continuously and picks up noise; a ${term('digital')} signal is interpreted as only two levels (low = 0, high = 1) with a wide margin between them, so small noise is ignored and copies are exact. A ${term('bit')} is one binary digit; 8 bits make a byte. n bits give 2ⁿ patterns.</p>`,
        worked: [step('How many different values can 10 bits represent?', '', { toc: 'Setup' }), step('Each bit doubles the count.', '2^{10}=1024', { hero: true, toc: 'Count' })],
        qs: [q('n', '6 bits can represent how many distinct patterns?', ['64.', '2⁶.'], [['36.', '6² is not the rule.'], ['12.', 'That is 6 × 2.']])],
        probs: [pr('p-bits', '<p>What is the minimum number of bits needed to label 100 different items?</p>', '2⁶ = 64 &lt; 100 ≤ 128 = 2⁷, so <b>7 bits</b>.')] }),
      sec('conv', '1.2', 'Converting between bases', { eyebrow: 'Positional notation',
        body: `<p>In base r each place has weight rᵏ. To convert <b>to</b> binary, divide by 2 repeatedly and read remainders upward; <b>from</b> binary, add the weights of the 1s. Octal and hex group bits in 3s and 4s, so conversion is just regrouping. For decimal 25: binary <b>${a.binary}</b>, octal <b>${a.octal}</b>, hex <b>${a.hex}</b>.</p>`,
        figs: [lab('numconv', { n: 25 }, 'The same number in every code.', ['binary', 'octal', 'hex'], { caption: '25 in other bases', name: 'nc' })],
        worked: [step('25 ÷ 2 = 12 r 1; 12 ÷ 2 = 6 r 0; 6 ÷ 2 = 3 r 0; 3 ÷ 2 = 1 r 1; 1 ÷ 2 = 0 r 1.', '', { toc: 'Divide' }), step('Read the remainders upward.', '25_{10}=11001_2', { hero: true, toc: 'Read up' })],
        qs: [q('hex', 'Binary 1011 0110 in hex is…', ['B6.', '1011 = B, 0110 = 6.'], [['96.', 'Misread the nibbles.'], ['66.', 'Wrong first nibble.']])] }),
      sec('bcd', '1.3', 'BCD, excess-3 and Gray', { eyebrow: 'Codes for decimal digits',
        body: `<p><b>BCD</b> writes each decimal digit in 4 bits: 25 → <b>${a.bcd}</b>. <b>Excess-3</b> adds 3 to each digit (<b>${a.excess3}</b>), which is self-complementing. <b>Gray</b> code changes only one bit between neighbouring values (<b>${a.gray}</b> for 25) — ideal for position encoders because no glitch between steps can show a wrong value.</p>`,
        qs: [q('gr', 'Gray code is useful for shaft encoders because…', ['Only one bit changes per step.', 'No false intermediate readings.'], [['It is shorter than binary.', 'Same length.'], ['It is decimal.', 'No.']])] }),
      sec('neg', '1.4', 'Signed numbers', { eyebrow: 'Negative values',
        body: `<p>Three schemes: <b>sign–magnitude</b> (top bit is the sign), <b>1’s complement</b> (invert all bits), <b>2’s complement</b> (invert, then add 1). 2’s complement wins: one zero, and addition just works. For −25 in 8 bits: sign–magnitude <b>${n.signMag}</b>, 1’s <b>${n.ones}</b>, 2’s <b>${n.twos}</b>. A 4-bit word covers −8 … +7.</p>`,
        figs: [lab('numconv', { n: -25, bits: 8 }, 'Compare the three negative encodings.', ['twos', 'ones', 'signMag'], { caption: '−25 in 8 bits', name: 'neg' })],
        worked: [step('+25 = 00011001. Invert every bit.', '11100110', { toc: 'Invert' }), step('Add 1.', '11100111=-25', { hero: true, toc: 'Add 1' })],
        qs: [q('tc', 'The 4-bit 2’s complement of +6 is…', ['1010.', `0110 inverted is 1001, plus 1 is ${six.twos}.`], [['1001.', 'That is the 1’s complement.'], ['1110.', 'That is sign–magnitude.']])],
        probs: [pr('p-tc', '<p>Write −13 in 8-bit 2’s complement.</p>', '13 = 00001101 → invert 11110010 → +1 = <b>11110011</b>.')] }),
      sec('add', '1.5', 'Adding and overflow', { eyebrow: 'Fixed word length',
        body: `<p>In 2’s complement, add as usual and discard the carry out. <b>Overflow</b> occurs when two numbers of the same sign give a result of the opposite sign (equivalently the carry into and out of the sign bit differ). In 4 bits, 5 + 4 = 9 does not fit in −8…+7: 0101 + 0100 = 1001, which reads as −7.</p>`,
        worked: [step('0101 (+5) + 0100 (+4).', '', { toc: 'Add' }), step('Result 1001 is negative although both inputs were positive: overflow.', '1001=-7', { hero: true, toc: 'Detect' })],
        qs: [q('ov', 'Adding two positive 2’s complement numbers gives a negative result. That means…', ['Overflow.', 'The true sum did not fit.'], [['A correct answer.', 'Signs cannot flip legitimately.'], ['A carry error only.', 'It is overflow.']])] }),
      sec('ascii', '1.6', 'Characters and parity', { eyebrow: 'Text and checking',
        body: `<p>ASCII assigns 7-bit codes to characters: ‘A’ = 65 = 1000001₂, ‘a’ = 97. Unicode extends this to all scripts (UTF-8). A <b>parity bit</b> makes the count of 1s even (or odd) so a single flipped bit is detected — though not corrected.</p>`,
        worked: [step('Even parity for ‘A’ = 1000001 (two 1s).', '', { toc: 'Count' }), step('Already even, so the parity bit is 0.', '01000001', { hero: true, toc: 'Parity' })],
        qs: [q('par', 'A single parity bit can…', ['Detect any one-bit error.', 'But cannot say which bit.'], [['Correct any one-bit error.', 'Needs Hamming codes.'], ['Detect all two-bit errors.', 'Two flips cancel out.']])] }),
    ],
  })
}
