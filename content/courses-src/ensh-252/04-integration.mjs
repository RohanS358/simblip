import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const t4 = run('integrate', { rule: 'trapezoid', f: 'sin(x)', a: 0, b: 3.14159265358979, n: 4 }), s4 = run('integrate', { rule: 'simpson', f: 'sin(x)', a: 0, b: 3.14159265358979, n: 4 }), t32 = run('integrate', { rule: 'trapezoid', f: 'sin(x)', a: 0, b: 3.14159265358979, n: 32 })
  return lesson({
    title: 'Numerical differentiation and integration',
    kicker: 'ENSH 252 · Numerical Methods · Chapter 4',
    subtitle: 'Slopes from differences, areas from slices — and how error shrinks as the slices get thinner.',
    sections: [
      sec('diff', '4.1', 'Numerical differentiation', { eyebrow: 'Slopes',
        body: `<p>From the definition f′(x) ≈ [f(x + h) − f(x)]/h (forward difference, error O(h)); the central difference [f(x + h) − f(x − h)]/(2h) has error O(h²). Shrinking h reduces truncation error but amplifies round-off error, so there is an optimal h (around 10⁻⁵ for double precision central differences).</p>`,
        worked: [step('Estimate the derivative of sin x at x = 0 with h = 0.1.', '', { toc: 'Task' }), step('Central: [sin 0.1 − sin(−0.1)]/0.2 = 0.19967/0.2.', '0.99833\\ (\\text{true }1)', { hero: true, toc: 'Central difference' }), step('Forward: sin 0.1 / 0.1 = 0.99833 too at this point (symmetry); at other x the central is much better.', '', { toc: 'Forward' })],
        qs: [q('cdiff', 'Which difference formula is more accurate for the same h?', ['The central difference, error O(h²).', 'Forward difference is O(h).'], [['Forward.', 'It is less accurate.'], ['They are identical.', 'Orders differ.']])] }),
      sec('trap', '4.2', 'The trapezoidal rule', { eyebrow: 'Area by slices',
        body: `<p>Replace the curve over each subinterval by a straight line: ∫f ≈ h[½f₀ + f₁ + … + f<sub>n−1</sub> + ½fₙ]. The error is O(h²) — halve h, quarter the error. For ∫₀^π sin x dx = 2: four intervals give <b>${t4.value}</b> (error ${t4.error}); 32 intervals give <b>${t32.value}</b>.</p>`,
        figs: [lab('integrate', { rule: 'trapezoid', f: 'sin(x)', a: 0, b: 3.14159265358979, n: 8 }, 'Each frame doubles the number of strips; the error drops.', ['value', 'error'], { caption: 'trapezoids for ∫ sin x', name: 'tr' })],
        worked: [step('n = 4 strips on [0, π]: h = π/4 and the function values at 0, π/4, π/2, 3π/4, π.', '0,\\ .7071,\\ 1,\\ .7071,\\ 0', { toc: 'Values' }), step('Trapezoid sum.', 'h[\\tfrac12(0)+.7071+1+.7071+\\tfrac12(0)]=\\tfrac{\\pi}{4}(2.4142)=1.896', { hero: true, toc: 'Area' })],
        qs: [q('o2', 'Halving the step size of the trapezoidal rule reduces the error by about…', ['4 (error ∝ h²).', 'Second-order accuracy.'], [['2.', 'That would be first order.'], ['16.', 'That is fourth order (Simpson).']])] }),
      sec('simp', '4.3', 'Simpson’s rule', { eyebrow: 'Parabolas',
        body: `<p>Fit a parabola through each pair of strips: ∫f ≈ (h/3)[f₀ + 4f₁ + 2f₂ + 4f₃ + … + fₙ], with n even. The error is O(h⁴) and the rule is exact for cubics. Same four intervals: Simpson gives <b>${s4.value}</b> (error ${s4.error}) — much better than the trapezoid's ${t4.error}.</p>`,
        figs: [lab('integrate', { rule: 'simpson', f: 'sin(x)', a: 0, b: 3.14159265358979, n: 8 }, 'Parabolic arcs follow the curve closely.', ['value', 'error'], { caption: 'Simpson’s 1/3 rule', name: 'sp' })],
        worked: [step('n = 4, h = π/4; coefficients 1, 4, 2, 4, 1 on the values 0, .7071, 1, .7071, 0.', '', { toc: 'Weights' }), step('Sum.', '\\tfrac{h}{3}(0+4(.7071)+2(1)+4(.7071)+0)=2.0046', { hero: true, toc: 'Area' })],
        qs: [q('evenn', 'Simpson’s 1/3 rule requires…', ['An even number of subintervals.', 'Parabolas span pairs of strips.'], [['An odd number.', 'That breaks the pairing.'], ['Equal function values.', 'No.']])],
        probs: [pr('p-simp', '<p>Approximate ∫₀^π sin x dx with n = 4 using the trapezoid and Simpson rules. Compare with 2.</p>', `Trapezoid <b>${t4.value}</b> (error ${t4.error}); Simpson <b>${s4.value}</b> (error ${s4.error}).`, { verify: lab('integrate', { rule: 'simpson', f: 'sin(x)', a: 0, b: 3.14159265358979, n: 4 }, 'Simpson at n = 4.', ['value', 'error'], { caption: 'answer', name: 'ans' }) })] }),
      sec('romberg', '4.4', 'Richardson extrapolation and Romberg', { eyebrow: 'Getting more from two estimates',
        body: `<p>If the trapezoid error is C·h², then from estimates T(h) and T(h/2): better = [4T(h/2) − T(h)]/3 cancels the h² term. Repeating gives Romberg integration, a triangle of ever better values. Note that one extrapolation of the trapezoid rule equals Simpson's rule.</p>`,
        worked: [step('T(π/2) = 1.5708 (n = 2) and T(π/4) = 1.8961 (n = 4).', '', { toc: 'Two estimates' }), step('Extrapolate.', '\\tfrac{4(1.8961)-1.5708}{3}=2.0046', { hero: true, toc: 'Improved' })],
        qs: [q('rich', 'Richardson extrapolation of two trapezoid estimates gives…', ['Simpson’s rule.', '(4T(h/2) − T(h))/3.'], [['The midpoint rule.', 'Not the same.'], ['The exact answer.', 'Only approximately better.']])] }),
      sec('gauss', '4.5', 'Gauss quadrature (idea)', { eyebrow: 'Choosing the points too',
        body: `<p>Newton–Cotes rules fix equally spaced nodes. Gaussian quadrature chooses both nodes and weights: an n-point rule is exact for polynomials up to degree 2n − 1. The two-point rule on [−1, 1] uses nodes ±1/√3 with weights 1 and 1.</p>`,
        worked: [step('Integrate x² on [−1, 1] by the 2-point Gauss rule.', '1\\cdot\\tfrac13+1\\cdot\\tfrac13', { toc: 'Sum' }), step('= 2/3, the exact value.', '\\tfrac23', { hero: true, toc: 'Exact' })],
        qs: [q('gq', 'The 2-point Gauss rule is exact for polynomials up to degree…', ['3.', '2n − 1 = 3.'], [['1.', 'Trapezoid manages that.'], ['2.', 'Simpson manages 3 as well.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Central difference O(h²); trapezoid O(h²); Simpson O(h⁴), n even.</li><li>Extrapolate to cancel leading error terms.</li></ul>` }),
    ],
  })
}
