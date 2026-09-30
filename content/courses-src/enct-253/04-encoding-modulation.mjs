import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const lc = run('linecode', { bits: '10110', codes: 'ami manchester nrzi' }), b8 = run('linecode', { bits: '100000000', codes: 'b8zs' }), hd = run('linecode', { bits: '1100001', codes: 'hdb3' })
  return lesson({
    title: 'Encoding, sampling and modulation',
    kicker: 'ENCT 253 · Data Communication · Chapter 4',
    subtitle: 'The four ways of turning information into signals — every combination of analog/digital data and signal.',
    sections: [
      sec('dd', '4.1', 'Digital data, digital signal: line codes', { eyebrow: 'Baseband',
        body: `<p>${term('NRZ-L')} ties the level to the bit; ${term('NRZ-I')} flips level on a 1 (a transition is easier to detect than an absolute level). ${term('RZ')} returns to zero mid-bit. ${term('Manchester')} puts a transition in every bit (low→high = 1) and ${term('differential Manchester')} codes a bit by whether there is a transition at its start. ${term('Bipolar AMI')} alternates the polarity of 1s, so there is no DC component; its weakness is long runs of 0s, cured by scrambling: ${term('B8ZS')} replaces eight 0s with 000+−0−+, and ${term('HDB3')} replaces four 0s with 000V or B00V. The bits 10110 give AMI <b>${lc.ami}</b>.</p>`,
        figs: [lab('linecode', { bits: '01001100011', codes: 'nrzl nrzi manchester diffmanchester' }, 'Compare four schemes on the same bits.', [], { caption: 'line codes', name: 'lc1' }), lab('linecode', { bits: '100000000', codes: 'ami b8zs' }, 'B8ZS breaks the run of zeros with deliberate violations.', ['b8zs'], { caption: 'AMI versus B8ZS', name: 'lc2' })],
        qs: [q('ami', 'Bipolar AMI encodes successive 1s as…', ['Alternating positive and negative pulses.', 'Zero is no pulse; this keeps the average voltage at zero.'], [['Always positive pulses.', 'That is unipolar.'], ['Transitions in mid-bit.', 'That is Manchester.']])],
        probs: [pr('p-b8', '<p>Encode 100000000 (a 1 followed by eight 0s) with B8ZS, assuming the previous pulse was negative.</p>', `The 1 is +. Eight zeros become 000VB0VB: V has the polarity of the previous pulse, so: <b>${b8.b8zs}</b> (+ 000 + − 0 − +).`, { verify: lab('linecode', { bits: '100000000', codes: 'b8zs' }, 'The waveform.', ['b8zs'], { caption: 'answer', name: 'ans' }) })] }),
      sec('ad', '4.2', 'Analog data, digital signal: PCM, DM', { eyebrow: 'Digitising voice',
        body: `<p>${term('PCM')}: sample at 8 kHz, quantise to 8 bits → 64 kb/s for one voice channel. ${term('DPCM')} sends the difference from a prediction; ${term('delta modulation')} sends one bit per sample: “up” or “down”. Non-uniform quantisation (companding) gives quiet sounds finer steps.</p>`,
        worked: [step('Voice limited to 4 kHz is sampled at 2 × 4000 = 8000 samples/s.', 'f_s = 2f_{max} = 8\\ \\text{kHz}', { toc: 'Nyquist' }), step('With 8 bits per sample.', '8000\\times8=64\\ 000\\ \\text{b/s}', { hero: true, toc: 'Bit rate' })],
        qs: [q('pcm', 'Bit rate of PCM voice with 8 kHz sampling and 8-bit samples?', ['64 kb/s.', '8000 × 8.'], [['8 kb/s.', 'Forgot the bits per sample.'], ['128 kb/s.', 'That is two channels.']])] }),
      sec('da', '4.3', 'Digital data, analog signal: ASK, FSK, PSK, QAM', { eyebrow: 'Modems and radios',
        body: `<p>A carrier sin(2πf<sub>c</sub>t) can carry bits by changing its amplitude (${term('ASK')}), frequency (${term('FSK')}) or phase (${term('PSK')}). ${term('QPSK')} uses four phases so each symbol carries 2 bits; ${term('QAM')} varies amplitude and phase together (16-QAM = 4 bits/symbol). Bit rate = baud rate × bits per symbol.</p>`,
        figs: [lab('modulation', { scheme: 'ask', bits: '1011001' }, 'Amplitude encodes the bit.', [], { caption: 'ASK', name: 'ask' }), lab('modulation', { scheme: 'fsk', bits: '1011001' }, 'Frequency encodes the bit.', [], { caption: 'FSK', name: 'fsk' }), lab('modulation', { scheme: 'psk', bits: '1011001' }, 'Phase flips by 180° for 0.', [], { caption: 'PSK', name: 'psk' })],
        worked: [step('A link runs at 2400 baud using 16-QAM.', '', { toc: 'Given' }), step('16 states = 4 bits per symbol.', '\\log_2 16 = 4', { toc: 'Bits/symbol' }), step('Bit rate = 2400 × 4.', '9600\\ \\text{b/s}', { hero: true, toc: 'Rate' })],
        qs: [q('baud', 'Baud rate versus bit rate — which is at least as large?', ['Bit rate (when each symbol carries ≥ 1 bit).', 'bit rate = baud × bits per symbol.'], [['Baud rate.', 'Only if symbols carry less than one bit.'], ['They are always equal.', 'Only for binary signalling.']])] }),
      sec('aa', '4.4', 'Analog data, analog signal: AM, FM, PM', { eyebrow: 'Radio',
        body: `<p>Modulation shifts a low-frequency message up to a frequency that antennas and channels handle well, and lets many stations share the air. ${term('AM')}: the carrier amplitude follows the message (bandwidth 2B, simple, noise-prone). ${term('FM')}: the carrier frequency follows it (wider bandwidth, much better noise resistance). ${term('PM')}: the phase follows it. Carson’s rule: FM bandwidth ≈ 2(Δf + B).</p>`,
        figs: [lab('modulation', { scheme: 'am', bits: '1011001' }, 'AM: the envelope follows the message.', [], { caption: 'AM', name: 'am' }), lab('modulation', { scheme: 'fm', bits: '1011001' }, 'FM: the spacing of the waves follows it.', [], { caption: 'FM', name: 'fm' })],
        worked: [step('Commercial FM: peak deviation 75 kHz, audio bandwidth 15 kHz.', '', { toc: 'Given' }), step('Carson’s rule.', 'BW\\approx2(75+15)=180\\ \\text{kHz}', { hero: true, toc: 'Bandwidth' })],
        qs: [q('fmam', 'Why is FM less noise-prone than AM?', ['Noise mostly changes amplitude, and FM information is in frequency.', 'An FM receiver can clip amplitude variations.'], [['FM uses less bandwidth.', 'It uses more.'], ['FM has no carrier.', 'It has a carrier.']])] }),
      sec('why', '4.5', 'Why modulate at all', { eyebrow: 'Motivation',
        body: `<p>An antenna must be a sizeable fraction of a wavelength: for a 3 kHz audio tone (λ = 100 km) that is impractical, but a 100 MHz carrier (λ = 3 m) needs an antenna of about a metre. Modulation also enables frequency-division sharing of a channel.</p>`,
        qs: [q('ant', 'What is one reason to modulate a low-frequency signal?', ['So it can be radiated by a practical-size antenna.', 'Antenna size scales with wavelength.'], [['To reduce its power.', 'No.'], ['To make it digital.', 'Modulation can be analog.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Line codes: NRZ, Manchester, AMI (+B8ZS/HDB3 scrambling).</li><li>PCM: 8 kHz × 8 bits = 64 kb/s.</li><li>ASK/FSK/PSK/QAM carry bits; AM/FM/PM carry analog messages.</li><li>Bit rate = baud × bits per symbol.</li></ul>` }),
    ],
  })
}
