import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const k = run('graphalgo', { algo: 'kruskal' }), p = run('graphalgo', { algo: 'prim' }), b = run('graphalgo', { algo: 'bfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }), t = run('graphalgo', { algo: 'topo', graph: 'a>b;a>c;b>d;c>d', start: 'a' })
  return lesson({
    title: 'Graphs: traversal, spanning trees, shortest paths',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 6',
    subtitle: 'Things and the links between them: maps, networks, dependencies.',
    sections: [
      sec('rep', '6.1', 'Graphs and how to store them', { eyebrow: 'Definitions',
        body: `<p>A ${term('graph')} G = (V, E) has vertices and edges (directed or undirected, weighted or not). Store it as an ${term('adjacency matrix')} (an n×n table: O(1) edge test, O(n²) space — good for dense graphs) or an ${term('adjacency list')} (each vertex lists its neighbours: O(n + e) space — good for sparse graphs).</p>`,
        worked: [step('A graph has 1000 vertices and 3000 edges.', '', { toc: 'Given' }), step('Matrix: 1000² = 10⁶ cells. List: 1000 + 2·3000 = 7000 entries (undirected).', '10^6\\ \\text{vs}\\ 7000', { hero: true, toc: 'Space' })],
        qs: [q('list', 'Which representation suits a sparse graph?', ['Adjacency list.', 'It stores only the edges that exist.'], [['Adjacency matrix.', 'It wastes n² space.'], ['Neither.', 'Both work; one is leaner.']])] }),
      sec('trav', '6.2', 'BFS and DFS', { eyebrow: 'Exploring',
        body: `<p>${term('Breadth-first search')} uses a queue and visits vertices level by level — it finds the fewest-edge path in an unweighted graph. ${term('Depth-first search')} uses a stack (or recursion), dives as deep as it can, then backtracks; it is the basis of cycle detection and topological sort. Both run in O(n + e). On the small graph A–B, A–C, B–D, C–D, D–E from A, BFS visits <b>${b.order}</b>.</p>`,
        figs: [lab('graphalgo', { algo: 'bfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }, 'Amber = frontier, green = visited.', ['order'], { caption: 'BFS', name: 'bfs' }), lab('graphalgo', { algo: 'dfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }, 'DFS dives first.', ['order'], { caption: 'DFS', name: 'dfs' })],
        qs: [q('bfsq', 'Which data structure drives breadth-first search?', ['A queue.', 'First discovered is first explored, giving level order.'], [['A stack.', 'That gives DFS.'], ['A heap.', 'That is Dijkstra/Prim.']])] }),
      sec('mst', '6.3', 'Minimum spanning trees', { eyebrow: 'Cheapest connection',
        body: `<p>A ${term('spanning tree')} connects all n vertices with n−1 edges; the minimum one has least total weight. ${term('Kruskal')}: sort edges, take each unless it forms a cycle (union–find). ${term('Prim')}: grow one tree, always adding the cheapest edge leaving it. On the textbook graph both give total weight <b>${k.weight}</b> (Prim ${p.weight}).</p>`,
        figs: [lab('graphalgo', { algo: 'kruskal' }, 'Skipped edges would close a cycle.', ['weight'], { caption: 'Kruskal', name: 'kr' }), lab('graphalgo', { algo: 'prim', start: 'A' }, 'Prim grows outward from A.', ['weight'], { caption: 'Prim', name: 'pr' })],
        qs: [q('cyc', 'Why does Kruskal skip an edge whose ends are already connected?', ['Adding it would create a cycle, which a tree cannot have.', 'A cycle means one edge is redundant.'], [['It is too heavy.', 'Weight order already handled.'], ['It is directed.', 'Not relevant.']])],
        probs: [pr('p-mst', '<p>Find the MST weight of the graph in the figure.</p>', `Both Kruskal and Prim give <b>${k.weight}</b>.`, { verify: lab('graphalgo', { algo: 'prim', start: 'A' }, 'Prim’s result.', ['weight'], { caption: 'answer', name: 'ans' }) })] }),
      sec('sp', '6.4', 'Shortest paths', { eyebrow: 'Weights',
        body: `<p>${term('Dijkstra')} settles the nearest unsettled vertex and relaxes its edges (non-negative weights; O((n + e) log n) with a heap). ${term('Floyd–Warshall')} computes all-pairs shortest paths with three nested loops, O(n³): for each intermediate k, dist[i][j] = min(dist[i][j], dist[i][k] + dist[k][j]). See the routing lesson in Computer Networks for the step-by-step picture of Dijkstra.</p>`,
        figs: [lab('routing', { algo: 'dijkstra', source: 'u' }, 'Dijkstra on the textbook graph.', ['d_z', 'path_z'], { caption: 'Dijkstra', name: 'dj' })],
        qs: [q('neg', 'Dijkstra can fail when…', ['an edge has negative weight.', 'A settled vertex might later be reachable more cheaply through a negative edge.'], [['The graph is undirected.', 'It works on undirected graphs.'], ['The graph is large.', 'Size only affects speed.']])] }),
      sec('topo', '6.5', 'Topological sort and transitive closure', { eyebrow: 'Dependencies',
        body: `<p>In a directed acyclic graph a ${term('topological order')} lists vertices so every edge points forward — a valid order for building tasks that depend on one another. Repeatedly remove a vertex with no incoming edges (Kahn). For a>b, a>c, b>d, c>d one order is <b>${t.order}</b>. ${term('Warshall’s algorithm')} computes reachability (transitive closure) with the same triple loop as Floyd using OR instead of min.</p>`,
        figs: [lab('graphalgo', { algo: 'topo', graph: 'a>b;a>c;b>d;c>d', start: 'a' }, 'Remove nodes with in-degree 0.', ['order'], { caption: 'topological sort', name: 'tp' })],
        qs: [q('dag', 'A topological order exists only if the graph is…', ['Directed and acyclic.', 'A cycle would need every member to precede the others.'], [['Undirected.', 'Order needs direction.'], ['Connected.', 'Not required.']])] }),
      sec('summary', '6.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Lists for sparse, matrices for dense graphs.</li><li>BFS = queue, DFS = stack; MST by Kruskal or Prim; Dijkstra for non-negative weights.</li></ul>` }),
    ],
  })
}
