import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const g = run('gd', { f: 'x^2 - 4*x + 5', lr: 0.2, x0: -1, steps: 15 })
  const gb = run('gd', { f: 'x^2 - 4*x + 5', lr: 1.1, x0: -1, steps: 15 })
  const n = run('dist', { kind: 'normal', mu: 0, sigma: 1, from: -1.96, to: 1.96 })
  const c = run('clt', { population: 'exponential', n: 30 })
  const ci = run('confint', { n: 25, sigma: 10, zcrit: 1.96, intervals: 40 })
  return lesson({
    title: 'Gradient descent, distributions and sampling',
    kicker: 'ENCT 202 · Foundation of Data Science · Chapter 2',
    subtitle: 'The four mathematical ideas behind almost every model: optimise by following the slope, describe uncertainty with distributions, and trust averages.',
    sections: [
      sec('vec', '2.1', 'Vectors, matrices, dot products', { eyebrow: 'Data as arrays',
        body: `<p>A row of a table is a vector; the table is a matrix X (rows = examples, columns = features). The dot product w·x = Σwᵢxᵢ is a weighted sum — the heart of linear models and neurons. Matrix product Xw scores every row at once. Distance ‖a − b‖ measures similarity.</p>`,
        worked: [step('w = (2, −1), x = (3, 4).', '', { toc: 'Vectors' }), step('Dot product.', 'w\\cdot x=2\\cdot3+(-1)\\cdot4=2', { hero: true, toc: 'Dot' })],
        qs: [q('dotq', '(1, 2, 3)·(4, 5, 6) =', ['32.', '4 + 10 + 18.'], [['15.', 'That is a sum of both vectors.'], ['(4, 10, 18).', 'That is the elementwise product.']])] }),
      sec('deriv', '2.2', 'Derivatives and the gradient', { eyebrow: 'Slope as direction',
        body: `<p>f′(x) is the slope; it points uphill. For several variables the gradient ∇f collects partial derivatives and points in the steepest-ascent direction. To minimise a loss, walk the opposite way. At a minimum the gradient is zero.</p>`,
        qs: [q('grad', 'To reduce a loss, move…', ['Against the gradient.', 'The gradient points uphill.'], [['Along the gradient.', 'That increases the loss.'], ['Perpendicular to it.', 'Loss barely changes.']])] }),
      sec('gd', '2.3', 'Gradient descent', { eyebrow: 'Downhill in small steps',
        body: `<p>Repeat x ← x − η f′(x), with learning rate η. For f = x² − 4x + 5 (minimum at x = 2) and η = 0.2 from x = −1, after 15 steps x = <b>${g.x}</b>. With η = 1.1 the steps overshoot more than they correct and it ${gb.diverged === 'yes' ? '<b>diverges</b>' : 'oscillates'}. Too small is slow; too large is unstable.</p>`,
        figs: [lab('gd', { f: 'x^2 - 4*x + 5', lr: 0.2, x0: -1, steps: 15 }, 'The ball rolls to x = 2.', ['x', 'diverged'], { caption: 'η = 0.2', name: 'gd1' }), lab('gd', { f: 'x^2 - 4*x + 5', lr: 1.1, x0: -1, steps: 15 }, 'Each step overshoots further.', ['diverged'], { caption: 'η = 1.1', name: 'gd2' })],
        worked: [step('f′(x) = 2x − 4. At x = −1, f′ = −6.', '', { toc: 'Slope' }), step('Step: x₁ = −1 − 0.2·(−6).', 'x_1=0.2', { hero: true, toc: 'Update' })],
        qs: [q('lr', 'Loss grows each step. First fix?', ['Lower the learning rate.', 'Steps are overshooting.'], [['Raise the learning rate.', 'Worse.'], ['Add more data.', 'Not the cause.']])],
        probs: [pr('p-gd', '<p>f(x) = x², η = 0.25, x₀ = 4. Find x₂.</p>', 'f′ = 2x. x₁ = 4 − 0.25·8 = 2; x₂ = 2 − 0.25·4 = <b>1</b>.')] }),
      sec('dist', '2.4', 'Distributions', { eyebrow: 'Describing uncertainty',
        body: `<p>A distribution assigns probabilities to outcomes. Binomial counts successes in n trials; Poisson counts events per interval; the normal N(μ, σ²) models measurement noise. About 95 % of a normal lies within ±1.96σ: here P = <b>${n.prob}</b>. Standardise z = (x − μ)/σ to compare different scales.</p>`,
        figs: [lab('dist', { kind: 'normal', mu: 0, sigma: 1, from: -1.96, to: 1.96 }, 'Shaded area = probability.', ['prob'], { caption: 'normal', name: 'nd' })],
        qs: [q('zsc', 'Exam 70 with class mean 60 and σ = 5 has z =', ['2.', '(70 − 60)/5.'], [['10.', 'Forgot σ.'], ['0.5.', 'Inverted.']])] }),
      sec('clt', '2.5', 'Sampling and the central limit theorem', { eyebrow: 'Why averages are trusted',
        body: `<p>Means of samples of size n are roughly normal with standard error σ/√n, whatever the population. Simulated means of 30 from a skewed exponential population have sd <b>${c.sdOfMeans}</b> versus theory <b>${c.theorySd}</b>.</p>`,
        figs: [lab('clt', { population: 'exponential', n: 30 }, 'Skewed population, bell-shaped means.', ['sdOfMeans', 'theorySd'], { caption: 'CLT', name: 'clt' })],
        qs: [q('cltq', 'CLT says sample means become…', ['Approximately normal.', 'For large n, any population.'], [['Exactly the population shape.', 'They change shape.'], ['Always zero.', 'Nonsense.']])] }),
      sec('ci', '2.6', 'Confidence intervals', { eyebrow: 'Quantified doubt',
        body: `<p>x̄ ± 1.96σ/√n is a 95 % interval. In 40 simulated studies <b>${ci.coverage}%</b> of intervals caught the true mean, with half-width ${ci.halfWidth}.</p>`,
        figs: [lab('confint', { n: 25, sigma: 10, zcrit: 1.96, intervals: 40 }, 'Rose intervals missed.', ['coverage'], { caption: 'intervals', name: 'ci' })],
        qs: [q('ciq', 'A 95 % CI means…', ['The method captures the true mean in about 95 % of repeated samples.', 'It is about the procedure.'], [['There is a 95 % chance μ is in this one interval.', 'μ is fixed; the interval varies.'], ['95 % of data lies inside.', 'That is a prediction interval.']])] }),
    ],
  })
}
