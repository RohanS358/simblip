import { lesson } from '../kit.mjs'
import { comma } from '../fin.mjs'
export default ({ dia, scr, q, pr, step, sec, term }) => {
  const table = (headers, rows, note, o) => scr(`var t = create("table", { headers: ${JSON.stringify(headers)}, data: ${JSON.stringify(rows)}, summary: "None" });`, note, o)
  // straight line and declining balance schedules for a Rs 100,000 asset, 5-year life, Rs 10,000 salvage
  const P = 100000, S = 10000, N = 5
  const sl = (P - S) / N
  const ddb = []
  let bv = P
  for (let y = 1; y <= N; y++) { let d = bv * 2 / N; if (bv - d < S) d = bv - S; bv -= d; ddb.push([y, Math.round(d), Math.round(bv)]) }
  const slRows = Array.from({ length: N }, (_, y) => [y + 1, sl, P - sl * (y + 1)])
  const be = 120000 / (50 - 30)
  return lesson({
    title: 'Costs, break-even and depreciation',
    kicker: 'ENCE 356 · Engineering Economics · Chapters 3 and 8',
    subtitle: 'Which costs change with the decision, where revenue overtakes cost, and how an asset’s value is spread over its life.',
    sections: [
      sec('kinds', '3.1', 'Kinds of cost', { eyebrow: 'Sorting costs',
        body: `<p><b>Fixed</b> costs do not change with output (rent, insurance); <b>variable</b> costs do (materials, energy). <b>Direct</b> costs trace to a product, <b>indirect</b> (overhead) do not. A ${term('sunk cost')} is already spent and irrecoverable — it must be <i>ignored</i> in a forward-looking decision. <b>Marginal cost</b> is the cost of one more unit.</p>`,
        qs: [q('sunk', 'You paid Rs 50,000 for a machine that is now worth Rs 20,000 if sold. The Rs 50,000 is…', ['A sunk cost — ignore it; compare the future options.', 'The past cannot be recovered.'], [['The value to use in the decision.', 'Use the Rs 20,000 forgone sale.'], ['A marginal cost.', 'Not new spending.']])] }),
      sec('total', '3.2', 'Total, average and marginal cost', { eyebrow: 'Cost curves',
        body: `<p>Total cost TC = FC + VC. Average cost AC = TC/Q falls while marginal cost MC is below it and rises when MC is above it — so MC cuts AC at its minimum (the efficient scale). With FC = 120,000 and variable cost Rs 30 per unit, AC at 4,000 units is 30 + 120,000/4,000 = 60.</p>`,
        figs: [table('Units;Total cost;Average cost', [[1000, 150000, 150], [2000, 180000, 90], [4000, 240000, 60], [6000, 300000, 50], [8000, 360000, 45]], 'Average cost falls because the fixed cost is spread over more units.', { caption: 'cost by volume' })],
        worked: [step('FC = 120,000, unit variable cost = 30, output 6,000.', '', { toc: 'Data' }), step('TC = 120,000 + 30 × 6000 = 300,000; AC = 300,000/6000.', 'AC=50', { hero: true, toc: 'Average' })],
        qs: [q('ac', 'Average cost keeps falling as output rises because…', ['Fixed cost is spread over more units.', 'Until marginal cost exceeds average cost.'], [['Variable cost per unit falls to zero.', 'It is constant here.'], ['Marginal cost is zero.', 'It is positive.']])] }),
      sec('bep', '3.3', 'Break-even analysis', { eyebrow: 'Where profit starts',
        body: `<p>Revenue = price × quantity; break-even is where revenue equals total cost: Q* = FC/(p − v), the fixed cost divided by the <i>contribution margin</i> per unit. Selling price Rs 50, variable cost Rs 30, FC Rs 120,000: Q* = 120,000/20 = <b>${be.toLocaleString('en-US')}</b> units. Above it profit is (p − v)(Q − Q*).</p>`,
        figs: [table('Units;Revenue;Total cost;Profit', [[2000, 100000, 180000, -80000], [4000, 200000, 240000, -40000], [6000, 300000, 300000, 0], [8000, 400000, 360000, 40000], [10000, 500000, 420000, 80000]], 'Profit crosses zero at 6,000 units.', { caption: 'break-even table' })],
        worked: [step('Contribution margin per unit.', '50-30=20', { toc: 'Margin' }), step('Break-even quantity.', '\\tfrac{120{,}000}{20}=6000', { hero: true, toc: 'Q*' })],
        qs: [q('bev', 'Reducing fixed costs makes the break-even quantity…', ['Smaller.', 'Q* = FC/(p − v).'], [['Larger.', 'Opposite.'], ['Unchanged.', 'FC is in the numerator.']])],
        probs: [pr('p-bep', '<p>FC = Rs 90,000, price Rs 45, variable cost Rs 25. Break-even units, and profit at 6,000 units?</p>', 'Q* = 90,000/20 = <b>4,500</b>; profit = 20 × (6000 − 4500) = <b>Rs 30,000</b>.')] }),
      sec('dep', '8.1', 'Depreciation: why and what', { eyebrow: 'Spreading the cost',
        body: `<p>An asset loses value with use and time. ${term('Depreciation')} allocates its cost over its life as an expense (it is not a cash outflow — the cash went out when it was bought). <b>Book value</b> = cost − accumulated depreciation; it never drops below <b>salvage value</b>. Depreciation matters for money because it is tax-deductible.</p>`,
        qs: [q('bv', 'Book value at the end of the asset’s life equals…', ['Its salvage value.', 'Depreciation stops there.'], [['Zero.', 'Only if salvage is zero.'], ['Original cost.', 'That is year 0.']])] }),
      sec('sl', '8.2', 'Straight-line method', { eyebrow: 'Equal every year',
        body: `<p>D = (P − S)/N each year. For P = Rs 100,000, S = Rs 10,000, N = 5: D = <b>${comma(sl)}</b> per year, book value falling by the same step.</p>`,
        figs: [table('Year;Depreciation;Book value', slRows, 'The same charge each year.', { caption: 'straight line' })],
        worked: [step('(P − S)/N.', '\\tfrac{100{,}000-10{,}000}{5}=18{,}000', { hero: true, toc: 'Annual' })],
        qs: [q('slq', 'Straight-line depreciation charges…', ['The same amount each year.', '(cost − salvage)/life.'], [['More in early years.', 'That is declining balance.'], ['Nothing until sold.', 'No.']])],
        probs: [pr('p-sl', '<p>A Rs 240,000 machine has a 6-year life and Rs 30,000 salvage. Annual straight-line depreciation and book value after year 4?</p>', 'D = 210,000/6 = <b>35,000</b>; BV₄ = 240,000 − 4 × 35,000 = <b>100,000</b>.')] }),
      sec('ddb', '8.3', 'Declining-balance and MACRS', { eyebrow: 'Front-loaded',
        body: `<p>Double declining balance takes a fixed fraction 2/N of the <i>remaining</i> book value each year (ignoring salvage until the end, never going below it): bigger deductions early. Same asset: ${ddb.map((r) => `year ${r[0]} ${comma(r[1])}`).join(', ')}. MACRS (used for tax in the USA) assigns standard percentage tables per asset class.</p>`,
        figs: [table('Year;Depreciation;Book value', ddb, 'Early years are depreciated faster.', { caption: 'double declining balance' })],
        worked: [step('Rate = 2/N = 2/5 = 40 %. Year 1 on Rs 100,000.', '', { toc: 'Rate' }), step('Depreciation then = 40,000; book value 60,000. Year 2 = 40 % of 60,000 = 24,000.', '', { hero: true, toc: 'Schedule' })],
        qs: [q('dd', 'Why do firms like accelerated depreciation?', ['Bigger early tax deductions, so tax is deferred.', 'Money now is worth more than later.'], [['It raises the asset’s value.', 'It lowers book value.'], ['It avoids paying tax forever.', 'Only deferral.']])] }),
      sec('tax', '8.4', 'Income taxes in decisions', { eyebrow: 'After-tax thinking',
        body: `<p>Taxable income = revenue − operating cost − depreciation. Tax = rate × taxable income. After-tax cash flow = (revenue − cost) − tax. Depreciation lowers tax, creating a <b>tax shield</b> of rate × D each year.</p>`,
        worked: [step('Revenue 80,000, cash costs 30,000, depreciation 18,000, tax rate 30 %.', '', { toc: 'Data' }), step('Taxable = 32,000; tax = 9,600; after-tax cash flow = 50,000 − 9,600.', '40{,}400', { hero: true, toc: 'Cash' })],
        qs: [q('ts', 'The tax shield from depreciation equals…', ['Tax rate × depreciation.', 'The tax it saves.'], [['Depreciation itself.', 'That is the deduction.'], ['Salvage value.', 'Unrelated.']])],
        probs: [pr('p-tax', '<p>Depreciation is Rs 25,000 a year and the tax rate 35 %. Annual tax shield?</p>', '0.35 × 25,000 = <b>Rs 8,750</b>.')] }),
    ],
  })
}
