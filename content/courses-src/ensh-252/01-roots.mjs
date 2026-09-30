import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const R = Object.fromEntries(['bisection', 'falsi', 'newton', 'secant'].map((m) => [m, run('rootfind', { method: m, f: 'x^3 - x - 2', a: 1, b: 2, x0: 1.5, tol: 0.000001 })]))
  const sq = run('rootfind', { method: 'newton', f: 'x^2-2', x0: 1, tol: 0.000000001 })
  return lesson({
    title: 'Finding roots: bisection, false position, Newton, secant',
    kicker: 'ENSH 252 · Numerical Methods · Chapter 1',
    subtitle: 'Most equations cannot be solved with algebra. Numerical methods creep up on the answer instead — and they differ enormously in how fast.',
    sections: [
      sec('why', '1.1', 'The problem and the errors', { eyebrow: 'Setting up',
        body: `<p>Solve f(x) = 0 when no formula exists (x³ − x − 2 = 0, cos x = x). Start by ${term('locating')} a root: if f is continuous and f(a), f(b) have opposite signs, a root lies between (intermediate value theorem). Then refine by iteration. Two errors matter: the ${term('truncation error')} of the method and the ${term('round-off error')} of the machine; accuracy is often stated as the tolerance at which iteration stops.</p>`,
        worked: [step('f(x) = x³ − x − 2. Test f(1) and f(2).', 'f(1)=-2,\\quad f(2)=4', { toc: 'Signs' }), step('Opposite signs, so a root lies in [1, 2].', '', { hero: true, toc: 'Bracket' })],
        qs: [q('ivt', 'f(1) = −2 and f(2) = 4 for continuous f. What follows?', ['There is a root in [1, 2].', 'The function must cross zero.'], [['There is no root.', 'Sign change guarantees one.'], ['The root is at 1.5.', 'Only that it lies between.']])] }),
      sec('bis', '1.2', 'Bisection', { eyebrow: 'Halve the bracket',
        body: `<p>Take the midpoint c; keep the half whose ends still have opposite signs. Each step halves the interval: after n steps the error is ≤ (b − a)/2ⁿ. Guaranteed to converge, but slowly (one binary digit per step). For x³ − x − 2 on [1, 2] it reaches <b>${R.bisection.root}</b> in <b>${R.bisection.iterations}</b> iterations to tolerance 10⁻⁶.</p>`,
        figs: [lab('rootfind', { method: 'bisection', f: 'x^3 - x - 2', a: 1, b: 2 }, 'Violet lines mark the shrinking bracket.', ['root', 'iterations'], { caption: 'bisection', name: 'bis' })],
        worked: [step('Iterations needed to get within 10⁻⁶ from an interval of length 1.', '\\frac{1}{2^n}<10^{-6}', { toc: 'Condition' }), step('n > log₂(10⁶) ≈ 19.9, so 20 iterations.', 'n=20', { hero: true, toc: 'Count' })],
        qs: [q('bisq', 'The error bound of bisection after n steps is…', ['(b − a)/2ⁿ.', 'The interval halves each step.'], [['(b − a)/n.', 'Only linear decay.'], ['Zero after one step.', 'It needs many.']])] }),
      sec('falsi', '1.3', 'False position (regula falsi)', { eyebrow: 'Use the function values',
        body: `<p>Instead of the midpoint, draw the chord between (a, f(a)) and (b, f(b)) and take where it crosses the axis: c = (a·f(b) − b·f(a)) / (f(b) − f(a)). Keep the sub-interval with the sign change, as in bisection. It uses the size of f, so it is usually faster (<b>${R.falsi.iterations}</b> iterations here), though one end can stay stuck for a convex function.</p>`,
        figs: [lab('rootfind', { method: 'falsi', f: 'x^3 - x - 2', a: 1, b: 2 }, 'Each point is where the chord meets the axis.', ['root', 'iterations'], { caption: 'false position', name: 'fal' })],
        qs: [q('falq', 'False position differs from bisection in that it…', ['Picks the point where the secant line crosses zero rather than the midpoint.', 'It uses function values to place the estimate.'], [['Does not need a sign change.', 'It does.'], ['Uses derivatives.', 'That is Newton.']])] }),
      sec('newton', '1.4', 'Newton–Raphson', { eyebrow: 'Follow the tangent',
        body: `<p>From a guess xₙ, draw the tangent to f and let it hit the axis: x<sub>n+1</sub> = xₙ − f(xₙ)/f′(xₙ). Near a simple root convergence is quadratic — the number of correct digits roughly doubles each step. It needs f′, a good start, and fails where f′ ≈ 0. Finding √2 from x₀ = 1 via f = x² − 2 takes <b>${sq.iterations}</b> iterations to 10⁻⁹; x³ − x − 2 from 1.5 takes <b>${R.newton.iterations}</b>.</p>`,
        figs: [lab('rootfind', { method: 'newton', f: 'x^2-2', x0: 1, tol: 0.000000001 }, 'Residuals collapse: 10⁻¹, 10⁻³, 10⁻⁷…', ['root', 'iterations'], { caption: 'Newton for √2', name: 'newt' })],
        worked: [step('f(x) = x² − 2, f′(x) = 2x, x₀ = 1.', '', { toc: 'Setup' }), step('x₁ = 1 − (1 − 2)/2 = 1.5.', 'x_1=1.5', { toc: 'Step 1' }), step('x₂ = 1.5 − (2.25 − 2)/3 = 1.41667.', 'x_2=1.41667', { hero: true, toc: 'Step 2' })],
        qs: [q('quad', 'Quadratic convergence of Newton’s method means…', ['The error is roughly squared each step (digits double).', 'Very fast near the root.'], [['The error halves each step.', 'That is bisection.'], ['It needs two starting values.', 'That is secant.']])],
        probs: [pr('p-newt', '<p>Use Newton’s method on f(x) = x² − 2 from x₀ = 1 for two steps.</p>', 'x₁ = 1.5, x₂ = <b>1.41667</b> (√2 = 1.41421). The third step gives 1.414216.', { verify: lab('rootfind', { method: 'newton', f: 'x^2-2', x0: 1 }, 'The iterates.', ['root'], { caption: 'answer', name: 'ans' }) })] }),
      sec('secant', '1.5', 'Secant method', { eyebrow: 'Newton without the derivative',
        body: `<p>Replace f′ by the slope through the last two points: x<sub>n+1</sub> = xₙ − f(xₙ)(xₙ − x<sub>n−1</sub>)/(f(xₙ) − f(x<sub>n−1</sub>)). No derivative needed and no bracket; order of convergence ≈ 1.618. Here <b>${R.secant.iterations}</b> iterations. Compare the four methods below on the same equation: root ≈ <b>${R.bisection.root}</b>.</p>`,
        figs: [lab('rootfind', { method: 'secant', f: 'x^3 - x - 2', a: 1, b: 2 }, 'Two starting guesses, no bracket needed.', ['root', 'iterations'], { caption: 'secant', name: 'sec' })],
        qs: [q('secq', 'The secant method needs…', ['Two starting values but no derivative.', 'The slope is estimated from the last two iterates.'], [['The derivative.', 'That is Newton.'], ['A bracket.', 'That is bisection/false position.']])] }),
      sec('cmp', '1.6', 'Choosing a method', { eyebrow: 'Summary',
        body: `<table><thead><tr><th>Method</th><th>Needs</th><th>Order</th><th>Guaranteed?</th></tr></thead><tbody><tr><td>Bisection</td><td>bracket</td><td>1 (linear, ½)</td><td>yes</td></tr><tr><td>False position</td><td>bracket</td><td>≥ 1</td><td>yes</td></tr><tr><td>Newton</td><td>f, f′, good guess</td><td>2</td><td>no</td></tr><tr><td>Secant</td><td>two guesses</td><td>1.618</td><td>no</td></tr></tbody></table><p>Practical recipe: bracket with bisection until close, then finish with Newton.</p>`,
        qs: [q('pick', 'Which method is certain to converge if you have a bracket?', ['Bisection.', 'Newton and secant can diverge or jump away.'], [['Newton.', 'It can diverge.'], ['Secant.', 'It can diverge.']])] }),
    ],
  })
}
