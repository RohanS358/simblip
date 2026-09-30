import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const o = run('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler rk4', exact: '2*exp(x) - x - 1' }), h = run('heat1d', { steps: 400 })
  return lesson({
    title: 'Physical and mathematical models',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapter 2',
    subtitle: 'Four kinds of model, and how a differential equation becomes a program.',
    sections: [
      sec('types', '2.1', 'Kinds of model', { eyebrow: 'Taxonomy',
        body: `<p>${term('Physical')} models are scaled or analogue versions of the real thing — static (a scale model of a building) or dynamic (a wind tunnel, a circuit that mimics a mechanical system). ${term('Mathematical')} models describe behaviour with equations — static (an algebraic relation such as Ohm’s law) or dynamic (differential equations in time). Computers make the dynamic mathematical model the workhorse.</p>`,
        qs: [q('dyn', 'A differential equation describing how a tank level changes is a…', ['Dynamic mathematical model.', 'It relates rates of change to state.'], [['Static physical model.', 'No equations there.'], ['Static mathematical model.', 'Static means no time dependence.']])] }),
      sec('ode', '2.2', 'From a differential equation to a simulation', { eyebrow: 'Numerical integration',
        body: `<p>Most dynamic models are of the form dy/dx = f(x, y). Euler’s method advances in small steps: y<sub>n+1</sub> = y<sub>n</sub> + h·f(x<sub>n</sub>, y<sub>n</sub>). Runge–Kutta 4 uses four slopes per step and is far more accurate. For y′ = x + y, y(0) = 1 (exact y = 2eˣ − x − 1), at x = 1 with h = 0.1: Euler gives <b>${o.euler}</b>, RK4 gives <b>${o.rk4}</b>, exact <b>${o.exact}</b>.</p>`,
        figs: [lab('ode', { f: 'x + y', x0: 0, y0: 1, h: 0.1, xEnd: 1, methods: 'euler rk4', exact: '2*exp(x) - x - 1' }, 'Grey = exact; Euler lags behind; RK4 sits on top of it.', ['euler', 'rk4', 'exact'], { caption: 'Euler versus RK4', name: 'ode' })],
        worked: [step('One Euler step from (0, 1) with h = 0.1 for y′ = x + y.', '', { toc: 'Setup' }), step('Slope f(0,1) = 1, so y₁ = 1 + 0.1·1.', 'y_1=1.1', { hero: true, toc: 'Step' })],
        qs: [q('euler', 'Why is Euler’s method less accurate than RK4?', ['It uses only the slope at the start of each step.', 'The error per step is O(h²) versus O(h⁵).'], [['It uses too many steps.', 'Step size is chosen by the user.'], ['It ignores the equation.', 'It uses f.']])] }),
      sec('pde', '2.3', 'Partial differential equations: heat flow', { eyebrow: 'Space and time',
        body: `<p>When the state varies in space as well as time we have a PDE. The heat equation u<sub>t</sub> = α u<sub>xx</sub> is discretised on a grid: u<sub>i</sub>ⁿ⁺¹ = u<sub>i</sub>ⁿ + r(u<sub>i−1</sub>ⁿ − 2u<sub>i</sub>ⁿ + u<sub>i+1</sub>ⁿ) with r = αΔt/Δx². The explicit scheme is stable only for r ≤ ½. A rod with ends held at 100 and 0 relaxes to the straight line between them: mid-rod temperature <b>${h.mid}</b> after 400 steps (steady value ${h.steadyMid}).</p>`,
        figs: [lab('heat1d', { steps: 60 }, 'Each curve is a later time; the last approaches a straight line.', ['mid', 'steadyMid'], { caption: 'heat conduction in a rod', name: 'heat' })],
        qs: [q('stab', 'If r = αΔt/Δx² exceeds ½ in the explicit scheme…', ['The solution becomes unstable and blows up.', 'The simulator refuses r above 0.5.'], [['It just runs faster.', 'It diverges.'], ['It becomes more accurate.', 'The opposite.']])] }),
      sec('mech', '2.4', 'A physical model in the notebook: a damped oscillator', { eyebrow: 'Try a physical model',
        body: `<p>SIMBLIP’s physics engine is itself a dynamic physical model solving Newton’s second law. A mass on a spring obeys m x″ + c x′ + k x = 0; the solution oscillates with angular frequency ω = √(k/m) and decays if c &gt; 0. Press Simulate and compare the period with 2π√(m/k).</p>`,
        figs: [{ id: 'spring', caption: 'Figure 2.4.1 — mass on a spring', script: `var sys = create("system", { x: 0, y: 0, domain: "mechanics", width: 460, height: 460 });
var anchor = create("hinge", { x: 300, y: 80 });
var bob = create("mass", { x: 300, y: 300, mass: 1 });
var spr = create("spring", { length: 200, k: 100 });
connect(spr.a, anchor.centre);
connect(spr.b, bob.centre);
graph.plot(bob.y);`, note: 'Press Simulate: m = 1 kg, k = 100 N/m, so T = 2π√(1/100) ≈ 0.63 s.' }],
        worked: [step('m = 1 kg, k = 100 N/m.', '\\omega=\\sqrt{k/m}=10\\ \\text{rad/s}', { toc: 'Frequency' }), step('Period.', 'T=\\frac{2\\pi}{\\omega}\\approx0.63\\ \\text{s}', { hero: true, toc: 'Period' })],
        qs: [q('T', 'Quadrupling the mass of a spring-mass system changes the period by a factor of…', ['2 (T ∝ √m).', '√4 = 2.'], [['4.', 'Period goes as the square root.'], ['1/2.', 'Heavier means slower.']])] }),
      sec('use', '2.5', 'Choosing a model’s level of detail', { eyebrow: 'Judgement',
        body: `<p>A model should be as simple as the question allows. Include what affects the answer; ignore the rest, and state the assumptions (no air resistance, small angles, constant service rate). Validate by comparing with data; refine only where validation fails.</p>`,
        probs: [pr('p1', '<p>A pendulum model assumes small angles. Why, and what breaks for large angles?</p>', 'For small θ, sin θ ≈ θ, so the equation becomes linear with period independent of amplitude. For large angles the true period grows with amplitude and the linear model underestimates it.')],
        qs: [q('assume', 'Why state a model’s assumptions?', ['So users know where it can and cannot be trusted.', 'Every model is wrong somewhere.'], [['To lengthen the report.', 'No.'], ['To avoid validation.', 'They make validation meaningful.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Physical vs mathematical, static vs dynamic.</li><li>ODEs: Euler is simple, RK4 accurate; PDEs: discretise space and time, watch stability.</li></ul>` }),
    ],
  })
}
