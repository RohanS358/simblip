export default {
  id: 'ensh-304', code: 'ENSH 304', title: 'Probability and Statistics', subject: 'computing', semester: 5, program: 'computer',
  description: 'Descriptive statistics, Bayes, distributions, the central limit theorem, confidence intervals, regression and control charts — each idea run as an experiment.',
  order: ['01-descriptive', '02-distributions', '03-inference', '04-regression', '05-quality'],
  lessons: {
    '01-descriptive': { path: '1 Descriptive Statistics and Basic Probability', title: 'Summaries, probability rules and Bayes' },
    '02-distributions': { path: '2 Probability Distributions and Sampling', title: 'Binomial, Poisson, normal and the central limit theorem' },
    '03-inference': { path: '3 Statistical Inference', title: 'Confidence intervals and hypothesis tests' },
    '04-regression': { path: '4 Correlation and Regression', title: 'Correlation and least-squares regression' },
    '05-quality': { path: '5 Statistical Quality Control', title: 'Control charts' },
  },
}
