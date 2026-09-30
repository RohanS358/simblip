import { lesson } from '../kit.mjs'
export default ({ dia, scr, q, pr, step, sec, term }) => {
  const table = (headers, rows, note, o) => scr(`var t = create("table", { headers: ${JSON.stringify(headers)}, data: ${JSON.stringify(rows)}, summary: "None" });`, note, o)
  return lesson({
    title: 'Decisions, markets and the circular flow',
    kicker: 'ENCE 356 · Engineering Economics · Chapters 1, 2 and 9',
    subtitle: 'Engineers choose between alternatives with limited money. Economics supplies the language: scarcity, demand, supply and the flow of income.',
    sections: [
      sec('scarcity', '1.1', 'Scarcity and the economic decision', { eyebrow: 'Why economics',
        body: `<p>Resources (money, time, materials) are limited while wants are not: that is ${term('scarcity')}. Every choice has an ${term('opportunity cost')} — the value of the best alternative given up. Engineering economics compares the <i>monetary</i> consequences of technical alternatives so that the option giving the most benefit per unit of resource is chosen.</p>`,
        worked: [step('You can spend Rs 100,000 on machine A (return Rs 12,000/yr) or machine B (return Rs 15,000/yr).', '', { toc: 'Options' }), step('Choosing A gives up B’s extra return. Opportunity cost of A per year:', 'Rs\\ 15{,}000', { hero: true, toc: 'Cost' })],
        qs: [q('oc', 'Opportunity cost is…', ['The value of the best alternative forgone.', 'What you give up by choosing.'], [['The purchase price.', 'That is a cash cost.'], ['Always zero for free items.', 'Time still has alternatives.']])] }),
      sec('proc', '1.2', 'The decision process', { eyebrow: 'A method, not a hunch',
        body: `<p>A rational engineering decision follows steps: define the problem, list alternatives (including “do nothing”), estimate cash flows, choose a criterion (present worth, IRR …), compare, consider non-monetary factors, decide, and review the result afterwards.</p>`,
        figs: [dia(`direction: down
(Define the problem) as a
[List alternatives incl. do nothing] as b
[Estimate cash flows] as c
[Choose a criterion and compare] as d
<Non-monetary factors change the answer?> as e
[Decide] as f
[Monitor and learn] as g
a -> b
b -> c
c -> d
d -> e
e -> f : no
e -> d : yes, revisit
f -> g
g -> a : next problem`, 'The last arrow closes the loop.', { caption: 'decision process' })],
        qs: [q('dn', 'Which alternative must always be considered?', ['Doing nothing.', 'It is the baseline for comparison.'], [['The cheapest machine.', 'Not always feasible.'], ['The newest technology.', 'No such rule.']])] }),
      sec('demand', '2.1', 'Demand and supply', { eyebrow: 'Markets',
        body: `<p>The <b>law of demand</b>: as price rises, quantity demanded falls. The <b>law of supply</b>: as price rises, quantity supplied rises. Where the curves cross is the <b>equilibrium</b>: price and quantity at which the market clears. If the price is above equilibrium there is a surplus and sellers cut prices; below it, a shortage and prices rise.</p>`,
        figs: [table('Price (Rs);Demand;Supply;Situation', [[10, 90, 10, 'shortage of 80'], [20, 70, 30, 'shortage of 40'], [30, 50, 50, 'equilibrium'], [40, 30, 70, 'surplus of 40'], [50, 10, 90, 'surplus of 80']], 'Demand falls and supply rises as price rises; they meet at Rs 30.', { caption: 'a market schedule' })],
        worked: [step('Demand Qd = 110 − 2P; supply Qs = 2P − 10. Set them equal.', '110-2P=2P-10', { toc: 'Equate' }), step('4P = 120, so P = 30 and Q = 50.', 'P^*=30,\\ Q^*=50', { hero: true, toc: 'Solve' })],
        qs: [q('eq', 'At a price above equilibrium there is…', ['A surplus: supply exceeds demand.', 'Sellers must lower price.'], [['A shortage.', 'That is below equilibrium.'], ['Equilibrium.', 'Only at the crossing.']])],
        probs: [pr('p-eq', '<p>Qd = 200 − 4P and Qs = 6P − 40. Find the equilibrium price and quantity.</p>', '200 − 4P = 6P − 40 → P = <b>24</b>, Q = 200 − 96 = <b>104</b>.')] }),
      sec('elastic', '2.2', 'Elasticity', { eyebrow: 'How sensitive?',
        body: `<p>Price elasticity of demand E = (%ΔQ)/(%ΔP). |E| &gt; 1: <b>elastic</b> (quantity reacts strongly — luxuries, substitutes available); |E| &lt; 1: <b>inelastic</b> (necessities). A firm facing elastic demand raises revenue by cutting price; with inelastic demand, by raising it.</p>`,
        worked: [step('Price rises from 20 to 22 (+10 %); quantity falls from 100 to 85 (−15 %).', '', { toc: 'Changes' }), step('E = −15/10 = −1.5, so |E| > 1: elastic.', 'E=-1.5', { hero: true, toc: 'E' })],
        qs: [q('el', '|E| = 0.4 means demand is…', ['Inelastic.', 'Quantity barely reacts to price.'], [['Elastic.', 'That needs |E| > 1.'], ['Unit elastic.', 'That is |E| = 1.']])] }),
      sec('mkt', '2.3', 'Market structures', { eyebrow: 'Competition',
        body: `<table><thead><tr><th>Structure</th><th>Sellers</th><th>Price power</th></tr></thead><tbody><tr><td>Perfect competition</td><td>many, identical product</td><td>none (price taker)</td></tr><tr><td>Monopolistic competition</td><td>many, differentiated</td><td>some</td></tr><tr><td>Oligopoly</td><td>few</td><td>strong, interdependent</td></tr><tr><td>Monopoly</td><td>one</td><td>maximum</td></tr></tbody></table>`,
        qs: [q('olig', 'A market with a handful of large firms watching each other is an…', ['Oligopoly.', 'Few sellers, interdependent.'], [['Perfect competition.', 'Many sellers.'], ['Monopoly.', 'One seller.']])] }),
      sec('gdp', '9.1', 'National income and the circular flow', { eyebrow: 'Measuring the whole economy',
        body: `<p>Households supply labour and buy goods; firms hire labour and sell goods; money flows round. <b>GDP</b> = the market value of final goods and services produced in a country in a year; three equal ways to measure it: production (value added), income (wages + profit + rent + interest) and expenditure: GDP = C + I + G + (X − M).</p>`,
        figs: [dia(`mode: sequence
[Households] as h
[Firms] as f
[Government] as g
h -> f : spending on goods (C)
f -> h : wages, rent, profit
h -> g : taxes
g -> f : purchases (G)
f -> f : investment (I)
@0 h -> f : spending on goods (C)
@1 f -> h : wages, rent, profit
@2 h -> g : taxes
@3 g -> f : purchases (G)
@4 f -> f : investment (I)`, 'One person’s spending is another’s income.', { caption: 'circular flow' })],
        worked: [step('C = 600, I = 200, G = 150, exports 120, imports 90 (all in billions).', '', { toc: 'Data' }), step('GDP = 600 + 200 + 150 + (120 − 90).', 'GDP=980', { hero: true, toc: 'Sum' })],
        qs: [q('gdp', 'Which is NOT a part of expenditure GDP?', ['Imports added on top.', 'Imports are subtracted (net exports).'], [['Consumption.', 'Included.'], ['Government purchases.', 'Included.']])],
        probs: [pr('p-gdp', '<p>C = 800, I = 250, G = 200, X = 150, M = 200. Find GDP.</p>', '800 + 250 + 200 + (150 − 200) = <b>1200</b>.')] }),
      sec('infl', '9.2', 'Inflation, growth and real values', { eyebrow: 'Adjusting for prices',
        body: `<p>Inflation is a general rise in prices. Real GDP divides nominal GDP by a price index to remove it. A nominal interest rate i relates to the real rate r and inflation f by (1 + i) = (1 + r)(1 + f). Ignoring inflation makes future money look bigger than it is.</p>`,
        worked: [step('Nominal interest 12 %, inflation 5 %.', '', { toc: 'Data' }), step('Real rate = 1.12/1.05 − 1.', 'r=6.67\\%', { hero: true, toc: 'Real' })],
        qs: [q('rr', 'Nominal 10 %, inflation 4 %: the real rate is about…', ['5.8 %.', '1.10/1.04 − 1.'], [['14 %.', 'Adding instead of dividing.'], ['6.0 % exactly.', 'Close but not exact.']])] }),
    ],
  })
}
