import { lesson } from '../kit.mjs'
import { fmt, comma, ap, pa, pf, npv, irr } from '../fin.mjs'
export default ({ scr, dia, lab, q, pr, step, sec, term, run }) => {
  const cf = (spec, note, o) => scr(`var cf = create("cashflow", { spec: ${JSON.stringify(spec)} });`, note, o)
  // Defender: keep old machine 3 more years, AOC 6000, market value now 20000, salvage 8000 at end
  // Challenger: new machine 60000, life 6, AOC 2000, salvage 10000
  const i = 0.1
  const eaDef = 20000 * ap(i, 3) + 6000 - 8000 * (i / ((1 + i) ** 3 - 1))
  const eaCh = 60000 * ap(i, 6) + 2000 - 10000 * (i / ((1 + i) ** 6 - 1))
  // economic life: machine P=50000, salvage falls; O&M rises
  const P = 50000
  const yrs = [[1, 35000, 4000], [2, 28000, 6000], [3, 22000, 8500], [4, 17000, 11500], [5, 13000, 15000]]
  let cum = 0
  const eac = yrs.map(([n, S, om]) => { cum += om * (1 + i) ** -n; return [n, (P - S * (1 + i) ** -n + cum) * ap(i, n)] })
  const best = eac.reduce((a, b) => (b[1] < a[1] ? b : a))
  // risk: NPW ~ normal
  const mu = 12000, sd = 9000
  const pneg = run('dist', { kind: 'normal', mu, sigma: sd, from: -40000, to: 0 })
  const cl = run('clt', { population: 'exponential', n: 30 })
  return lesson({
    title: 'Replacement analysis and risk',
    kicker: 'ENCE 356 · Engineering Economics · Chapters 6 and 7',
    subtitle: 'When is an old machine worth keeping, and how sure are we of any of these numbers?',
    sections: [
      sec('why', '6.1', 'Why and when to replace', { eyebrow: 'Defender vs challenger',
        body: `<p>Assets are replaced because of <b>physical deterioration</b> (rising maintenance), <b>obsolescence</b> (better technology) or changed requirements. The decision compares the current asset, the ${term('defender')}, with the best available replacement, the ${term('challenger')}. Use today’s <i>market value</i> of the defender as its investment — what you forgo by keeping it. What you paid for it long ago is a sunk cost.</p>`,
        qs: [q('sunk', 'The defender’s original purchase price should be…', ['Ignored; use its current market value.', 'Sunk cost.'], [['Used as its first cost.', 'The past cost is irrelevant.'], ['Added to the challenger’s cost.', 'Never.']])] }),
      sec('ea', '6.2', 'Comparing by equivalent annual cost', { eyebrow: 'Unequal lives',
        body: `<p>Defender: market value 20,000 now, 3 more years, operating cost 6,000/yr, salvage 8,000. Challenger: 60,000, 6 years, operating cost 2,000/yr, salvage 10,000. MARR 10 %. Equivalent annual cost EAC = P·(A/P) + AOC − S·(A/F). Defender: <b>Rs ${comma(eaDef)}</b>; challenger: <b>Rs ${comma(eaCh)}</b>. The lower EAC wins: ${eaDef < eaCh ? 'keep the defender' : 'replace it'}.</p>`,
        figs: [cf({ description: 'Challenger machine', marr: 10, discrete: [{ t: 0, amount: -60000 }, { t: 6, amount: 10000 }], annuities: [{ start: 0, periods: 6, every: 1, amount: -2000 }], salvage: 0 }, 'The card’s annual worth is the negative of the EAC.', { caption: 'challenger cash flow' })],
        worked: [step('Capital recovery of 60,000 over 6 years at 10 %.', `60000\\times${fmt(ap(i, 6), 4)}=${comma(60000 * ap(i, 6))}`, { toc: 'Capital' }), step('Add operating cost, subtract the salvage credit.', `EAC=${comma(eaCh)}`, { hero: true, toc: 'EAC' })],
        qs: [q('eac', 'To compare machines with different lives, use…', ['Equivalent annual cost (or annual worth).', 'It puts both on a per-year basis.'], [['Simple totals of spending.', 'Ignores time and life.'], ['Payback only.', 'Ignores long-run cost.']])],
        probs: [pr('p-ea', '<p>A pump costs 18,000 and lasts 5 years with no salvage and 1,500 a year operating cost. Find the EAC at 8 %.</p>', `18,000 × A/P(8 %, 5) = 18,000 × ${fmt(ap(0.08, 5), 4)} = ${comma(18000 * ap(0.08, 5))}; plus 1,500 = <b>Rs ${comma(18000 * ap(0.08, 5) + 1500)}</b> per year.`)] }),
      sec('life', '6.3', 'Economic life', { eyebrow: 'When to stop using an asset',
        body: `<p>As an asset ages its maintenance rises and its salvage falls. The <b>economic life</b> is the retention period that minimises the equivalent annual cost. For a 50,000 machine with falling salvage and rising maintenance at 10 %, the annual cost over n years is: ${eac.map((r) => `${r[0]} yr ${comma(r[1])}`).join('; ')}. The minimum is at <b>${best[0]} years</b> (Rs ${comma(best[1])}).</p>`,
        worked: [step('EAC(n) = [P − S·(P/F) + Σ O&M·(P/F)] · (A/P).', '', { toc: 'Formula' }), step(`Evaluate for n = 1…5 and pick the smallest: n = ${best[0]}.`, `n^*=${best[0]}`, { hero: true, toc: 'Minimum' })],
        qs: [q('el', 'The economic life is the period that…', ['Minimises equivalent annual cost.', 'Before it, capital cost dominates; after it, upkeep does.'], [['Matches the physical life.', 'Usually shorter.'], ['Maximises salvage.', 'Not the criterion.']])] }),
      sec('ins', '6.4', 'Replacement over a finite horizon', { eyebrow: 'Practical checks',
        body: `<p>Assuming identical replacements forever is a modelling choice. If the planning horizon is finite (a 4-year contract) compare the cash flows over exactly that horizon, including the salvage at its end. Technology that improves rapidly favours shorter horizons and leasing.</p>`,
        qs: [q('hz', 'Which assumption underlies the EAC comparison of unequal-life machines?', ['Each can be repeated identically.', 'The annual cost continues.'], [['Neither can be repeated.', 'Then use the horizon.'], ['They cost the same.', 'Not needed.']])] }),
      sec('risk', '7.1', 'Risk and uncertainty', { eyebrow: 'Estimates are guesses',
        body: `<p>Every input is an estimate. <b>Sensitivity analysis</b> changes one input at a time (±20 %) to see which matters most; <b>scenario analysis</b> changes sets of inputs together (best / expected / worst); <b>probabilistic analysis</b> gives inputs distributions and finds the distribution of the outcome. The <b>expected value</b> of an outcome is Σ p·x.</p>`,
        worked: [step('Project NPW: +40,000 with prob 0.3, +10,000 with prob 0.5, −20,000 with prob 0.2.', '', { toc: 'Outcomes' }), step('E[NPW] = 0.3·40000 + 0.5·10000 + 0.2·(−20000).', 'E=12000+5000-4000=13000', { hero: true, toc: 'Expectation' })],
        qs: [q('ev', 'Expected value of a risky project is…', ['The probability-weighted average outcome.', 'Σ p·x.'], [['The most likely outcome.', 'That is the mode.'], ['The worst outcome.', 'No.']])],
        probs: [pr('p-ev', '<p>Outcomes +50,000 (p = 0.4), +10,000 (p = 0.4), −30,000 (p = 0.2). Expected NPW?</p>', '20,000 + 4,000 − 6,000 = <b>Rs 18,000</b>.')] }),
      sec('norm', '7.2', 'NPW as a random variable', { eyebrow: 'How likely a loss?',
        body: `<p>If the NPW is roughly normal with mean Rs ${comma(mu)} and standard deviation Rs ${comma(sd)}, the chance of a loss is P(NPW &lt; 0) = Φ(−μ/σ) = Φ(−${fmt(mu / sd)}) ≈ <b>${fmt(Number(pneg.prob) * 100)} %</b>. A project can have a positive expected value and still carry a one-in-ten chance of losing money; decision-makers weigh that risk against the return. Adding many independent projects reduces the relative spread — diversification, the central limit theorem at work (means of 30 draws have sd ${cl.sdOfMeans}).</p>`,
        figs: [lab('dist', { kind: 'normal', mu, sigma: sd, from: -40000, to: 0 }, 'The shaded tail is the probability of a negative NPW.', ['prob'], { caption: 'P(NPW < 0)', name: 'risk', w: 640, h: 290 })],
        qs: [q('prl', 'Mean NPW 12,000 and σ 9,000: P(NPW < 0) corresponds to z =', ['−1.33.', '(0 − 12000)/9000.'], [['+1.33.', 'Sign reversed.'], ['−0.75.', 'Inverted ratio.']])] }),
      sec('mc', '7.3', 'Monte Carlo on cash flows', { eyebrow: 'Simulate the future',
        body: `<p>Give each uncertain input a distribution (demand ~ N(1000, 100), price ~ uniform 40–60), draw values many times, compute the NPW each time, and read the distribution: mean, spread, probability of loss. The error in any estimated probability shrinks like 1/√n, so 10,000 trials give about 1 % precision.</p>`,
        figs: [dia(`direction: right
[Random inputs: demand, price, cost] as a
[Compute NPW] as b
[Record result] as c
<Enough trials?> as d
[Histogram of NPW] as e
a -> b
b -> c
c -> d
d -> a : no
d -> e : yes
@0 a -> b
@1 b -> c
@2 c -> d
@3 d -> a : no
loop 3`, 'Each loop is one simulated future.', { caption: 'Monte Carlo loop' })],
        qs: [q('mcq', 'A Monte Carlo study reports a 12 % chance NPW < 0. That means…', ['In 12 % of simulated futures the project lost money.', 'A frequency over many trials.'], [['The project will lose 12 %.', 'A probability, not a loss size.'], ['It is certain to profit.', 'No.']])] }),
    ],
  })
}
