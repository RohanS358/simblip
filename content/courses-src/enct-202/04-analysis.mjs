import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const r = run('regression', { points: '1,2;2,3;3,5;4,4;5,6' })
  return lesson({
    title: 'Exploring data with summaries and charts',
    kicker: 'ENCT 202 · Foundation of Data Science · Chapter 4',
    subtitle: 'Before modelling, look: the right chart answers a question in a glance.',
    sections: [
      sec('eda', '4.1', 'Exploratory data analysis', { eyebrow: 'Look first',
        body: `<p>${term('EDA')} means summarising and plotting data to find its shape, oddities and relationships before modelling. Start univariate (one variable), then bivariate (pairs), then multivariate.</p>`,
        qs: [q('edaq', 'EDA is done…', ['Before modelling, to understand the data.', 'It guides cleaning and features.'], [['Only after deployment.', 'Too late.'], ['Instead of statistics.', 'It complements it.']])] }),
      sec('summ', '4.2', 'Summary statistics', { eyebrow: 'Numbers',
        body: `<p>Centre: mean, median. Spread: standard deviation, IQR. Shape: skewness. For categories: counts and proportions. Group summaries (mean income by region) are the most common first insight — “group by, then aggregate”.</p>`,
        worked: [step('Sales (k): North 10, 12, 14; South 20, 22.', '', { toc: 'Groups' }), step('Group means: 12 and 21.', '\\bar x_N=12,\\ \\bar x_S=21', { hero: true, toc: 'Aggregate' })],
        qs: [q('gb', '“Group by region then mean” produces…', ['One average per region.', 'Aggregation over groups.'], [['One average overall.', 'That ignores groups.'], ['A sorted table.', 'Sorting is separate.']])] }),
      sec('chart', '4.3', 'Choosing a chart', { eyebrow: 'Question → picture',
        body: `<table><thead><tr><th>Question</th><th>Chart</th></tr></thead><tbody><tr><td>Distribution of one number</td><td>histogram / box plot</td></tr><tr><td>Compare categories</td><td>bar chart</td></tr><tr><td>Change over time</td><td>line chart</td></tr><tr><td>Relationship of two numbers</td><td>scatter plot</td></tr><tr><td>Part of a whole</td><td>bar (pie only for few parts)</td></tr></tbody></table>`,
        qs: [q('chq', 'Monthly rainfall over a year is best shown as…', ['A line chart.', 'Time on the x-axis.'], [['A pie chart.', 'Not parts of a whole.'], ['A scatter of categories.', 'Loses the order.']])] }),
      sec('corr', '4.4', 'Relationships', { eyebrow: 'Pairs',
        body: `<p>A scatter plot shows direction, strength and curvature; the correlation r summarises only the linear part. For the sample data r = <b>${r.r}</b> and R² = <b>${r.r2}</b>. A correlation matrix (heat map) scans many pairs at once.</p>`,
        figs: [lab('regression', { points: '1,2;2,3;3,5;4,4;5,6' }, 'A rising cloud with a fitted line.', ['r', 'r2'], { caption: 'scatter and fit', name: 'sc' })],
        qs: [q('rq', 'r near 0 means…', ['No linear relationship (there may still be a curve).', 'r measures linear association only.'], [['No relationship of any kind.', 'A parabola can give r ≈ 0.'], ['A strong negative link.', 'That would be near −1.']])] }),
      sec('mislead', '4.5', 'Honest charts', { eyebrow: 'Avoid lying with graphics',
        body: `<p>Start bar charts at zero; keep scales comparable; label axes and units; do not use 3-D effects; show the sample size. Simpson’s paradox: a trend in every group can reverse when groups are pooled — so check subgroups.</p>`,
        worked: [step('Treatment A cures 81/87 (93 %) of small stones and 192/263 (73 %) of large; B: 234/270 (87 %) and 55/80 (69 %).', '', { toc: 'Groups' }), step('A wins in both groups, yet pooled A = 273/350 = 78 % and B = 289/350 = 83 %: the mix of stone sizes reverses the ranking.', '', { hero: true, toc: 'Pooled' })],
        qs: [q('simp', 'Simpson’s paradox warns us to…', ['Check subgroups before trusting a pooled trend.', 'Confounding can flip the conclusion.'], [['Never pool any data.', 'Overreaction.'], ['Trust averages always.', 'Exactly the trap.']])] }),
      sec('story', '4.6', 'Telling the story', { eyebrow: 'Communicating',
        body: `<p>A finding is useful only if the audience acts on it. Lead with the conclusion, show one chart per message, state uncertainty, and note the limits (sample, period, missing data).</p>`,
        qs: [q('story', 'A good chart title states…', ['The message (“Sales fell 12 % in Q3”).', 'Audiences read titles first.'], [['The column names only.', 'Says nothing.'], ['The software used.', 'Irrelevant.']])] }),
    ],
  })
}
