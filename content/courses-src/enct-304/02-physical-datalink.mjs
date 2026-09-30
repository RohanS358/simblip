import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const crc = run('crc', { data: '1101011011', generator: '10011' })
  const ham = run('hamming', { data: '1011', error: 5 })
  const lc = run('linecode', { bits: '01001100011', codes: 'nrzl manchester ami' })
  return lesson({
    title: 'Encoding, framing and error control',
    kicker: 'ENCT 304 · Computer Networks · Chapters 2–3',
    subtitle: 'Turning bits into voltages, marking where frames start and end, and noticing — or fixing — the bit that got flipped.',
    sections: [
      sec('encoding', '2.1', 'Line coding', { eyebrow: 'Bits to signals',
        body: `<p>A wire carries voltages, so bits must be mapped to levels. ${term('NRZ-L')} holds a level for the whole bit; ${term('NRZ-I')} flips level for a 1. Both lose the clock on long runs of identical bits. ${term('Manchester')} puts a transition in the middle of every bit (low→high for 1, high→low for 0), so the receiver recovers the clock at the cost of double the signal rate — the code of classic 10 Mb/s Ethernet. ${term('Bipolar AMI')} sends 0 as no pulse and alternates + and − for 1s.</p>`,
        figs: [lab('linecode', { bits: '01001100011', codes: 'nrzl manchester ami' }, 'Step through: each code turns the same bits into a different waveform.', ['ami'], { caption: 'NRZ-L, Manchester and AMI', name: 'lc' })],
        qs: [q('clk', 'Why does Manchester coding help the receiver?', ['Every bit contains a mid-bit transition, so the clock can be recovered even from 000000.', 'NRZ gives no edge during a long run of identical bits.'], [['It halves the bandwidth.', 'It doubles the signalling rate.'], ['It uses three voltage levels.', 'That is AMI.']])] }),
      sec('framing', '3.1', 'Framing and byte stuffing', { eyebrow: 'Finding the edges',
        body: `<p>The data link layer must tell the receiver where a frame starts and ends. A flag byte (HDLC uses 01111110) does it; to stop data that happens to contain the flag confusing the receiver, the sender inserts extra bits — ${term('bit stuffing')}: after five consecutive 1s in the data, insert a 0, which the receiver removes.</p>`,
        worked: [step('Data: 0111111011 (contains six 1s in a row).', '', { toc: 'Data' }), step('After the first five 1s insert a 0 so the flag pattern 01111110 cannot appear inside the data.', '01111\\underline{0}1\\,1011\\ \\to\\ 0111110\\,11011', { hero: true, toc: 'Stuffed' })],
        qs: [q('stuff', 'After how many consecutive 1s does HDLC insert a 0?', ['Five.', 'The flag has six 1s, so five in a row must be broken up.'], [['Six.', 'Too late — the flag would already appear.'], ['Eight.', 'That is a byte count, not the rule.']])] }),
      sec('crc', '3.2', 'Error detection: parity, checksum, CRC', { eyebrow: 'Noticing errors',
        body: `<p>A single ${term('parity')} bit catches any odd number of flipped bits but no even number. The ${term('checksum')} adds the words and sends the complement. The ${term('CRC')} treats the message as a polynomial and sends the remainder of dividing by an agreed generator G(x): the receiver divides the whole frame and accepts only a zero remainder. It catches all single-bit errors, all bursts up to the generator’s degree, and almost everything else. Dividing 1101011011 by 10011 gives the CRC <b>${crc.crc}</b>; the frame sent is <b>${crc.codeword}</b>.</p>`,
        figs: [lab('crc', { data: '1101011011', generator: '10011' }, 'Long division with XOR — no carries.', ['crc', 'codeword'], { caption: 'computing a CRC', name: 'crc' }), lab('crc', { data: '1101011011', generator: '10011', flip: 3 }, 'Flip bit 3 in transit: the receiver’s remainder is not zero.', ['detected', 'receiverRemainder'], { caption: 'a corrupted frame', name: 'bad' })],
        qs: [q('rem', 'A CRC receiver divides the received frame by G(x). What does a non-zero remainder mean?', ['The frame was corrupted in transit.', 'A valid codeword is exactly divisible by the generator.'], [['The frame arrived correctly.', 'That would give zero.'], ['The generator was wrong.', 'Both sides agreed on it in advance.']])],
        probs: [pr('p-crc', '<p>Compute the CRC for data 1101011011 with generator 10011.</p>', `Append four zeros (degree of G) and divide with XOR; the remainder is <b>${crc.crc}</b>. The transmitted codeword is <b>${crc.codeword}</b>.`, { verify: lab('crc', { data: '1101011011', generator: '10011' }, 'The division.', ['crc'], { caption: 'answer', name: 'ans' }) })] }),
      sec('hamming', '3.3', 'Error correction: Hamming code', { eyebrow: 'Fixing errors',
        body: `<p>Detection needs a retransmission; ${term('Hamming codes')} let the receiver correct a single-bit error itself. Parity bits sit at positions 1, 2, 4, 8…; parity bit <i>p</i> covers every position whose binary index contains <i>p</i>. After an error the failing parity checks, read as a binary number, give the position of the bad bit — the ${term('syndrome')}. Data 1011 encodes to <b>${ham.codeword}</b>; corrupt bit 5 and the syndrome reads <b>${ham.syndrome}</b>.</p>`,
        figs: [lab('hamming', { data: '1011', error: 5 }, 'Encode, corrupt a bit, locate it, fix it.', ['codeword', 'syndrome'], { caption: 'Hamming(7,4)', name: 'ham' })],
        worked: [step('4 data bits need r parity bits with 2ʳ ≥ 4 + r + 1.', '2^3 = 8 \\ge 4+3+1', { toc: 'How many parity bits' }), step('So Hamming(7,4): 7 bits sent for 4 data bits.', '', { hero: true, toc: 'Code length' })],
        qs: [q('syn', 'The Hamming syndrome of a received word is 101 in binary. Which bit is wrong?', ['Bit 5.', 'The syndrome is the position of the error.'], [['Bit 3.', 'Syndrome 011.'], ['None.', 'Syndrome 000 means no error.']])] }),
      sec('protocols', '3.4', 'PPP, HDLC and Ethernet', { eyebrow: 'Real link protocols',
        body: `<p>${term('HDLC')} and ${term('PPP')} frame point-to-point links with flags, an address/control field, a payload and a CRC. ${term('Ethernet')} (IEEE 802.3) frames carry destination and source MAC (6 bytes each), a type, 46–1500 bytes of data and a 4-byte CRC. The data link layer is split into LLC (flow and error control, protocol multiplexing) and MAC (who may transmit, and addressing).</p>`,
        qs: [q('mtu', 'Maximum Ethernet payload?', ['1500 bytes.', 'That is the MTU; the minimum is 46 bytes.'], [['64 bytes.', 'That is the minimum frame size.'], ['9000 bytes.', 'Jumbo frames are an extension.']])] }),
      sec('summary', '3.5', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Line coding maps bits to signals; Manchester embeds the clock.</li><li>Framing needs flags and bit stuffing.</li><li>CRC detects, Hamming corrects single errors.</li></ul>` }),
    ],
  })
}
