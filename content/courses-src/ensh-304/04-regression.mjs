import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const r = run('regression', {})
  const r2 = run('regression', { points: '1,5;2,4;3,3;4,2;5,1' })
  return lesson({
    title: 'Correlation and least-squares regression',
    kicker: 'ENSH 304 · Probability and Statistics · Chapter 4',
    subtitle: 'Do two quantities move together, and can one predict the other? Fit the line that makes the smallest total squared miss.',
    sections: [
      sec('scatter', '4.1', 'Scatter plots and correlation', { eyebrow: 'Do they move together?',
        body: `<p>Plot pairs (x, y). The ${term('correlation coefficient')} r = Sxy/√(Sxx·Syy) lies in [−1, 1]: +1 perfect rising line, −1 perfect falling, 0 no <em>linear</em> relation. For the default data r = <b>${r.r}</b>; a falling line gives <b>${r2.r}</b>. Correlation is not causation, and r ignores curved patterns.</p>`,
        qs: [q('corr', 'r = −0.95 means…', ['A strong falling linear relationship.', 'Sign gives direction, size gives strength.'], [['y falls by 95 %.', 'r is not a percentage change.'], ['x causes y to fall.', 'Correlation is not causation.']])] }),
      sec('ls', '4.2', 'The least-squares line', { eyebrow: 'Smallest total squared miss',
        body: `<p>Fit ŷ = a + bx by minimising Σ(yᵢ − ŷᵢ)². Solution: b = Sxy/Sxx and a = ȳ − b·x̄, so the line always passes through (x̄, ȳ). Here slope <b>${r.slope}</b> and intercept <b>${r.intercept}</b>. The residuals are the vertical gaps; squaring them punishes big misses.</p>`,
        figs: [lab('regression', {}, 'The line pivots on the mean point; gaps are the residuals.', ['slope', 'intercept', 'r2'], { caption: 'least squares', name: 'reg' })],
        worked: [step('Data (1,2) (2,3) (3,5) (4,4) (5,6): x̄ = 3, ȳ = 4. Sxy = 9, Sxx = 10.', '', { toc: 'Sums' }), step('Slope = 9/10, intercept = 4 − 0.9·3.', 'b=0.9,\\ a=1.3', { hero: true, toc: 'Fit' })],
        qs: [q('thru', 'The least-squares line always passes through…', ['(x̄, ȳ).', 'Follows from a = ȳ − b·x̄.'], [['The origin.', 'Only if a = 0.'], ['The first data point.', 'It fits the cloud, not one point.']])],
        probs: [pr('p-reg', '<p>Predict y at x = 6 using the fitted line.</p>', 'ŷ = 1.3 + 0.9·6 = <b>6.7</b> (x = 6 is just outside the data — mild extrapolation).')] }),
      sec('r2', '4.3', 'How good is the fit? R²', { eyebrow: 'Variance explained',
        body: `<p>R² = 1 − SSres/SStot is the fraction of the variation in y explained by x; for simple regression R² = r². This fit has R² = <b>${r.r2}</b> — 81 % explained. A high R² does not prove the model is right: always look at the residual plot for curves or fan shapes.</p>`,
        qs: [q('rsq', 'r = 0.9 gives R² =', ['0.81.', 'r squared.'], [['0.9.', 'That is r.'], ['0.45.', 'Halving is not the rule.']])] }),
      sec('pit', '4.4', 'Pitfalls', { eyebrow: 'Where regression lies',
        body: `<ul><li><b>Extrapolation</b> beyond the data range is unreliable.</li><li><b>Outliers</b> with large leverage can tilt the line.</li><li><b>Non-linear</b> patterns: transform (log y) or use a curve.</li><li><b>Confounders</b>: ice-cream sales and drownings correlate because of summer.</li></ul>`,
        qs: [q('conf', 'Shark attacks and ice-cream sales correlate. Best explanation?', ['A lurking variable: hot weather.', 'Confounding, not causation.'], [['Ice cream attracts sharks.', 'Causal claim without evidence.'], ['It is a coincidence only.', 'There is a real common cause.']])] }),
      sec('mult', '4.5', 'More than one predictor', { eyebrow: 'Looking ahead',
        body: `<p>Multiple regression fits ŷ = b₀ + b₁x₁ + b₂x₂ + … by the same least-squares idea (solve the normal equations XᵀXb = Xᵀy — the Gaussian elimination of Numerical Methods). Gradient descent finds the same minimum iteratively, which is how machine-learning models are trained.</p>`,
        qs: [q('ne', 'Solving the normal equations is a…', ['Linear system.', 'XᵀXb = Xᵀy.'], [['Differential equation.', 'No derivatives in time.'], ['Random search.', 'It is exact algebra.']])] }),
      sec('rank', '4.6', 'Rank correlation', { eyebrow: 'When data is ordinal',
        body: `<p>Spearman’s ρ applies the correlation formula to the <em>ranks</em>: ρ = 1 − 6Σd²/(n(n² − 1)), d = rank difference. It detects any monotone relationship and resists outliers. Two judges ranking five entries with Σd² = 4 give ρ = 1 − 24/120 = <b>0.8</b>.</p>`,
        qs: [q('sp', 'Σd² = 0 gives Spearman ρ =', ['1.', 'Identical rankings.'], [['0.', 'That would be unrelated.'], ['−1.', 'That is reversed order.']])] }),
    ],
  })
}
