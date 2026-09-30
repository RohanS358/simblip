import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const g = run('gd', { f: 'x^2 - 4*x + 5', lr: 0.2, steps: 60 }), big = run('gd', { f: 'x^2', lr: 1.1, x0: 1, steps: 80 }), r = run('regression', {}), k = run('kmeans', {}), p = run('perceptron', { data: '0,0,0;0,1,0;1,0,0;1,1,1' })
  return lesson({
    title: 'Learning from data',
    kicker: 'ENCT 351 · Artificial Intelligence · Chapter 4',
    subtitle: 'Instead of writing rules, show examples and let an optimiser find the rule.',
    sections: [
      sec('kinds', '4.1', 'Kinds of learning', { eyebrow: 'The landscape',
        body: `<p>${term('Supervised')} learning has labelled examples (input → correct output): classification (discrete labels) and regression (numbers). ${term('Unsupervised')} learning finds structure without labels: clustering, dimensionality reduction. ${term('Reinforcement')} learning learns from rewards by trial and error. ${term('Semi-supervised')} uses a few labels plus many unlabelled examples. The four pillars of the field: data, model, loss and optimiser.</p>`,
        figs: [dia(`direction: right
[Data: examples] as d #blue
[Model: parameters] as m #violet
[Loss: how wrong] as l #rose
[Optimiser: adjust] as o #mint
d -> m : predict
m -> l : compare
l -> o : gradient
o -> m : update
@0 d -> m : x
@1 m -> l : y-hat
@2 l -> o : error
@3 o -> m : new weights
loop 5`, 'Every learning algorithm is this loop.', { caption: 'the learning loop' })],
        qs: [q('clus', 'Clustering customers into segments with no predefined labels is…', ['Unsupervised learning.', 'There is no target to predict.'], [['Supervised learning.', 'That needs labels.'], ['Reinforcement learning.', 'That needs rewards.']])] }),
      sec('gd', '4.2', 'Gradient descent', { eyebrow: 'The optimiser',
        body: `<p>To minimise a loss f(x), repeatedly step opposite the slope: x ← x − η f′(x), with learning rate η. Too small is slow; too large overshoots and can diverge. On f(x) = x² − 4x + 5 with η = 0.2 it converges to x = <b>${g.x}</b>; with f(x) = x² and η = 1.1 each step multiplies x by −1.2 and it diverges (<b>${big.diverged}</b>).</p>`,
        figs: [lab('gd', { f: 'x^2 - 4*x + 5', lr: 0.2, steps: 15 }, 'Steps shrink as the slope flattens.', ['x'], { caption: 'converging', name: 'ok' }), lab('gd', { f: 'x^2', lr: 1.1, x0: 1, steps: 12, xmin: -6, xmax: 6 }, 'η is too large: each step overshoots further.', ['diverged'], { caption: 'diverging', name: 'bad' })],
        worked: [step('f(x) = x² − 4x + 5, f′(x) = 2x − 4. Start x = −1, η = 0.2.', '', { toc: 'Setup' }), step('Step 1: slope −6, so x ← −1 − 0.2(−6) = 0.2.', 'x_1=-1-0.2(-6)=0.2', { hero: true, toc: 'First step' }), step('Continuing converges to the minimum where f′ = 0, x = 2.', 'x^*=2', { toc: 'Minimum' })],
        qs: [q('lr', 'A learning rate that is too large causes…', ['Overshooting and possibly divergence.', 'Each step jumps past the minimum by more than before.'], [['Slower convergence only.', 'That is too small.'], ['Convergence to a wrong minimum always.', 'It may not converge at all.']])] }),
      sec('reg', '4.3', 'Linear regression', { eyebrow: 'Fitting a line',
        body: `<p>Fit ŷ = b₀ + b₁x by minimising the sum of squared residuals. The closed form: b₁ = Sxy/Sxx and b₀ = ȳ − b₁x̄. For the five sample points: slope <b>${r.slope}</b>, intercept <b>${r.intercept}</b>, R² = <b>${r.r2}</b> (the fraction of variance explained). The same idea extends to many features and, with a sigmoid, to logistic regression for classification.</p>`,
        figs: [lab('regression', {}, 'Red segments are the residuals the fit minimises.', ['slope', 'intercept', 'r2'], { caption: 'least squares', name: 'reg' })],
        qs: [q('r2', 'R² = 0.81 means…', ['81% of the variation in y is explained by the model.', 'The remaining 19% is unexplained.'], [['81% of predictions are exact.', 'Not that.'], ['The slope is 0.81.', 'Different number.']])] }),
      sec('cluster', '4.4', 'Clustering: k-means', { eyebrow: 'Unsupervised',
        body: `<p>k-means alternates: assign every point to its nearest centroid; move each centroid to the mean of its points; repeat until nothing changes. It minimises the within-cluster sum of squares but depends on the start and on k. On the sample points the centroids settle at <b>${k.centroids}</b>.</p>`,
        figs: [lab('kmeans', {}, 'Squares are centroids; colours show clusters.', ['centroids', 'sse'], { caption: 'k-means', name: 'km' })],
        qs: [q('kmeans', 'What does k-means do in the update step?', ['Moves each centroid to the mean of its assigned points.', 'Assignment and update alternate.'], [['Picks new random centroids.', 'Only at initialisation.'], ['Removes outliers.', 'Not part of the algorithm.']])] }),
      sec('perc', '4.5', 'The perceptron and overfitting', { eyebrow: 'Classification and generalisation',
        body: `<p>A ${term('perceptron')} classifies by the sign of w·x + b and corrects itself on mistakes: w ← w + η(t − y)x. It converges on linearly separable data (AND: converged <b>${p.converged}</b> in ${p.epochs} epochs) and never on data like XOR. Models can ${term('overfit')} — memorise noise in the training data — so performance is measured on held-out data, hyper-parameters are tuned on a validation set, and cross-validation rotates the split. Underfitting means the model is too simple to capture the pattern.</p>`,
        figs: [lab('perceptron', { data: '0,0,0;0,1,0;1,0,0;1,1,1' }, 'The amber line moves after each mistake.', ['converged', 'epochs'], { caption: 'learning AND', name: 'pc' }), lab('perceptron', { data: '0,0,0;0,1,1;1,0,1;1,1,0', epochs: 20 }, 'XOR: no straight line separates the classes.', ['converged'], { caption: 'XOR never converges', name: 'xor' })],
        qs: [q('over', 'A model with near-zero training error but high test error is…', ['Overfitting.', 'It memorised the training set.'], [['Underfitting.', 'That has high error on both.'], ['Perfect.', 'Generalisation is what counts.']])],
        probs: [pr('p-eval', '<p>A classifier on 100 test cases gives TP = 40, FP = 10, FN = 5, TN = 45. Compute accuracy, precision and recall.</p>', 'Accuracy = (40 + 45)/100 = <b>0.85</b>; precision = 40/(40 + 10) = <b>0.80</b>; recall = 40/(40 + 5) ≈ <b>0.89</b>; F-score ≈ 0.84.')] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Learning = data + model + loss + optimiser.</li><li>Gradient descent: x ← x − η f′(x); watch η.</li><li>Evaluate on unseen data; precision/recall beyond accuracy.</li></ul>` }),
    ],
  })
}
