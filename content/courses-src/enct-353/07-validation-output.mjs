import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const c = run('confint', { intervals: 40 }), k = run('clt', { population: 'exponential', n: 30, samples: 400 })
  return lesson({
    title: 'Verification, validation and output analysis',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapters 7–8',
    subtitle: 'A simulation gives numbers. These are the checks that say whether to believe them, and how much.',
    sections: [
      sec('vv', '7.1', 'Verification versus validation', { eyebrow: 'Two questions',
        body: `<p>${term('Verification')}: is the model built <em>right</em>? — does the program faithfully implement the conceptual model (debugging, code walkthroughs, tracing, checking against hand calculations, simple cases with known answers)? ${term('Validation')}: is it the <em>right</em> model? — does it reproduce the real system’s behaviour closely enough for its purpose (comparing with real data, expert review, sensitivity analysis)? Naylor and Finger: build face-valid assumptions, test them, and compare the model’s output with the real system.</p>`,
        figs: [dia(`direction: right
[Real system] as r #blue
[Conceptual model] as c #violet
[Computer program] as p #mint
r -> c : modelling
c -> p : programming
p --> c : VERIFICATION: same model?
c --> r : VALIDATION: same behaviour?`, 'Verification checks the last step; validation checks the whole chain.', { caption: 'where V&V apply' })],
        qs: [q('vvq', 'A program crashes on negative inputs. This is a problem of…', ['Verification — the code does not do what was intended.', 'Validation concerns fit to reality.'], [['Validation.', 'The issue is correctness of implementation.'], ['Random numbers.', 'Unrelated.']])] }),
      sec('errors', '7.2', 'Calibration and sources of error', { eyebrow: 'Fitting to reality',
        body: `<p>${term('Calibration')} adjusts model parameters until the output matches observed data, iterating between model and real system. Errors: wrong assumptions, wrong input distributions, sampling error, programming bugs, truncation. Techniques: the Turing-style test (can experts tell simulated output from real?), extreme-condition tests, sensitivity analysis (vary an input 10% — does the output change sensibly?).</p>`,
        qs: [q('sens', 'A sensitivity analysis varies…', ['An input or parameter slightly and watches how the output responds.', 'Unexpected sensitivity reveals modelling problems.'], [['The random seed only.', 'That is replication.'], ['The output directly.', 'Output is observed.']])] }),
      sec('ci', '8.1', 'Confidence intervals', { eyebrow: 'How sure are we?',
        body: `<p>One run is a sample of size one. Simulation output is random, so report a ${term('confidence interval')} around the estimate: x̄ ± z·s/√n (or t for small n). A 95% interval means: if the experiment were repeated many times, about 95% of such intervals would contain the true mean. The demonstration builds 40 intervals from fresh samples; the coverage is <b>${c.coverage}%</b> (expected ≈ 95).</p>`,
        figs: [lab('confint', { intervals: 40 }, 'Green bars contain μ (the blue line); red ones miss.', ['coverage', 'halfWidth'], { caption: 'many 95% intervals', name: 'ci' })],
        worked: [step('20 replications give a mean wait of 12.0 min with standard deviation 3.0.', '', { toc: 'Data' }), step('95% CI half-width ≈ 1.96·3/√20 (use t₁₉ = 2.09 for small n: 1.40).', '\\pm 1.31\\ (z)\\ \\text{or}\\ \\pm1.40\\ (t)', { hero: true, toc: 'Interval' })],
        qs: [q('ciq', 'Doubling the number of replications changes the CI width by a factor of about…', ['1/√2 ≈ 0.71.', 'Width ∝ 1/√n.'], [['1/2.', 'That needs four times as many.'], ['No change.', 'More data narrows it.']])] }),
      sec('clt', '8.2', 'Why averages are normal: the central limit theorem', { eyebrow: 'The justification',
        body: `<p>Whatever the shape of the population, the mean of n independent samples is approximately normal with standard deviation σ/√n. The exponential distribution (σ = 1) is very skewed, yet means of samples of 30 have standard deviation <b>${k.sdOfMeans}</b> against the theoretical <b>${k.theorySd}</b>. This is why confidence intervals are valid for simulation averages.</p>`,
        figs: [lab('clt', { population: 'exponential', n: 30, samples: 400 }, 'The histogram of sample means approaches the amber normal curve.', ['sdOfMeans', 'theorySd'], { caption: 'the CLT in action', name: 'clt' })],
        qs: [q('cltq', 'The standard deviation of sample means of size n is…', ['σ/√n.', 'Averaging shrinks the spread.'], [['σ.', 'That is for single values.'], ['σ·n.', 'Wrong direction.']])] }),
      sec('bias', '8.3', 'Initial bias, replications and run length', { eyebrow: 'Practical advice',
        body: `<p>A simulation starts empty (an empty queue), which is not typical, so early observations are biased — the ${term('warm-up')} or transient period. Remedies: discard an initial segment (Welch's graphical method decides how much), run long enough, or start in a representative state. Independent ${term('replications')} (different seeds) give independent estimates to average; ${term('batch means')} cut one long run into batches and treat batch means as nearly independent.</p>`,
        probs: [pr('p1', '<p>A queue simulation starts empty. Why does its average wait underestimate the steady-state value if the first observations are included?</p>', 'Early customers find an empty, short queue, so their waits are small; including them pulls the average down. Discarding a warm-up period removes that initial-condition bias.')],
        qs: [q('warm', 'The warm-up period is discarded to remove…', ['Bias from the artificial initial conditions.', 'Steady-state statistics should not include the transient.'], [['Random number errors.', 'Different problem.'], ['Verification bugs.', 'Different problem.']])] }),
      sec('summary', '8.4', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Verify the code, validate the model, calibrate the parameters.</li><li>Report confidence intervals; discard warm-up; use replications or batch means.</li></ul>` }),
    ],
  })
}
