import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Responsible data science',
  kicker: 'ENCT 202 · Foundation of Data Science · Chapter 7',
  subtitle: 'A model that is accurate on average can still be unfair, invasive or impossible to explain.',
  sections: [
    sec('bias', '7.1', 'Bias in data and models', { eyebrow: 'Where unfairness comes from',
      body: `<p>Sources: <b>sampling bias</b> (some groups under-represented), <b>historical bias</b> (past decisions encoded in labels), <b>measurement bias</b> (proxies such as postcode for income), <b>feedback loops</b> (predictions change the data they are retrained on). A model trained on biased history reproduces it.</p>`,
      qs: [q('hb', 'A hiring model trained on past hires favouring one group will…', ['Learn and repeat that pattern.', 'Historical bias enters through labels.'], [['Remove the bias automatically.', 'Models copy data.'], ['Be neutral because it is maths.', 'Maths inherits data bias.']])] }),
    sec('fair', '7.2', 'Measuring fairness', { eyebrow: 'Numbers for groups',
      body: `<p>Compare groups: selection rate, false-positive rate, recall. The “four-fifths rule” flags concern if one group’s selection rate is below 80 % of the highest. Different fairness definitions can conflict, so choose deliberately and explain it.</p>`,
      worked: [step('Group A approved 50 of 100; group B 30 of 100.', '', { toc: 'Rates' }), step('Ratio B/A = 0.30/0.50.', '0.6<0.8', { hero: true, toc: 'Ratio' })],
      qs: [q('ff', 'Selection rates 50 % vs 30 % give a ratio of 0.6. Under the four-fifths rule this is…', ['A red flag.', 'Below 0.8.'], [['Acceptable.', 'Above 0.8 would be.'], ['Proof of intent.', 'It is evidence to investigate, not proof.']])],
      probs: [pr('p-fr', '<p>Approvals: men 45/90, women 24/60. Compute the ratio and judge.</p>', 'Rates 0.50 and 0.40; ratio 0.8 — exactly at the threshold, warranting review.')] }),
    sec('priv', '7.3', 'Privacy and consent', { eyebrow: 'People behind the rows',
      body: `<p>Collect only what you need; obtain consent; anonymise (removing names is often not enough: a birth date + postcode + gender can re-identify). Techniques: aggregation, k-anonymity, differential privacy (adding calibrated noise). Laws such as GDPR and Nepal’s Privacy Act set rights over personal data.</p>`,
      qs: [q('anon', 'Removing names from a dataset makes it…', ['Not necessarily anonymous.', 'Combinations of attributes can re-identify people.'], [['Fully anonymous.', 'Linkage attacks exist.'], ['Illegal.', 'No.']])] }),
    sec('xai', '7.4', 'Explainability', { eyebrow: 'Why did it decide that?',
      body: `<p>Linear and tree models are interpretable; deep networks are not. Tools: feature importance, partial-dependence, LIME/SHAP local explanations. High-stakes uses (loans, health) need reasons a person can contest.</p>`,
      qs: [q('xq', 'A denied loan applicant asks why. The lender should be able to…', ['Give the main factors behind the decision.', 'Contestability requires reasons.'], [['Say “the algorithm decided”.', 'Not acceptable.'], ['Hide the model.', 'Undermines accountability.']])] }),
    sec('trend', '7.5', 'Recent trends', { eyebrow: 'Where the field is going',
      body: `<p>Large language and foundation models, AutoML, MLOps (monitoring, versioning, retraining), edge AI on devices, federated learning (train without centralising data), and synthetic data. Each brings new cost, bias and privacy questions.</p>`,
      figs: [dia(`
Collect -> Train
Train -> Validate
Validate -> Deploy
Deploy -> Monitor : drift?
Monitor -> Retrain : data changed
Retrain -> Validate`, 'MLOps closes the loop with monitoring.', { caption: 'MLOps loop' })],
      qs: [q('drift', 'Monitoring a deployed model mainly detects…', ['Data or performance drift.', 'The world changes after training.'], [['Typos in code.', 'Not the target.'], ['Hardware age.', 'Unrelated.']])] }),
    sec('code', '7.6', 'A practical checklist', { eyebrow: 'Before you ship',
      body: `<ul><li>Is the question worth answering, and by whom?</li><li>Is the data legal, consented and representative?</li><li>Were groups evaluated separately?</li><li>Can the result be explained and challenged?</li><li>Who monitors it afterwards?</li></ul>`,
      qs: [q('chk', 'Before shipping a model, which check is essential?', ['Performance across subgroups.', 'Averages hide group failures.'], [['Only overall accuracy.', 'Hides disparities.'], ['Its file size.', 'Irrelevant to harm.']])] }),
  ],
})
