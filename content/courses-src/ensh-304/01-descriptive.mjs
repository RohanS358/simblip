import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const b = run('bayes', {})
  const b2 = run('bayes', { prior: 0.1 })
  const mc = run('montecarlo', {})
  return lesson({
    title: 'Summaries, probability rules and Bayes',
    kicker: 'ENSH 304 · Probability and Statistics · Chapter 1',
    subtitle: 'Squeeze a pile of numbers into two or three, then learn the few rules that govern chance — and why a positive test is usually less alarming than it sounds.',
    sections: [
      sec('center', '1.1', 'Centre and spread', { eyebrow: 'Describing data',
        body: `<p>The ${term('mean')} x̄ = Σx/n balances the data; the ${term('median')} is the middle value and ignores outliers; the ${term('mode')} is the most frequent. Spread is measured by the ${term('variance')} s² = Σ(x − x̄)²/(n − 1) and its root, the ${term('standard deviation')} s (same units as the data). Charts: a histogram shows shape, a box plot shows median and quartiles, a scatter plot shows pairs.</p>`,
        worked: [step('Data: 2, 4, 4, 4, 5, 5, 7, 9. Mean = 40/8.', '\\bar x=5', { toc: 'Mean' }), step('Squared deviations: 9,1,1,1,0,0,4,16 sum to 32. Divide by n − 1 = 7.', 's^2=\\tfrac{32}{7}\\approx4.57', { toc: 'Variance' }), step('Standard deviation is the root.', 's\\approx2.14', { hero: true, toc: 'Std dev' })],
        qs: [q('med', 'Incomes 20, 22, 25, 27, 400 (thousand). Which average describes a typical person?', ['The median, 25.', 'One outlier drags the mean to 98.8 but not the median.'], [['The mean, 98.8.', 'The outlier inflates it.'], ['The mode.', 'No value repeats.']])],
        probs: [pr('p-sd', '<p>Find the sample standard deviation of 2, 4, 4, 4, 5, 5, 7, 9.</p>', 's² = 32/7 = 4.571, so s ≈ <b>2.14</b> (population formula ÷8 would give 2.0).')] }),
      sec('prob', '1.2', 'Probability rules', { eyebrow: 'The grammar of chance',
        body: `<p>P(A) lies in [0, 1]; the certain event has P = 1. <b>Complement</b>: P(Aᶜ) = 1 − P(A). <b>Addition</b>: P(A ∪ B) = P(A) + P(B) − P(A ∩ B). <b>Conditional</b>: P(A | B) = P(A ∩ B)/P(B). Events are ${term('independent')} when P(A ∩ B) = P(A)P(B). Counting: n! orderings, ⁿPᵣ = n!/(n − r)!, ⁿCᵣ = n!/(r!(n − r)!).</p>`,
        worked: [step('Two fair dice. P(sum = 7): 6 of the 36 outcomes.', 'P=\\tfrac{6}{36}', { toc: 'Count' }), step('Given the first die is 3, only (3,4) works: 1 of 6.', 'P(7\\mid 3)=\\tfrac16', { hero: true, toc: 'Condition' })],
        qs: [q('ind', 'P(A) = 0.5, P(B) = 0.4, P(A ∩ B) = 0.2. Are A and B independent?', ['Yes — 0.5 × 0.4 = 0.2.', 'The product rule holds.'], [['No, they overlap.', 'Overlap is normal; independence is about the product.'], ['Cannot tell.', 'The numbers decide it.']])] }),
      sec('bayes', '1.3', 'Bayes’ theorem, by counting people', { eyebrow: 'Reversing a condition',
        body: `<p>P(A | B) = P(B | A)P(A)/P(B). The trick is to imagine 1000 people. A disease has prior 1%; the test catches 90% of cases (sensitivity) and wrongly flags 9% of healthy people (specificity 91%). Of 10 sick, <b>${b.truePositives}</b> test positive; of 990 healthy, <b>${b.falsePositives}</b> also do. A positive result therefore means only <b>${b.posterior}</b> probability of disease — most positives are false alarms because the condition is rare.</p>`,
        figs: [lab('bayes', {}, 'Mint = true positives, rose = false positives among everyone who tested positive.', ['posterior', 'truePositives', 'falsePositives'], { caption: 'rare disease', name: 'bay' }), lab('bayes', { prior: 0.1 }, 'Raise the prior to 10% and the same test is far more convincing.', ['posterior'], { caption: 'prior 10 %', name: 'bay2' })],
        worked: [step('True positives: 1000 × 0.01 × 0.90 = 9. False positives: 990 × 0.09 = 89.1.', '', { toc: 'Count' }), step('Posterior = 9 / (9 + 89.1).', 'P(D\\mid +)=0.0917', { hero: true, toc: 'Divide' })],
        qs: [q('prior', 'Why does a 10% prior give a higher posterior with the same test?', ['More of the positives come from genuinely sick people.', `Posterior rises to ${b2.posterior}.`], [['The test becomes more accurate.', 'Test accuracy did not change.'], ['False positives vanish.', 'They shrink in proportion only.']])],
        probs: [pr('p-bayes', '<p>A factory’s machine A makes 60% of parts (2% defective); machine B makes 40% (5% defective). A part is defective. P(it came from A)?</p>', 'P(D) = 0.6·0.02 + 0.4·0.05 = 0.032. P(A|D) = 0.012/0.032 = <b>0.375</b>.')] }),
      sec('mc', '1.4', 'When the maths is hard, simulate', { eyebrow: 'Monte Carlo',
        body: `<p>If P(event) is awkward to derive, generate many random trials and count. Throwing random points in a unit square and counting those inside the quarter-circle estimates π/4. This run gives π ≈ <b>${mc.estimate}</b> (error <b>${mc.error}</b>); the error shrinks like 1/√n, so 100× more trials gives only 10× more accuracy.</p>`,
        figs: [lab('montecarlo', {}, 'Mint points are inside the circle.', ['estimate'], { caption: 'estimating π', name: 'mc' })],
        qs: [q('mcq', 'To cut a Monte Carlo error by 10× you need…', ['About 100× more samples.', 'Error ∝ 1/√n.'], [['10× more samples.', 'That only gives 3.2×.'], ['Twice the samples.', 'Far too few.']])] }),
      sec('shape', '1.5', 'Shape and quartiles', { eyebrow: 'Reading a distribution',
        body: `<p>Sort the data: Q1, the median Q2 and Q3 cut it into quarters; the IQR = Q3 − Q1 measures spread robustly, and points beyond 1.5·IQR from the box are flagged as outliers. A histogram that trails right is <em class="term">right-skewed</em> (mean &gt; median), as incomes are; a symmetric one has mean ≈ median.</p>`,
        qs: [q('skew', 'A right-skewed sample has…', ['Mean greater than median.', 'The long right tail pulls the mean up.'], [['Mean less than median.', 'That is left-skew.'], ['Mean exactly equal to mode.', 'Only for symmetric unimodal data.']])] }),
      sec('expect', '1.6', 'Random variables: expectation and variance', { eyebrow: 'Long-run averages',
        body: `<p>A random variable X assigns a number to each outcome. E[X] = Σx·P(x) is the long-run average and Var(X) = E[X²] − (E[X])². For a fair die E = 3.5 and Var = 35/12 ≈ 2.92. Linearity: E[aX + b] = aE[X] + b and Var(aX + b) = a²Var(X); for independent X, Y, Var(X + Y) = Var X + Var Y.</p>`,
        worked: [step('Fair die: E[X²] = (1+4+9+16+25+36)/6.', 'E[X^2]=15.17', { toc: 'E[X²]' }), step('Subtract 3.5² = 12.25.', '\mathrm{Var}(X)=2.92', { hero: true, toc: 'Variance' })],
        qs: [q('lin', 'If Var(X) = 4, what is Var(3X + 1)?', ['36.', 'Scale squares, shift is ignored.'], [['13.', 'Variance scales by a².'], ['12.', 'The constant 3 is squared.']])] }),
    ],
  })
}
