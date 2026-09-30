import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const g = run('gauss', {}), j = run('iterative', { method: 'jacobi', iterations: 12 }), s = run('iterative', { method: 'seidel', iterations: 12 })
  return lesson({
    title: 'Gauss elimination, Jacobi and Gauss–Seidel',
    kicker: 'ENSH 252 · Numerical Methods · Chapter 2',
    subtitle: 'Solving Ax = b two ways: a fixed number of steps (direct), or creeping closer each pass (iterative).',
    sections: [
      sec('gauss', '2.1', 'Gaussian elimination', { eyebrow: 'Direct',
        body: `<p>Write the system as an augmented matrix [A | b]. ${term('Forward elimination')} subtracts multiples of a pivot row to put zeros below the diagonal, giving an upper-triangular system; ${term('back-substitution')} then solves from the last unknown upward. Cost ≈ n³/3 multiplications. For 2x + y − z = 8, −3x − y + 2z = −11, −2x + y + 2z = −3 the solution is x, y, z = <b>${g.solution}</b>.</p>`,
        figs: [lab('gauss', {}, 'Amber cells are being eliminated; blue is the active row.', ['solution'], { caption: 'Gaussian elimination with pivoting', name: 'g' })],
        worked: [step('Eliminate x from row 2 using row 1: multiplier m = −3/2 (after any row swap).', 'R_2\\leftarrow R_2-m R_1', { toc: 'Multiplier' }), step('Back-substitute: the last row gives z = −1, then y = 3, then x = 2.', 'x=2,\\ y=3,\\ z=-1', { hero: true, toc: 'Solution' })],
        qs: [q('piv', 'Why swap rows to use the largest available pivot?', ['It reduces round-off error and avoids dividing by zero or a tiny number.', 'This is partial pivoting.'], [['It makes the matrix symmetric.', 'Not the purpose.'], ['It changes the solution.', 'Row swaps do not change it.']])] }),
      sec('sing', '2.2', 'When elimination fails', { eyebrow: 'Singular systems',
        body: `<p>If a zero pivot remains after pivoting, the matrix is singular: the system has no solution or infinitely many. x + y = 2, 2x + 2y = 4 has infinitely many (the rows are dependent); x + y = 2, x + y = 3 has none. Ill-conditioned systems (nearly singular) give wildly different answers for tiny changes in the data — a property of the problem, not the method.</p>`,
        qs: [q('zero', 'A zero pivot that cannot be removed by row swaps indicates…', ['A singular matrix — no unique solution.', 'The rows are linearly dependent.'], [['A coding bug.', 'It is mathematics.'], ['A large solution.', 'No.']])],
        probs: [pr('p-g', '<p>Solve 2x + y − z = 8, −3x − y + 2z = −11, −2x + y + 2z = −3 by Gaussian elimination.</p>', `x, y, z = <b>${g.solution}</b>.`, { verify: lab('gauss', {}, 'Step through the elimination.', ['solution'], { caption: 'answer', name: 'ans' }) })] }),
      sec('iter', '2.3', 'Jacobi and Gauss–Seidel', { eyebrow: 'Iterative',
        body: `<p>For large sparse systems iteration is cheaper. Solve each equation for its own unknown: xᵢ = (bᵢ − Σⱼ≠ᵢ aᵢⱼxⱼ)/aᵢᵢ. ${term('Jacobi')} updates every unknown from the <em>previous</em> iterate; ${term('Gauss–Seidel')} uses each new value immediately, usually converging about twice as fast. Both converge if the matrix is ${term('diagonally dominant')} (|aᵢᵢ| &gt; Σ|aᵢⱼ| on every row). For 10x − y + 2z = 6, −x + 11y − z = 25, 2x − y + 10z = −11 (dominant: <b>${j.dominant}</b>) the answer is <b>${s.x}</b> after 12 Gauss–Seidel sweeps.</p>`,
        figs: [lab('iterative', { method: 'jacobi', iterations: 8 }, 'Jacobi: all updates from the old values.', ['x', 'dominant'], { caption: 'Jacobi', name: 'jac' }), lab('iterative', { method: 'seidel', iterations: 8 }, 'Gauss–Seidel: new values used at once.', ['x'], { caption: 'Gauss–Seidel', name: 'gs' })],
        qs: [q('dom', 'Diagonal dominance guarantees…', ['Convergence of Jacobi and Gauss–Seidel.', 'It is a sufficient (not necessary) condition.'], [['A solution in one step.', 'Iteration still takes many steps.'], ['That the matrix is symmetric.', 'Unrelated.']])] }),
      sec('cmp', '2.4', 'Direct versus iterative', { eyebrow: 'Choosing',
        body: `<p>Direct methods (elimination, LU) give an answer after a fixed amount of work and handle any non-singular matrix, but cost O(n³) and fill in zeros. Iterative methods cost O(n) per sweep for sparse matrices and can stop at the accuracy you need, but may not converge. Real solvers use LU for moderate sizes and preconditioned Krylov methods for huge sparse ones.</p>`,
        worked: [step('A system with n = 10 000 unknowns, 5 non-zeros per row.', '', { toc: 'Sparse' }), step('One Gauss–Seidel sweep ≈ 5×10⁴ operations; elimination ≈ n³/3 ≈ 3×10¹¹. Even 100 sweeps are far cheaper.', '5\\times10^4\\ \\text{vs}\\ 3\\times10^{11}', { hero: true, toc: 'Cost' })],
        qs: [q('sparse', 'For a huge sparse system an iterative method is attractive because…', ['Each sweep costs little and preserves sparsity.', 'Elimination fills in the zeros.'], [['It always converges.', 'It needs conditions.'], ['It is exact.', 'It is approximate.']])] }),
      sec('lu', '2.5', 'LU factorisation', { eyebrow: 'Reusing the work',
        body: `<p>Gaussian elimination records its multipliers: A = LU with L lower-triangular (multipliers below a unit diagonal) and U the upper-triangular result. To solve Ax = b: solve Ly = b by forward substitution, then Ux = y by back-substitution. Factor once, then solve for many right-hand sides cheaply.</p>`,
        worked: [step('A = [[2, 1], [4, 5]]. Multiplier m₂₁ = 4/2 = 2.', 'L=\\begin{pmatrix}1&0\\\\2&1\\end{pmatrix}', { toc: 'L' }), step('Eliminate: row 2 − 2·row 1 gives [0, 3].', 'U=\\begin{pmatrix}2&1\\\\0&3\\end{pmatrix}', { hero: true, toc: 'U' })],
        qs: [q('lu', 'The entries of L below the diagonal are…', ['The elimination multipliers.', 'They record what was subtracted.'], [['The pivots.', 'Those are U’s diagonal.'], ['The solution.', 'No.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Elimination + pivoting is direct; Jacobi/Seidel iterate and need diagonal dominance.</li><li>LU reuses the work across right-hand sides.</li></ul>` }),
    ],
  })
}
