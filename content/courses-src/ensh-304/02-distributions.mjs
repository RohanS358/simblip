import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const bi = run('dist', { kind: 'binomial', n: 10, p: 0.5, from: 4, to: 6 })
  const po = run('dist', { kind: 'poisson', n: 10, lambda: 4, from: 0, to: 2 })
  const no = run('dist', { kind: 'normal', mu: 0, sigma: 1, from: -1.96, to: 1.96 })
  const no1 = run('dist', { kind: 'normal', mu: 0, sigma: 1, from: -1, to: 1 })
  const cl = run('clt', { population: 'exponential', n: 1 })
  const cl30 = run('clt', { population: 'exponential', n: 30 })
  return lesson({
    title: 'Binomial, Poisson, normal and the central limit theorem',
    kicker: 'ENSH 304 · Probability and Statistics · Chapter 2',
    subtitle: 'Three shapes describe most of what we count and measure — and one theorem explains why the bell curve turns up everywhere.',
    sections: [
      sec('disc', '2.1', 'Discrete vs continuous', { eyebrow: 'Two kinds of variable',
        body: `<p>A ${term('discrete')} variable takes countable values and has a probability mass function p(x) with Σp = 1. A ${term('continuous')} variable has a density f(x) with total area 1; probabilities are areas, so P(X = a) = 0 and P(a ≤ X ≤ b) = ∫f dx. The ${term('cdf')} F(x) = P(X ≤ x) works for both.</p>`,
        qs: [q('cont', 'For a continuous X, P(X = 2.5) equals…', ['0.', 'A single point has no area.'], [['f(2.5).', 'Density is not probability.'], ['1/2.', 'Nothing suggests that.']])] }),
      sec('binom', '2.2', 'Binomial distribution', { eyebrow: 'Counting successes',
        body: `<p>n independent trials, each succeeding with probability p: P(X = k) = ⁿCₖ pᵏ(1 − p)ⁿ⁻ᵏ, mean np, variance np(1 − p). For 10 fair coin tosses the chance of 4 to 6 heads is <b>${bi.prob}</b>.</p>`,
        figs: [lab('dist', { kind: 'binomial', n: 10, p: 0.5, from: 4, to: 6 }, 'Shaded bars sum to the probability.', ['prob'], { caption: 'heads in 10 tosses', name: 'bin' })],
        worked: [step('P(X = 5) = ¹⁰C₅ (½)¹⁰ = 252/1024.', 'P(5)=0.246', { toc: 'k = 5' }), step('Add k = 4 and 6 (210/1024 each).', 'P(4\\le X\\le6)=0.656', { hero: true, toc: 'Total' })],
        qs: [q('bmean', 'A binomial with n = 40, p = 0.25 has mean…', ['10.', 'np.'], [['0.25.', 'That is p.'], ['7.5.', 'That is the variance np(1−p).']])] }),
      sec('pois', '2.3', 'Poisson distribution', { eyebrow: 'Rare events in an interval',
        body: `<p>For events arriving independently at average rate λ per interval: P(X = k) = e⁻λ λᵏ/k!, with mean = variance = λ. It is the limit of the binomial as n → ∞, p → 0 with np = λ. With λ = 4 calls per hour, P(at most 2 calls) = <b>${po.prob}</b>.</p>`,
        figs: [lab('dist', { kind: 'poisson', n: 10, lambda: 4, from: 0, to: 2 }, 'Bars for k = 0, 1, 2 are shaded.', ['prob'], { caption: 'λ = 4', name: 'poi' })],
        qs: [q('pv', 'A Poisson variable has variance…', ['Equal to its mean λ.', 'A signature property.'], [['λ².', 'Not for Poisson.'], ['√λ.', 'That is the standard deviation.']])] }),
      sec('norm', '2.4', 'The normal distribution', { eyebrow: 'The bell curve',
        body: `<p>f(x) = exp(−(x − μ)²/2σ²)/(σ√2π). Standardise with z = (x − μ)/σ and read the standard table. The 68–95–99.7 rule: P(|Z| ≤ 1) = <b>${no1.prob}</b>, P(|Z| ≤ 1.96) = <b>${no.prob}</b>.</p>`,
        figs: [lab('dist', { kind: 'normal', mu: 0, sigma: 1, from: -1.96, to: 1.96 }, 'The central 95 % of the standard normal.', ['prob'], { caption: 'z between ±1.96', name: 'nor' })],
        worked: [step('Heights ~ N(170, 10²). P(X > 185): z = (185 − 170)/10.', 'z=1.5', { toc: 'z-score' }), step('Tail area beyond 1.5 is 0.0668.', 'P=0.0668', { hero: true, toc: 'Table' })],
        qs: [q('z', 'x = 55 from N(40, 5²) has z =', ['3.', '(55 − 40)/5.'], [['15.', 'Forgot to divide by σ.'], ['0.33.', 'Divided by the wrong thing.']])] }),
      sec('approx', '2.5', 'Binomial becomes normal', { eyebrow: 'Approximation',
        body: `<p>When np and n(1 − p) are both at least about 5, Binomial(n, p) ≈ N(np, np(1 − p)). Step through n = 5, 10, 30 below and the bars fit the curve ever better. Apply a ±½ continuity correction when converting a count to a continuous area.</p>`,
        figs: [lab('dist', { kind: 'binomial', n: '5 10 30', p: 0.5 }, 'Each frame increases n.', [], { caption: 'n = 5, 10, 30', name: 'appr' })],
        qs: [q('cc', 'Approximating P(X ≤ 12) for a binomial by a normal, use…', ['The area below 12.5.', 'Continuity correction adds ½.'], [['The area below 12.', 'Undercounts half a bar.'], ['The area below 13.', 'Overcounts.']])] }),
      sec('clt', '2.6', 'The central limit theorem', { eyebrow: 'Why the bell shows up',
        body: `<p>Take samples of size n from <em>any</em> population with mean μ and sd σ. The sample means X̄ are approximately N(μ, σ²/n) for large n, with standard error σ/√n. Start from a lopsided exponential population; single draws have sd <b>${cl.sdOfMeans}</b>, yet means of 30 have sd <b>${cl30.sdOfMeans}</b> (theory ${cl30.theorySd}) and a bell shape.</p>`,
        figs: [lab('clt', { population: 'exponential', n: 30 }, 'The histogram of 400 sample means is symmetric.', ['sdOfMeans', 'theorySd'], { caption: 'means of 30', name: 'clt' })],
        qs: [q('se', 'Quadrupling the sample size changes the standard error by a factor of…', ['½.', 'σ/√n.'], [['¼.', 'That would be for variance.'], ['2.', 'Wrong direction.']])],
        probs: [pr('p-se', '<p>Weights have σ = 12 g. What is the standard error of the mean of 36 items?</p>', 'σ/√n = 12/6 = <b>2 g</b>.')] }),
    ],
  })
}
