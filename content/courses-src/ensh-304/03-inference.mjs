import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const c95 = run('confint', { n: 25, sigma: 10, zcrit: 1.96, intervals: 100 })
  const c99 = run('confint', { n: 25, sigma: 10, zcrit: 2.576, intervals: 100 })
  const c100 = run('confint', { n: 100, sigma: 10, zcrit: 1.96, intervals: 40 })
  const c25 = run('confint', { n: 25, sigma: 10, zcrit: 1.96, intervals: 40 })
  return lesson({
    title: 'Confidence intervals and hypothesis tests',
    kicker: 'ENSH 304 · Probability and Statistics · Chapter 3',
    subtitle: 'From a sample to a statement about the population — with an honest measure of how wrong we might be.',
    sections: [
      sec('est', '3.1', 'Estimation', { eyebrow: 'Point estimates',
        body: `<p>A ${term('statistic')} computed from a sample estimates a population ${term('parameter')}: x̄ for μ, s² for σ² (÷(n − 1) makes it <em>unbiased</em>), p̂ for p. A good estimator is unbiased (right on average) and has small standard error σ/√n — more data tightens it.</p>`,
        qs: [q('unb', 'Why divide by n − 1 in the sample variance?', ['It makes s² unbiased for σ².', 'x̄ is fitted from the same data, using up one degree of freedom.'], [['It makes the answer bigger for fun.', 'There is a precise reason.'], ['To avoid dividing by zero.', 'Not the purpose.']])] }),
      sec('ci', '3.2', 'Confidence interval for a mean', { eyebrow: 'A range, not a guess',
        body: `<p>With σ known (or n large): x̄ ± z·σ/√n, where z = 1.645, 1.96, 2.576 for 90 %, 95 %, 99 %. The 95 % means: if you repeated the whole sampling many times, about 95 % of the intervals built this way would contain μ. It is <b>not</b> a 95 % chance that μ lies in one given interval. Below, 100 simulated intervals at z = 1.96 caught the true mean <b>${c95.coverage}%</b> of the time; at z = 2.576 <b>${c99.coverage}%</b> (wider, half-width ${c99.halfWidth} vs ${c95.halfWidth}).</p>`,
        figs: [lab('confint', { n: 25, sigma: 10, zcrit: 1.96, intervals: 100 }, 'Rose intervals miss the true mean (vertical line).', ['coverage', 'halfWidth'], { caption: '95 % intervals', name: 'ci95' })],
        worked: [step('n = 25, x̄ = 52, σ = 10. Standard error = 10/5.', 'SE=2', { toc: 'SE' }), step('95 % half-width = 1.96 × 2 = 3.92.', '52\\pm3.92', { hero: true, toc: 'Interval' })],
        qs: [q('ciw', 'To halve the width of a confidence interval you need…', ['Four times the sample size.', 'Width ∝ 1/√n.'], [['Twice the sample size.', 'Only 29 % narrower.'], ['Half the confidence level.', 'Changes z, not by half.']])],
        probs: [pr('p-ci', '<p>n = 100, x̄ = 75, σ = 15. Give the 95 % CI for μ.</p>', 'SE = 1.5, half-width = 1.96 × 1.5 = 2.94 → <b>(72.06, 77.94)</b>.')] }),
      sec('n', '3.3', 'Effect of n and confidence level', { eyebrow: 'Trade-offs',
        body: `<p>Width = 2zσ/√n. Raising confidence raises z (wider). Raising n shrinks it: half-width is <b>${c25.halfWidth}</b> at n = 25 but <b>${c100.halfWidth}</b> at n = 100. Precision, confidence and cost pull against each other; you choose two.</p>`,
        figs: [lab('confint', { n: 100, sigma: 10, zcrit: 1.96, intervals: 40 }, 'Same confidence, four times the data.', ['halfWidth'], { caption: 'n = 100', name: 'cin' })],
        qs: [q('ntr', 'Raising confidence from 95 % to 99 % with n fixed makes the interval…', ['Wider.', 'z grows from 1.96 to 2.576.'], [['Narrower.', 'You are demanding more certainty.'], ['The same.', 'z changes.']])] }),
      sec('ht', '3.4', 'Hypothesis testing: the logic', { eyebrow: 'Evidence against a claim',
        body: `<p>State a null hypothesis H₀ (“nothing special”, e.g. μ = μ₀) and an alternative H₁. Compute a test statistic, e.g. z = (x̄ − μ₀)/(σ/√n). If it falls in the rejection region (|z| &gt; 1.96 at α = 0.05, two-sided) — equivalently if the ${term('p-value')} &lt; α — reject H₀. Errors: Type I = rejecting a true H₀ (probability α); Type II = failing to reject a false H₀ (probability β; power = 1 − β).</p>`,
        figs: [dia(`
Claim H0 -> Sample -> z = (x̄ - μ0)/SE
z = (x̄ - μ0)/SE -> |z| > z crit? : compare
|z| > z crit? -> Reject H0 : yes
|z| > z crit? -> Keep H0 : no`, 'The decision procedure as a flow.', { caption: 'test procedure' })],
        qs: [q('t1', 'A Type I error is…', ['Rejecting H₀ when it is true.', 'Its probability is α.'], [['Keeping H₀ when it is false.', 'That is Type II.'], ['Using the wrong table.', 'Not a named error.']])] }),
      sec('ztest', '3.5', 'Worked test of a mean', { eyebrow: 'Putting it together',
        body: `<p>A maker claims a bulb lasts 1000 h (σ = 80). A sample of 64 averages 980 h. Is the claim still believable at α = 0.05?</p>`,
        worked: [step('H₀: μ = 1000, H₁: μ ≠ 1000. SE = 80/√64.', 'SE=10', { toc: 'Setup' }), step('Test statistic.', 'z=\\tfrac{980-1000}{10}=-2', { toc: 'z' }), step('|z| = 2 exceeds 1.96, so reject H₀ (p ≈ 0.046).', '', { hero: true, toc: 'Decide' })],
        qs: [q('pv', 'A p-value of 0.03 at α = 0.05 means…', ['Reject H₀.', 'Data this extreme would occur only 3 % of the time if H₀ were true.'], [['H₀ is 3 % likely to be true.', 'p-value is not P(H₀).'], ['Fail to reject.', 'p < α, so reject.']])],
        probs: [pr('p-z', '<p>H₀: μ = 50, σ = 6, n = 36, x̄ = 52. Two-sided test at 5 %.</p>', 'SE = 1, z = 2 → |z| &gt; 1.96, <b>reject H₀</b>.')] }),
      sec('t', '3.6', 'Unknown σ: the t-test', { eyebrow: 'Small samples',
        body: `<p>When σ must be estimated by s, use t = (x̄ − μ₀)/(s/√n) with n − 1 degrees of freedom. The t distribution has heavier tails than the normal, so critical values are larger (2.262 at 9 d.f. vs 1.96) — the price of not knowing σ. As n grows, t → z. For two proportions or categorical counts the χ² test compares observed and expected counts: χ² = Σ(O − E)²/E.</p>`,
        qs: [q('tdf', 'A t-test on 12 observations has how many degrees of freedom?', ['11.', 'n − 1.'], [['12.', 'One is lost estimating the mean.'], ['10.', 'Too many lost.']])] }),
    ],
  })
}
