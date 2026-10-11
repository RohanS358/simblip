import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => {
  const k = run('graphalgo', { algo: 'kruskal' }), p = run('graphalgo', { algo: 'prim' }), b = run('graphalgo', { algo: 'bfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }), d = run('graphalgo', { algo: 'dfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }), t = run('graphalgo', { algo: 'topo', graph: 'a>b;a>c;b>d;c>d', start: 'a' })
  const dj = run('routing', { algo: 'dijkstra', source: 'u' })
  const cx = scr(`var t = create("table", { headers: "Algorithm;Time;Needs;Finds", data: ${JSON.stringify([['BFS', 'O(V + E)', 'queue', 'fewest-edge paths, levels'], ['DFS', 'O(V + E)', 'stack / recursion', 'cycles, components, topological order'], ['Kruskal', 'O(E log E)', 'sort + union–find', 'minimum spanning tree'], ['Prim', 'O(E log V)', 'priority queue', 'minimum spanning tree'], ['Dijkstra', 'O((V + E) log V)', 'priority queue', 'single-source shortest paths, w ≥ 0'], ['Bellman–Ford', 'O(V·E)', 'edge list', 'shortest paths, negative edges allowed'], ['Floyd–Warshall', 'O(V³)', 'matrix', 'all-pairs shortest paths'], ['Topological sort', 'O(V + E)', 'queue or DFS', 'order of a DAG']])}, summary: "None" });`, 'The same V and E appear in almost every graph bound; learn them as a set.', { caption: 'graph algorithms at a glance' })
  return lesson({
    title: 'Graphs: traversal, spanning trees, shortest paths',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 6',
    subtitle: 'Things and the links between them: maps, networks, dependencies. The chapter defines graphs, stores them, explores them with BFS and DFS, then finds minimum spanning trees, shortest paths and topological orders.',
    sections: [
      sec('what', '6.1', 'What a graph is and what it models', { eyebrow: 'Definitions',
        body: `<p>Trees describe hierarchies; graphs describe <em>anything connected</em>. Road maps (cities joined by roads), the internet (routers joined by links), social networks (people joined by friendship), a circuit (components joined by wires), the prerequisites of courses (course A must precede B) are all graphs. A ${term('graph')} G = (V, E) is a set of <b>vertices</b> (nodes) V and a set of <b>edges</b> E, each edge joining two vertices. Edges may be <b>undirected</b> (a road you can drive both ways) or <b>directed</b> (a one-way street, “A must precede B”), and may carry a <b>weight</b> (distance, cost, capacity).</p><p>The vocabulary again. Two vertices joined by an edge are <b>adjacent</b>. In an undirected graph the <b>degree</b> of a vertex is the number of edges at it; the <em>handshake lemma</em> says the degrees sum to twice the number of edges, because each edge has two ends. In a directed graph a vertex has an <b>in-degree</b> and an <b>out-degree</b>. A <b>path</b> is a sequence of vertices with an edge between each consecutive pair; its length is its number of edges (or the sum of the weights). A <b>cycle</b> is a path that returns to its start. A graph is <b>connected</b> if a path joins every pair of vertices; otherwise it splits into <b>connected components</b>. A <b>tree</b> is a connected graph with no cycles — exactly n − 1 edges. A <b>DAG</b> is a directed acyclic graph. A graph with few edges (E ≈ V) is <b>sparse</b>; one with many (E ≈ V²) is <b>dense</b>, and a <b>complete</b> graph has every pair joined (n(n − 1)/2 edges).</p>`,
        worked: [step('An undirected graph has 5 vertices with degrees 3, 3, 2, 2, 2. How many edges does it have?', '', { toc: 'Given' }), step('The degrees sum to twice the number of edges.', '3+3+2+2+2=12=2E', { toc: 'Handshake' }), step('So E = 6. (A complete graph on 5 vertices would have 5·4/2 = 10 edges.)', 'E=6', { hero: true, toc: 'Result' })],
        qs: [q('tree', 'Which description matches a tree?', ['A connected graph with no cycles (n − 1 edges).', 'Remove any edge and it disconnects; add any edge and it makes a cycle.'], [['A graph with no edges.', 'That is n isolated vertices, not connected.'], ['A graph where every vertex has degree 2.', 'That is a cycle (or a union of cycles).']]), q('handshake', 'A graph has 10 edges. What is the sum of all vertex degrees?', ['20.', 'Each edge contributes 1 to the degree of each of its two ends.'], [['10.', 'That counts each edge once.'], ['100.', 'No such relationship.']])],
        probs: [pr('p-complete', '<p>How many edges does a complete undirected graph on 8 vertices have? A complete directed graph (every ordered pair)?</p>', 'Undirected: 8·7/2 = <b>28</b>. Directed: 8·7 = <b>56</b>.')],
      }),

      sec('rep', '6.2', 'Storing a graph: matrix or list', { eyebrow: 'Representation',
        body: `<p>How do we put a graph in memory? The two standard answers trade space against speed. The ${term('adjacency matrix')} is a V × V table <code>A</code> where A[i][j] = 1 (or the weight) if there is an edge i → j and 0 otherwise; an undirected graph gives a symmetric matrix. Testing whether two vertices are adjacent is O(1), but the table needs V² cells whatever the number of edges, and listing a vertex’s neighbours costs O(V). The ${term('adjacency list')} keeps, for each vertex, a list of its neighbours (with weights); it needs only V + 2E entries (V + E for directed graphs), listing the neighbours of v costs only deg(v), and testing a particular edge costs O(deg).</p><p>Choose by density. Real-world graphs — road networks, the web, a social network — are sparse (each vertex touches a handful of others), so adjacency lists are the default and make the traversal algorithms run in O(V + E). The matrix wins for dense graphs, for algorithms that ask “is there an edge?” constantly, and for the matrix-multiplication-style algorithms (Floyd–Warshall). An <b>edge list</b> (a plain array of (u, v, w) triples) is the natural input for Kruskal’s algorithm.</p>`,
        worked: [step('A graph has 1000 vertices and 3000 undirected edges.', '', { toc: 'Given' }), step('Matrix: 1000² = 10⁶ cells. List: 1000 heads + 2·3000 list nodes = 7000 entries (undirected).', '10^6\\ \\text{vs}\\ 7000', { hero: true, toc: 'Space' }), step('The list is about 140 times smaller. For a complete graph (E ≈ V²/2) the two would be comparable and the matrix simpler.', '', { toc: 'Comparison' })],
        qs: [q('list', 'Which representation suits a sparse graph?', ['Adjacency list.', 'It stores only the edges that exist.'], [['Adjacency matrix.', 'It wastes n² space.'], ['Neither.', 'Both work; one is leaner.']]), q('edgetest', 'Which representation answers “is there an edge between u and v?” in O(1)?', ['The adjacency matrix.', 'Just read A[u][v].'], [['The adjacency list.', 'It must scan u’s neighbour list.'], ['The edge list.', 'It must scan all edges.']])],
        probs: [pr('p-rep', '<p>Write the adjacency list and the matrix for the undirected graph with edges A–B, A–C, B–D, C–D, D–E.</p>', 'List: A: B, C · B: A, D · C: A, D · D: B, C, E · E: D. Matrix (order A B C D E): A 01100, B 10010, C 10010, D 01101, E 00010.')],
      }),

      sec('bfs', '6.3', 'Breadth-first search', { eyebrow: 'Level by level',
        body: `<p>To explore a graph from a start vertex s, you need a rule for what to do next. ${term('Breadth-first search')} (BFS) visits s, then all of s’s neighbours, then all <em>their</em> unvisited neighbours, and so on — expanding like ripples in a pond. The tool is a <b>queue</b>: mark s visited and enqueue it; repeatedly dequeue a vertex u, process it, and for each unvisited neighbour v, mark it visited and enqueue it. Marking on <em>enqueue</em> (not dequeue) prevents a vertex from being added twice. Each vertex enters the queue once and each edge is examined once (twice if undirected), so BFS costs O(V + E) with adjacency lists.</p><p>BFS has a valuable property: it discovers each vertex by the path with the <em>fewest edges</em>, so recording each vertex’s parent when it is discovered yields shortest paths in an unweighted graph — the number of “hops”. It computes <b>levels</b> (distance from s), tests connectivity and bipartiteness (two-colourability), and powers “friends within three steps” queries. On the small graph A–B, A–C, B–D, C–D, D–E, BFS from A visits <b>${b.order}</b>: A first, then its neighbours B and C, then D, then E. The C++ program does the same on a matrix; the card animates the frontier.</p>`,
        figs: [lab('graphalgo', { algo: 'bfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }, 'Amber = frontier, green = visited.', ['order'], { caption: 'BFS', name: 'bfs' }), cpp(`#include <iostream>
#include <queue>
using namespace std;
int main() {
  int n = 5;
  int g[5][5] = {{0,1,1,0,0},{1,0,0,1,0},{1,0,0,1,0},{0,1,1,0,1},{0,0,0,1,0}};
  bool seen[5] = {false, false, false, false, false};
  queue<int> q;
  q.push(0);
  seen[0] = true;
  while (!q.empty()) {
    int u = q.front();
    q.pop();
    cout << u << " ";
    for (int v = 0; v < n; v++) {
      if (g[u][v] == 1 && !seen[v]) {
        seen[v] = true;
        q.push(v);
      }
    }
  }
  cout << endl;
  return 0;
}`, 'Vertices 0–4 are A–E; the output is the BFS order.', { output: '0 1 2 3 4' })],
        qs: [q('bfsq', 'Which data structure drives breadth-first search?', ['A queue.', 'First discovered is first explored, giving level order.'], [['A stack.', 'That gives DFS.'], ['A heap.', 'That is Dijkstra/Prim.']]), q('bfsshort', 'In an unweighted graph, BFS from s finds…', ['The path with the fewest edges to every reachable vertex.', 'Vertices are discovered in order of their distance from s.'], [['The path with the smallest total weight in any graph.', 'It ignores weights; use Dijkstra for that.'], ['Only whether s is connected to itself.', 'It reaches every connected vertex.']]), q('mark', 'Why does BFS mark a vertex visited when it is enqueued rather than when it is dequeued?', ['So a vertex adjacent to several already-queued vertices is not enqueued repeatedly.', 'Otherwise the queue could hold duplicates and the work could blow up.'], [['To save memory.', 'The saving is incidental.'], ['It makes no difference.', 'It changes the queue size and the work done.']])],
        probs: [pr('p-bfs', '<p>BFS from A on edges A–B, A–C, B–D, C–D, D–E (visit neighbours in alphabetical order). Give the visit order and the distance of each vertex from A.</p>', `Order: <b>${b.order}</b>. Distances: A 0; B, C 1; D 2; E 3.`)],
      }),

      sec('dfs', '6.4', 'Depth-first search', { eyebrow: 'Dive, then backtrack',
        body: `<p>${term('Depth-first search')} (DFS) explores as far as possible along one path before backing up — like walking a maze with a ball of string, always taking a new corridor and returning at a dead end. The code is recursion: mark u visited; for each neighbour v not yet visited, call DFS(v). The recursion stack is the stack ADT of Chapter 2 (an explicit stack gives an iterative version). The cost is the same O(V + E). From A on the same graph the order is <b>${d.order}</b> — A, then B, then B’s neighbour D, then D’s neighbour E (a dead end), then back to D, A, and C.</p><p>DFS discovers structure BFS does not. Run it from every unvisited vertex in turn and the number of times you start is the number of <b>connected components</b>. A <b>back edge</b> (an edge to an ancestor still being explored) reveals a <b>cycle</b>. Finishing times give a <b>topological order</b> of a DAG, and DFS is the engine behind strongly-connected-component algorithms and maze solving (backtracking). The programs show a matrix-based DFS and a component counter: a seven-vertex graph with edges 0–1, 1–2, 3–4 has four components ({0,1,2}, {3,4}, {5}, {6}).</p>`,
        figs: [lab('graphalgo', { algo: 'dfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }, 'DFS dives first.', ['order'], { caption: 'DFS', name: 'dfs' }), cpp(`#include <iostream>
using namespace std;
int n = 5;
int g[5][5] = {{0,1,1,0,0},{1,0,0,1,0},{1,0,0,1,0},{0,1,1,0,1},{0,0,0,1,0}};
bool seen[5] = {false, false, false, false, false};
void dfs(int u) {
  seen[u] = true;
  cout << u << " ";
  for (int v = 0; v < n; v++)
    if (g[u][v] == 1 && !seen[v]) dfs(v);
}
int main() {
  dfs(0);
  cout << endl;
  return 0;
}`, 'The recursion goes 0 → 1 → 3 → 2 (via 3), then 4.', { output: '0 1 3 2 4' }), cpp(`#include <iostream>
using namespace std;
int n = 7;
int g[7][7];
bool seen[7];
void dfs(int u) {
  seen[u] = true;
  for (int v = 0; v < n; v++)
    if (g[u][v] == 1 && !seen[v]) dfs(v);
}
int main() {
  for (int i = 0; i < 7; i++) {
    seen[i] = false;
    for (int j = 0; j < 7; j++) g[i][j] = 0;
  }
  g[0][1] = g[1][0] = 1;
  g[1][2] = g[2][1] = 1;
  g[3][4] = g[4][3] = 1;
  int comps = 0;
  for (int i = 0; i < n; i++)
    if (!seen[i]) { dfs(i); comps++; }
  cout << comps << endl;
  return 0;
}`, 'Each fresh start of dfs() is a new connected component.', { output: '4' })],
        qs: [q('dfsq', 'Which structure does depth-first search use (explicitly or via recursion)?', ['A stack.', 'The recursion stack holds the path being explored.'], [['A queue.', 'That gives BFS.'], ['A hash table.', 'Not needed.']]), q('cycle', 'During DFS of an undirected graph you meet an edge to an already-visited vertex that is not your parent. What does it show?', ['A cycle.', 'You have found a second route to a vertex already reached.'], [['A bridge.', 'A bridge is an edge whose removal disconnects, the opposite situation.'], ['The graph is a tree.', 'A tree has no such edge.']]), q('comp', 'How do you count the connected components of an undirected graph?', ['Start a traversal from each unvisited vertex; the number of starts is the number of components.', 'Each traversal covers exactly one component.'], [['Count the edges.', 'Edges do not give components.'], ['Run Dijkstra once.', 'Dijkstra reaches only one component.']])],
        probs: [pr('p-dfs', '<p>DFS from A on the graph A–B, A–C, B–D, C–D, D–E (neighbours in alphabetical order). Give the visit order.</p>', `<b>${d.order}</b>.`), pr('p-bfsdfs', '<p>Give one problem BFS solves better than DFS and one the reverse.</p>', 'BFS: shortest path in an unweighted graph (fewest edges). DFS: topological sort / cycle detection / maze backtracking (needs the full path, not the nearest).')],
      }),

      sec('mst', '6.5', 'Minimum spanning trees', { eyebrow: 'Cheapest connection',
        body: `<p>You must connect n towns by roads (or computers by cable) as cheaply as possible. Each possible road has a cost. You need the towns to be connected and no more roads than necessary: a cycle contains a redundant edge. The cheapest answer is a ${term('minimum spanning tree')} (MST): a spanning tree — a tree containing all V vertices, hence V − 1 edges — whose total edge weight is the least possible. It exists for every connected weighted graph, and is unique if all weights are distinct. Applications include network design, clustering, and approximations for travelling-salesman-like problems.</p><p>Two greedy algorithms find it. ${term('Kruskal’s algorithm')} thinks in <em>edges</em>: sort all edges by weight and go through them in order; add an edge unless it would form a cycle (its two ends are already connected). The cycle test uses <b>union–find</b> (disjoint sets): each vertex starts in its own set; an edge is accepted if its ends are in different sets, and then the sets merge. Cost O(E log E) for the sort. ${term('Prim’s algorithm')} thinks in <em>vertices</em>: start from any vertex, and repeatedly add the cheapest edge that connects the tree so far to a vertex outside it — like Dijkstra but comparing edge weights rather than path lengths. With a priority queue it costs O(E log V).</p><p>Why does greedy work here? The <b>cut property</b>: for any split of the vertices into two groups, the lightest edge crossing the split belongs to some MST. Both algorithms only ever add such an edge, so they cannot go wrong. On the textbook graph (nine vertices, fourteen edges) both give total weight <b>${k.weight}</b> using ${p.edges} edges (9 − 1 = 8). Step the cards: Kruskal marks the edges it rejects as cycle-formers, Prim grows from A.</p>`,
        figs: [lab('graphalgo', { algo: 'kruskal' }, 'Skipped edges would close a cycle.', ['weight'], { caption: 'Kruskal', name: 'kr' }), lab('graphalgo', { algo: 'prim', start: 'A' }, 'Prim grows outward from A.', ['weight'], { caption: 'Prim', name: 'pr' })],
        worked: [step('Edges of a small graph: A–B 4, A–C 1, B–C 2, B–D 5, C–D 8. Kruskal sorts by weight: A–C 1, B–C 2, A–B 4, B–D 5, C–D 8.', '', { toc: 'Sort' }), step('Take A–C (1), take B–C (2). A–B (4) would join A and B, which are already connected through C → reject. Take B–D (5): D is new.', '1+2+5', { toc: 'Select' }), step('Three edges for four vertices: the MST weight is 8.', 'W=8', { hero: true, toc: 'Weight' })],
        qs: [q('cyc', 'Why does Kruskal skip an edge whose ends are already connected?', ['Adding it would create a cycle, which a tree cannot have.', 'A cycle means one edge is redundant.'], [['It is too heavy.', 'Weight order already handled.'], ['It is directed.', 'Not relevant.']]), q('edges', 'How many edges does a spanning tree of a connected graph with 12 vertices have?', ['11.', 'A tree on V vertices has V − 1 edges.'], [['12.', 'That would contain a cycle.'], ['13.', 'No.']]), q('primkr', 'Which statement distinguishes Prim from Kruskal?', ['Prim grows a single tree from a start vertex; Kruskal merges a forest of components by globally cheapest edges.', 'Both produce an MST of the same total weight.'], [['Prim works only on dense graphs.', 'It works on any connected graph; the heap version is good for sparse ones.'], ['Kruskal needs a start vertex.', 'It does not; it sorts the edges.']])],
        probs: [pr('p-mst', '<p>Find the MST weight of the graph in the figure.</p>', `Both Kruskal and Prim give <b>${k.weight}</b>.`, { verify: lab('graphalgo', { algo: 'prim', start: 'A' }, 'Prim’s result.', ['weight'], { caption: 'answer', name: 'ans' }) }), pr('p-mstunique', '<p>If all edge weights are distinct, how many minimum spanning trees are there?</p>', 'Exactly <b>one</b>: with distinct weights the lightest edge across every cut is unique, so the greedy choices are forced.')],
      }),

      sec('sp', '6.6', 'Shortest paths: Dijkstra', { eyebrow: 'Weights',
        body: `<p>A satnav must find the cheapest route from where you are to everywhere else. In an unweighted graph BFS does it. With weights — distances, times, tolls — we need ${term('Dijkstra’s algorithm')} (1959), valid when <em>all weights are non-negative</em>. Keep a tentative distance <code>dist[v]</code> for every vertex (0 for the source, ∞ for the rest). Repeat: pick the unsettled vertex u with the smallest tentative distance — it is now <b>settled</b>, its distance is final — and <b>relax</b> each outgoing edge (u, v, w): if dist[u] + w &lt; dist[v], set dist[v] to it and remember u as v’s parent. After all vertices are settled, the parents trace the shortest-path tree back to the source.</p><p>Why is the settled distance final? When u has the smallest tentative distance among unsettled vertices, any other route to u must leave the settled set through some unsettled vertex, whose distance is already at least dist[u]; with non-negative edges the rest of that route cannot make it shorter. That argument breaks with a <b>negative edge</b>, and Dijkstra can then give wrong answers; <b>Bellman–Ford</b> handles negative weights by relaxing all edges V − 1 times in O(V·E), and detects negative cycles. With a simple array to find the minimum, Dijkstra costs O(V²); with a binary heap it costs O((V + E) log V). The card runs it on the textbook graph: from u, the shortest path to z is <b>${dj.path_z}</b> of length <b>${dj.d_z}</b>. The C++ program runs the O(V²) array version on a five-vertex graph and prints the final distances 0 7 3 9 5.</p>`,
        figs: [lab('routing', { algo: 'dijkstra', source: 'u' }, 'Dijkstra on the textbook graph.', ['d_z', 'path_z'], { caption: 'Dijkstra', name: 'dj' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int INF = 999;
  int w[5][5] = {{0,10,3,INF,INF},{INF,0,1,2,INF},{INF,4,0,8,2},{INF,INF,INF,0,7},{INF,INF,INF,9,0}};
  int dist[5] = {0, INF, INF, INF, INF};
  bool done[5] = {false, false, false, false, false};
  for (int it = 0; it < 5; it++) {
    int u = -1;
    for (int i = 0; i < 5; i++)
      if (!done[i] && (u == -1 || dist[i] < dist[u])) u = i;
    done[u] = true;
    for (int v = 0; v < 5; v++)
      if (w[u][v] < INF && dist[u] + w[u][v] < dist[v]) dist[v] = dist[u] + w[u][v];
  }
  for (int i = 0; i < 5; i++) cout << dist[i] << " ";
  cout << endl;
  return 0;
}`, 'Each pass settles the nearest vertex and relaxes its edges.', { output: '0 7 3 9 5' })],
        worked: [step('Source 0. Direct edges: 0→1 (10), 0→2 (3). Settle the nearest: vertex 2 at distance 3.', '', { toc: 'Settle 2' }), step('Relax from 2: to 1 it is 3 + 4 = 7 &lt; 10; to 4 it is 3 + 2 = 5; to 3 it is 3 + 8 = 11.', 'dist=[0,7,3,11,5]', { toc: 'Relax' }), step('Next nearest is 4 (5): relax 4→3: 5 + 9 = 14 &gt; 11, no change. Then 1 (7): 1→3 is 7 + 2 = 9 &lt; 11. Final distances:', '[0,7,3,9,5]', { hero: true, toc: 'Final' })],
        qs: [q('neg', 'Dijkstra can fail when…', ['an edge has negative weight.', 'A settled vertex might later be reachable more cheaply through a negative edge.'], [['The graph is undirected.', 'It works on undirected graphs.'], ['The graph is large.', 'Size only affects speed.']]), q('relax', 'What does “relaxing” the edge (u, v, w) mean?', ['If dist[u] + w is smaller than the current dist[v], update dist[v] to the smaller value.', 'It improves the best-known route to v by going through u.'], [['Removing the edge from the graph.', 'Relaxation changes distances, not edges.'], ['Doubling the weight.', 'Not what it means.']]), q('dijcost', 'What data structure makes Dijkstra O((V + E) log V)?', ['A binary-heap priority queue to find the nearest unsettled vertex.', 'Without it the array scan costs O(V²).'], [['A stack.', 'A stack cannot find the minimum.'], ['A hash table.', 'Not suited to finding the minimum.']])],
        probs: [pr('p-dij', '<p>Run Dijkstra by hand on vertices A, B, C, D with edges A–B 1, A–C 4, B–C 2, B–D 6, C–D 3 from A. Give the final distances.</p>', 'A 0. Settle A: B = 1, C = 4. Settle B (1): C = min(4, 1 + 2) = 3, D = 1 + 6 = 7. Settle C (3): D = min(7, 3 + 3) = 6. Final: <b>A 0, B 1, C 3, D 6</b>.')],
      }),

      sec('allpairs', '6.7', 'All-pairs shortest paths and transitive closure', { eyebrow: 'Floyd and Warshall',
        body: `<p>Sometimes you need the shortest distance between <em>every</em> pair of vertices — a table of flight costs between all airports. Running Dijkstra from each vertex works, but the ${term('Floyd–Warshall')} algorithm does it with a compact triple loop and handles negative edges (but not negative cycles). Define d[i][j] as the shortest known distance from i to j, initially the edge weight (0 on the diagonal, ∞ if no edge). Then, for each possible <b>intermediate vertex k</b> in turn, ask whether going through k helps: d[i][j] = min(d[i][j], d[i][k] + d[k][j]). After k has taken every value, d holds the true shortest distances. Three nested loops over V: O(V³) time, O(V²) space. The order of the loops matters — <em>k must be the outermost</em>.</p><p>Replace min and + by OR and AND and the same loop computes ${term('transitive closure')} (Warshall’s algorithm): reach[i][j] = reach[i][j] OR (reach[i][k] AND reach[k][j]) — is there <em>any</em> path from i to j? The program runs Floyd–Warshall on a four-vertex directed graph; look at the first row: from vertex 0 the best route to vertex 2 is 5, via vertex 1 (3 + 2), and to vertex 3 is 6 (via 1 and 2).</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int INF = 999;
  int d[4][4] = {{0, 3, INF, 7}, {8, 0, 2, INF}, {5, INF, 0, 1}, {2, INF, INF, 0}};
  for (int k = 0; k < 4; k++)
    for (int i = 0; i < 4; i++)
      for (int j = 0; j < 4; j++)
        if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4; j++) cout << d[i][j] << " ";
    cout << endl;
  }
  return 0;
}`, 'Rows are sources, columns destinations; every entry is now the shortest distance.', { output: '0 3 5 6 \n5 0 2 3 \n3 6 0 1 \n2 5 7 0' })],
        qs: [q('floyd', 'In Floyd–Warshall, which loop must be outermost?', ['The loop over the intermediate vertex k.', 'Each pass allows paths through one more intermediate vertex; reversing the order breaks the argument.'], [['The loop over the source i.', 'That is not the standard correct order.'], ['The loop over the destination j.', 'That is not the standard correct order.']]), q('fwcost', 'What is the time complexity of Floyd–Warshall on V vertices?', ['O(V³).', 'Three nested loops over V vertices.'], [['O(V²).', 'That would need a smarter algorithm.'], ['O(V + E).', 'That is BFS/DFS.']])],
        probs: [pr('p-fw', '<p>When is running Dijkstra from every vertex better than Floyd–Warshall?</p>', 'On a sparse graph: V runs of O((V + E) log V) total O(V(V + E) log V), which beats O(V³) when E is much smaller than V². Floyd–Warshall is simpler and handles negative edges, so it suits dense graphs or small V.')],
      }),

      sec('topo', '6.8', 'Topological sort', { eyebrow: 'Dependencies',
        body: `<p>Getting dressed has constraints: socks before shoes, trousers before belt. A <b>topological order</b> of a directed acyclic graph lists all vertices so that for every edge u → v, u comes before v. It is the schedule for build systems (compile this file before that), course prerequisites, spreadsheet recalculation and task planning. It exists if and only if the graph has <b>no directed cycle</b> — a cycle of dependencies cannot be satisfied — and there may be many valid orders.</p><p><b>Kahn’s algorithm</b> peels the graph: compute every vertex’s in-degree; put all vertices of in-degree 0 in a queue; repeatedly remove a vertex from the queue, output it, and decrement the in-degree of its successors, enqueuing any that reach 0. If the output has fewer vertices than the graph, the rest lie on a cycle. Cost O(V + E). The DFS-based alternative outputs vertices in <em>reverse finishing order</em>. For a→b, a→c, b→d, c→d one order is <b>${t.order}</b> (a first because it has no prerequisite, d last because it needs both b and c; b and c may swap).</p>`,
        figs: [lab('graphalgo', { algo: 'topo', graph: 'a>b;a>c;b>d;c>d', start: 'a' }, 'Remove nodes with in-degree 0.', ['order'], { caption: 'topological sort', name: 'tp' })],
        qs: [q('dag', 'A topological order exists only if the graph is…', ['Directed and acyclic.', 'A cycle would need every member to precede the others.'], [['Undirected.', 'Order needs direction.'], ['Connected.', 'Not required.']]), q('kahn', 'In Kahn’s algorithm, which vertices go into the queue first?', ['Those with in-degree 0 (no prerequisites).', 'They can be placed first without violating any edge.'], [['Those with out-degree 0.', 'They are the last ones.'], ['The vertex with the most edges.', 'Degree count is not the criterion.']]), q('cycdet', 'Kahn’s algorithm outputs only 3 of 5 vertices. What does this tell you?', ['The graph contains a directed cycle among the remaining vertices.', 'Their in-degrees never reach 0.'], [['The graph is disconnected.', 'Disconnected DAGs are still fully sorted.'], ['The algorithm has a bug.', 'It is a feature: it detects cycles.']])],
        probs: [pr('p-topo', '<p>Give a topological order of: shirt→tie, tie→jacket, trousers→belt, trousers→shoes, belt→jacket, socks→shoes.</p>', 'One valid order: <b>shirt, trousers, socks, tie, belt, shoes, jacket</b> (every edge goes left to right). Many others are valid.')],
      }),

      sec('summary', '6.9', 'Summary', { eyebrow: 'Recap', figs: [cx], body: `<ul><li>A graph is vertices plus edges (directed/undirected, weighted); degrees sum to 2E; a tree is a connected acyclic graph with V − 1 edges.</li><li>Store sparse graphs as adjacency lists (V + E), dense ones as matrices (V²).</li><li>BFS (queue) gives fewest-edge paths; DFS (stack/recursion) gives components, cycles and topological order; both O(V + E).</li><li>MST: Kruskal (sort edges + union–find) or Prim (grow a tree), justified by the cut property.</li><li>Shortest paths: Dijkstra for non-negative weights (heap: O((V + E) log V)), Bellman–Ford for negatives, Floyd–Warshall for all pairs in O(V³).</li><li>Topological sort needs a DAG; Kahn’s algorithm detects cycles.</li></ul>` }),
    ],
  })
}
