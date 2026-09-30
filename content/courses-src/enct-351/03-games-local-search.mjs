import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const on = run('minimax', { pruning: 'on' }), off = run('minimax', { pruning: 'off' }), ga = run('ga', { generations: 30, population: 10 })
  return lesson({
    title: 'Games, local search and genetic algorithms',
    kicker: 'ENCT 351 · Artificial Intelligence · Chapter 2 (adversarial and optimisation)',
    subtitle: 'When an opponent answers back, and when the path does not matter — only the final state.',
    sections: [
      sec('minimax', '2.7', 'Minimax', { eyebrow: 'Two players',
        body: `<p>In a zero-sum game two players alternate. MAX tries to maximise a score, MIN to minimise it. ${term('Minimax')} looks ahead to the leaves, scores them with an evaluation function, and backs values up: MAX nodes take the largest child, MIN nodes the smallest. The root value is the best MAX can guarantee against perfect play. Cost: bᵈ nodes.</p>`,
        figs: [lab('minimax', { pruning: 'off' }, `All ${off.leavesTotal} leaves are evaluated; value ${off.value}.`, ['value', 'leavesEvaluated'], { caption: 'minimax', name: 'mm' })],
        qs: [q('minmax', 'At a MIN node minimax takes…', ['The smallest child value.', 'The opponent chooses what is worst for MAX.'], [['The largest.', 'That is a MAX node.'], ['The average.', 'That is expectimax.']])] }),
      sec('ab', '2.8', 'Alpha–beta pruning', { eyebrow: 'Skipping what cannot matter',
        body: `<p>${term('Alpha–beta')} carries two bounds: α, the best MAX is already assured, and β, the best MIN is already assured. When α ≥ β the remaining children cannot change the decision and are ${term('pruned')}. It returns the same value as minimax but evaluates fewer leaves: here <b>${on.leavesEvaluated}</b> of ${on.leavesTotal}, value ${on.value}. With perfect move ordering it searches about b^(d/2) nodes — doubling the depth you can afford.</p>`,
        figs: [lab('minimax', { pruning: 'on' }, 'Dashed red branches are never examined.', ['value', 'leavesEvaluated'], { caption: 'alpha–beta', name: 'ab' })],
        qs: [q('same', 'Does alpha–beta pruning change the game-theoretic value at the root?', ['No — it returns exactly the minimax value, only faster.', 'It prunes branches that cannot affect the result.'], [['Yes, it approximates it.', 'It is exact.'], ['Only for MIN nodes.', 'Both.']])],
        probs: [pr('p-ab', '<p>Leaves 3 5 6 9 1 2 0 −1 under a MAX–MIN–MAX tree of branching 2. Find the root value and how many leaves alpha–beta evaluates.</p>', `Root value <b>${on.value}</b>; <b>${on.leavesEvaluated}</b> of 8 leaves are evaluated (9 and the whole (0,−1) branch are pruned).`, { verify: lab('minimax', { pruning: 'on' }, 'Pruned branches.', ['leavesEvaluated'], { caption: 'answer', name: 'ans' }) })] }),
      sec('hill', '2.9', 'Local search: hill climbing and simulated annealing', { eyebrow: 'Only the state matters',
        body: `<p>For timetabling or n-queens the path is irrelevant. ${term('Hill climbing')} moves to the best neighbouring state until none is better; it gets stuck on ${term('local maxima')}, plateaus and ridges. ${term('Simulated annealing')} sometimes accepts a worse move with probability e^(−Δ/T), where the temperature T falls over time: early on it explores, later it settles. Random restarts also help.</p>`,
        worked: [step('Current cost 10; a neighbour has cost 12 (Δ = 2). Temperature T = 4.', '', { toc: 'Given' }), step('Probability of accepting the worse move.', 'e^{-2/4}=e^{-0.5}\\approx0.61', { hero: true, toc: 'Acceptance' })],
        qs: [q('sa', 'Why does simulated annealing accept worse moves?', ['To escape local optima.', 'As T falls it behaves more and more like hill climbing.'], [['By mistake.', 'It is deliberate.'], ['To save memory.', 'Unrelated.']])] }),
      sec('ga', '2.10', 'Genetic algorithms', { eyebrow: 'Evolution as search',
        body: `<p>A ${term('genetic algorithm')} keeps a population of candidate solutions (bit strings). Each generation: ${term('selection')} (fitter individuals are more likely parents, e.g. roulette wheel), ${term('crossover')} (swap tails at a random cut) and ${term('mutation')} (rare bit flips). Here it maximises f(x) = x² over 5-bit strings (optimum 31² = 961); after 30 generations of 10 individuals the best fitness reaches <b>${ga.best}</b> (optimum ${ga.optimum}).</p>`,
        figs: [lab('ga', { generations: 10, population: 6 }, 'Watch fitness climb generation by generation.', ['best', 'optimum'], { caption: 'a genetic algorithm', name: 'ga' })],
        qs: [q('mut', 'What is the role of mutation?', ['Keep diversity and reintroduce lost genetic material.', 'Without it the population may converge prematurely.'], [['Select the fittest.', 'That is selection.'], ['Combine parents.', 'That is crossover.']])] }),
      sec('summary', '2.11', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Minimax backs up values; alpha–beta prunes without changing them.</li><li>Local search ignores the path; annealing escapes local optima; GAs evolve populations.</li></ul>` }),
      sec('ex', '2.12', 'Try it', { eyebrow: 'Practice',
        body: `<p>Change the leaf values and watch which branches get pruned. Good ordering (best move first) prunes the most; bad ordering prunes nothing.</p>`,
        figs: [lab('minimax', { pruning: 'on', leaves: '9 5 6 3 2 1 -1 0' }, 'The same leaves in the opposite order: check the pruning.', ['leavesEvaluated'], { caption: 'reordered leaves', name: 'ord' })],
        qs: [q('order', 'When does alpha–beta prune the most?', ['When the best moves are examined first.', 'Good bounds are found early.'], [['When the tree is shallow.', 'Depth is not the factor.'], ['Never.', 'It depends on ordering.']])] }),
    ],
  })
}
