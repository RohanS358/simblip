import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const m = run('markov', {})
  return lesson({
    title: 'Markov chains',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapter 5',
    subtitle: 'Tomorrow depends only on today. That single assumption predicts weather, web rankings and queue lengths.',
    sections: [
      sec('def', '5.1', 'The Markov property', { eyebrow: 'Memorylessness',
        body: `<p>A ${term('Markov chain')} moves between states; the probability of the next state depends <em>only on the current state</em>, not on how it got there. The chain is described by a transition matrix P where P<sub>ij</sub> is the probability of going from i to j and each row sums to 1. Example: Sunny → Sunny 0.9, Sunny → Rainy 0.1, Rainy → Sunny 0.5, Rainy → Rainy 0.5.</p>`,
        figs: [dia(`direction: right
((Sunny)) as s
((Rainy)) as r
s -> r : 0.1
r -> s : 0.5`, 'Sunny stays sunny with probability 0.9; rainy stays rainy with 0.5.', { caption: 'a two-state weather chain' })],
        qs: [q('rows', 'Why must each row of a transition matrix sum to 1?', ['From any state the chain must go somewhere.', 'The row is a probability distribution over next states.'], [['Each column must sum to 1.', 'Only rows, in general.'], ['They can sum to anything.', 'Probabilities total 1.']])] }),
      sec('evolve', '5.2', 'Evolving the distribution', { eyebrow: 'Step by step',
        body: `<p>If π₀ is the starting distribution (a row vector), then π₁ = π₀P, π₂ = π₁P, … The probabilities of each state after n steps are the entries of πₙ. Starting sunny: π₀ = (1, 0); π₁ = (0.9, 0.1); π₂ = (0.86, 0.14).</p>`,
        worked: [step('π₁ = π₀P with π₀ = (1, 0).', '(1,0)\\begin{pmatrix}0.9&0.1\\\\0.5&0.5\\end{pmatrix}=(0.9,0.1)', { toc: 'Step 1' }), step('π₂ = π₁P.', '(0.9\\cdot0.9+0.1\\cdot0.5,\\ 0.9\\cdot0.1+0.1\\cdot0.5)=(0.86,0.14)', { hero: true, toc: 'Step 2' })],
        qs: [q('p2', 'Sunny today. Probability of sun the day after tomorrow?', ['0.86.', '0.9·0.9 + 0.1·0.5.'], [['0.9.', 'That is tomorrow.'], ['0.81.', 'Misses the rainy path.']])] }),
      sec('steady', '5.3', 'Steady state', { eyebrow: 'Where it settles',
        body: `<p>For most chains the distribution converges to a ${term('steady state')} π satisfying π = πP, regardless of the start. Solve π(1−0.9) = 0.5π₂ ⇒ 0.1π₁ = 0.5π₂ ⇒ π₁ = 5π₂, and π₁ + π₂ = 1, so π = (5/6, 1/6) = (<b>${m.steady_Sunny}</b>, <b>${m.steady_Rainy}</b>): in the long run it is sunny 83% of days. The simulation shows convergence from a sunny start.</p>`,
        figs: [lab('markov', {}, 'Bars and lines converge to the steady state.', ['steady_Sunny', 'steady_Rainy'], { caption: 'convergence to steady state', name: 'mk' })],
        qs: [q('conv', 'Does the long-run distribution depend on the starting state (for this chain)?', ['No — it converges to the same steady state.', 'The chain forgets where it began.'], [['Yes, completely.', 'That holds for non-ergodic chains.'], ['Only for the first step.', 'It has no memory anyway.']])],
        probs: [pr('p-ss', '<p>Find the steady state of the matrix [[0.9, 0.1], [0.5, 0.5]].</p>', `Solve π = πP with π₁ + π₂ = 1: π = (5/6, 1/6) = (<b>${m.steady_Sunny}</b>, <b>${m.steady_Rainy}</b>).`, { verify: lab('markov', {}, 'Numerical evolution.', ['steady_Sunny'], { caption: 'answer', name: 'ans' }) })] }),
      sec('types', '5.4', 'Kinds of state', { eyebrow: 'Structure',
        body: `<p>A state is ${term('absorbing')} if once entered it is never left (P<sub>ii</sub> = 1) — a game’s “ruined” state. A chain is ${term('irreducible')} if every state can reach every other; ${term('periodic')} if returns happen only at multiples of some period. Irreducible, aperiodic chains are ${term('ergodic')}: they have a unique steady state.</p>`,
        qs: [q('abs', 'An absorbing state is one where…', ['Once entered the chain stays forever (P_ii = 1).', 'Gambler’s ruin ends there.'], [['The chain moves every step.', 'That is not absorbing.'], ['Probabilities are equal.', 'Unrelated.']])] }),
      sec('app', '5.5', 'Applications', { eyebrow: 'Uses',
        body: `<p>Weather and text generation, PageRank (a random surfer on the web graph has a steady state that ranks pages), queues (the number in an M/M/1 queue is a birth–death chain), reliability (working/failed states), genetics, finance and speech recognition (hidden Markov models).</p>`,
        worked: [step('A machine is Up or Down. Up → Down 0.1, Down → Up 0.6.', '', { toc: 'Chain' }), step('Steady state: 0.1π_Up = 0.6π_Down ⇒ π_Up = 6π_Down, so π_Up = 6/7.', '\\pi_{Up}=\\tfrac67\\approx0.857', { hero: true, toc: 'Availability' })],
        qs: [q('pr', 'PageRank models web surfing as…', ['A Markov chain whose steady state ranks pages.', 'Important pages are visited more in the long run.'], [['A queue.', 'Not the model.'], ['A sorting algorithm.', 'No.']])] }),
      sec('summary', '5.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Next state depends on the current state only; π ← πP.</li><li>Ergodic chains have a unique steady state π = πP.</li></ul>` }),
    ],
  })
}
