import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const m = run('montecarlo', { points: 5000 })
  return lesson({
    title: 'What simulation is, and Monte Carlo',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapter 1',
    subtitle: 'When the real system is too costly, too slow or too dangerous to try, build a model and run that instead.',
    sections: [
      sec('sys', '1.1', 'Systems, models and simulation', { eyebrow: 'Vocabulary',
        body: `<p>A ${term('system')} is a set of entities interacting toward a goal, inside an ${term('environment')}. A ${term('model')} is a simplified representation of it. ${term('Simulation')} is running the model over time to see how the system behaves. Systems are ${term('continuous')} (state changes smoothly: a tank filling) or ${term('discrete')} (state changes at events: customers arriving). Models may be static or dynamic, deterministic or stochastic.</p>`,
        qs: [q('disc', 'A bank queue is best modelled as…', ['A discrete-event system: state changes at arrivals and departures.', 'Nothing changes between events.'], [['A continuous system.', 'The number of customers is an integer that jumps.'], ['A static model.', 'It evolves in time.']])] }),
      sec('why', '1.2', 'When to simulate, and the steps of a study', { eyebrow: 'Method',
        body: `<p>Simulate when experimenting on the real system is expensive, dangerous or impossible, when an analytic solution does not exist, or to compare designs cheaply. Advantages: what-if experiments, time compression, insight. Disadvantages: needs skill and data, results are estimates not proofs, can be costly to build. A study proceeds: formulate the problem → set objectives → conceptual model → collect data → translate to a program → verify → validate → design experiments → run → analyse → document.</p>`,
        figs: [dia(`direction: down
[Problem formulation and objectives] as a #blue
[Conceptual model and data] as b #blue
[Build the computer model] as c #violet
<Verified? does the code do what we meant> as v #amber
<Validated? does it match reality> as w #amber
[Design experiments, run, analyse] as d #mint
(Recommendations) as e
a -> b
b -> c
c -> v
v -> c : no
v -> w : yes
w -> b : no
w -> d : yes
d -> e`, 'Two loops back: verification and validation.', { caption: 'steps in a simulation study' })],
        qs: [q('steps', 'In a simulation study, validation asks…', ['Does the model represent the real system well enough?', 'Verification asks whether the program implements the model correctly.'], [['Does the code compile?', 'That is far weaker.'], ['Is the random generator long enough?', 'A separate check.']])] }),
      sec('mc', '1.3', 'Monte Carlo simulation', { eyebrow: 'Sampling to compute',
        body: `<p>${term('Monte Carlo')} uses random sampling to estimate a quantity. Throw random points at the unit square; the fraction that lands inside the quarter-circle x² + y² ≤ 1 estimates its area π/4. With 5000 points the estimate is <b>${m.estimate}</b> (error ${m.error}). The error shrinks like 1/√n: a hundred times more points for ten times the accuracy — slow, but it works for problems (high-dimensional integrals, risk) where nothing else does.</p>`,
        figs: [lab('montecarlo', { points: 400 }, 'Green points fell inside the arc, red outside.', ['estimate', 'error'], { caption: 'estimating π', name: 'mc' })],
        worked: [step('Out of 1000 random points, 786 fall inside the quarter circle.', '', { toc: 'Data' }), step('π ≈ 4 × 786/1000.', '\\pi\\approx3.144', { hero: true, toc: 'Estimate' })],
        qs: [q('rate', 'To make a Monte Carlo estimate 10× more accurate you need about…', ['100× as many samples.', 'Error ∝ 1/√n.'], [['10× as many.', 'That gives only √10.'], ['The same number.', 'More samples are needed.']])],
        probs: [pr('p-mc', '<p>Estimate π with Monte Carlo using 5000 points. How close do you get?</p>', `The run gives <b>${m.estimate}</b>, off by <b>${m.error}</b>; different seeds give different errors of the same order (~0.03).`, { verify: lab('montecarlo', { points: 5000 }, 'More points, smaller error.', ['estimate', 'error'], { caption: 'answer', name: 'ans' }) })] }),
      sec('des', '1.4', 'Discrete-event simulation', { eyebrow: 'Jumping between events',
        body: `<p>A discrete-event simulator keeps a clock and an ordered ${term('future event list')}. Loop: take the earliest event, advance the clock to its time, update the state (and statistics), schedule any new events it causes. Nothing happens between events, so the clock skips over idle time. Arrivals, service completions and breakdowns are typical events.</p>`,
        figs: [dia(`direction: down
(Initialise: clock = 0, schedule the first arrival) as i
[Pop the earliest event from the list] as p #blue
[Advance the clock to that time] as a #violet
[Update state and statistics] as u #mint
[Schedule new events] as s #amber
<List empty or time up?> as e
(Report) as r
i -> p
p -> a
a -> u
u -> s
s -> e
e -> p : no
e -> r : yes`, 'The heart of every discrete-event simulator.', { caption: 'the event loop' })],
        qs: [q('clock', 'Between two events the simulation clock…', ['Jumps straight to the next event time.', 'No change occurs in between, so no computation is needed.'], [['Ticks in equal steps.', 'That is time-stepping.'], ['Stops.', 'It advances to the next event.']])] }),
      sec('mcdes', '1.5', 'Monte Carlo versus discrete-event', { eyebrow: 'Choosing',
        body: `<p>Monte Carlo typically has no notion of time — each trial is independent (estimating π, the chance a project overruns). Discrete-event simulation tracks a system’s evolution in time (queues, factories, networks). Many studies combine them: DES with random inter-arrival and service times <em>is</em> Monte Carlo over a dynamic model.</p>`,
        qs: [q('indep', 'Which is typically time-independent?', ['A Monte Carlo estimate of an integral.', 'Each sample stands alone.'], [['A bank queue simulation.', 'It evolves in time.'], ['A traffic simulation.', 'Also dynamic.']])] }),
      sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Model → run → analyse; verify and validate.</li><li>Monte Carlo: error ∝ 1/√n. DES: clock jumps between events.</li></ul>` }),
    ],
  })
}
