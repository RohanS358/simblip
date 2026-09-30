export default {
  id: 'ensh-252', code: 'ENSH 252', title: 'Numerical Methods', subject: 'computing', semester: 4, program: 'computer',
  description: 'Roots, linear systems, interpolation, integration, differential equations and heat flow — each method iterated on screen until it converges.',
  order: ['01-roots', '02-linear-systems', '03-interpolation', '04-integration', '05-odes', '06-pdes'],
  lessons: {
    '01-roots': { path: '1 Solution of Non-Linear Equations', title: 'Finding roots: bisection, false position, Newton, secant' },
    '02-linear-systems': { path: '2 Solution of Linear Algebraic Systems', title: 'Gauss elimination, Jacobi and Gauss–Seidel' },
    '03-interpolation': { path: '3 Interpolation', title: 'Polynomial interpolation' },
    '04-integration': { path: '4 Numerical Differentiation and Integration', title: 'Numerical differentiation and integration' },
    '05-odes': { path: '5 Ordinary Differential Equations', title: 'Euler, Heun and Runge–Kutta' },
    '06-pdes': { path: '6 Partial Differential Equations', title: 'Finite differences for heat and Laplace equations' },
  },
}
