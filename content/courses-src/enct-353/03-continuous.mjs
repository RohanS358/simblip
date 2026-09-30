import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const fb = run('blocks', {}), un = run('blocks', { blocks: 'r: step(1)\ng: tf(1 ; 1 0.4 1)\ny: scope\nr -> g -> y', time: 40 }), pid = run('blocks', { blocks: 'r: step(1)\ne: sum(+-)\nc: pid(2, 1, 0)\np: tf(1 ; 1 1)\ny: scope\nr -> e -> c -> p -> y\np -> e', time: 20 })
  return lesson({
    title: 'Continuous systems: feedback and block diagrams',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapter 3',
    subtitle: 'The analog-computer idea, made digital: wire integrators, gains and sums into a diagram and let it run.',
    sections: [
      sec('analog', '3.1', 'Analog computers and block diagrams', { eyebrow: 'History',
        body: `<p>Before digital machines, continuous models ran on ${term('analog computers')}: op-amp circuits wired as summers, gains and integrators, solving differential equations in real time. A ${term('hybrid')} computer paired analog parts with a digital controller. Modern ${term('continuous system simulation languages')} (CSSLs — Simulink, Modelica) keep the same picture: a ${term('block diagram')} of integrators, gains and sums. Below is the simulator built into this notebook.</p>`,
        figs: [lab('blocks', { blocks: 'r: const(2)\ni: integrator\ny: scope\nr -> i -> y', time: 3 }, 'An integrator fed a constant 2 ramps at 2 per second.', ['final'], { caption: 'the integrator', name: 'int' })],
        qs: [q('int', 'An integrator fed a constant 2 for 3 seconds outputs…', ['6.', '∫ 2 dt = 2t.'], [['2.', 'That is the input.'], ['3.', 'That is the time.']])] }),
      sec('from', '3.2', 'Turning an equation into a diagram', { eyebrow: 'The recipe',
        body: `<p>Solve the highest derivative, then integrate down. For y′ + y = u: y′ = u − y, so a sum forms u − y, an integrator gives y, and a feedback wire returns y to the sum. The first-order system responds to a step by rising as 1 − e⁻ᵗ, with time constant 1 s.</p>`,
        figs: [lab('blocks', { blocks: 'u: step(1)\ns: sum(+-)\ni: integrator\ny: scope\nu -> s -> i -> y\ni -> s', time: 6 }, 'y′ = u − y, drawn as a loop.', ['final', 'settling'], { caption: 'y′ + y = u', name: 'fo' })],
        worked: [step('y′ + y = u, u = step(1). Rearranged y′ = u − y.', '', { toc: 'Rearrange' }), step('Steady state: y′ = 0, so y = u = 1. Time constant τ = 1: about 63% (0.632) at t = 1 and 98% near t = 4.', 'y(t)=1-e^{-t}', { hero: true, toc: 'Response' })],
        qs: [q('fb', 'Why is there a feedback wire from y back to the sum?', ['Because y′ depends on y itself: y′ = u − y.', 'The loop is the equation.'], [['To add noise.', 'No.'], ['To slow the simulation.', 'Unrelated.']])] }),
      sec('second', '3.3', 'Second-order systems: oscillation', { eyebrow: 'Mass–spring–damper',
        body: `<p>A second-order plant 1/(s² + 2ζωₙs + ωₙ²) oscillates when the damping ratio ζ is less than 1. With ωₙ = 1 and ζ = 0.2 the step response overshoots by exp(−πζ/√(1−ζ²)) ≈ 52.7%: the simulator gives <b>${un.overshoot}%</b> overshoot and settles at <b>${un.final}</b>. ζ = 1 is critical damping (fastest without overshoot); ζ &gt; 1 is sluggish.</p>`,
        figs: [lab('blocks', { blocks: 'r: step(1)\ng: tf(1 ; 1 0.4 1)\ny: scope\nr -> g -> y', time: 40 }, 'An underdamped response.', ['overshoot', 'settling', 'final'], { caption: 'ζ = 0.2', name: 'sec' })],
        qs: [q('zeta', 'The damping ratio ζ = 0.2 means the response is…', ['Underdamped — it oscillates with noticeable overshoot.', 'ζ < 1.'], [['Overdamped.', 'That needs ζ > 1.'], ['Unstable.', 'Positive damping is stable.']])],
        probs: [pr('p-os', '<p>For 1/(s² + 0.4s + 1) find the damping ratio and predicted overshoot. Then check it against the simulator.</p>', `2ζωₙ = 0.4 with ωₙ = 1 → ζ = 0.2; overshoot = e^(−π·0.2/√0.96) = 52.7%. Simulator: <b>${un.overshoot}%</b>.`, { verify: lab('blocks', { blocks: 'r: step(1)\ng: tf(1 ; 1 0.4 1)\ny: scope\nr -> g -> y', time: 40 }, 'Measured overshoot.', ['overshoot'], { caption: 'answer', name: 'ans' }) })] }),
      sec('loop', '3.4', 'Feedback systems', { eyebrow: 'Closing the loop',
        body: `<p>In a ${term('feedback control')} system the output is compared with a reference; the error drives a controller that drives the plant. With proportional gain K around the plant 1/(s+1) the closed loop settles at K/(1+K) of the reference: K = 2 gives <b>${fb.final}</b> — a permanent ${term('steady-state error')}. Adding integral action removes it: a PI controller (kp = 2, ki = 1) settles at <b>${pid.final}</b>.</p>`,
        figs: [lab('blocks', {}, 'Proportional only: settles at 2/3.', ['final'], { caption: 'proportional control', name: 'p' }), lab('blocks', { blocks: 'r: step(1)\ne: sum(+-)\nc: pid(2, 1, 0)\np: tf(1 ; 1 1)\ny: scope\nr -> e -> c -> p -> y\np -> e', time: 20 }, 'Integral action drives the error to zero.', ['final'], { caption: 'PI control', name: 'pi' })],
        worked: [step('Closed loop with gain K around 1/(s+1): y = K/(s+1+K) · r.', '', { toc: 'Closed loop' }), step('Final value for a unit step: K/(1+K). For K = 2: 2/3 ≈ 0.667.', '\\frac{2}{3}', { hero: true, toc: 'Steady state' })],
        qs: [q('ss', 'Why does proportional control alone leave a steady-state error?', ['A non-zero output needs a non-zero error to keep the controller producing it.', 'Integral action accumulates the error until it vanishes.'], [['The plant is noisy.', 'The plant here is noiseless.'], ['The gain is too high.', 'Higher gain only reduces the error.']])] }),
      sec('nonlin', '3.5', 'Nonlinear blocks and limits', { eyebrow: 'Real hardware',
        body: `<p>Actuators saturate, sensors have delays. Insert a saturation block: output clipped to ±1. A sine of amplitude 3 becomes a flattened wave — a first taste of distortion. Delays and saturation are why real systems need more care than their linear models.</p>`,
        figs: [lab('blocks', { blocks: 'r: sine(3, 0.5)\ns: sat(-1, 1)\ny: scope\nr -> s -> y', time: 4 }, 'Peaks are clipped at ±1.', ['y_final'], { caption: 'saturation', name: 'sat' })],
        qs: [q('sat', 'A saturation block limits…', ['The output to a maximum and minimum value.', 'Beyond the limits the output stays flat.'], [['The frequency.', 'No.'], ['The input noise.', 'No.']])] }),
      sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Solve for the highest derivative, integrate down, feed back.</li><li>ζ &lt; 1 overshoots; P alone leaves steady-state error; I removes it.</li></ul>` }),
    ],
  })
}
