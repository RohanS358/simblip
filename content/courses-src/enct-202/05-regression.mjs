import { lesson } from '../kit.mjs'
export default ({ lab, q, pr, step, sec, term, run }) => {
  const a = run('regression', {})
  const o = run('regression', { points: '1,2;2,3;3,5;4,4;5,30' })
  return lesson({
    title: 'Regression and prediction',
    kicker: 'ENCT 202 · Foundation of Data Science · Chapter 5',
    subtitle: 'Fit a line, read its slope, predict, and see how one outlier can betray it.',
    sections: [
      sec('idea', '5.1', 'Predicting a number', { eyebrow: 'Regression',
        body: `<p>Regression predicts a continuous target y from features x. Simple linear regression: ŷ = a + bx. The slope b is “change in y per unit x”; the intercept a is y at x = 0. Classification, by contrast, predicts a category.</p>`,
        qs: [q('rc', 'Predicting house price is…', ['Regression.', 'The target is continuous.'], [['Classification.', 'That predicts a label.'], ['Clustering.', 'No target at all.']])] }),
      sec('fit', '5.2', 'Least squares', { eyebrow: 'The best line',
        body: `<p>Choose a, b minimising the sum of squared residuals. For the sample data slope = <b>${a.slope}</b>, intercept = <b>${a.intercept}</b>, R² = <b>${a.r2}</b>.</p>`,
        figs: [lab('regression', {}, 'Dashed gaps are residuals.', ['slope', 'intercept', 'r2'], { caption: 'fit', name: 'fit' })],
        worked: [step('Slope b = Sxy / Sxx = 9 / 10.', 'b=0.9', { toc: 'Slope' }), step('Intercept a = ȳ − b x̄ = 4 − 0.9·3.', 'a=1.3', { hero: true, toc: 'Intercept' })],
        qs: [q('res', 'A residual is…', ['Actual y minus predicted ŷ.', 'The vertical miss.'], [['x minus mean.', 'That is a deviation.'], ['Predicted minus mean.', 'Not the error.']])],
        probs: [pr('p-fit', '<p>With ŷ = 1.3 + 0.9x, predict y at x = 4 and find the residual if the actual is 4.</p>', 'ŷ = 4.9; residual = 4 − 4.9 = <b>−0.9</b>.')] }),
      sec('outl', '5.3', 'Outliers can steer the line', { eyebrow: 'Sensitivity',
        body: `<p>Replace the last point (5, 6) with (5, 30): slope jumps to <b>${o.slope}</b> and R² falls to <b>${o.r2}</b>. Squaring makes big errors dominate; robust methods or removing a verified error is the remedy.</p>`,
        figs: [lab('regression', { points: '1,2;2,3;3,5;4,4;5,30' }, 'One far point tilts the whole line.', ['slope', 'r2'], { caption: 'with outlier', name: 'outl' })],
        qs: [q('ls', 'Why is least squares sensitive to outliers?', ['Errors are squared, so large ones dominate.', 'A distant point pulls hard.'], [['It ignores extreme points.', 'The opposite.'], ['It uses medians.', 'It uses means.']])] }),
      sec('metrics', '5.4', 'Measuring error', { eyebrow: 'How wrong is it?',
        body: `<p>MAE = mean |error|; MSE = mean error²; RMSE = √MSE (same units as y); R² = 1 − SSres/SStot. RMSE punishes large errors more than MAE. Always compare to a baseline: predicting the mean has R² = 0.</p>`,
        worked: [step('Errors: 1, −2, 3.', '', { toc: 'Errors' }), step('MSE = (1 + 4 + 9)/3 = 4.67, so RMSE = 2.16 while MAE = 2.', 'RMSE=2.16', { hero: true, toc: 'RMSE' })],
        qs: [q('rm', 'RMSE is preferred over MSE for reporting because it is…', ['In the same units as y.', 'Easier to interpret.'], [['Always smaller.', 'Not always.'], ['Immune to outliers.', 'It is not.']])] }),
      sec('multi', '5.5', 'Many features and overfitting', { eyebrow: 'More is not always better',
        body: `<p>ŷ = b₀ + b₁x₁ + … + b_k x_k. Adding features always lowers training error, but a model that memorises noise (<em class="term">overfits</em>) does worse on new data. Regularisation (ridge/lasso) adds a penalty on large coefficients; validation (next chapter) detects the problem.</p>`,
        qs: [q('ov', 'Training error tiny, test error large suggests…', ['Overfitting.', 'The model memorised noise.'], [['Underfitting.', 'That has high error on both.'], ['A perfect model.', 'It fails on new data.']])] }),
      sec('logi', '5.6', 'From regression to classification', { eyebrow: 'Logistic regression',
        body: `<p>To predict a yes/no outcome, pass the linear score through the sigmoid σ(s) = 1/(1 + e⁻ˢ) to get a probability in (0, 1), then threshold at 0.5. It is fitted by gradient descent, exactly as in chapter 2.</p>`,
        qs: [q('sig', 'σ(0) =', ['0.5.', '1/(1 + 1).'], [['0.', 'That is the limit at −∞.'], ['1.', 'That is the limit at +∞.']])] }),
    ],
  })
}
