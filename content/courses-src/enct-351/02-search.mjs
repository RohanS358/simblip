import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const g = 'S...;.##.;...G', open = 'S.......;........;........;.......G'
  const b = run('search', { algo: 'bfs', grid: g }), d = run('search', { algo: 'dfs', grid: g }), a = run('search', { algo: 'astar', grid: g }), bo = run('search', { algo: 'bfs', grid: open }), ao = run('search', { algo: 'astar', grid: open }), go = run('search', { algo: 'greedy', grid: open })
  return lesson({
    title: 'Uninformed and informed search',
    kicker: 'ENCT 351 · Artificial Intelligence · Chapter 2 (search)',
    subtitle: 'Problem solving as finding a path through a space of states: blind search, then search that can see where the goal is.',
    sections: [
      sec('formal', '2.1', 'Formulating a problem', { eyebrow: 'States and actions',
        body: `<p>A well-defined search problem has an ${term('initial state')}, a set of ${term('actions')}, a ${term('transition model')} (state + action → state), a ${term('goal test')} and a ${term('path cost')}. A route-finding problem: states are cities, actions are roads, cost is distance. A solution is a sequence of actions from start to goal; an optimal solution has least cost. Search strategies are compared on completeness, optimality, time and space.</p>`,
        qs: [q('opt', 'A search strategy is optimal if it…', ['Always finds a least-cost solution.', 'Completeness only says it finds one.'], [['Always finds some solution.', 'That is completeness.'], ['Uses little memory.', 'That is space efficiency.']])] }),
      sec('unin', '2.2', 'Breadth-first and depth-first', { eyebrow: 'Blind search',
        body: `<p>${term('BFS')} expands the shallowest node first (a FIFO queue): complete, optimal when steps cost the same, but memory grows as bᵈ. ${term('DFS')} expands the deepest first (a stack): tiny memory, but can dive forever and need not find the shortest path. ${term('Iterative deepening')} runs depth-limited DFS with limits 0, 1, 2… combining BFS’s optimality with DFS’s memory. On the small maze: BFS cost <b>${b.cost}</b>, DFS cost <b>${d.cost}</b> (a longer, legal route).</p>`,
        figs: [lab('search', { algo: 'bfs', grid: g }, 'BFS fans out evenly.', ['cost', 'expanded'], { caption: 'BFS', name: 'bfs' }), lab('search', { algo: 'dfs', grid: g }, 'DFS follows one branch deep.', ['cost', 'expanded'], { caption: 'DFS', name: 'dfs' })],
        qs: [q('bfsopt', 'Why is BFS optimal when every step costs the same?', ['It reaches the goal at the smallest depth first.', 'Shallowest also means fewest steps.'], [['It uses a stack.', 'That is DFS.'], ['It ignores the goal.', 'It tests each node.']])] }),
      sec('heur', '2.3', 'Heuristics: greedy best-first and A*', { eyebrow: 'Informed search',
        body: `<p>A ${term('heuristic')} h(n) estimates the cost from n to the goal (here the Manhattan distance). ${term('Greedy best-first')} expands the node with the smallest h: fast, but not optimal. ${term('A*')} expands the smallest f(n) = g(n) + h(n), where g is the cost so far: it is optimal if h is ${term('admissible')} (never overestimates). On an open 4×8 grid BFS expands <b>${bo.expanded}</b> cells, greedy <b>${go.expanded}</b> and A* <b>${ao.expanded}</b> — all three find the cost-${ao.cost} path except greedy may not in general.</p>`,
        figs: [lab('search', { algo: 'astar', grid: g }, 'A* expands fewer cells than BFS and still finds the optimal path.', ['cost', 'expanded'], { caption: 'A* on the maze', name: 'astar' }), lab('search', { algo: 'greedy', grid: open }, 'Greedy heads straight for the goal.', ['cost', 'expanded'], { caption: 'greedy on an open grid', name: 'greedy' })],
        qs: [q('adm', 'A heuristic is admissible if it…', ['Never overestimates the true remaining cost.', 'This guarantees A* is optimal.'], [['Is always 0.', 'That is admissible but useless.'], ['Is exact.', 'Exact is allowed, not required.']])],
        probs: [pr('p-astar', '<p>On the grid S...;.##.;...G, how many cells does A* expand and what is the path cost?</p>', `Path cost <b>${a.cost}</b>, expansions <b>${a.expanded}</b> (BFS: ${b.expanded}).`, { verify: lab('search', { algo: 'astar', grid: g }, 'A*.', ['cost', 'expanded'], { caption: 'answer', name: 'ans' }) })] }),
      sec('csp', '2.4', 'Constraint satisfaction', { eyebrow: 'Puzzles with rules',
        body: `<p>A ${term('CSP')} has variables, domains and constraints (map colouring: neighbouring regions differ; sudoku; timetabling). Solve by ${term('backtracking')}: assign a variable, check constraints, undo on failure. Improve with constraint propagation (node/arc/path consistency) and variable-ordering heuristics (most constrained first).</p>`,
        figs: [dia(`direction: right
[WA] as wa #blue
[NT] as nt #mint
[SA] as sa #amber
[Q] as q #violet
wa -- nt
wa -- sa
nt -- sa
nt -- q
sa -- q`, 'Adjacent regions may not share a colour; SA touches everything.', { caption: 'a map-colouring constraint graph' })],
        worked: [step('Colour WA, NT, SA, Q with 3 colours so neighbours differ. SA touches WA, NT and Q, so colour it first (most constrained).', '', { toc: 'Order' }), step('SA = red; WA = green, NT = blue (differs from both), Q = green (differs from NT and SA).', '\\text{SA=R, WA=G, NT=B, Q=G}', { hero: true, toc: 'Solution' })],
        qs: [q('mrv', 'Why assign the most constrained variable first?', ['It has the fewest legal values, so failures show up early and save backtracking.', 'The “fail-first” principle.'], [['It has the most values.', 'The opposite.'], ['It is alphabetically first.', 'Irrelevant.']])] }),
      sec('cmp', '2.5', 'Comparing strategies', { eyebrow: 'Summary table',
        body: `<table><thead><tr><th>Strategy</th><th>Complete</th><th>Optimal</th><th>Time</th><th>Space</th></tr></thead><tbody><tr><td>BFS</td><td>yes</td><td>yes (unit cost)</td><td>bᵈ</td><td>bᵈ</td></tr><tr><td>DFS</td><td>no (infinite depth)</td><td>no</td><td>bᵐ</td><td>b·m</td></tr><tr><td>Iterative deepening</td><td>yes</td><td>yes (unit cost)</td><td>bᵈ</td><td>b·d</td></tr><tr><td>Greedy</td><td>no</td><td>no</td><td>bᵐ</td><td>bᵐ</td></tr><tr><td>A*</td><td>yes</td><td>yes (admissible h)</td><td>exp.</td><td>all nodes</td></tr></tbody></table>`,
        worked: [step('Branching factor b = 3, solution depth d = 4: BFS generates about 1 + 3 + 9 + 27 + 81 nodes.', '\\frac{3^5-1}{3-1}=121', { hero: true, toc: 'Node count' })],
        qs: [q('mem', 'Which uninformed strategy needs the least memory?', ['DFS — only the current path is stored.', 'O(b·m) against BFS’s O(bᵈ).'], [['BFS.', 'Stores the whole frontier.'], ['A*.', 'Stores all generated nodes.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>BFS: shortest in steps; DFS: small memory; A*: optimal and focused with an admissible heuristic.</li><li>CSP: backtracking plus propagation.</li></ul>` }),
    ],
  })
}
