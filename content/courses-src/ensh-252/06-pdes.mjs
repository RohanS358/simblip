import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const h = run('heat1d', { steps: 400 })
  return lesson({
    title: 'Finite differences for heat and Laplace equations',
    kicker: 'ENSH 252 · Numerical Methods · Chapter 6',
    subtitle: 'Replace derivatives by differences on a grid and a partial differential equation becomes arithmetic.',
    sections: [
      sec('classes', '6.1', 'Kinds of PDE', { eyebrow: 'Classification',
        body: `<p>Second-order linear PDEs Auₓₓ + Buₓᵧ + Cuᵧᵧ = … are ${term('elliptic')} (B² − 4AC &lt; 0: Laplace, Poisson — steady states), ${term('parabolic')} (= 0: heat equation — diffusion) or ${term('hyperbolic')} (&gt; 0: wave equation — propagation). The type decides which numerical scheme is stable and what boundary or initial data are needed.</p>`,
        worked: [step('Classify uₜ = α uₓₓ: write it as α uₓₓ − uₜ = 0, with only one second derivative (A = α, B = C = 0).', 'B^2-4AC=0', { hero: true, toc: 'Parabolic' })],
        qs: [q('type', 'The 1-D heat equation is…', ['Parabolic.', 'B² − 4AC = 0.'], [['Elliptic.', 'That is Laplace.'], ['Hyperbolic.', 'That is the wave equation.']])] }),
      sec('fd', '6.2', 'Finite-difference approximations', { eyebrow: 'Derivatives to differences',
        body: `<p>Central differences on a grid with spacing h: uₓ ≈ (uᵢ₊₁ − uᵢ₋₁)/(2h), uₓₓ ≈ (uᵢ₊₁ − 2uᵢ + uᵢ₋₁)/h². In time, uₜ ≈ (uᵢⁿ⁺¹ − uᵢⁿ)/Δt. Each approximation has a known truncation error.</p>`,
        worked: [step('u = x² at x = 2 with h = 0.5: u(1.5) = 2.25, u(2) = 4, u(2.5) = 6.25.', '', { toc: 'Values' }), step('Second difference.', 'u_{xx}\\approx\\tfrac{2.25-8+6.25}{0.25}=2\\ (\\text{exact }2)', { hero: true, toc: 'u″' })],
        qs: [q('fdq', 'The central second-difference of a parabola is…', ['Exact — the formula is exact for quadratics.', 'The error term involves the fourth derivative.'], [['Always zero.', 'It gives the constant u″.'], ['Always wrong.', 'It is exact here.']])] }),
      sec('heat', '6.3', 'The explicit scheme for the heat equation', { eyebrow: 'Marching in time',
        body: `<p>uᵢⁿ⁺¹ = uᵢⁿ + r(uᵢ₋₁ⁿ − 2uᵢⁿ + uᵢ₊₁ⁿ), r = αΔt/Δx². Each new value is a weighted average of a point and its neighbours. A rod with ends at 100 and 0 starts at 0 and relaxes toward the straight line: after 400 steps the middle reads <b>${h.mid}</b> (steady value ${h.steadyMid}). The scheme is stable only if r ≤ ½.</p>`,
        figs: [lab('heat1d', { steps: 60 }, 'Successive profiles; dark curves are earlier times.', ['mid', 'steadyMid'], { caption: 'heat diffusing along a rod', name: 'heat' })],
        worked: [step('Interior node with neighbours 100 and 0, itself at 0, r = 0.25.', '', { toc: 'Given' }), step('New value = 0 + 0.25(100 − 0 + 0).', 'u^{n+1}=25', { hero: true, toc: 'One step' })],
        qs: [q('stable', 'What happens if r > 0.5 in the explicit scheme?', ['The numerical solution oscillates and grows without bound.', 'The scheme is conditionally stable.'], [['Nothing; it is unconditionally stable.', 'Only implicit schemes are.'], ['It converges faster.', 'It blows up.']])],
        probs: [pr('p-h', '<p>Why does the simulator refuse r = 0.6? What can you change?</p>', 'The explicit scheme is stable only for αΔt/Δx² ≤ ½. Reduce the time step Δt (or increase Δx) until r ≤ 0.5.')] }),
      sec('lap', '6.4', 'Laplace’s equation: relaxation', { eyebrow: 'Steady state',
        body: `<p>∇²u = 0 becomes uᵢⱼ = ¼(uᵢ₊₁,ⱼ + uᵢ₋₁,ⱼ + uᵢ,ⱼ₊₁ + uᵢ,ⱼ₋₁): every interior value is the average of its four neighbours. Start with a guess, set the boundary values, and repeatedly replace each point by the average (Gauss–Seidel iteration) until nothing changes. This is exactly the electrostatic potential in a box with fixed-voltage walls.</p>`,
        worked: [step('A 3×3 grid, top edge 100, other edges 0. Find the centre value by symmetry with all four neighbours averaging in.', '', { toc: 'Setup' }), step('For the single interior point: u = ¼(100 + 0 + 0 + 0).', 'u=25', { hero: true, toc: 'Centre' })],
        qs: [q('avg', 'At a solution of Laplace’s equation each interior point equals…', ['The average of its neighbours.', 'The mean-value property.'], [['The maximum of its neighbours.', 'No.'], ['Zero.', 'Only with zero boundary.']])] }),
      sec('crank', '6.5', 'Implicit schemes and accuracy', { eyebrow: 'Beyond explicit',
        body: `<p>The implicit (backward-time) scheme and Crank–Nicolson evaluate the spatial differences at the new time level. Each step solves a tridiagonal linear system (Gaussian elimination in O(n)), but they are stable for any step size, so the time step is chosen for accuracy only. Crank–Nicolson is second-order in time.</p>`,
        qs: [q('impl', 'Implicit schemes are attractive because they…', ['Remain stable for large time steps, at the cost of solving a system each step.', 'Unconditional stability.'], [['Need no equation solving.', 'They solve a system.'], ['Are first order always.', 'Crank–Nicolson is second order.']])] }),
      sec('summary', '6.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Central differences turn PDEs into arithmetic on a grid.</li><li>Explicit heat scheme needs r ≤ ½; Laplace relaxes to the neighbour average.</li></ul>` }),
    ],
  })
}
