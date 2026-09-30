import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const o = run('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler heun rk4', exact: '2*exp(x) - x - 1' }), o2 = run('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.05, xEnd: 1, methods: 'euler', exact: '2*exp(x) - x - 1' })
  return lesson({
    title: 'Euler, Heun and Runge–Kutta',
    kicker: 'ENSH 252 · Numerical Methods · Chapter 5',
    subtitle: 'Step along the solution of dy/dx = f(x, y), using the slope — once, twice, or four times per step.',
    sections: [
      sec('ivp', '5.1', 'Initial value problems', { eyebrow: 'The setting',
        body: `<p>Solve y′ = f(x, y) with y(x₀) = y₀. Numerical methods produce y at x₀, x₀ + h, x₀ + 2h, … ${term('One-step')} methods use only the last point. The running example is y′ = x + y, y(0) = 1, whose exact solution y = 2eˣ − x − 1 gives y(1) = <b>${o.exact}</b> to compare with.</p>`,
        qs: [q('ivp', 'An initial value problem gives…', ['The equation and the starting value y(x₀).', 'Without it there are infinitely many solutions.'], [['The whole solution.', 'That is what we seek.'], ['Only the boundary values.', 'That is a boundary-value problem.']])] }),
      sec('euler', '5.2', 'Euler’s method', { eyebrow: 'One slope',
        body: `<p>y<sub>n+1</sub> = yₙ + h·f(xₙ, yₙ): walk along the tangent. Simple, but each step has error O(h²) and the total error is O(h) — first order. Halving h halves the error: y(1) is <b>${o.euler}</b> with h = 0.1 and <b>${o2.euler}</b> with h = 0.05, against the exact ${o.exact}.</p>`,
        figs: [lab('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler', exact: '2*exp(x) - x - 1' }, 'Grey = exact, blue = Euler; the gap grows.', ['euler', 'exact'], { caption: 'Euler with h = 0.1', name: 'eu' })],
        worked: [step('y′ = x + y, y₀ = 1, h = 0.1. Slope at (0, 1) = 1.', '', { toc: 'Slope' }), step('y₁ = 1 + 0.1·1 = 1.1; then slope at (0.1, 1.1) = 1.2 so y₂ = 1.1 + 0.12.', 'y_1=1.1,\\ y_2=1.22', { hero: true, toc: 'Two steps' })],
        qs: [q('ord1', 'Euler’s method is first order: halving h…', ['Roughly halves the global error.', 'Error ∝ h.'], [['Quarters it.', 'That is second order.'], ['Does nothing.', 'Accuracy improves.']])] }),
      sec('heun', '5.3', 'Heun’s method (improved Euler)', { eyebrow: 'Two slopes',
        body: `<p>Predict with Euler, then average the slope at the start and at the predicted end: k₁ = f(xₙ, yₙ), k₂ = f(xₙ + h, yₙ + hk₁), y<sub>n+1</sub> = yₙ + (h/2)(k₁ + k₂). Second-order: y(1) = <b>${o.heun}</b> with h = 0.1 — far closer than Euler. It is the trapezoid rule applied to the ODE.</p>`,
        figs: [lab('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler heun', exact: '2*exp(x) - x - 1' }, 'Heun hugs the exact curve.', ['euler', 'heun'], { caption: 'Euler vs Heun', name: 'he' })],
        worked: [step('One Heun step from (0, 1), h = 0.1. k₁ = f(0, 1) = 1. Predictor y* = 1.1.', '', { toc: 'Predictor' }), step('k₂ = f(0.1, 1.1) = 1.2; y₁ = 1 + 0.05(1 + 1.2).', 'y_1=1.11', { hero: true, toc: 'Corrected' })],
        qs: [q('heunq', 'Heun’s method improves on Euler by…', ['Averaging the slopes at the start and at the predicted end of the step.', 'Two slope evaluations per step.'], [['Using a smaller h automatically.', 'h is the user’s choice.'], ['Ignoring the equation.', 'No.']])] }),
      sec('rk4', '5.4', 'Runge–Kutta of order 4', { eyebrow: 'Four slopes',
        body: `<p>The classic RK4: k₁ = f(xₙ, yₙ); k₂ = f(xₙ + h/2, yₙ + hk₁/2); k₃ = f(xₙ + h/2, yₙ + hk₂/2); k₄ = f(xₙ + h, yₙ + hk₃); y<sub>n+1</sub> = yₙ + (h/6)(k₁ + 2k₂ + 2k₃ + k₄). Fourth-order: error ∝ h⁴ — y(1) = <b>${o.rk4}</b> at h = 0.1, agreeing with the exact ${o.exact} to five digits. Each step costs four evaluations, but it reaches a given accuracy with far larger h.</p>`,
        figs: [lab('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler heun rk4', exact: '2*exp(x) - x - 1' }, 'All three against the exact curve.', ['euler', 'heun', 'rk4', 'exact'], { caption: 'Euler, Heun and RK4', name: 'rk' })],
        qs: [q('rk4q', 'Why is RK4 popular?', ['High accuracy (order 4) without needing derivatives of f.', 'Large steps are possible.'], [['It uses one slope per step.', 'It uses four.'], ['It is exact.', 'It is approximate.']])],
        probs: [pr('p-ode', '<p>Solve y′ = x + y, y(0) = 1 to x = 1 with h = 0.1 using Euler and RK4. Compare with the exact 2eˣ − x − 1.</p>', `Euler <b>${o.euler}</b>, Heun <b>${o.heun}</b>, RK4 <b>${o.rk4}</b>, exact <b>${o.exact}</b>.`, { verify: lab('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler rk4', exact: '2*exp(x) - x - 1' }, 'All methods.', ['euler', 'rk4', 'exact'], { caption: 'answer', name: 'ans' }) })] }),
      sec('step', '5.5', 'Step size, stability and stiff equations', { eyebrow: 'Practical issues',
        body: `<p>Too large an h is inaccurate and, for equations like y′ = −50y, unstable (the explicit Euler method blows up when h &gt; 2/50). Adaptive methods shrink h where the solution changes quickly (Runge–Kutta–Fehlberg compares orders 4 and 5). ${term('Stiff')} problems, with very different time scales, need implicit methods that stay stable at large steps.</p>`,
        worked: [step('y′ = −50y, y(0) = 1, Euler with h = 0.05.', '', { toc: 'Setup' }), step('y₁ = y₀(1 − 50·0.05) = −1.5: the true solution decays to 0 but the numerical one grows in magnitude — instability.', '1-50h=-1.5,\\ |{-1.5}|>1', { hero: true, toc: 'Blow-up' })],
        qs: [q('unst', 'Euler on y′ = −50y with h = 0.05 gives…', ['Growing oscillations — the step is beyond the stability limit.', '|1 − 50h| > 1.'], [['A smooth decay.', 'h is too large for that.'], ['The exact answer.', 'No.']])] }),
      sec('systems', '5.6', 'Systems and higher-order equations', { eyebrow: 'Extending',
        body: `<p>A higher-order ODE becomes a first-order system: y″ = f(x, y, y′) → let u = y, v = y′; then u′ = v, v′ = f(x, u, v). All methods apply componentwise to the vector (u, v). This is how the notebook's physics engine advances every body: position and velocity together.</p>`,
        worked: [step('Write y″ + y = 0 as a system.', 'u=y,\\ v=y\'', { toc: 'Substitute' }), step('u′ = v, v′ = −u — one Euler step from (1, 0): u₁ = 1, v₁ = −h.', "u'=v,\\ v'=-u", { hero: true, toc: 'System' })],
        qs: [q('sys', 'y″ = −y is converted to a first-order system using…', ['u = y, v = y′, so u′ = v and v′ = −u.', 'Two first-order equations.'], [['y = 2y′.', 'Not a conversion.'], ['It cannot be.', 'Every ODE can.']])] }),
    ],
  })
}
