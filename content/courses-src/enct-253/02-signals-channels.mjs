import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const f3 = run('fourier', { shape: 'square', harmonics: 3 }), f49 = run('fourier', { shape: 'square', harmonics: 49 })
  const p = run('pcm', { fm: 1, fs: 8, bits: 3 }), al = run('pcm', { fm: 5, fs: 8, bits: 3 })
  return lesson({
    title: 'Signals, bandwidth and channel capacity',
    kicker: 'ENCT 253 · Data Communication · Chapter 2',
    subtitle: 'Any signal is a sum of sine waves. How many you need is its bandwidth — and bandwidth plus noise sets the speed limit.',
    sections: [
      sec('sine', '2.1', 'Sine waves and the frequency domain', { eyebrow: 'Building blocks',
        body: `<p>A periodic signal has a ${term('period')} <i>T</i> and ${term('frequency')} <i>f</i> = 1/<i>T</i>. A sine wave A sin(2πft + φ) is described by amplitude, frequency and phase. The ${term('time domain')} shows amplitude against time; the ${term('frequency domain')} shows how much of each frequency is present.</p>`,
        worked: [step('A signal repeats every 20 ms.', 'T=20\\ \\text{ms}', { toc: 'Period' }), step('Its frequency.', 'f=\\frac1T=50\\ \\text{Hz}', { hero: true, toc: 'Frequency' })],
        qs: [q('freq', 'A sine wave has period 4 ms. Its frequency?', ['250 Hz.', '1 / 0.004 s.'], [['4 Hz.', 'That would be period 0.25 s.'], ['25 Hz.', 'Wrong reciprocal.']])] }),
      sec('fourier', '2.2', 'Fourier series', { eyebrow: 'Sum of sines',
        body: `<p>Fourier showed that any periodic signal is a sum of sine waves at multiples (harmonics) of its fundamental frequency. A square wave is sin x + ⅓ sin 3x + ⅕ sin 5x + … (odd harmonics only). Add more harmonics and the edges get sharper — but a ripple at each jump never disappears (the Gibbs phenomenon). The RMS error falls from <b>${f3.rmsError}</b> with 3 harmonics to <b>${f49.rmsError}</b> with 49.</p>`,
        figs: [lab('fourier', { shape: 'square', harmonics: 9 }, 'Step through: more harmonics, sharper edges.', ['rmsError'], { caption: 'building a square wave', name: 'fs' })],
        qs: [q('odd', 'A square wave contains which harmonics?', ['Only odd ones (1, 3, 5, …).', 'Its symmetry cancels the even ones.'], [['All harmonics equally.', 'Amplitudes fall as 1/n.'], ['Only the fundamental.', 'Then it would be a sine.']])] }),
      sec('bw', '2.3', 'Bandwidth', { eyebrow: 'The width of the spectrum',
        body: `<p>The ${term('bandwidth')} of a signal is the range of frequencies it occupies. A channel passes only a band; sharp-edged signals need many harmonics, so a narrow channel rounds them off. To send a square wave reasonably you need at least the 3rd–5th harmonic: for a 1 kHz square wave, about 5 kHz.</p>`,
        worked: [step('Send a 2 kHz square wave through a channel that passes 0–8 kHz. Which harmonics get through?', '', { toc: 'Question' }), step('Odd harmonics up to 8 kHz: 2, 6 kHz (3rd). 10 kHz (5th) is cut off.', '2\\ \\text{kHz},\\ 6\\ \\text{kHz}', { hero: true, toc: 'Answer' })],
        qs: [q('bwq', 'Why does a narrow-bandwidth channel round off a square wave?', ['It removes the high harmonics that make the edges sharp.', 'Sharp edges are made of high frequencies.'], [['It adds noise.', 'The effect is filtering.'], ['It shifts the frequency.', 'No shift occurs.']])] }),
      sec('nyq', '2.4', 'Nyquist and Shannon capacity', { eyebrow: 'Speed limits',
        body: `<p>${term('Nyquist')} (noiseless): max bit rate = 2B log₂ M for bandwidth B and M signal levels. ${term('Shannon')} (noisy): capacity C = B log₂(1 + SNR), with SNR as a ratio (dB = 10 log₁₀ ratio). Nyquist says more levels give more bits; Shannon says noise puts a ceiling on how many levels you can tell apart, however clever the coding.</p>`,
        worked: [step('A 3 kHz telephone channel, SNR 30 dB.', '', { toc: 'Given' }), step('30 dB is a ratio of 10³ = 1000.', '\\text{SNR}=10^{30/10}=1000', { toc: 'Convert' }), step('Shannon capacity.', 'C=3000\\log_2(1001)\\approx 29\\ 900\\ \\text{b/s}', { hero: true, toc: 'Capacity' }), step('Levels needed under Nyquist to reach that (2B log₂M = 6000 log₂M): log₂ M ≈ 4.98 → M ≈ 32.', '', { toc: 'Levels' })],
        qs: [q('shannon', 'Doubling the bandwidth while the SNR stays fixed…', ['Doubles the Shannon capacity.', 'C is proportional to B.'], [['Does nothing.', 'B multiplies the log term.'], ['Squares it.', 'Linear in B.']])],
        probs: [pr('p-sh', '<p>A channel has 4 kHz bandwidth and SNR of 15 (ratio). Find the Shannon capacity.</p>', 'C = 4000 log₂(1 + 15) = 4000 × 4 = <b>16 000 b/s</b>.'), pr('p-ny', '<p>A noiseless 6 kHz channel carries 8-level signals. Maximum data rate?</p>', '2 × 6000 × log₂8 = <b>36 000 b/s</b>.')] }),
      sec('sample', '2.5', 'Sampling: the Nyquist rate', { eyebrow: 'Analog to digital',
        body: `<p>To digitise an analog signal, sample it at least twice per cycle of its highest frequency (fs ≥ 2 fmax), otherwise higher frequencies masquerade as lower ones — ${term('aliasing')}. A 1 Hz tone sampled at 8 Hz is comfortable (Nyquist ok: <b>${p.nyquistOk}</b>); a 5 Hz tone at 8 Hz is not (<b>${al.nyquistOk}</b>). Each sample is then quantised to one of 2ⁿ levels: rate = fs·n (here ${p.bitRate} b/s) and SNR ≈ 6.02n + 1.76 dB (<b>${p.snrDb}</b> dB for 3 bits).</p>`,
        figs: [lab('pcm', { fm: 1, fs: 8, bits: 3 }, 'Blue dots are samples; green are the quantised values.', ['bitRate', 'snrDb', 'nyquistOk'], { caption: 'sampling and quantising', name: 'pcm' }), lab('pcm', { fm: 5, fs: 8, bits: 3 }, 'Under-sampled: the tone is misread as a slower one.', ['nyquistOk'], { caption: 'aliasing', name: 'alias' })],
        qs: [q('alias', 'Sampling a 5 kHz tone at 8 kHz causes…', ['Aliasing — it appears as a 3 kHz tone.', 'fs is below the Nyquist rate 2 × 5 = 10 kHz.'], [['No problem.', 'Below Nyquist it is a problem.'], ['Extra quantisation noise only.', 'The damage is to the frequency itself.']])] }),
      sec('perf', '2.6', 'Impairments', { eyebrow: 'What goes wrong',
        body: `<p>Three impairments: ${term('attenuation')} (signal weakens with distance, measured in dB), ${term('distortion')} (different frequencies travel at different speeds, smearing the pulses), and ${term('noise')} (thermal, crosstalk, impulse). Decibels add: a 3 dB loss halves the power; 10 dB is a factor 10.</p>`,
        worked: [step('A cable loses 2 dB/km over 15 km.', '2\\times15=30\\ \\text{dB}', { toc: 'Loss' }), step('Power ratio = 10^(−30/10) = 0.001: one thousandth arrives, so amplifiers are needed.', '10^{-3}', { hero: true, toc: 'Ratio' })],
        qs: [q('db', 'A −3 dB change in power means…', ['About half the power.', '10^(−0.3) ≈ 0.5.'], [['A third.', 'That is about −4.8 dB.'], ['Double.', 'That is +3 dB.']])] }),
    ],
  })
}
