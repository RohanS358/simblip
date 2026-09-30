import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const i = run('interp', { points: '0,1;1,3;2,2;3,5', at: 1.5 })
  return lesson({
    title: 'Polynomial interpolation',
    kicker: 'ENSH 252 · Numerical Methods · Chapter 3',
    subtitle: 'Given a handful of measurements, find a curve through all of them and read values in between.',
    sections: [
      sec('why', '3.1', 'The interpolation problem', { eyebrow: 'Filling gaps',
        body: `<p>Given points (x₀,y₀)…(xₙ,yₙ) find a function p with p(xᵢ) = yᵢ, then use it to estimate values between the points. Exactly one polynomial of degree ≤ n passes through n+1 points with distinct x’s — every method (Lagrange, Newton, divided differences) finds the <em>same</em> polynomial in a different form.</p>`,
        qs: [q('uniq', 'How many polynomials of degree ≤ 3 pass through 4 points with distinct x?', ['Exactly one.', 'The interpolating polynomial is unique.'], [['Infinitely many.', 'That holds for degree > 3.'], ['None, in general.', 'One always exists.']])] }),
      sec('lag', '3.2', 'Lagrange form', { eyebrow: 'Weighted blend',
        body: `<p>P(x) = Σ yᵢ·Lᵢ(x), where Lᵢ(x) = ∏<sub>j≠i</sub> (x − xⱼ)/(xᵢ − xⱼ) equals 1 at xᵢ and 0 at all other nodes. Simple to write, awkward to extend: adding a point changes every term. For the points (0,1), (1,3), (2,2), (3,5) the value at x = 1.5 is <b>${i.value}</b>.</p>`,
        figs: [lab('interp', { points: '0,1;1,3;2,2;3,5', at: 1.5 }, 'Each frame adds a point and raises the degree.', ['value', 'degree'], { caption: 'building the polynomial', name: 'lag' })],
        worked: [step('Linear interpolation between (1, 3) and (2, 2) at x = 1.5.', 'P(1.5)=3+\\frac{1.5-1}{2-1}(2-3)', { toc: 'Two points' }), step('= 2.5 — the cubic through all four points gives a different value, using more information.', `\\text{cubic}: ${i.value}`, { hero: true, toc: 'Compare' })],
        qs: [q('basis', 'The Lagrange basis polynomial Lᵢ(xᵢ) equals…', ['1, and 0 at every other node.', 'That is why yᵢLᵢ reproduces yᵢ at xᵢ.'], [['0 at xᵢ.', 'Opposite.'], ['xᵢ.', 'No.']])] }),
      sec('newton', '3.3', 'Newton divided differences', { eyebrow: 'Easy to extend',
        body: `<p>P(x) = c₀ + c₁(x − x₀) + c₂(x − x₀)(x − x₁) + … The coefficients cₖ are divided differences f[x₀…xₖ] computed in a triangle: f[xᵢ,xᵢ₊₁] = (yᵢ₊₁ − yᵢ)/(xᵢ₊₁ − xᵢ), then differences of differences. A new point only adds one term. The value at 1.5 is the same, <b>${i.newtonValue}</b>.</p>`,
        worked: [step('Points (0,1), (1,3), (2,2). First differences: (3−1)/1 = 2 and (2−3)/1 = −1.', 'f[0,1]=2,\\ f[1,2]=-1', { toc: 'First' }), step('Second difference: (−1 − 2)/(2 − 0).', 'f[0,1,2]=-1.5', { toc: 'Second' }), step('P(x) = 1 + 2x − 1.5x(x − 1). Check P(2) = 1 + 4 − 3 = 2 ✓.', 'P(x)=1+2x-1.5x(x-1)', { hero: true, toc: 'Polynomial' })],
        qs: [q('addpt', 'What is the advantage of Newton’s form?', ['Adding a data point adds one term without recomputing the others.', 'The earlier coefficients are unchanged.'], [['It is more accurate than Lagrange.', 'Same polynomial.'], ['It needs equally spaced points.', 'Not required.']])],
        probs: [pr('p-int', '<p>Interpolate the value at x = 1.5 through (0,1), (1,3), (2,2), (3,5).</p>', `<b>${i.value}</b> (Lagrange and Newton agree: ${i.newtonValue}).`, { verify: lab('interp', { points: '0,1;1,3;2,2;3,5', at: 1.5 }, 'The fit.', ['value'], { caption: 'answer', name: 'ans' }) })] }),
      sec('err', '3.4', 'Error and the trouble with high degree', { eyebrow: 'Caveats',
        body: `<p>The error at x is f⁽ⁿ⁺¹⁾(ξ)/(n+1)! · ∏(x − xᵢ): small when the nodes are close to x and the function is smooth. Using many equally spaced nodes can make things worse near the ends (Runge’s phenomenon), so practice uses low-degree pieces (splines) or Chebyshev nodes instead of one high-degree polynomial.</p>`,
        qs: [q('runge', 'Why avoid one high-degree polynomial through many equally spaced points?', ['It can oscillate wildly near the ends (Runge’s phenomenon).', 'Piecewise low-degree splines behave better.'], [['It is too slow to evaluate.', 'Not the reason.'], ['It cannot pass through the points.', 'It does.']])] }),
      sec('spl', '3.5', 'Piecewise linear and splines', { eyebrow: 'Practical choices',
        body: `<p>Join the points with straight segments (piecewise linear: continuous, corners at the data) or with cubic pieces matching slope and curvature at each point (cubic spline: smooth). Tables of trigonometric values use linear interpolation between entries; drawing programs use splines.</p>`,
        worked: [step('sin 30° = 0.5000 and sin 40° = 0.6428 from a table. Estimate sin 34°.', '', { toc: 'Table' }), step('Linear interpolation.', '0.5+\\tfrac{4}{10}(0.1428)=0.5571', { hero: true, toc: 'Estimate (true 0.5592)' })],
        qs: [q('lin', 'Linear interpolation between table entries is exact when the function is…', ['A straight line between them.', 'Curvature is what introduces error.'], [['Any polynomial.', 'Only degree 1.'], ['Periodic.', 'Not sufficient.']])] }),
      sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>One unique polynomial of degree ≤ n through n+1 points; Lagrange and Newton are two forms.</li><li>Use low-degree pieces for many points.</li></ul>` }),
    ],
  })
}
