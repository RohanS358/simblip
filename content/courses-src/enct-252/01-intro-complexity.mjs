import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => {
  const b = run('sorting', { algo: 'bubble', values: '5 1 4 2 8' }), m = run('sorting', { algo: 'merge', values: '5 1 4 2 8' })
  const lg = (n) => Math.log2(n)
  const growth = scr(`var t = create("table", { headers: "n;log n;n;n log n;n²;2ⁿ", data: ${JSON.stringify([10, 20, 50, 100, 1000].map((n) => [String(n), lg(n).toFixed(1), String(n), (n * lg(n)).toFixed(0), String(n * n), n <= 50 ? (2 ** n).toExponential(2) : '≈ 10^' + Math.floor(n * Math.log10(2))]))}, summary: "None" });`, 'At n = 100 the first four columns are trivial and 2ⁿ is more than the number of atoms you could count in a lifetime.', { caption: 'how the standard functions grow' })
  const feasible = scr(`var t = create("table", { headers: "Algorithm;n = 10³;n = 10⁶;n = 10⁹", data: ${JSON.stringify([['O(log n)', '10 ns', '20 ns', '30 ns'], ['O(n)', '1 µs', '1 ms', '1 s'], ['O(n log n)', '10 µs', '20 ms', '30 s'], ['O(n²)', '1 ms', '17 min', '32 years'], ['O(2ⁿ)', '≈ 3×10²⁸⁴ years', '—', '—']])}, summary: "None" });`, 'Assuming 10⁹ simple operations per second. Quadratic algorithms stop being usable somewhere around n = 10⁵.', { caption: 'what a billion operations a second buys' })
  return lesson({
    title: 'Data structures, ADTs and algorithm analysis',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 1',
    subtitle: 'Choose how to store data, and know how the cost of working with it grows. This chapter builds the vocabulary — structure, ADT, algorithm, Big-O, recurrence, amortised cost — that every later chapter uses.',
    sections: [
      sec('why', '1.1', 'Why structure matters', { eyebrow: 'The idea',
        body: `<p>Every program does two things: it <em>stores</em> data and it <em>computes</em> on it. How the data is arranged decides how hard the computing is. Imagine a phone book. Arranged alphabetically, you find “Sharma” by opening in the middle and halving the search, about ten steps for a thousand names. Arranged in the order people were added, you would have to read every entry. The information is identical; only the structure differs, and the difference between ten steps and a thousand is the whole subject of this course.</p><p>A ${term('data structure')} is a way of organising data in memory so that the operations you need are cheap. An array gives instant access by index but costly insertion in the middle; a linked list inserts cheaply at a known place but finds slowly; a hash table finds almost instantly but keeps no order; a balanced tree does everything in logarithmic time and keeps order. No structure wins every operation — choosing one is choosing which operations you want to be fast.</p><p>Separate from <em>how</em> data is stored is <em>what you can do</em> with it. An ${term('abstract data type')} (ADT) is a specification: a set of values and the operations on them, with their meaning, but no mention of memory layout. A <b>stack</b> is an ADT — push, pop, peek, “last in, first out” — and it can be implemented on an array or on a linked list without any user of the stack noticing. That separation is the same one you met in operating systems (abstraction hides implementation) and in object-oriented programming (a class exposes an interface). Data structures are the <em>implementations</em>; ADTs are the <em>contracts</em>.</p>`,
        figs: [dia(`direction: right
[Array: O(1) index, O(n) insert] as a #blue
[Linked list: O(1) insert at head, O(n) search] as l #mint
[Hash table: O(1) average search] as h #amber
[Balanced tree: O(log n) everything, ordered] as t #violet
a -> l : trade
l -> h : trade
h -> t : trade`, 'No structure wins every operation.', { caption: 'trade-offs' })],
        qs: [q('adt', 'What is an ADT?', ['A specification of operations, independent of implementation.', 'A stack can be built on an array or on a linked list without changing its users.'], [['A specific array layout.', 'That is an implementation.'], ['A C++ class only.', 'The idea is language-independent.']]), q('which', 'You need to look up records by key very often and never need them in order. Which structure is the natural first choice?', ['A hash table.', 'Average O(1) search; the lack of ordering does not matter for this workload.'], [['A sorted linked list.', 'Search is O(n) on a linked list, even when sorted.'], ['An unsorted array.', 'Search would be O(n).']])],
      }),

      sec('classes', '1.2', 'Kinds of data structure', { eyebrow: 'A map of the subject',
        body: `<p>Structures are sorted in a few overlapping ways. By construction: <b>primitive</b> types (int, char, float, pointer) are built into the language; <b>non-primitive</b> structures are built from them. Non-primitive structures split into <b>linear</b> ones, where elements form a sequence and each (except the ends) has one predecessor and one successor — arrays, linked lists, stacks, queues — and <b>non-linear</b> ones, where an element may relate to many others — trees and graphs. By memory: <b>static</b> structures have a fixed size decided at compile time (a plain array); <b>dynamic</b> ones grow and shrink at run time (linked list, vector). By storage: <b>contiguous</b> (array: neighbours in memory) or <b>linked</b> (nodes anywhere, joined by pointers).</p><p>The rest of this course walks the map in order: stack and recursion (Chapter 2), queues and lists (3–4), trees (5), graphs (6), then the two big algorithmic topics that use these structures — sorting (7) and searching and hashing (8). Each chapter builds the structure, analyses its operations with the notation of this chapter, and then shows an algorithm that depends on it.</p>`,
        qs: [q('linear', 'Which of these is a non-linear data structure?', ['A tree.', 'Nodes may have several children, so elements do not form a single sequence.'], [['A queue.', 'A queue is linear: elements form a line.'], ['An array.', 'An array is linear.']])],
      }),

      sec('algo', '1.3', 'What an algorithm is', { eyebrow: 'Definition',
        body: `<p>An ${term('algorithm')} is a finite sequence of well-defined steps that solves a problem. Five properties are required. <b>Input</b>: zero or more values supplied from outside. <b>Output</b>: at least one result. <b>Definiteness</b>: each step is precise and unambiguous (“add 1 to x”, not “improve x”). <b>Finiteness</b>: for every input it terminates after a finite number of steps. <b>Effectiveness</b>: each step can be carried out in finite time with pencil and paper. A recipe that says “stir until nice” fails definiteness; a loop with a condition that never becomes false fails finiteness.</p><p>An algorithm is not a program. The same algorithm — binary search — can be written in C++, Python or pseudocode; the program is one way of expressing it. We therefore describe algorithms in <b>pseudocode</b> (structured English with loops and conditions) or as <b>flowcharts</b> and then analyse the idea, not the language.</p>`,
        qs: [q('finite', 'A procedure that sometimes loops forever is missing which property of an algorithm?', ['Finiteness.', 'An algorithm must terminate after finitely many steps for every valid input.'], [['Input.', 'Input is about what it receives, not termination.'], ['Output.', 'Output is the result; failing to terminate is a different failure.']])],
      }),

      sec('design', '1.4', 'Algorithm design techniques', { eyebrow: 'Strategies',
        body: `<p>Algorithms are rarely invented from nothing; they come from a small toolbox of strategies. ${term('Brute force')} tries every possibility — correct and easy, often hopeless for large inputs. ${term('Divide and conquer')} splits the problem into smaller copies of itself, solves each (usually recursively) and combines the answers — merge sort, quick sort, binary search. ${term('Greedy')} algorithms build a solution by always taking the best-looking local choice and never reconsidering — Huffman coding, Kruskal’s and Prim’s spanning trees, Dijkstra’s shortest path; they are fast but correct only when the problem has the right structure. ${term('Dynamic programming')} solves overlapping subproblems once and stores the answers (Fibonacci, shortest paths between all pairs, knapsack). ${term('Backtracking')} builds a solution step by step and undoes the last step when it hits a dead end (N-queens, maze solving); ${term('branch and bound')} adds pruning by a bound on the best possible result. ${term('Randomised')} algorithms use random choices (random pivot in quick sort) to avoid bad worst cases.</p><p>Recognising which strategy a problem fits is half the skill of an algorithm designer. As a rule of thumb: if the problem splits into independent halves, think divide and conquer; if subproblems repeat, think dynamic programming; if a local best choice can be proved safe, think greedy; if nothing else works and the input is small, brute force with pruning.</p>`,
        qs: [q('dc', 'Merge sort is an example of…', ['Divide and conquer.', 'It splits the array, sorts the halves, and merges.'], [['Greedy.', 'No local best choice is committed to.'], ['Brute force.', 'That would try all permutations.']]), q('greedy', 'What risk does a greedy algorithm carry?', ['It may not give an optimal answer unless the problem has the greedy-choice property.', 'A locally best choice can lock you out of the global optimum (e.g. coin change with odd denominations).'], [['It always takes exponential time.', 'Greedy algorithms are usually fast.'], ['It cannot be implemented recursively.', 'That has nothing to do with the strategy.']])],
        probs: [pr('p-strat', '<p>Name the design technique used by (a) binary search, (b) Huffman coding, (c) the N-queens solver that retreats from dead ends.</p>', '(a) <b>Divide and conquer</b> (halve the range each step). (b) <b>Greedy</b> (always merge the two lightest trees). (c) <b>Backtracking</b>.')],
      }),

      sec('analysis', '1.5', 'Measuring an algorithm: counting, not timing', { eyebrow: 'Analysis',
        body: `<p>How do we compare two algorithms? Timing them is unreliable — it depends on the machine, the compiler, the language and what else is running. Instead we count how many basic operations the algorithm performs as a function of the input size <i>n</i>, in an idealised <b>RAM model</b>: every elementary operation (assignment, comparison, arithmetic, array access) takes one unit of time. The result is a function T(n), and what matters is how it <em>grows</em>. If doubling n doubles T, the algorithm scales linearly; if doubling n quadruples T, it scales quadratically.</p><p>The cards below count real operations. Bubble sort on 5 1 4 2 8 makes <b>${b.comparisons}</b> comparisons and <b>${b.moves}</b> swaps; merge sort makes <b>${m.comparisons}</b> comparisons. On five numbers the difference is small. The point of analysis is to predict what happens at five million, where one grows as n² and the other as n log n.</p>`,
        figs: [lab('sorting', { algo: 'bubble', values: '5 1 4 2 8' }, 'Counters at the bottom are the “cost”.', ['comparisons', 'moves'], { caption: 'bubble sort', name: 'bub' }), lab('sorting', { algo: 'merge', values: '5 1 4 2 8' }, 'Merge sort does fewer comparisons as n grows.', ['comparisons'], { caption: 'merge sort', name: 'mer' })],
        qs: [q('why-count', 'Why do we count operations instead of measuring seconds?', ['Counts are independent of the machine and language, so they describe the algorithm itself.', 'Wall-clock time mixes the algorithm with hardware, compiler and load.'], [['Because timers are inaccurate.', 'Timers are fine for benchmarking; the point is portability of the conclusion.'], ['Because counting is easier to program.', 'The reason is generality, not convenience.']])],
      }),

      sec('best', '1.6', 'Best, worst and average case', { eyebrow: 'Which input?',
        body: `<p>The cost of an algorithm often depends on <em>which</em> input of size n it receives. Linear search for a value in an array stops at the first match, so it needs 1 comparison if the target is first (<b>best case</b>), n if it is last or absent (<b>worst case</b>), and on average about half. The <b>worst case</b> is the one analysts quote by default, because it is a guarantee: no input can make the algorithm slower. The <b>best case</b> is rarely informative (every sorting algorithm is fast on already-sorted data in some way). The <b>average case</b> needs an assumption about the distribution of inputs, usually “all equally likely”, and is harder to compute but often more representative — quick sort is O(n²) in the worst case yet O(n log n) on average, which is why it is used everywhere.</p>`,
        worked: [step('Linear search in an array of n distinct elements. The target is equally likely to be at any of the n positions. Position i needs i comparisons.', '', { toc: 'Setup' }), step('Average comparisons = (1 + 2 + … + n) / n.', '\\tfrac1n\\sum_{i=1}^{n}i=\\tfrac1n\\cdot\\tfrac{n(n+1)}{2}', { toc: 'Average' }), step('Simplify.', '\\tfrac{n+1}{2}', { hero: true, toc: 'Result' }), step('For n = 8 that is 4.5 comparisons on average, against 8 in the worst case — both are Θ(n).', '', { toc: 'Example' })],
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a[8] = {9, 4, 7, 1, 8, 2, 6, 3};
  int target = 8, cmp = 0, pos = -1;
  for (int i = 0; i < 8; i++) {
    cmp++;
    if (a[i] == target) { pos = i; break; }
  }
  cout << pos << " " << cmp << endl;
  return 0;
}`, 'Step through: the target 8 is at index 4, found after 5 comparisons.', { output: '4 5' })],
        qs: [q('wc', 'Why is the worst case the default thing to quote?', ['It is a guarantee: no input can make the algorithm slower.', 'Average cases depend on assumptions about the input distribution.'], [['Because the worst case is the most common.', 'It is often rare; it is quoted as a bound.'], ['Because it is easiest to compute.', 'Sometimes it is, but the reason is the guarantee.']])],
        probs: [pr('p-avg', '<p>Linear search in 1000 elements: how many comparisons in the best, worst and (assuming a present, uniformly placed target) average case?</p>', 'Best <b>1</b>; worst <b>1000</b>; average (1000 + 1)/2 = <b>500.5</b>.')],
      }),

      sec('big', '1.7', 'Asymptotic notation: O, Ω, Θ', { eyebrow: 'The language of growth',
        body: `<p>We now make “grows like” precise. We care about behaviour for large n and ignore constant factors (different machines change them) and lower-order terms (they are swamped). ${term('Big-O')} gives an <em>upper</em> bound: f(n) = O(g(n)) if there are constants c &gt; 0 and n₀ such that f(n) ≤ c·g(n) for all n ≥ n₀. ${term('Big-Omega')} gives a <em>lower</em> bound: f(n) = Ω(g(n)) if f(n) ≥ c·g(n) for large n. ${term('Big-Theta')} is both: f(n) = Θ(g(n)) when f is squeezed between two constant multiples of g — the tight bound. Little-o and little-ω say “strictly smaller” and “strictly larger”.</p><p>A few rules make this mechanical. Drop constants: 5n = O(n). Keep the dominant term: n² + n log n + 100 = O(n²). Sum: O(f) + O(g) = O(max(f, g)). Product: O(f)·O(g) = O(f·g). A sequence of two code blocks costs the larger; nested blocks multiply. Limit test: if lim f(n)/g(n) is finite, f = O(g); if it is a positive constant, f = Θ(g); if it is 0, f = o(g). Beware the common confusion: Big-O is an <em>upper bound</em>, not “the worst case” — you can say the best case is O(n) too. And O(n²) is a true statement about linear search (it is also O(n)), just a loose one; the tight claim is Θ(n).</p><p>The order of the standard functions, slowest-growing first: 1 &lt; log n &lt; √n &lt; n &lt; n log n &lt; n² &lt; n³ &lt; 2ⁿ &lt; n!. The table shows how fast they separate; the second shows what that means in wall-clock time at a billion operations a second.</p>`,
        figs: [growth, feasible],
        worked: [step('Show 3n² + 5n + 20 = O(n²): choose c and n₀ with 3n² + 5n + 20 ≤ c·n² for n ≥ n₀.', '', { toc: 'Goal' }), step('For n ≥ 1: 5n ≤ 5n² and 20 ≤ 20n², so the sum is at most 28n².', '3n^2+5n+20\\le 28n^2\\quad(n\\ge1)', { hero: true, toc: 'Witness c = 28, n₀ = 1' }), step('Now show 3n² + 5n + 20 = Ω(n²): trivially 3n² + 5n + 20 ≥ 3n² for all n ≥ 0, so c = 3 works. Both bounds hold, hence the function is Θ(n²).', '3n^2\\le 3n^2+5n+20\\le28n^2', { toc: 'Lower bound' }), step('Disproof by contradiction: is n³ = O(n²)? It would need n³ ≤ c·n², i.e. n ≤ c for all large n — impossible for any constant c.', 'n\\le c\\ \\text{for all } n\\ge n_0\\ \\text{is false}', { toc: 'n³ is not O(n²)' })],
        qs: [q('dom', 'Simplify 3n² + 5n + 20 to Big-O.', ['O(n²).', 'For large n the n² term dominates; constants are dropped.'], [['O(n).', 'The n² term grows faster.'], ['O(3n²).', 'Constants are not written.']]), q('theta', 'f(n) = 4n + 7 is O(n²). Is it Θ(n²)?', ['No — it is Θ(n); n² is a valid but loose upper bound.', 'Θ needs a matching lower bound, and 4n + 7 is not Ω(n²).'], [['Yes, because n² ≥ 4n + 7 for large n.', 'That shows only O; Θ also needs the lower bound.'], ['Yes, all linear functions are Θ(n²).', 'Linear functions are Θ(n).']]), q('bigoworst', 'A student says “Big-O means worst case”. What is wrong?', ['Big-O is an upper bound on a function; it can describe the best, average or worst case of an algorithm, each with its own function.', 'Case analysis and asymptotic notation are separate ideas.'], [['Nothing; it is exactly right.', 'They are different concepts, though often combined.'], ['Big-O is a lower bound.', 'That is Big-Omega.']]), q('order', 'Which grows fastest as n becomes large?', ['2ⁿ.', 'Exponential growth overtakes any polynomial.'], [['n³.', 'Polynomial.'], ['n log n.', 'Slower than any polynomial of degree 2.']])],
        probs: [pr('p-big', '<p>Order these from slowest- to fastest-growing: n², 2ⁿ, n log n, log n, n, n!, √n.</p>', 'log n &lt; √n &lt; n &lt; n log n &lt; n² &lt; 2ⁿ &lt; n!.'), pr('p-prove', '<p>Prove that 7n + 3 = O(n) by giving c and n₀.</p>', 'For n ≥ 1, 3 ≤ 3n, so 7n + 3 ≤ 10n. Take <b>c = 10, n₀ = 1</b>.'), pr('p-sum', '<p>What is the order of n² log n + 50n² + 10n³?</p>', 'The dominant term is 10n³, so <b>O(n³)</b>.')],
      }),

      sec('loops', '1.8', 'Analysing loops and code', { eyebrow: 'Practice',
        body: `<p>To analyse a piece of code, count how often its innermost statement runs. The rules are simple. A statement is O(1). A <b>sequence</b> costs the sum, which is the larger term. A single loop to n with an O(1) body is O(n). <b>Nested loops</b> multiply: two loops to n give O(n²). A loop whose counter <b>doubles or halves</b> (<code>i *= 2</code>, <code>n /= 2</code>) runs about log₂ n times, because that is how many doublings it takes to reach n. A loop whose inner bound depends on the outer variable needs a sum: <code>for i … for j = i+1 …</code> runs 1 + 2 + … + (n − 1) = n(n − 1)/2 times — still O(n²), because the sum of the first n integers is quadratic. Run each program: the DSA Lab counts the iterations.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int n = 5, count = 0;
  for (int i = 0; i < n; i++)
    for (int j = i + 1; j < n; j++)
      count++;
  cout << count << endl;
  return 0;
}`, 'Pairs (i < j): 4 + 3 + 2 + 1 = 10 = n(n−1)/2.', { output: '10' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int n = 1000, steps = 0;
  while (n > 1) {
    n = n / 2;
    steps++;
  }
  cout << steps << endl;
  return 0;
}`, 'Halving 1000 takes 9 steps: ⌊log₂ 1000⌋.', { output: '9' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int n = 16, count = 0;
  for (int i = 1; i < n; i *= 2) {
    count++;
  }
  cout << count << endl;
  return 0;
}`, 'The loop runs log₂16 = 4 times.', { output: '4' })],
        worked: [step('Analyse: <code>for (i = 1; i &lt;= n; i++) for (j = 1; j &lt;= i; j++) c++;</code>. The inner loop runs i times for each i.', '', { toc: 'Setup' }), step('Total iterations is the sum 1 + 2 + … + n.', '\\sum_{i=1}^{n}i=\\tfrac{n(n+1)}{2}', { toc: 'Sum' }), step('Which is Θ(n²); for n = 4 the count is 10.', '\\Theta(n^2)', { hero: true, toc: 'Order' })],
        qs: [q('log', 'for (i = 1; i < n; i *= 2) runs how many times?', ['About log₂ n.', 'The counter doubles, so it needs log₂ n steps to reach n.'], [['n times.', 'That needs i++.'], ['n/2 times.', 'That is i += 2.']]), q('nested', 'for (i = 0; i < n; i++) for (j = 0; j < n; j *= 2)… (assume j starts at 1). What is the complexity?', ['O(n log n).', 'The outer loop runs n times and the inner loop runs about log n times.'], [['O(n²).', 'The inner loop is logarithmic, not linear.'], ['O(log n).', 'The outer loop still runs n times.']])],
        probs: [pr('p1', '<p>What is the complexity of two nested loops, each from 1 to n, with the inner body O(1)?</p>', 'n × n = <b>O(n²)</b>.'), pr('p2', '<p>A loop <code>for (i = n; i &gt; 0; i /= 2)</code> — complexity?</p>', 'The counter halves each time: <b>O(log n)</b>.'), pr('p-three', '<p>Give the complexity of: a loop to n containing a call to a function that itself loops to n, followed by a separate loop to n².</p>', 'First part n × n = n², then n²: total n² + n² = <b>O(n²)</b>.')],
      }),

      sec('recur', '1.9', 'Recurrences: analysing recursive algorithms', { eyebrow: 'Recursion',
        body: `<p>A recursive algorithm’s cost is described by a <b>recurrence</b>: T(n) is expressed in terms of T on smaller inputs. Binary search does one comparison and recurses on half: T(n) = T(n/2) + 1. Merge sort sorts two halves and merges in linear time: T(n) = 2T(n/2) + n. A naive Fibonacci calls itself on n − 1 and n − 2: T(n) = T(n − 1) + T(n − 2) + 1, which grows exponentially. Three tools solve them. <b>Substitution</b> guesses the answer and proves it by induction. The <b>recursion tree</b> draws the calls level by level and sums the work per level. The <b>master theorem</b> handles the divide-and-conquer form T(n) = aT(n/b) + f(n): compare f(n) with n^{log_b a}. If f is smaller, T = Θ(n^{log_b a}); if equal, T = Θ(n^{log_b a} log n); if larger (and regular), T = Θ(f).</p>`,
        deriv: [
          step('Binary search: each call does constant work and halves the interval. Unroll the recurrence k times.', 'T(n)=T(n/2)+1=T(n/4)+2=\\dots=T(n/2^{k})+k', { toc: 'Unroll' }),
          step('The recursion ends when the interval has size 1, i.e. when n/2^k = 1, so k = log₂ n.', '2^{k}=n\\Rightarrow k=\\log_2 n', { toc: 'When it stops' }),
          step('Substitute k: T(n) = T(1) + log₂ n.', 'T(n)=O(\\log n)', { hero: true, toc: 'Result' }),
          step('Merge sort via the recursion tree: level 0 does n work; level 1 has two subproblems of n/2 each, again n in total; every one of the log₂ n levels does n work.', 'T(n)=2T(n/2)+n:\\ n\\cdot\\log_2 n', { toc: 'Merge sort tree' }),
          step('Master theorem check: a = 2, b = 2, so n^{log_2 2} = n, which equals f(n) = n; the middle case gives Θ(n log n).', '\\Theta(n\\log n)', { hero: true, toc: 'Master theorem' }),
        ],
        worked: [step('Solve T(n) = 4T(n/2) + n using the master theorem.', 'a=4,\\ b=2,\\ f(n)=n', { toc: 'Parameters' }), step('Compare f(n) = n with n^{log₂ 4} = n².', 'n < n^{2}', { toc: 'Compare' }), step('f is polynomially smaller, so the leaves dominate.', 'T(n)=\\Theta(n^{2})', { hero: true, toc: 'Answer' })],
        qs: [q('rec1', 'The recurrence T(n) = T(n/2) + 1 describes which algorithm and what is its order?', ['Binary search; O(log n).', 'Halving the problem with constant work per level gives log₂ n levels.'], [['Linear search; O(n).', 'Linear search is T(n) = T(n − 1) + 1.'], ['Merge sort; O(n log n).', 'Merge sort has 2T(n/2) + n.']]), q('rec2', 'T(n) = T(n − 1) + 1 has the solution…', ['Θ(n).', 'It unrolls to n additions of 1.'], [['Θ(log n).', 'That needs halving.'], ['Θ(2ⁿ).', 'That needs two recursive calls.']])],
        probs: [pr('p-master', '<p>Solve T(n) = 2T(n/2) + 1 and T(n) = 2T(n/2) + n². Which case of the master theorem applies?</p>', 'First: n^{log₂2} = n beats f = 1 → <b>Θ(n)</b> (leaves dominate). Second: f = n² is larger than n → <b>Θ(n²)</b> (the root dominates).'), pr('p-fib', '<p>Why is the naive recursive Fibonacci exponential?</p>', 'T(n) = T(n − 1) + T(n − 2) + 1 makes two overlapping calls each time; the call tree roughly doubles at each level, giving about φⁿ ≈ 1.618ⁿ calls. The same subproblems are recomputed many times (a case for dynamic programming).')],
      }),

      sec('amort', '1.10', 'Amortised analysis: the cost of many operations together', { eyebrow: 'Averaging over a sequence',
        body: `<p>Worst-case analysis can be pessimistic when an expensive operation is rare. Consider a <b>dynamic array</b> (C++ <code>vector</code>): adding an element is O(1) when there is room, but when the array is full it must allocate a bigger one and copy every element, costing O(n). Is each <code>push_back</code> then O(n)? Not on average. If the capacity doubles each time it fills, the expensive copies happen at sizes 1, 2, 4, 8, … and the total copying over n insertions is 1 + 2 + 4 + … + n/2 &lt; n. So n insertions cost O(n) in total — O(1) <b>amortised</b> per insertion. Amortised cost is the <em>average over the worst-case sequence</em>, not a probabilistic average: it is a guarantee about any sequence of operations.</p><p>Run the program: 100 insertions into an array that starts with capacity 1 and doubles. The final capacity is 128 and the total number of elements copied is 127 — barely more than one copy per insertion.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int size = 0, cap = 1, copies = 0;
  for (int k = 0; k < 100; k++) {
    if (size == cap) {
      copies += size;
      cap = cap * 2;
    }
    size++;
  }
  cout << size << " " << cap << " " << copies << endl;
  return 0;
}`, 'Capacity doubles at sizes 1, 2, 4, …, 64: copies = 1 + 2 + … + 64 = 127.', { output: '100 128 127' })],
        deriv: [
          step('Insert n elements into an array that doubles its capacity when full. Copy cost at the doubling that happens when the size is 2^i is 2^i elements.', '\\text{copies}=1+2+4+\\dots+2^{k},\\quad 2^{k}<n', { toc: 'Copies' }),
          step('A geometric sum: the last term is more than the sum of all earlier ones.', '1+2+\\dots+2^{k}=2^{k+1}-1<2n', { toc: 'Geometric sum' }),
          step('Add the n ordinary insertions (1 unit each). Total work is less than 3n, so the amortised cost per insertion is at most 3 — a constant.', '\\tfrac{n+2n}{n}=3=O(1)', { hero: true, toc: 'Amortised cost' }),
        ],
        qs: [q('amort', 'A vector doubles its capacity when full. Each push_back is…', ['O(1) amortised, though an individual push can cost O(n).', 'The rare expensive copy is paid for by the many cheap pushes.'], [['O(n) always.', 'Only the occasional push triggers the copy.'], ['O(log n) amortised.', 'The total is linear, so the average is constant.']]), q('grow', 'What would happen to the amortised cost if the array grew by a fixed 10 slots each time instead of doubling?', ['It becomes O(n) per insertion on average, because a copy of the whole array happens every 10 insertions.', 'Geometric growth is what makes the sum of copies linear.'], [['It stays O(1).', 'The copying sum becomes quadratic.'], ['It becomes O(log n).', 'The cost is linear in n per insertion.']])],
        probs: [pr('p-amort', '<p>An array starts with capacity 4 and doubles when full. How many element copies occur during 40 insertions?</p>', 'Doublings occur when the size is 4, 8, 16, 32: copies = 4 + 8 + 16 + 32 = <b>60</b> (final capacity 64).')],
      }),

      sec('space', '1.11', 'Space complexity and the time–space trade-off', { eyebrow: 'Memory',
        body: `<p>Time is not the only resource. <b>Space complexity</b> counts the extra memory an algorithm needs beyond its input, again as a function of n. Merge sort needs O(n) extra space for the merge buffer; heap sort sorts in place with O(1) extra; quick sort needs O(log n) of stack on average (and O(n) in the worst case). A recursive algorithm also uses space for its call stack — a recursion n levels deep costs O(n) stack even if it allocates nothing else. Often you can trade one resource for the other: a lookup table or <b>memoisation</b> spends memory to avoid recomputation; compressing data spends time to save memory. Knowing the trade-off lets you choose by constraint: on a phone with little RAM, in-place; in a server with spare memory and strict latency, precompute.</p>`,
        qs: [q('inplace', 'Which sort uses O(1) extra space?', ['Heap sort (in place).', 'It rearranges the array itself.'], [['Merge sort.', 'It needs a temporary array.'], ['Counting sort.', 'It needs a count array.']]), q('stackspace', 'A recursive function calls itself n times deep and allocates no arrays. Its space complexity is…', ['O(n), because of the call stack.', 'Each active call keeps a frame.'], [['O(1).', 'The stack frames are real memory.'], ['O(log n).', 'Only if the depth were logarithmic.']])],
        probs: [pr('p-memo', '<p>Give an example of trading space for time.</p>', 'Memoising Fibonacci: store each computed value in a table (O(n) space) so each is calculated once, turning an exponential algorithm into a linear one.')],
      }),

      sec('summary', '1.12', 'Summary', { eyebrow: 'Recap', body: `<ul><li>A data structure arranges data so needed operations are cheap; an ADT states the operations without the implementation. No structure wins every operation.</li><li>An algorithm is finite, definite and effective; common strategies are brute force, divide and conquer, greedy, dynamic programming and backtracking.</li><li>Cost is counted in operations as a function of n: best, worst and average cases can differ; the worst case is a guarantee.</li><li>O is an upper bound, Ω a lower bound, Θ a tight bound; keep the dominant term, drop constants. Order: 1 &lt; log n &lt; n &lt; n log n &lt; n² &lt; 2ⁿ &lt; n!.</li><li>Loops: sequence adds, nesting multiplies, halving/doubling gives log n, dependent inner bounds give sums such as n(n−1)/2.</li><li>Recurrences (substitution, recursion tree, master theorem) analyse recursion: T(n) = T(n/2) + 1 is O(log n); T(n) = 2T(n/2) + n is O(n log n).</li><li>Amortised analysis averages over a sequence: doubling arrays give O(1) amortised insertion. Space complexity and recursion depth matter too.</li></ul>` }),
    ],
  })
}
