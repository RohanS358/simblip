import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const crc = run('crc', { data: '1101011011', generator: '10011' }), ham = run('hamming', { data: '1011', error: 5 }), hf = run('huffman', { text: 'aaaabbc' })
  return lesson({
    title: 'Media, error control and compression',
    kicker: 'ENCT 253 · Data Communication · Chapter 3',
    subtitle: 'The wires and waves that carry bits, and the arithmetic that notices, fixes and shrinks them.',
    sections: [
      sec('guided', '3.1', 'Guided media', { eyebrow: 'Cables',
        body: `<p>${term('Twisted pair')} (UTP/STP): two insulated wires twisted to cancel interference — cheap, the LAN workhorse (Cat 5e/6, up to 100 m). ${term('Coaxial')}: a centre conductor inside a shield — higher bandwidth, cable TV. ${term('Optical fibre')}: light in a glass core by total internal reflection — enormous bandwidth, low loss, immune to electrical noise; single-mode for long haul, multimode for short runs.</p>`,
        figs: [dia(`direction: right
[Twisted pair: cheap, 100 m, LAN] as a #blue
[Coaxial: shielded, cable TV] as b #mint
[Fibre: light, km, huge bandwidth] as c #amber
a -> b : more bandwidth
b -> c : much more`, 'Bandwidth and distance rise left to right; so does cost.', { caption: 'guided media' })],
        qs: [q('fib', 'Why is optical fibre immune to electromagnetic interference?', ['It carries light, not electric current.', 'There is no electrical signal to pick up noise.'], [['It is shielded by metal.', 'It is glass.'], ['It is shorter.', 'Fibre runs kilometres.']])] }),
      sec('unguided', '3.2', 'Wireless media', { eyebrow: 'Through the air',
        body: `<p>Radio waves (omnidirectional, pass walls), microwaves (line-of-sight, dish to dish, satellites), infrared (short range, blocked by walls). Propagation modes: ${term('ground wave')} (low frequencies follow the earth), ${term('sky wave')} (HF reflects off the ionosphere — long distance), ${term('line of sight')} (VHF and above, limited by the horizon). Higher frequencies carry more data but travel less far.</p>`,
        qs: [q('los', 'Which propagation mode do microwaves and satellite links use?', ['Line of sight.', 'Their beams do not bend around the earth.'], [['Ground wave.', 'That is for low frequencies.'], ['Sky wave.', 'HF only.']])] }),
      sec('errors', '3.3', 'Error detection: parity, checksum, CRC', { eyebrow: 'Noticing',
        body: `<p>Noise flips bits. A single ${term('parity')} bit detects any odd number of errors. A ${term('checksum')} sums the data words and sends the complement. The ${term('CRC')} divides by a generator polynomial with XOR and sends the remainder: for data 1101011011 and generator 10011 the CRC is <b>${crc.crc}</b>.</p>`,
        figs: [lab('crc', { data: '1101011011', generator: '10011' }, 'Long division with XOR.', ['crc', 'codeword'], { caption: 'CRC', name: 'crc' })],
        qs: [q('par', 'A single even-parity bit cannot detect…', ['An even number of flipped bits.', 'Two flips leave the parity unchanged.'], [['A single flipped bit.', 'That it does detect.'], ['Any error at all.', 'It detects odd numbers of errors.']])] }),
      sec('ham', '3.4', 'Error correction: Hamming code', { eyebrow: 'Fixing',
        body: `<p>Extra parity bits at positions 1, 2, 4, 8… let the receiver locate a single error: the failed checks, read as binary, name the position. 1011 encodes as <b>${ham.codeword}</b>; flip bit 5 and the syndrome is <b>${ham.syndrome}</b>. The minimum Hamming distance d of a code decides its power: it detects d−1 errors and corrects ⌊(d−1)/2⌋.</p>`,
        figs: [lab('hamming', { data: '1011', error: 5 }, 'Encode, corrupt, correct.', ['codeword', 'syndrome'], { caption: 'Hamming(7,4)', name: 'ham' })],
        worked: [step('A code has minimum distance 5.', 'd=5', { toc: 'Given' }), step('It detects d − 1 = 4 errors and corrects ⌊4/2⌋ = 2.', '\\lfloor (5-1)/2\\rfloor=2', { hero: true, toc: 'Power' })],
        qs: [q('dist', 'A code with minimum distance 3 can…', ['Correct 1 error or detect 2.', 'd = 3 gives ⌊2/2⌋ = 1 correctable and 2 detectable.'], [['Correct 3 errors.', 'Only ⌊(d−1)/2⌋.'], ['Detect 3 errors only.', 'It detects d−1 = 2.']])] }),
      sec('comp', '3.5', 'Data compression', { eyebrow: 'Shrinking',
        body: `<p>${term('Lossless')} compression removes redundancy and reproduces the data exactly (ZIP, PNG): run-length coding, Huffman and Lempel–Ziv. ${term('Lossy')} compression discards what perception will not miss (JPEG, MP3): much higher ratios. Huffman gives frequent symbols short codes: aaaabbc needs <b>${hf.totalBits}</b> bits instead of ${hf.asciiBits}.</p>`,
        figs: [lab('huffman', { text: 'aaaabbc' }, 'The merge order builds the tree.', ['totalBits', 'codes'], { caption: 'Huffman coding', name: 'hf' })],
        qs: [q('lossy', 'Which format is lossy?', ['JPEG (and MP3).', 'They discard detail that eyes and ears barely notice.'], [['PNG.', 'Lossless.'], ['ZIP.', 'Lossless.']])],
        probs: [pr('p-rl', '<p>Run-length encode AAAABBBCCD.</p>', '<b>4A3B2C1D</b> — 10 characters become 8; it only helps when runs are long.')] }),
      sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Twisted pair → coax → fibre: more bandwidth, more cost.</li><li>CRC detects; Hamming corrects one error; distance d detects d−1, corrects ⌊(d−1)/2⌋.</li><li>Lossless keeps every bit; lossy trades fidelity for size.</li></ul>` }),
    ],
  })
}
