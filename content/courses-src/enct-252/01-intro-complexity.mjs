import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, q, pr, step, sec, term, run }) => {
  const b = run('sorting', { algo: 'bubble', values: '5 1 4 2 8' }), m = run('sorting', { algo: 'merge', values: '5 1 4 2 8' })
  return lesson({
    title: 'Data structures, ADTs and algorithm analysis',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 1',
    subtitle: 'Choose how to store data, and know how the cost of working with it grows.',
    sections: [
      sec('why', '1.1', 'Why structure matters', { eyebrow: 'The idea',
        body: `<p>A ${term('data structure')} is a way of organising data so that the operations you need are cheap. An array gives instant access by index but costly insertion in the middle; a linked list inserts cheaply but finds slowly; a hash table finds almost instantly but keeps no order. An ${term('abstract data type')} (ADT) states <em>what</em> operations exist (stack: push, pop, peek) independent of <em>how</em> they are implemented (array or linked list).</p>`,
        figs: [dia(`direction: right
[Array: O(1) index, O(n) insert] as a #blue
[Linked list: O(1) insert at head, O(n) search] as l #mint
[Hash table: O(1) average search] as h #amber
[Balanced tree: O(log n) everything, ordered] as t #violet
a -> l : trade
l -> h : trade
h -> t : trade`, 'No structure wins every operation.', { caption: 'trade-offs' })],
        qs: [q('adt', 'What is an ADT?', ['A specification of operations, independent of implementation.', 'A stack can be built on an array or on a linked list without changing its users.'], [['A specific array layout.', 'That is an implementation.'], ['A C++ class only.', 'The idea is language-independent.']])] }),
      sec('design', '1.2', 'Algorithm design techniques', { eyebrow: 'Strategies',
        body: `<p>Recurring strategies: ${term('brute force')} (try everything), ${term('divide and conquer')} (split, solve, combine — merge sort), ${term('greedy')} (take the best local choice — Huffman), ${term('dynamic programming')} (remember sub-answers), ${term('backtracking')} (build and undo), ${term('branch and bound')}, ${term('randomised')} and ${term('recursive')} algorithms.</p>`,
        qs: [q('dc', 'Merge sort is an example of…', ['Divide and conquer.', 'It splits the array, sorts the halves, and merges.'], [['Greedy.', 'No local best choice is committed to.'], ['Brute force.', 'That would try all permutations.']])] }),
      sec('big', '1.3', 'Growth rates and Big-O', { eyebrow: 'Analysis',
        body: `<p>We measure cost as a function of input size <i>n</i> and keep only the dominant term. ${term('Big-O')} is an upper bound (f = O(g) if f ≤ c·g for large n), ${term('Big-Omega')} a lower bound, ${term('Big-Theta')} both. Best, worst and average cases can differ: linear search is O(1) best, O(n) worst. Common orders, slowest-growing first: 1, log n, n, n log n, n², n³, 2ⁿ, n!.</p><p>Count real operations: bubble sort on 5 1 4 2 8 makes <b>${b.comparisons}</b> comparisons and <b>${b.moves}</b> swaps; merge sort makes <b>${m.comparisons}</b> comparisons.</p>`,
        figs: [lab('sorting', { algo: 'bubble', values: '5 1 4 2 8' }, 'Counters at the bottom are the “cost”.', ['comparisons', 'moves'], { caption: 'bubble sort', name: 'bub' }), lab('sorting', { algo: 'merge', values: '5 1 4 2 8' }, 'Merge sort does fewer comparisons as n grows.', ['comparisons'], { caption: 'merge sort', name: 'mer' })],
        qs: [q('dom', 'Simplify 3n² + 5n + 20 to Big-O.', ['O(n²).', 'For large n the n² term dominates; constants are dropped.'], [['O(n).', 'The n² term grows faster.'], ['O(3n²).', 'Constants are not written.']])],
        worked: [step('Show 3n² + 5n + 20 = O(n²): choose c and n₀ with 3n² + 5n + 20 ≤ c·n² for n ≥ n₀.', '', { toc: 'Goal' }), step('For n ≥ 1: 5n ≤ 5n² and 20 ≤ 20n², so the sum is at most 28n².', '3n^2+5n+20\\le 28n^2\\quad(n\\ge1)', { hero: true, toc: 'Witness c = 28, n₀ = 1' })] }),
      sec('loops', '1.4', 'Counting loops', { eyebrow: 'Practice',
        body: `<p>A single loop to <i>n</i> is O(n); nested loops to <i>n</i> are O(n²); a loop that doubles its counter (<code>i *= 2</code>) runs log₂ n times. Run the program and the DSA Lab counts the iterations.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int n = 16, count = 0;
  for (int i = 1; i < n; i *= 2) {
    count++;
  }
  cout << count << endl;
  return 0;
}`, 'The loop runs log₂16 = 4 times.', { output: '4' })],
        qs: [q('log', 'for (i = 1; i < n; i *= 2) runs how many times?', ['About log₂ n.', 'The counter doubles, so it needs log₂ n steps to reach n.'], [['n times.', 'That needs i++.'], ['n/2 times.', 'That is i += 2.']])],
        probs: [pr('p1', '<p>What is the complexity of two nested loops, each from 1 to n, with the inner body O(1)?</p>', 'n × n = <b>O(n²)</b>.'), pr('p2', '<p>A loop <code>for (i = n; i > 0; i /= 2)</code> — complexity?</p>', 'The counter halves each time: <b>O(log n)</b>.')] }),
      sec('space', '1.5', 'Space complexity and trade-offs', { eyebrow: 'Memory',
        body: `<p>Space complexity counts the extra memory an algorithm needs. Merge sort needs O(n) extra space; heap sort and quick sort (average) sort in place. Often time can be bought with space — a lookup table or memoisation — and the reverse.</p>`,
        qs: [q('inplace', 'Which sort uses O(1) extra space?', ['Heap sort (in place).', 'It rearranges the array itself.'], [['Merge sort.', 'It needs a temporary array.'], ['Counting sort.', 'It needs a count array.']])] }),
      sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Pick the structure whose cheap operations match your workload.</li><li>Big-O keeps the dominant term: n² beats n log n beats n.</li><li>Measure by counting operations, not seconds.</li></ul>` }),
    ],
  })
}
