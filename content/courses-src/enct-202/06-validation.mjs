import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const k = run('kmeans', {})
  const p = run('perceptron', {})
  return lesson({
    title: 'Training, validation and clustering',
    kicker: 'ENCT 202 · Foundation of Data Science · Chapter 6',
    subtitle: 'How do you know a model works? Hide some data, test on it — and learn what to do when there are no labels at all.',
    sections: [
      sec('types', '6.1', 'Supervised and unsupervised', { eyebrow: 'Kinds of learning',
        body: `<p><b>Supervised</b>: examples come with answers (labels) — regression, classification. <b>Unsupervised</b>: no labels; find structure — clustering, dimensionality reduction. <b>Reinforcement</b>: learn from reward by acting.</p>`,
        qs: [q('sup', 'Grouping customers with no predefined labels is…', ['Unsupervised learning (clustering).', 'No target column.'], [['Supervised classification.', 'Needs labels.'], ['Regression.', 'No numeric target.']])] }),
      sec('perc', '6.2', 'A learning loop: the perceptron', { eyebrow: 'Learn from mistakes',
        body: `<p>A perceptron predicts sign(w·x + b). For every mistake, nudge the weights toward the correct class: w ← w + η·y·x. On separable data it converges: here in <b>${p.epochs}</b> epochs to w = (${p.w1}, ${p.w2}), b = ${p.b}. Training is this loop: predict, measure error, adjust.</p>`,
        figs: [lab('perceptron', {}, 'The boundary rotates after each misclassified point.', ['converged', 'epochs'], { caption: 'perceptron', name: 'per' })],
        qs: [q('perq', 'A perceptron updates its weights when it…', ['Misclassifies an example.', 'Correct ones leave it unchanged.'], [['Classifies correctly.', 'No change then.'], ['Starts a new epoch.', 'Only mistakes matter.']])] }),
      sec('split', '6.3', 'Train / validation / test', { eyebrow: 'Honest evaluation',
        body: `<p>Judging a model on the data it trained on rewards memorising. Split: <b>train</b> (fit, e.g. 70 %), <b>validation</b> (choose settings, 15 %), <b>test</b> (final unbiased score, 15 %, used once). <b>k-fold cross-validation</b> rotates the validation part k times and averages — good for small data.</p>`,
        figs: [dia(`
Dataset -> Train 70% : fit
Dataset -> Validation 15% : tune
Dataset -> Test 15% : final score
Train 70% -> Model
Validation 15% -> Model : choose settings
Model -> Test 15% : evaluate once`, 'The test set is touched only at the end.', { caption: 'data split' })],
        worked: [step('1000 rows split 70 / 15 / 15.', '', { toc: 'Split' }), step('That is 700 training, 150 validation, 150 test rows.', '700+150+150', { hero: true, toc: 'Sizes' })],
        qs: [q('tst', 'The test set should be used…', ['Once, at the very end.', 'Reusing it leaks into your choices.'], [['After every tweak.', 'That becomes a validation set.'], ['For training too.', 'Destroys the estimate.']])] }),
      sec('conf', '6.4', 'Classification metrics', { eyebrow: 'Beyond accuracy',
        body: `<p>Confusion matrix: TP, FP, FN, TN. Accuracy = (TP + TN)/all; precision = TP/(TP + FP); recall = TP/(TP + FN); F1 is their harmonic mean. With rare positives accuracy is deceiving.</p>`,
        worked: [step('TP = 8, FP = 2, FN = 4, TN = 86.', '', { toc: 'Counts' }), step('Precision = 8/10 = 0.8; recall = 8/12 = 0.67; accuracy = 94/100.', 'P=0.8,\\ R=0.67', { hero: true, toc: 'Scores' })],
        qs: [q('rec', 'A cancer screen must miss few real cases, so maximise…', ['Recall.', 'It counts missed positives.'], [['Precision.', 'Counts false alarms.'], ['Specificity only.', 'Not the priority.']])],
        probs: [pr('p-f1', '<p>Precision 0.8 and recall 0.667. Find F1.</p>', 'F1 = 2PR/(P + R) = 1.0667/1.4667 = <b>0.727</b>.')] }),
      sec('km', '6.5', 'k-means clustering', { eyebrow: 'Unlabelled groups',
        body: `<p>Pick k centroids; assign each point to the nearest; move each centroid to its cluster mean; repeat until stable. On the sample data it stops in <b>${k.iterations}</b> iterations with centroids <b>${k.centroids}</b> and within-cluster SSE <b>${k.sse}</b>. Choose k with the “elbow” of SSE vs k.</p>`,
        figs: [lab('kmeans', {}, 'Watch the crosses move.', ['iterations', 'sse'], { caption: 'k-means', name: 'km' })],
        qs: [q('kmq', 'k-means alternates between…', ['Assigning points and updating centroids.', 'Two steps until stable.'], [['Adding labels and removing labels.', 'It has no labels.'], ['Training and testing.', 'That is supervised.']])] }),
      sec('bv', '6.6', 'Bias–variance', { eyebrow: 'The central trade-off',
        body: `<p>Too simple a model is biased (underfits: high error everywhere). Too flexible a model has high variance (overfits: low train, high test error). The best model sits between. More data reduces variance; better features reduce bias.</p>`,
        qs: [q('bvq', 'High train error and high test error indicate…', ['High bias (underfitting).', 'The model is too simple.'], [['Overfitting.', 'That has low train error.'], ['Leakage.', 'That shows unrealistically good scores.']])] }),
    ],
  })
}
