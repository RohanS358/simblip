import { lesson } from '../kit.mjs'
export default ({ dia, q, step, sec, term }) => lesson({
  title: 'The data-science lifecycle',
  kicker: 'ENCT 202 · Foundation of Data Science · Chapter 1',
  subtitle: 'Data science is a loop, not a line: ask, collect, clean, explore, model, check, deploy — and go round again.',
  sections: [
    sec('what', '1.1', 'What data science is', { eyebrow: 'Definition',
      body: `<p>${term('Data science')} extracts knowledge and decisions from data using statistics, programming and domain understanding. It sits between three skills: mathematics/statistics (what is true?), computing (how to do it at scale?) and the domain (is it meaningful?). Related terms: <b>analytics</b> describes the past, <b>machine learning</b> learns patterns to predict, <b>big data</b> means volume, velocity and variety beyond one machine.</p>`,
      qs: [q('dsdef', 'Which best states the aim of data science?', ['Turn data into decisions using statistics, computing and domain knowledge.', 'All three skills are needed.'], [['Store as much data as possible.', 'Storage is a means.'], ['Build the biggest model.', 'Size is not the goal.']])] }),
    sec('loop', '1.2', 'The lifecycle', { eyebrow: 'A loop',
      body: `<p>Typical stages (CRISP-DM style): business understanding → data collection → preparation → exploration → modeling → evaluation → deployment → monitoring. Results at any stage often send you back: poor evaluation means revisit features or collect more data.</p>`,
      figs: [dia(`
Question -> Collect : what data answers it?
Collect -> Clean : raw data
Clean -> Explore : tidy data
Explore -> Model : features
Model -> Evaluate : predictions
Evaluate -> Deploy : good enough
Evaluate -> Clean : not yet
Deploy -> Question : monitor and refine`, 'Follow the arrows; the “not yet” arrow is the loop.', { caption: 'lifecycle' })],
      qs: [q('loopq', 'Poor evaluation results usually send you…', ['Back to earlier stages (cleaning, features, more data).', 'The lifecycle is iterative.'], [['Straight to deployment.', 'Unvalidated models are risky.'], ['To delete the data.', 'Rarely the answer.']])] }),
    sec('types', '1.3', 'Kinds of data', { eyebrow: 'Structure',
      body: `<table><thead><tr><th>Kind</th><th>Examples</th></tr></thead><tbody><tr><td>Structured</td><td>tables, SQL rows</td></tr><tr><td>Semi-structured</td><td>JSON, XML, logs</td></tr><tr><td>Unstructured</td><td>text, images, audio</td></tr></tbody></table><p>Variables are <b>numeric</b> (discrete or continuous) or <b>categorical</b> (nominal, or ordinal if ordered). The type decides which summary and chart are allowed.</p>`,
      qs: [q('ord', '“small, medium, large” is…', ['Ordinal categorical.', 'Categories with an order.'], [['Continuous numeric.', 'No numeric values.'], ['Nominal.', 'Nominal has no order.']])] }),
    sec('roles', '1.4', 'Sources and tools', { eyebrow: 'Where data comes from',
      body: `<p>Sources: databases, APIs, sensors/IoT, web scraping, surveys, logs. Typical tools: Python (pandas, NumPy, scikit-learn), SQL, notebooks, visualisation libraries. Data engineers build pipelines; analysts explain; scientists model.</p>`,
      qs: [q('src', 'Sensor readings streaming from a machine are an example of…', ['High-velocity machine-generated data.', 'Volume and velocity are big-data traits.'], [['Survey data.', 'No questionnaire is involved.'], ['Static archive data.', 'They keep arriving.']])] }),
    sec('bias', '1.5', 'Good questions and samples', { eyebrow: 'Before any code',
      body: `<p>A vague goal (“improve sales”) becomes a measurable question (“which customers will churn in 30 days?”). Sampling matters: a random sample represents the population; convenience or self-selected samples are biased. More data does not fix a biased sample.</p>`,
      worked: [step('A shop has 400 customers; 60 churned last month. Churn rate:', '\\tfrac{60}{400}=0.15', { toc: 'Rate' }), step('Predicting “no churn” for everyone is right 85 % of the time yet useless — accuracy alone misleads on imbalanced data.', '', { hero: true, toc: 'Baseline' })],
      qs: [q('samp', 'An online poll answered only by people who chose to click is…', ['Self-selected and likely biased.', 'Respondents differ from the population.'], [['A random sample.', 'Nobody randomised.'], ['Unbiased if large.', 'Size does not remove bias.']])] }),
    sec('lim', '1.6', 'What data cannot tell you', { eyebrow: 'Limits',
      body: `<p>Correlation is not causation; past patterns may not hold; a model is only as good as its data (“garbage in, garbage out”). Randomised experiments (A/B tests) are how causal claims are earned.</p>`,
      qs: [q('ab', 'Which design best supports a causal claim?', ['A randomised experiment.', 'Randomisation removes confounders on average.'], [['A larger observational dataset.', 'Confounders remain.'], ['A nicer chart.', 'Looks do not establish cause.']])] }),
  ],
})
