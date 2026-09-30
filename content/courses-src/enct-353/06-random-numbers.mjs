import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const f = run('lcg', { a: 5, c: 3, m: 16, seed: 7 }), bad = run('lcg', { a: 4, c: 0, m: 16, seed: 1 })
  return lesson({
    title: 'Random numbers and their tests',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapter 6',
    subtitle: 'Computers cannot be random, so we build generators whose output passes every test for randomness we can think of.',
    sections: [
      sec('props', '6.1', 'What we need from a generator', { eyebrow: 'Properties',
        body: `<p>We want numbers that look ${term('uniformly distributed')} on [0, 1) and ${term('independent')}. Practical needs: fast, reproducible (same seed, same stream — essential for debugging), a long ${term('period')} before repeating, and the ability to produce several independent streams. Since an algorithm produces them they are ${term('pseudo-random')}.</p>`,
        qs: [q('seed', 'Why is reproducibility (a seed) desirable in simulation?', ['You can rerun exactly the same experiment to debug or compare designs fairly.', 'Common random numbers reduce variance between compared systems.'], [['It makes numbers more random.', 'It does not.'], ['It speeds up the CPU.', 'Unrelated.']])] }),
      sec('lcg', '6.2', 'The linear congruential method', { eyebrow: 'The classic',
        body: `<p>X<sub>n+1</sub> = (a·X<sub>n</sub> + c) mod m; U<sub>n</sub> = X<sub>n</sub>/m. With a = 5, c = 3, m = 16, X₀ = 7 the sequence is <b>${f.sequence}</b> — it visits all 16 values before repeating (<b>full period ${f.fullPeriod}</b>). The Hull–Dobell theorem: full period m iff c and m are coprime, a−1 is divisible by every prime factor of m, and by 4 if m is divisible by 4. A poor choice (a = 4, c = 0, m = 16, X₀ = 1) cycles early: period <b>${bad.period}</b>. A multiplicative (c = 0) generator can reach at most m−1.</p>`,
        figs: [lab('lcg', { a: 5, c: 3, m: 16, seed: 7 }, 'Frame 2 shows where the cycle closes.', ['sequence', 'period', 'fullPeriod'], { caption: 'a full-period generator', name: 'good' }), lab('lcg', { a: 4, c: 0, m: 16, seed: 1 }, 'The same modulus with bad constants repeats almost immediately.', ['period', 'fullPeriod'], { caption: 'a bad generator', name: 'bad' })],
        worked: [step('X₀ = 7, X₁ = (5·7 + 3) mod 16.', '38\\bmod16=6', { toc: 'X₁' }), step('X₂ = (5·6 + 3) mod 16.', '33\\bmod16=1', { hero: true, toc: 'X₂' })],
        qs: [q('period', 'The maximum possible period of an LCG with modulus m is…', ['m.', 'There are only m distinct states.'], [['m²', 'The state is one number below m.'], ['Infinite.', 'A finite machine must repeat.']])],
        probs: [pr('p-lcg', '<p>Generate the first 6 numbers for X₀ = 7, a = 5, c = 3, m = 16 and find the period.</p>', `Sequence <b>${f.sequence}</b>; period <b>${f.period}</b>.`, { verify: lab('lcg', { a: 5, c: 3, m: 16, seed: 7 }, 'The generator.', ['sequence', 'period'], { caption: 'answer', name: 'ans' }) })] }),
      sec('chi', '6.3', 'Testing uniformity: χ² and Kolmogorov–Smirnov', { eyebrow: 'Does it look uniform?',
        body: `<p>The ${term('chi-square test')} splits [0,1) into k classes and compares observed counts Oᵢ with the expected n/k: χ² = Σ(Oᵢ − Eᵢ)²/Eᵢ; reject uniformity if it exceeds the critical value for k−1 degrees of freedom (14.07 for 8 classes at 5%). The ${term('Kolmogorov–Smirnov')} test compares the empirical CDF with the ideal diagonal: D = max gap, critical value ≈ 1.36/√n. Here χ² = <b>${f.chi2}</b> and D = <b>${f.ks}</b>.</p>`,
        figs: [lab('lcg', { a: 5, c: 3, m: 16, seed: 7, count: 64 }, 'Frames 3 and 4 show the two tests.', ['chi2', 'ks'], { caption: 'χ² and KS', name: 'tests' })],
        qs: [q('alpha', 'A significance level of 5% in a randomness test means…', ['A good generator is wrongly rejected about 5% of the time.', 'The level is the false-rejection rate.'], [['The generator is 5% random.', 'No.'], ['5 numbers were tested.', 'No.']])] }),
      sec('other', '6.4', 'Other tests: gap, poker, autocorrelation', { eyebrow: 'Independence',
        body: `<p>Uniformity is not enough — the sequence 0.1, 0.2, 0.3… is uniform but not random. Tests of independence: the ${term('gap test')} (gaps between occurrences of a digit should be geometric), the ${term('poker test')} (frequencies of patterns such as all different, one pair, three of a kind), ${term('runs tests')} (lengths of ascending/descending runs), and ${term('autocorrelation')} (correlation between U<sub>i</sub> and U<sub>i+k</sub> should be near 0).</p>`,
        worked: [step('Poker test on 3-digit groups: probability all three digits differ = 10·9·8/10³.', '0.72', { toc: 'All different' }), step('Exactly one pair: 3·10·9/10³ = 0.27; all same 10/10³ = 0.01. Total 1.00.', '0.72+0.27+0.01=1', { hero: true, toc: 'Check' })],
        qs: [q('indep', 'The sequence 0.1, 0.2, 0.3, …, 0.9 fails which kind of test?', ['Independence — consecutive values are perfectly correlated.', 'It passes a uniformity test.'], [['Uniformity.', 'It is evenly spread.'], ['Period.', 'Length is not the issue.']])] }),
      sec('dist', '6.5', 'Generating other distributions', { eyebrow: 'From uniform to anything',
        body: `<p>Given U ~ Uniform(0,1): the ${term('inverse transform')} method sets X = F⁻¹(U). For the exponential with rate λ, F(x) = 1 − e^(−λx), so X = −ln(1−U)/λ. Others: ${term('rejection')} sampling, ${term('composition')} (mix distributions), ${term('convolution')} (sum of variables: Erlang = sum of exponentials). Discrete: divide [0,1) into intervals of the given probabilities.</p>`,
        worked: [step('Generate an exponential(λ = 2) variate from U = 0.6.', 'X=-\\frac{\\ln(1-0.6)}{2}', { toc: 'Formula' }), step('ln 0.4 = −0.916.', 'X=\\frac{0.916}{2}=0.458', { hero: true, toc: 'Value' })],
        qs: [q('inv', 'The inverse-transform method produces X from U by…', ['Applying the inverse CDF, X = F⁻¹(U).', 'The CDF maps X to uniform, so its inverse maps uniform to X.'], [['Adding U to a constant.', 'No.'], ['Squaring U.', 'Not general.']])] }),
      sec('summary', '6.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>LCG: X ← (aX + c) mod m; full period needs Hull–Dobell.</li><li>Test uniformity (χ², KS) and independence (runs, gaps, autocorrelation).</li><li>Inverse transform: X = F⁻¹(U).</li></ul>` }),
    ],
  })
}
