import { lesson } from '../kit.mjs'
import { fmt, comma, fp, pf, pa, ap, af, npv, irr } from '../fin.mjs'
export default ({ scr, q, pr, step, sec, term }) => {
  const cf = (spec, note, o) => scr(`var cf = create("cashflow", { spec: ${JSON.stringify(spec)} });`, note, o)
  const f10 = 1000 * fp(0.1, 5), p10 = 1000 * pf(0.1, 5)
  const pA = 350 * pa(0.08, 4), aP = 1000 * ap(0.08, 4)
  const A = [-1000, 350, 350, 350, 350]
  const nA = npv(0.08, A), iA = irr(A)
  const B = [-1500, 500, 500, 500, 500]
  const nB = npv(0.08, B), iB = irr(B)
  const inc = [-500, 150, 150, 150, 150]
  const a10 = npv(0.15, A)
  const iInc = irr(inc)
  return lesson({
    title: 'Time value of money and choosing projects',
    kicker: 'ENCE 356 · Engineering Economics · Chapters 4 and 5',
    subtitle: 'A rupee today is worth more than a rupee next year. Put every cash flow on one date and the choice becomes arithmetic.',
    sections: [
      sec('why', '4.1', 'Why money has a time value', { eyebrow: 'Interest',
        body: `<p>Money can be invested to earn a return, so Rs 1,000 today can become more later. <b>Simple interest</b> is earned only on the principal; <b>compound interest</b> earns interest on interest: F = P(1 + i)ⁿ. At 10 % for 5 years, Rs 1,000 grows to <b>Rs ${comma(f10)}</b>; equivalently Rs 1,000 in 5 years is worth only <b>Rs ${comma(p10)}</b> today.</p>`,
        worked: [step('P = 1,000, i = 10 %, n = 5.', '', { toc: 'Data' }), step('F = P(1 + i)ⁿ.', `F=1000(1.1)^5=${fmt(f10)}`, { hero: true, toc: 'Future' })],
        qs: [q('cmp', 'Compared with simple interest, compound interest gives…', ['More, because interest earns interest.', 'Growth is exponential.'], [['Less.', 'Opposite.'], ['The same.', 'Only for one period.']])],
        probs: [pr('p-fv', '<p>How much will Rs 5,000 be worth in 8 years at 6 % compound interest?</p>', `F = 5000(1.06)⁸ = <b>Rs ${comma(5000 * fp(0.06, 8))}</b>.`)] }),
      sec('eq', '4.2', 'Equivalence and the cash-flow diagram', { eyebrow: 'Drawing money over time',
        body: `<p>Two cash flows are <b>equivalent</b> if they have the same worth at the same date and interest rate. A cash-flow diagram puts time on a horizontal axis, inflows as up arrows and outflows as down arrows. Below: invest 1,000 now and receive 350 at the end of each of 4 years, at MARR = 8 %.</p>`,
        figs: [cf({ description: 'Machine purchase', marr: 8, discrete: [{ t: 0, amount: -1000 }], annuities: [{ start: 0, periods: 4, every: 1, amount: 350 }], salvage: 0 }, 'The card shows present worth, future worth, IRR and more.', { caption: 'project A' })],
        qs: [q('dir', 'In a cash-flow diagram the initial investment is drawn as…', ['A downward arrow at t = 0.', 'Outflow = down.'], [['An upward arrow.', 'That is an inflow.'], ['A horizontal line.', 'Time axis.']])] }),
      sec('factors', '4.3', 'The six interest factors', { eyebrow: 'Conversion formulas',
        body: `<table><thead><tr><th>To find</th><th>Given</th><th>Factor</th></tr></thead><tbody><tr><td>F</td><td>P</td><td>(1 + i)ⁿ</td></tr><tr><td>P</td><td>F</td><td>(1 + i)⁻ⁿ</td></tr><tr><td>P</td><td>A</td><td>[(1 + i)ⁿ − 1] / [i(1 + i)ⁿ]</td></tr><tr><td>A</td><td>P</td><td>i(1 + i)ⁿ / [(1 + i)ⁿ − 1]</td></tr><tr><td>F</td><td>A</td><td>[(1 + i)ⁿ − 1] / i</td></tr><tr><td>A</td><td>F</td><td>i / [(1 + i)ⁿ − 1]</td></tr></tbody></table><p>Annuity A is a uniform end-of-period payment. The present worth of 350 a year for 4 years at 8 % is <b>${fmt(pA)}</b>; repaying a Rs 1,000 loan over 4 years costs <b>${fmt(aP)}</b> a year.</p>`,
        worked: [step('P/A factor at 8 %, n = 4.', `\\tfrac{1.08^4-1}{0.08\\cdot1.08^4}=${fmt(pa(0.08, 4), 4)}`, { toc: 'Factor' }), step('Multiply by the annuity amount 350.', `P=350\\times${fmt(pa(0.08, 4), 4)}=${fmt(pA)}`, { hero: true, toc: 'P' })],
        qs: [q('ap', 'To spread a loan P over n years at interest i, which factor converts P to a yearly payment?', ['A/P.', 'Capital recovery factor.'], [['P/A.', 'That is the opposite direction.'], ['F/P.', 'Gives a future lump sum.']])],
        probs: [pr('p-ap', '<p>A Rs 500,000 loan at 12 % is repaid in 5 equal yearly payments. Find the payment.</p>', `A = 500,000 × A/P = 500,000 × ${fmt(ap(0.12, 5), 4)} = <b>Rs ${comma(500000 * ap(0.12, 5))}</b>.`)] }),
      sec('nom', '4.4', 'Nominal and effective rates', { eyebrow: 'Compounding more often',
        body: `<p>A nominal 12 % compounded monthly is 1 % per month; the effective annual rate is (1 + r/m)ᵐ − 1 = <b>${fmt(((1 + 0.12 / 12) ** 12 - 1) * 100)} %</b>, more than 12 % because of within-year compounding. Always match the interest period to the payment period.</p>`,
        worked: [step('Nominal 18 % compounded quarterly: 4.5 % per quarter.', '', { toc: 'Per period' }), step('Effective annual rate.', `(1.045)^4-1=${fmt(((1.045) ** 4 - 1) * 100)}\\%`, { hero: true, toc: 'Effective' })],
        qs: [q('eff', 'Nominal 12 % compounded monthly has an effective rate that is…', ['Slightly above 12 %.', 'Interest on interest inside the year.'], [['Below 12 %.', 'Compounding raises it.'], ['Exactly 12 %.', 'Only for annual compounding.']])] }),
      sec('pw', '5.1', 'Present worth and MARR', { eyebrow: 'Judging one project',
        body: `<p>The <b>minimum attractive rate of return (MARR)</b> is the least return the firm will accept. Project <b>net present worth</b> NPW = Σ Cₜ/(1 + MARR)ᵗ. If NPW &gt; 0 the project earns more than MARR — accept. Project A at 8 %: NPW = −1000 + 350·(P/A) = <b>${fmt(nA)}</b>; project B (invest 1,500, receive 500 a year) gives <b>${fmt(nB)}</b>. Both are worth doing on their own; but only one can be built.</p>`,
        figs: [cf({ description: 'Project B', marr: 8, discrete: [{ t: 0, amount: -1500 }], annuities: [{ start: 0, periods: 4, every: 1, amount: 500 }], salvage: 0 }, 'Compare its present worth with project A.', { caption: 'project B' })],
        qs: [q('npw', 'NPW > 0 at the MARR means…', ['The project earns more than the MARR: accept.', 'Positive surplus in today’s money.'], [['Reject the project.', 'Opposite.'], ['The IRR is below MARR.', 'Opposite.']])] }),
      sec('irr', '5.2', 'Internal rate of return', { eyebrow: 'The project’s own rate',
        body: `<p>The IRR is the rate that makes NPW = 0. Accept if IRR &gt; MARR. Project A: IRR ≈ <b>${fmt(iA * 100)} %</b>; project B: <b>${fmt(iB * 100)} %</b>. Both beat 8 %. The IRR is found by trial (or by the card’s solver) — there is no closed form for n &gt; 4.</p>`,
        worked: [step('Try i = 15 %: NPW = −1000 + 350 × 2.855.', `${fmt(a10)}`, { toc: 'Try 15 %' }), step('That is almost zero, so the IRR is just under 15 %.', `i\\approx${fmt(iA * 100)}\\%`, { hero: true, toc: 'Interpolate' })],
        qs: [q('irrq', 'The IRR is the discount rate at which…', ['NPW equals zero.', 'Inflows exactly repay outflows with interest.'], [['NPW is maximum.', 'Not the definition.'], ['Payback occurs.', 'Different measure.']])] }),
      sec('inc', '5.3', 'Comparing alternatives: incremental analysis', { eyebrow: 'Mutually exclusive choice',
        body: `<p>Only one of A, B can be built. The larger IRR does not always win, and a bigger investment is justified only if its <i>extra</i> money earns enough. Analyse the <b>increment</b> B − A: extra investment 500, extra return 150 a year, incremental IRR ≈ <b>${fmt(iInc * 100)} %</b>. That is below the MARR of 8 %, so the extra 500 is <b>not</b> worth spending: choose A. (Consistent with NPW(A) = ${fmt(nA)} &gt; NPW(B) = ${fmt(nB)}, even though B has the larger returns.) Compare equal-life options by NPW; unequal lives by annual worth, which repeats each as if replaced.</p>`,
        worked: [step('Incremental cash flow B − A.', '-500,\\ +150\\times4', { toc: 'Delta' }), step('Incremental IRR vs MARR 8 %.', `${fmt(iInc * 100)}\\%<8\\%\\Rightarrow\\text{choose A}`, { hero: true, toc: 'Decide' })],
        qs: [q('incq', 'The incremental IRR is below MARR. You should…', ['Choose the cheaper alternative.', 'The extra investment does not earn enough.'], [['Choose the higher-cost alternative.', 'Only when the increment beats MARR.'], ['Reject both.', 'Not implied.']])],
        probs: [pr('p-aw', '<p>Compute the annual worth of project A at 8 % (PW = ' + fmt(nA) + ', n = 4).</p>', `AW = PW × (A/P) = ${fmt(nA)} × ${fmt(ap(0.08, 4), 4)} = <b>${fmt(nA * ap(0.08, 4))}</b> per year.`)] }),
      sec('bc', '5.4', 'Benefit–cost ratio and payback', { eyebrow: 'Other criteria',
        body: `<p>Public projects use B/C = PW(benefits)/PW(costs); accept if &gt; 1. <b>Payback</b> is the time to recover the investment: simple payback for A = 1000/350 = <b>${fmt(1000 / 350)} years</b>. It ignores the time value and cash flows after payback, so use it only as a rough liquidity check.</p>`,
        worked: [step('PW(benefits) = 350 × 3.3121 = 1159.2; PW(costs) = 1000.', '', { toc: 'PWs' }), step('B/C = 1159.2/1000 = 1.16 > 1: accept at 8 %.', `B/C=${fmt(pA / 1000, 3)}`, { hero: true, toc: 'Ratio' })],
        qs: [q('pb', 'A weakness of simple payback is that it…', ['Ignores the time value of money and later cash flows.', 'Quick but blunt.'], [['Needs an interest rate.', 'It does not.'], ['Always rejects good projects.', 'Not always.']])] }),
    ],
  })
}
