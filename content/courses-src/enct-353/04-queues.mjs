import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const s = run('mm1', { lambda: 0.5, mu: 1, customers: 4000, seed: 9 }), hi = run('mm1', { lambda: 0.9, mu: 1, customers: 4000, seed: 9 })
  return lesson({
    title: 'Queueing systems',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapter 4',
    subtitle: 'Waiting is what most systems are made of. A few formulas tell you when the line explodes.',
    sections: [
      sec('elems', '4.1', 'Elements of a queue', { eyebrow: 'Anatomy',
        body: `<p>A queueing system has an ${term('arrival')} process (calling population, inter-arrival times), a ${term('queue')} (capacity, discipline — FIFO, LIFO, priority) and one or more ${term('servers')} (service-time distribution). ${term('Kendall’s notation')} A/B/c/K/N/D describes it: M/M/1 = Markovian (Poisson) arrivals, Markovian (exponential) service, one server. Applications: banks, call centres, routers, CPUs, traffic.</p>`,
        figs: [dia(`direction: right
(Arrivals, rate λ) as a
[Queue: FIFO, waiting customers] as q #amber
[Server, rate μ] as s #mint
(Departures) as d
a -> q
q -> s
s -> d
@0 a -> q : customer
@1 q -> s : starts service
@2 s -> d : leaves
loop 4`, 'The anatomy of an M/M/1 queue.', { caption: 'a single-server queue' })],
        qs: [q('kend', 'In M/M/1 the second “M” stands for…', ['Exponential (Markovian) service times.', 'The first M is Poisson arrivals.'], [['Multiple servers.', 'That is the third symbol.'], ['Maximum capacity.', 'That is K.']])] }),
      sec('mm1', '4.2', 'M/M/1 in theory', { eyebrow: 'The formulas',
        body: `<p>With arrival rate λ and service rate μ the ${term('utilisation')} is ρ = λ/μ, which must stay below 1. Then L (mean number in system) = ρ/(1−ρ), W (mean time in system) = 1/(μ−λ), Lq = ρ²/(1−ρ), Wq = ρ/(μ−λ), and Little’s law L = λW holds for any stable queue. At ρ = 0.5: L = 1. At ρ = 0.9: L = 9 — waiting explodes as utilisation approaches 100%.</p>`,
        worked: [step('λ = 0.8 customers/min, μ = 1 customer/min.', '\\rho=0.8', { toc: 'Utilisation' }), step('Mean number in system.', 'L=\\frac{\\rho}{1-\\rho}=4', { toc: 'L' }), step('Mean time in system, and Little’s law check L = λW.', 'W=\\frac{1}{1-0.8}=5\\ \\text{min},\\ \\lambda W=4', { hero: true, toc: 'W' })],
        qs: [q('rho', 'What happens to an M/M/1 queue as ρ → 1?', ['The mean queue length and waiting time grow without bound.', 'L = ρ/(1 − ρ) → ∞.'], [['Nothing; utilisation is irrelevant.', 'It is everything.'], ['The queue empties.', 'It grows.']])] }),
      sec('sim', '4.3', 'Simulating it', { eyebrow: 'Does the simulation agree?',
        body: `<p>Generate exponential inter-arrival and service times, run the event loop, and measure. With λ = 0.5, μ = 1 (ρ = 0.5) over 4000 customers the simulated utilisation is <b>${s.utilisation}</b> and average number in system <b>${s.avgInSystem}</b> against theory ρ = ${s.rho}, L = ${s.theoryL}. At ρ = 0.9 the theory says L = 9 and the simulation gives about <b>${hi.avgInSystem}</b> — with much more noise.</p>`,
        figs: [lab('mm1', { lambda: 0.5, mu: 1, customers: 300 }, 'Steps show the queue length over time; ticks are arrivals and departures.', ['utilisation', 'avgInSystem', 'theoryL'], { caption: 'ρ = 0.5', name: 'lo' }), lab('mm1', { lambda: 0.9, mu: 1, customers: 300 }, 'Near saturation the queue wanders to large values.', ['utilisation', 'avgInSystem', 'theoryL'], { caption: 'ρ = 0.9', name: 'hi' })],
        qs: [q('noise', 'Why is the ρ = 0.9 simulation noisier than ρ = 0.5?', ['Long busy periods make the queue correlated over time, so averages converge slowly.', 'More runs or longer runs are needed.'], [['The random generator is worse.', 'Same generator.'], ['The formula is wrong.', 'Theory is fine; estimating it is harder.']])],
        probs: [pr('p-q', '<p>λ = 0.5, μ = 1: give the theoretical utilisation, L and mean wait in queue, and compare with the simulation.</p>', `ρ = 0.5, L = 1, Wq = ρ/(μ−λ) = 1. Simulated: utilisation <b>${s.utilisation}</b>, L ≈ <b>${s.avgInSystem}</b>.`, { verify: lab('mm1', { lambda: 0.5, mu: 1, customers: 4000, seed: 9 }, 'Long run.', ['utilisation', 'avgInSystem'], { caption: 'answer', name: 'ans' }) })] }),
      sec('net', '4.4', 'Networks of queues', { eyebrow: 'Many servers',
        body: `<p>Real systems chain queues: a customer visits several stations. In a tandem of M/M/1 queues, each behaves (Jackson's theorem) as an independent M/M/1 with the same arrival rate but its own μ, and the total time is the sum. More servers (M/M/c) share the load: the same λ with two half-speed servers behaves differently from one full-speed server.</p>`,
        worked: [step('Two M/M/1 stations in series, λ = 2/min, μ₁ = 4, μ₂ = 3.', '', { toc: 'Given' }), step('W₁ = 1/(4−2) = 0.5 min, W₂ = 1/(3−2) = 1 min.', 'W=0.5+1=1.5\\ \\text{min}', { hero: true, toc: 'Total time' })],
        qs: [q('tandem', 'In a tandem of two queues the total time in the system is…', ['The sum of the times at each station.', 'Time adds along the path.'], [['The larger of the two.', 'Both are experienced.'], ['The average.', 'It is a sum.']])] }),
      sec('app', '4.5', 'Applications', { eyebrow: 'Uses',
        body: `<p>Sizing a call-centre (how many agents keep waiting under 30 s), router buffers, CPU scheduling, hospital beds, checkout lanes. The simulator shows the danger zone: keep utilisation below about 70–80% if waiting matters.</p>`,
        qs: [q('size', 'Why do real systems avoid 100% utilisation?', ['Queues and delays grow without bound as ρ approaches 1.', 'Some idle capacity buys short waits.'], [['It is impossible to reach.', 'You can approach it.'], ['It wastes power.', 'The issue is delay.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>ρ = λ/μ &lt; 1; L = ρ/(1−ρ); W = 1/(μ−λ); L = λW.</li><li>Simulation agrees with theory, with noise growing near ρ = 1.</li></ul>` }),
    ],
  })
}
