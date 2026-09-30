import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const d = run('dist', { kind: 'normal', mu: 0, sigma: 1, from: -3, to: 3 })
  return lesson({
    title: 'Control charts',
    kicker: 'ENSH 304 · Probability and Statistics · Chapter 5',
    subtitle: 'A factory cannot inspect every item — but it can watch the average and notice the moment the process drifts.',
    sections: [
      sec('var', '5.1', 'Two kinds of variation', { eyebrow: 'Noise vs signal',
        body: `<p>Every process varies. ${term('Common-cause')} variation is the steady random noise of a healthy process; ${term('special-cause')} variation comes from something specific (worn tool, new supplier). Statistical quality control (SQC) separates the two so we act only on real changes.</p>`,
        qs: [q('cs', 'A sudden jump after changing supplier is…', ['Special-cause variation.', 'It has an assignable cause.'], [['Common-cause.', 'That is steady noise.'], ['Sampling error only.', 'A step change is not noise.']])] }),
      sec('xbar', '5.2', 'The X̄ chart', { eyebrow: 'Watching the mean',
        body: `<p>Take small samples (size n) regularly and plot each sample mean. Centre line = grand mean X̿. Control limits sit three standard errors away: UCL, LCL = X̿ ± 3σ/√n (or X̿ ± A₂R̄ from tabulated constants). Because P(|Z| ≤ 3) = <b>${d.prob}</b>, a healthy process almost never crosses them by chance: about 1 false alarm in 370.</p>`,
        figs: [dia(`
Process -> Sample n items : every hour
Sample n items -> Plot mean : compute x̄
Plot mean -> Inside limits? : compare to LCL, UCL
Inside limits? -> Continue : yes
Inside limits? -> Investigate cause : no`, 'The loop an operator runs.', { caption: 'monitoring loop' })],
        worked: [step('Grand mean 50, σ = 4, n = 4. SE = 4/√4.', 'SE=2', { toc: 'SE' }), step('Limits = 50 ± 3·2.', 'LCL=44,\\ UCL=56', { hero: true, toc: 'Limits' })],
        qs: [q('lim', 'Control limits are placed at…', ['Three standard errors from the centre line.', 'Catches ≈ 99.73 % of ordinary variation.'], [['The specification limits.', 'Specs are customer requirements, not process behaviour.'], ['One standard error.', 'Far too many false alarms.']])],
        probs: [pr('p-xb', '<p>Process mean 100, σ = 6, samples of n = 9. Find the X̄ chart limits.</p>', 'SE = 6/3 = 2 → LCL = <b>94</b>, UCL = <b>106</b>.')] }),
      sec('rules', '5.3', 'Signals beyond one point', { eyebrow: 'Patterns that matter',
        body: `<p>A single point outside the limits is one signal. Others: 7 points in a row on one side of the centre line, 6 steadily rising, 2 of 3 beyond 2σ. Each pattern is unlikely under pure noise, so it flags a shift earlier than waiting for the limit.</p>`,
        qs: [q('run', 'Eight consecutive points above the centre line suggest…', ['The mean has shifted.', 'Probability under noise ≈ (½)⁸.'], [['Everything is normal.', 'It is very unlikely by chance.'], ['The limits are too wide.', 'Limits are not the issue.']])] }),
      sec('p', '5.4', 'Charts for attributes', { eyebrow: 'Counting defects',
        body: `<p>For defective fractions use the p-chart: centre p̄, limits p̄ ± 3√(p̄(1 − p̄)/n). For defects per unit use the c-chart: c̄ ± 3√c̄ (Poisson). Lower limits below zero are set to zero.</p>`,
        worked: [step('p̄ = 0.04, n = 100: √(0.04·0.96/100) = 0.0196.', '', { toc: 'σ_p' }), step('UCL = 0.04 + 0.0588; LCL negative, use 0.', 'UCL=0.0988', { hero: true, toc: 'Limits' })],
        qs: [q('cc', 'A c-chart monitors…', ['Defects per unit.', 'Poisson counts.'], [['Sample means.', 'That is X̄.'], ['Sample ranges.', 'That is R.']])] }),
      sec('cap', '5.5', 'Process capability', { eyebrow: 'Is the process good enough?',
        body: `<p>Control asks “is it stable?”; capability asks “does it meet the spec?” Cp = (USL − LSL)/6σ. Cp ≥ 1.33 is comfortable; Cp = 1 leaves 0.27 % out of spec. Cpk = min(USL − μ, μ − LSL)/3σ also penalises an off-centre mean.</p>`,
        worked: [step('Spec 40–60, σ = 2.5: 6σ = 15.', 'C_p=\\tfrac{20}{15}', { toc: 'Cp' }), step('So Cp = 1.33 if the mean is centred.', '', { hero: true, toc: 'Verdict' })],
        qs: [q('cp', 'Cp = 1.33 means the spec width is…', ['Eight standard deviations wide.', '1.33 × 6σ = 8σ.'], [['Six standard deviations.', 'That is Cp = 1.'], ['Exactly 3σ.', 'That is Cp = 0.5.']])] }),
      sec('acc', '5.6', 'Acceptance sampling', { eyebrow: 'Inspecting lots',
        body: `<p>A single-sampling plan (n, c) inspects n items from a lot and accepts if at most c are defective. The operating-characteristic curve plots P(accept) against the lot defect rate — computed with the binomial (or Poisson). Producer’s risk α rejects a good lot; consumer’s risk β accepts a bad one.</p>`,
        qs: [q('oc', 'Plan n = 50, c = 0 versus c = 2. Which accepts more lots?', ['c = 2.', 'More defects are tolerated.'], [['c = 0.', 'Strictest.'], ['They are the same.', 'c changes acceptance.']])] }),
    ],
  })
}
