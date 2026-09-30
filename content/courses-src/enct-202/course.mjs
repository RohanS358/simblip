export default {
  id: 'enct-202', code: 'ENCT 202', title: 'Foundation of Data Science', subject: 'computing', semester: 3, program: 'computer',
  description: 'The data-science lifecycle, the maths underneath it, cleaning, analysis, regression and validation — with gradient descent, distributions, regression and clustering run live.',
  order: ['01-intro', '02-maths', '03-preprocessing', '04-analysis', '05-regression', '06-validation', '07-ethics'],
  lessons: {
    '01-intro': { path: '1 Introduction to Data Science', title: 'The data-science lifecycle' },
    '02-maths': { path: '2 Mathematics for Data Science', title: 'Gradient descent, distributions and sampling' },
    '03-preprocessing': { path: '3 Data Understanding and Preprocessing', title: 'Understanding and cleaning data' },
    '04-analysis': { path: '4 Data Analysis', title: 'Exploring data with summaries and charts' },
    '05-regression': { path: '5 Regression and Predictive Modeling', title: 'Regression and prediction' },
    '06-validation': { path: '6 Modeling and Validation Processes', title: 'Training, validation and clustering' },
    '07-ethics': { path: '7 Ethics and Recent Trends', title: 'Responsible data science' },
  },
}
