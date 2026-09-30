import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Understanding and cleaning data',
  kicker: 'ENCT 202 · Foundation of Data Science · Chapter 3',
  subtitle: 'Most of a data scientist’s time goes here: real data is missing, duplicated, mis-typed and on wildly different scales.',
  sections: [
    sec('profile', '3.1', 'Profiling a dataset', { eyebrow: 'First look',
      body: `<p>Before changing anything, ask: how many rows and columns? what type is each? how many values are missing? what are the min, max, mean? are there duplicates? Quick profiling catches a column of ages containing −1 or 999 before a model learns from it.</p>`,
      qs: [q('prof', 'An age column has a maximum of 999. This is most likely…', ['A placeholder for “unknown”, to be treated as missing.', 'Sentinel values must be recognised.'], [['A real age.', 'Nobody is 999.'], ['A sign of an excellent dataset.', 'It is an error.']])] }),
    sec('missing', '3.2', 'Missing values', { eyebrow: 'Holes in the table',
      body: `<p>Options: <b>drop</b> rows or columns (fine if few), <b>impute</b> with mean/median/mode, or model the missing value from others. Median is safer for skewed data. Adding a “was missing” flag preserves the information that it was absent.</p>`,
      worked: [step('Ages: 20, 22, 24, —, 90. The median of the known ones.', '\\text{median}=23', { toc: 'Median' }), step('Mean would be 39, dragged up by 90; fill with 23.', '', { hero: true, toc: 'Impute' })],
      qs: [q('imp', 'Which fill is most robust for skewed income data?', ['Median.', 'Outliers do not move it.'], [['Mean.', 'Pulled by large values.'], ['Zero.', 'Invents poverty.']])],
      probs: [pr('p-imp', '<p>Values 4, 6, 8, —, 100: mean vs median imputation for the gap?</p>', 'Mean of known = 29.5; median = <b>7</b>. The median ignores the outlier 100.')] }),
    sec('outlier', '3.3', 'Outliers', { eyebrow: 'Unusual points',
      body: `<p>Flag a value if |z| &gt; 3, or if it lies beyond 1.5·IQR from the quartiles. Then <em>investigate</em>: a typo is fixed, a real extreme is kept (or modelled separately). Never delete just because it is inconvenient.</p>`,
      qs: [q('out', 'Quartiles 10 and 20 give upper fence…', ['35.', 'Q3 + 1.5×IQR = 20 + 15.'], [['30.', 'That is Q3 + IQR.'], ['50.', 'Too generous.']])] }),
    sec('scale', '3.4', 'Scaling and encoding', { eyebrow: 'Making features comparable',
      body: `<p>Distance-based and gradient-based methods are thrown off by features in different units (salary in lakhs vs age in years). <b>Min–max</b>: (x − min)/(max − min) maps to [0, 1]. <b>Standardise</b>: (x − μ)/σ. Categories become numbers by <b>one-hot</b> encoding (one 0/1 column per category), or by ordering for ordinals.</p>`,
      worked: [step('Ages 20, 30, 50. Min–max of 30:', '\\tfrac{30-20}{50-20}=0.33', { hero: true, toc: 'Min–max' })],
      qs: [q('oh', 'Colour ∈ {red, green, blue} one-hot encoded gives…', ['Three 0/1 columns.', 'Exactly one is 1 per row.'], [['One column 1,2,3.', 'That invents an order.'], ['Six columns.', 'Too many.']])] }),
    sec('pipe', '3.5', 'A cleaning pipeline', { eyebrow: 'Do it in order',
      body: `<p>A repeatable pipeline: load → fix types → remove duplicates → handle missing → treat outliers → encode → scale → split. Fit scalers on the training set only and apply them to the test set; fitting on all data leaks information.</p>`,
      figs: [dia(`
Raw data -> Fix types
Fix types -> Drop duplicates
Drop duplicates -> Impute missing
Impute missing -> Handle outliers
Handle outliers -> Encode
Encode -> Scale
Scale -> Clean data`, 'Each stage takes the previous stage’s output.', { caption: 'cleaning pipeline' })],
      qs: [q('leak', 'Computing the scaling mean using the test set is…', ['Data leakage.', 'The test set must stay unseen.'], [['Best practice.', 'It contaminates evaluation.'], ['Harmless.', 'Scores become optimistic.']])] }),
    sec('integ', '3.6', 'Combining sources', { eyebrow: 'Joins and integrity',
      body: `<p>Datasets are merged by a key (join). Watch for duplicate keys, mismatched formats (“NP” vs “Nepal”), and inconsistent units. Validate counts before and after a join; an inner join loses unmatched rows, a left join keeps them with blanks.</p>`,
      qs: [q('join', 'Keep all customers even if they have no orders:', ['Left join from customers.', 'Unmatched order fields stay blank.'], [['Inner join.', 'Drops customers without orders.'], ['Cross join.', 'Every pairing.']])] }),
  ],
})
