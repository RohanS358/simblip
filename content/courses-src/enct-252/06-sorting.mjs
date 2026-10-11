import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => {
  const v = '5 1 4 2 8 9 3'
  const S = Object.fromEntries(['bubble', 'insertion', 'selection', 'shell', 'quick', 'merge', 'heap'].map((a) => [a, run('sorting', { algo: a, values: v })]))
  const rd = run('sorting', { algo: 'radix', values: '170 45 75 90 802 24 2 66' })
  const lb = scr(`var t = create("table", { headers: "n;n!;log₂(n!) ≈ minimum comparisons;n log₂ n", data: ${JSON.stringify([3, 4, 5, 8, 10, 100].map((n) => { let f = 1; let lg = 0; for (let i = 2; i <= n; i++) lg += Math.log2(i); return [String(n), n <= 10 ? String([1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800][n]) : '≈ 9.3×10¹⁵⁷', Math.ceil(lg).toString(), (n * Math.log2(n)).toFixed(0)] }))}, summary: "None" });`, 'Any comparison sort must distinguish n! orderings; every comparison has only two outcomes, so at least ⌈log₂ n!⌉ comparisons are needed.', { caption: 'the comparison lower bound' })
  const cmpTable = scr(`var t = create("table", { headers: "Sort;Best;Average;Worst;Extra space;Stable", data: ${JSON.stringify([['Bubble (early exit)', 'n', 'n²', 'n²', '1', 'yes'], ['Selection', 'n²', 'n²', 'n²', '1', 'no'], ['Insertion', 'n', 'n²', 'n²', '1', 'yes'], ['Shell', 'n log n', '≈ n^1.3', 'n² (simple gaps)', '1', 'no'], ['Merge', 'n log n', 'n log n', 'n log n', 'n', 'yes'], ['Quick', 'n log n', 'n log n', 'n²', 'log n', 'no'], ['Heap', 'n log n', 'n log n', 'n log n', '1', 'no'], ['Counting', 'n + k', 'n + k', 'n + k', 'k', 'yes'], ['Radix (d digits)', 'd(n + k)', 'd(n + k)', 'd(n + k)', 'n + k', 'yes']])}, summary: "None" });`, 'Learn this table; most sorting questions are some cell of it.', { caption: 'sorting algorithms compared' })
  return lesson({
    title: 'Sorting algorithms',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 7',
    subtitle: 'Eight ways to put numbers in order — and why “how many comparisons” is the question. The chapter derives the n log n lower bound, then builds every algorithm and counts its work on the same seven numbers.',
    sections: [
      sec('why', '7.1', 'Why sort, and what to ask of a sort', { eyebrow: 'Vocabulary',
        body: `<p>Sorting is the most studied problem in computing because order makes everything else cheap: binary search needs sorted data, duplicates become adjacent, merging two sorted lists is linear, and a person can scan a sorted list at a glance. Formally, given records with keys k₁ … kₙ, produce a permutation in which the keys are non-decreasing.</p><p>Algorithms differ in properties beyond speed. A sort is <b>internal</b> if all data fits in memory and <b>external</b> if it must stream from disk (merge-based). It is ${term('in place')} if it needs only O(1) extra memory beyond the array. It is ${term('stable')} if records with equal keys keep their original relative order — vital when you sort by several keys in turn: sort a class list by name, then stably by grade, and students within each grade stay alphabetical; with an unstable sort the alphabetical order is scrambled. It is ${term('adaptive')} if it runs faster on nearly sorted input. And it is a <b>comparison sort</b> if it learns the order only by asking “is a &lt; b?” — all of the algorithms except radix and counting sort.</p><p>We compare algorithms by counting comparisons and moves, using the same seven numbers throughout: 5 1 4 2 8 9 3. The C++ programs are real implementations that count their comparisons, and the cards show the same counts, so you can check each by hand.</p>`,
        qs: [q('stable', 'A stable sort…', ['Keeps equal keys in their original relative order.', 'Sort names by city, then by surname: a stable second pass keeps city order within equal surnames.'], [['Never changes the input.', 'It returns sorted output.'], ['Always runs in O(n log n).', 'Stability is unrelated to speed.']]), q('inplace', 'Which description is “in place”?', ['It uses O(1) extra memory besides the array.', 'It rearranges the elements inside the input array.'], [['It sorts without comparing.', 'That describes counting or radix sort.'], ['It runs in O(n log n).', 'Speed is unrelated to memory use.']])],
      }),

      sec('bound', '7.2', 'How fast can comparison sorting be? The n log n barrier', { eyebrow: 'A lower bound',
        body: `<p>Before building algorithms it helps to know the target. Is O(n log n) merely the best we have found, or a hard limit? For algorithms that only <em>compare</em> keys it is a hard limit, and the proof is a lovely counting argument. Picture a sorting algorithm as a <b>decision tree</b>: each internal node is a comparison “is aᵢ &lt; aⱼ?”, with two outgoing branches for yes and no; each leaf is the final answer — a particular ordering of the input. For the algorithm to be correct, <em>every</em> one of the n! possible orderings of n distinct keys must appear at some leaf. A binary tree of height h has at most 2ʰ leaves, so 2ʰ ≥ n!, and the worst-case number of comparisons — the height — is at least log₂(n!).</p><p>How big is log₂(n!)? Using Stirling’s approximation, n! ≈ (n/e)ⁿ, so log₂ n! ≈ n log₂ n − 1.44 n = Θ(n log n). A cruder bound is enough: n! has at least n/2 factors each ≥ n/2, so n! ≥ (n/2)^{n/2} and log₂ n! ≥ (n/2) log₂(n/2). The table shows the exact minimum for small n: sorting 5 items needs at least 7 comparisons, sorting 10 at least 22. Merge sort and heap sort <em>meet</em> this bound up to constants — they are asymptotically optimal. To beat n log n you must stop comparing and exploit the structure of the keys, as counting sort and radix sort do (section 7.10).</p>`,
        figs: [lb],
        deriv: [
          step('A comparison sort is a binary decision tree. Each of the n! input orderings must reach a different leaf, otherwise two different inputs would be given the same output permutation and one would be wrong.', '\\text{leaves}\\ge n!', { toc: 'Leaves' }),
          step('A binary tree of height h has at most 2^h leaves.', '2^{h}\\ge n!', { toc: 'Height' }),
          step('Take logarithms: the worst-case number of comparisons h is at least log₂ n!.', 'h\\ge\\log_2 n!', { toc: 'Bound' }),
          step('Bound the factorial from below by its largest n/2 factors.', 'n!\\ge\\left(\\tfrac n2\\right)^{n/2}\\Rightarrow \\log_2 n!\\ge\\tfrac n2\\log_2\\tfrac n2=\\Omega(n\\log n)', { hero: true, toc: 'n log n' }),
        ],
        qs: [q('lbq', 'Why must any comparison-based sort make at least about n log₂ n comparisons in the worst case?', ['It must distinguish n! orderings and each comparison gives only one bit, so it needs at least log₂ n! comparisons.', 'That is Θ(n log n).'], [['Because computers are slow at comparing.', 'The bound is about information, not hardware.'], ['Because the array must be copied.', 'Copying is separate.']]), q('beat', 'Radix sort sorts in O(d·n) time. Does that contradict the n log n lower bound?', ['No — the bound applies only to comparison sorts; radix sort never compares two keys.', 'It uses the digits of the keys directly.'], [['Yes, so radix sort must be wrong.', 'There is no contradiction.'], ['Only for large n.', 'The bound is independent of n.']])],
        probs: [pr('p-lb', '<p>What is the minimum number of comparisons in the worst case needed to sort 4 distinct numbers?</p>', '4! = 24 orderings, ⌈log₂ 24⌉ = <b>5</b> comparisons are necessary (and 5 are sufficient with a clever algorithm).')],
      }),

      sec('bubble', '7.3', 'Bubble sort', { eyebrow: 'The simplest idea',
        body: `<p>Walk along the array comparing neighbouring pairs and swap any pair that is out of order. After one pass the largest element has “bubbled” to the end, like a bubble rising in water. Repeat for the unsorted part: n − 1 passes, the i-th scanning n − i pairs, so n(n − 1)/2 comparisons in total — O(n²). Adding an <em>early exit</em> (stop if a whole pass made no swap) makes the best case — an already sorted array — a single pass of n − 1 comparisons, so O(n). It is stable (equal elements are never swapped) and in place. The number of swaps equals the number of <em>inversions</em> (out-of-order pairs) in the input, which is why a reversed array is the worst case with n(n − 1)/2 swaps.</p><p>For 5 1 4 2 8 9 3 it makes <b>${S.bubble.comparisons}</b> comparisons and <b>${S.bubble.moves}</b> swaps (the program’s output agrees). Bubble sort is almost never used in practice; it is taught because it is easy to analyse and a good first example of an invariant: after pass i the last i elements are in their final positions.</p>`,
        figs: [lab('sorting', { algo: 'bubble', values: v }, 'Bubble sort.', ['comparisons', 'moves'], { caption: 'bubble', name: 'bu' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int a[7] = {5, 1, 4, 2, 8, 9, 3};
  int n = 7, cmp = 0, swaps = 0;
  for (int i = 0; i < n - 1; i++) {
    bool swapped = false;
    for (int j = 0; j < n - 1 - i; j++) {
      cmp++;
      if (a[j] > a[j + 1]) {
        int t = a[j]; a[j] = a[j + 1]; a[j + 1] = t;
        swaps++;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  for (int i = 0; i < n; i++) cout << a[i] << " ";
  cout << "| " << cmp << " " << swaps << endl;
  return 0;
}`, 'Sorted output, then comparisons and swaps.', { output: '1 2 3 4 5 8 9 | 20 8' })],
        worked: [step('One pass of bubble sort on 5 1 4 2: compare (5,1) swap → 1 5 4 2; compare (5,4) swap → 1 4 5 2; compare (5,2) swap → 1 4 2 5.', '5\\ 1\\ 4\\ 2\\to1\\ 4\\ 2\\ 5', { toc: 'Pass 1' }), step('The largest value, 5, is now in its final place. Three comparisons and three swaps were used.', '', { toc: 'Result' }), step('Worst case n = 7 (reversed input): every comparison swaps; total comparisons n(n − 1)/2 = 21, swaps 21.', '\\tfrac{7\\cdot6}{2}=21', { hero: true, toc: 'Worst case' })],
        qs: [q('bubbleq', 'After the first pass of bubble sort, which element is guaranteed to be in its final place?', ['The largest element, at the end.', 'It is carried rightwards by every swap it takes part in.'], [['The smallest element, at the front.', 'The smallest moves only one place per pass.'], ['The median.', 'Nothing special happens to the median.']]), q('bubblebest', 'With the early-exit flag, what is bubble sort’s cost on an already sorted array?', ['O(n) — one pass with no swaps.', 'The flag stays false and the algorithm stops.'], [['O(n²).', 'Only without the flag.'], ['O(log n).', 'It must still look at every element.']])],
        probs: [pr('p-inv', '<p>Count the inversions in 3 1 2. How many swaps will bubble sort make?</p>', 'Inversions (pairs out of order): (3,1), (3,2) = <b>2</b>. Bubble sort makes exactly <b>2</b> swaps.')],
      }),

      sec('select', '7.4', 'Selection sort', { eyebrow: 'Find the minimum',
        body: `<p>Divide the array into a sorted prefix (initially empty) and an unsorted rest. Repeatedly <em>select</em> the smallest element of the unsorted part and swap it into the first unsorted position. After i rounds the first i elements are the i smallest, in order. It always makes n(n − 1)/2 comparisons whatever the input (<b>${S.selection.comparisons}</b> here) — it is not adaptive — but it makes at most n − 1 swaps (<b>${S.selection.moves}</b> here), which matters when writing is expensive (flash memory, or moving big records). It is in place; the long-distance swap makes it <em>unstable</em> (swapping the 5 of 5 5′ 2 with the 2 places 5′ before 5).</p>`,
        figs: [lab('sorting', { algo: 'selection', values: v }, 'Selection sort.', ['comparisons', 'moves'], { caption: 'selection', name: 'se' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int a[7] = {5, 1, 4, 2, 8, 9, 3};
  int n = 7, cmp = 0, swaps = 0;
  for (int i = 0; i < n - 1; i++) {
    int m = i;
    for (int j = i + 1; j < n; j++) {
      cmp++;
      if (a[j] < a[m]) m = j;
    }
    if (m != i) {
      int t = a[i]; a[i] = a[m]; a[m] = t;
      swaps++;
    }
  }
  for (int i = 0; i < n; i++) cout << a[i] << " ";
  cout << "| " << cmp << " " << swaps << endl;
  return 0;
}`, 'Comparisons never change with the input; swaps are few.', { output: '1 2 3 4 5 8 9 | 21 6' })],
        qs: [q('selswap', 'What is selection sort’s main advantage over bubble and insertion sort?', ['It makes at most n − 1 swaps, which is useful when writes are costly.', 'Its comparison count is always n(n − 1)/2.'], [['It is faster on sorted data.', 'It always does n(n − 1)/2 comparisons.'], ['It is stable.', 'It is not stable.']])],
        probs: [pr('p-sel', '<p>How many comparisons does selection sort make on an array of 10 elements, whatever the order?</p>', '9 + 8 + … + 1 = 10·9/2 = <b>45</b>.')],
      }),

      sec('insert', '7.5', 'Insertion sort', { eyebrow: 'Like sorting cards in your hand',
        body: `<p>Pick up playing cards one at a time and slide each into the right place among those already in your hand. ${term('Insertion sort')} does just that: the prefix a[0..i−1] is sorted; take the next element as <em>key</em>, shift every larger element of the prefix one place right, and drop the key into the gap. For random data it makes about n²/4 comparisons and shifts — still O(n²) — but its virtues are real: it is <b>stable</b>, <b>in place</b>, <b>adaptive</b> (an already-sorted array costs only n − 1 comparisons, O(n)), and its inner loop is tiny. For these reasons it is the algorithm real libraries use for small arrays (typically fewer than 10–20 elements) inside faster recursive sorts. The count of shifts equals the number of inversions: for 5 1 4 2 8 9 3 that is <b>${S.insertion.moves}</b> shifts and <b>${S.insertion.comparisons}</b> comparisons.</p>`,
        figs: [lab('sorting', { algo: 'insertion', values: v }, 'Insertion sort.', ['comparisons', 'moves'], { caption: 'insertion', name: 'in' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int a[7] = {5, 1, 4, 2, 8, 9, 3};
  int n = 7, cmp = 0, shifts = 0;
  for (int i = 1; i < n; i++) {
    int key = a[i];
    int j = i - 1;
    while (j >= 0) {
      cmp++;
      if (a[j] > key) { a[j + 1] = a[j]; shifts++; j--; }
      else break;
    }
    a[j + 1] = key;
  }
  for (int i = 0; i < n; i++) cout << a[i] << " ";
  cout << "| " << cmp << " " << shifts << endl;
  return 0;
}`, 'Each shift removes one inversion; the shift count is the inversion count.', { output: '1 2 3 4 5 8 9 | 13 8' })],
        worked: [step('Insert 2 into the sorted prefix 1 4 5 (array: 1 4 5 | 2 8 …). Compare 2 with 5 → shift; with 4 → shift; with 1 → stop.', '1\\ 4\\ 5\\ 2\\to1\\ 2\\ 4\\ 5', { toc: 'One insertion' }), step('Two shifts and three comparisons for this key. The total shifts over the whole sort equal the number of inversions: 5-1, 5-4, 5-2, 5-3, 4-2, 4-3, 8-3, 9-3 = 8.', '\\text{shifts}=8', { hero: true, toc: 'Inversions' })],
        qs: [q('nearly', 'Which simple sort is best on an almost-sorted array?', ['Insertion sort — few shifts are needed.', 'Its best case is linear.'], [['Selection sort.', 'Always quadratic comparisons.'], ['Bubble sort without early exit.', 'Still does all passes.']]), q('insstable', 'Why is insertion sort stable?', ['It moves an element past only strictly larger ones, so equal elements never cross.', 'The comparison a[j] > key (not ≥) stops at equal keys.'], [['Because it uses recursion.', 'It is iterative.'], ['Because it uses no extra memory.', 'In-place-ness and stability are independent.']])],
        probs: [pr('p-ins', '<p>Insertion sort an array that is already sorted of length n, and a reversed array of length n: how many comparisons for each?</p>', 'Sorted: <b>n − 1</b> comparisons, 0 shifts. Reversed: 1 + 2 + … + (n − 1) = <b>n(n − 1)/2</b> comparisons and the same number of shifts.')],
      }),

      sec('shell', '7.6', 'Shell sort', { eyebrow: 'Insertion sort with long strides',
        body: `<p>Insertion sort is slow because an element that is far from its place moves one position at a time. Donald Shell (1959) noticed that if we first sort elements that are far apart, large elements jump close to their destinations quickly. ${term('Shell sort')} performs insertion sort on the elements spaced <em>h</em> apart, for a decreasing sequence of gaps h (for example n/2, n/4, …, 1). Each pass leaves the array “h-sorted”; the final pass with h = 1 is plain insertion sort, but by then the array is nearly sorted, so it is fast. The running time depends entirely on the gap sequence: the halving sequence gives O(n²) in the worst case, Knuth’s sequence (1, 4, 13, 40, …) O(n^{3/2}), and cleverer sequences about O(n^{4/3}) — far better than quadratic and with no extra memory or recursion. It is not stable. For our seven numbers it needs <b>${S.shell.comparisons}</b> comparisons.</p>`,
        figs: [lab('sorting', { algo: 'shell', values: v }, 'Shell sort.', ['comparisons'], { caption: 'shell sort', name: 'sh' })],
        qs: [q('shellq', 'What is the last gap used by Shell sort?', ['1 — a plain insertion sort on a nearly sorted array.', 'Earlier passes have moved elements most of the way.'], [['n/2.', 'That is the first gap of the halving sequence.'], ['0.', 'A gap of 0 is meaningless.']])],
      }),

      sec('merge', '7.7', 'Merge sort', { eyebrow: 'Divide and conquer',
        body: `<p>Two sorted lists can be merged into one in linear time by repeatedly taking the smaller of the two front elements. ${term('Merge sort')} turns this into a sorting algorithm: split the array in half, sort each half <em>recursively</em>, and merge the two sorted halves. The base case is an array of one element, already sorted. The recurrence is T(n) = 2T(n/2) + n: the recursion tree has log₂ n levels and each level does n work in merging, so T(n) = Θ(n log n) <em>in every case</em> — best, average and worst — which makes it dependable. It is <b>stable</b> (take from the left half on ties) but needs O(n) extra space for the merge buffer. It is the natural choice for linked lists (merging needs no extra space) and for <b>external sorting</b>, where data too large for memory is sorted in chunks and merged from disk. Our run takes <b>${S.merge.comparisons}</b> comparisons.</p>`,
        figs: [lab('sorting', { algo: 'merge', values: v }, 'Merging two sorted halves.', ['comparisons', 'sorted'], { caption: 'merge sort', name: 'ms' }), cpp(`#include <iostream>
using namespace std;
int cmp = 0;
int a[7] = {5, 1, 4, 2, 8, 9, 3};
int tmp[7];
void msort(int lo, int hi) {
  if (hi - lo < 1) return;
  int mid = (lo + hi) / 2;
  msort(lo, mid);
  msort(mid + 1, hi);
  int i = lo, j = mid + 1, k = lo;
  while (i <= mid && j <= hi) {
    cmp++;
    if (a[i] <= a[j]) tmp[k++] = a[i++];
    else tmp[k++] = a[j++];
  }
  while (i <= mid) tmp[k++] = a[i++];
  while (j <= hi) tmp[k++] = a[j++];
  for (int x = lo; x <= hi; x++) a[x] = tmp[x];
}
int main() {
  msort(0, 6);
  for (int i = 0; i < 7; i++) cout << a[i] << " ";
  cout << "| " << cmp << endl;
  return 0;
}`, 'A temporary array holds each merge; the lab shows the call tree.', { output: '1 2 3 4 5 8 9 | 12' })],
        worked: [step('Why O(n log n)? Halving gives log₂ n levels and each level does O(n) merging work.', '', { toc: 'Levels' }), step('For n = 1024 that is about 10 levels × 1024 ≈ 10 240 operations, versus 1 048 576 for n².', '1024\\log_2 1024\\approx 10^4\\ \\text{vs}\\ 10^6', { hero: true, toc: 'Comparison' }), step('Merging [1 4 5] and [2 8 9]: compare 1/2 → 1; 4/2 → 2; 4/8 → 4; 5/8 → 5; then copy 8, 9. Five comparisons for six elements, never more than n − 1.', '1,2,4,5,8,9', { toc: 'One merge' })],
        qs: [q('mergespace', 'What is merge sort’s main drawback on arrays?', ['It needs O(n) extra space for merging.', 'Heap sort and quick sort work in place.'], [['It is slower than O(n log n).', 'It is always O(n log n).'], ['It is not stable.', 'It is stable.']]), q('mergecost', 'Merging two sorted lists of lengths m and n takes at most how many comparisons?', ['m + n − 1.', 'Each comparison places one element; the last element needs none.'], [['m × n.', 'That would be comparing every pair.'], ['log(m + n).', 'Every element must be looked at.']])],
        probs: [pr('p-merge', '<p>Merge sort 8 elements: how many levels of recursion (splitting down to single elements), and what is the maximum number of comparisons in total?</p>', 'Levels: log₂ 8 = <b>3</b>. Each level merges n = 8 elements with at most 7, then 6 (2×3), then 4 (4×1) comparisons, so ≤ 7 + 6 + 4 = <b>17</b> in total (the classic bound n log₂ n − n + 1 = 24 − 8 + 1 = 17).')],
      }),

      sec('quick', '7.8', 'Quick sort', { eyebrow: 'Partition and recurse',
        body: `<p>Tony Hoare’s ${term('quick sort')} (1960) does its work <em>before</em> the recursive calls rather than after. Choose a <b>pivot</b> element; <b>partition</b> the array so everything smaller than the pivot is to its left and everything larger to its right — the pivot is then in its final place — and recursively sort the two sides. There is no merge step and no extra array: partitioning is done in place by one scan. In the common Lomuto scheme the last element is the pivot, an index i marks the end of the “smaller” region, and each element smaller than the pivot is swapped into that region.</p><p>Performance depends on how balanced the partitions are. If each splits the array roughly in half, the recurrence is T(n) = 2T(n/2) + n — O(n log n), and in practice quick sort is the fastest general-purpose sort because its inner loop is tight and cache-friendly. If the pivot is always the smallest or largest element, one side has n − 1 elements and T(n) = T(n − 1) + n = O(n²): this happens on <b>already-sorted input when the first or last element is the pivot</b>. The run below sorts 1..8 and makes 28 = 8·7/2 comparisons, exactly the quadratic worst case. Remedies: choose the pivot <b>at random</b>, or as the <b>median of three</b> (first, middle, last), which makes the bad case astronomically unlikely and gives O(n log n) expected time. Quick sort is in place but needs O(log n) stack on average (O(n) worst case) and is not stable. For our seven numbers it takes <b>${S.quick.comparisons}</b> comparisons.</p>`,
        figs: [lab('sorting', { algo: 'quick', values: v }, 'The pivot settles at its final place each round.', ['comparisons', 'sorted'], { caption: 'quick sort', name: 'qs' }), cpp(`#include <iostream>
using namespace std;
int cmp = 0;
int a[7] = {5, 1, 4, 2, 8, 9, 3};
int part(int lo, int hi) {
  int p = a[hi];
  int i = lo - 1;
  for (int j = lo; j < hi; j++) {
    cmp++;
    if (a[j] < p) {
      i++;
      int t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }
  int t = a[i + 1]; a[i + 1] = a[hi]; a[hi] = t;
  return i + 1;
}
void qs(int lo, int hi) {
  if (lo >= hi) return;
  int p = part(lo, hi);
  qs(lo, p - 1);
  qs(p + 1, hi);
}
int main() {
  qs(0, 6);
  for (int i = 0; i < 7; i++) cout << a[i] << " ";
  cout << "| " << cmp << endl;
  return 0;
}`, 'Lomuto partition with the last element as pivot.', { output: '1 2 3 4 5 8 9 | 13' }), cpp(`#include <iostream>
using namespace std;
int cmp = 0;
int a[8] = {1, 2, 3, 4, 5, 6, 7, 8};
int part(int lo, int hi) {
  int p = a[hi];
  int i = lo - 1;
  for (int j = lo; j < hi; j++) {
    cmp++;
    if (a[j] < p) {
      i++;
      int t = a[i]; a[i] = a[j]; a[j] = t;
    }
  }
  int t = a[i + 1]; a[i + 1] = a[hi]; a[hi] = t;
  return i + 1;
}
void qs(int lo, int hi) {
  if (lo >= hi) return;
  int p = part(lo, hi);
  qs(lo, p - 1);
  qs(p + 1, hi);
}
int main() {
  qs(0, 7);
  cout << cmp << endl;
  return 0;
}`, 'The worst case: already-sorted input, last element as pivot — n(n−1)/2 = 28 comparisons.', { output: '28' })],
        deriv: [
          step('Best case: the pivot always lands in the middle, so each call splits n into two halves and partitioning costs n.', 'T(n)=2T(n/2)+n=\\Theta(n\\log n)', { toc: 'Best case' }),
          step('Worst case: the pivot is the extreme element, so one subproblem is empty and the other has n − 1 elements.', 'T(n)=T(n-1)+n=n+(n-1)+\\dots+1=\\tfrac{n(n+1)}{2}', { toc: 'Worst case' }),
          step('Even a lopsided but constant split, say 1:9, keeps the tree depth logarithmic (log_{10/9} n levels) with n work per level, so the cost stays O(n log n) — which is why random pivots work so well.', 'T(n)=T(n/10)+T(9n/10)+n=O(n\\log n)', { hero: true, toc: 'Unbalanced but constant' }),
        ],
        qs: [q('qworst', 'When does quick sort degrade to O(n²)?', ['When partitions are badly unbalanced, e.g. always picking the smallest or largest element as pivot.', 'One side gets n−1 elements every time.'], [['On random input.', 'Random input is its average case.'], ['On tiny arrays.', 'Size alone does not cause it.']]), q('qpiv', 'How does choosing a random pivot help?', ['It makes consistently bad splits very unlikely for any input, so the expected time is O(n log n).', 'An adversary can no longer pick an input that is bad for a fixed rule.'], [['It makes the algorithm stable.', 'Stability is unaffected.'], ['It removes the recursion.', 'Recursion remains.']]), q('qvm', 'Which statement compares quick sort and merge sort correctly?', ['Quick sort is in place and usually faster in practice but has an O(n²) worst case; merge sort is always O(n log n) and stable but needs extra space.', 'Each has a niche.'], [['Merge sort is in place; quick sort is not.', 'Reversed.'], ['Both are stable.', 'Quick sort is not.']])],
        probs: [pr('p-qs', '<p>Partition 5 1 4 2 8 9 3 with the last element (3) as pivot using the Lomuto scheme. Give the array after the partition and the pivot’s final index.</p>', 'Scan j = 0…5 with i = −1. j = 0: 5 is not &lt; 3. j = 1: 1 &lt; 3 → i = 0, swap a[0] and a[1] → 1 5 4 2 8 9 3. j = 2: 4 no. j = 3: 2 &lt; 3 → i = 1, swap a[1] and a[3] → 1 2 4 5 8 9 3. j = 4, 5: no. Finally swap the pivot with a[i + 1] = a[2]: <b>1 2 3 5 8 9 4</b>. The pivot’s final index is <b>2</b>.')],
      }),

      sec('heapsort', '7.9', 'Heap sort', { eyebrow: 'Sorting with a priority queue',
        body: `<p>Last chapter’s heap makes a sort almost for free. <b>Phase 1</b>: arrange the array into a <em>max-heap</em> (parent ≥ children) with the O(n) bottom-up build. <b>Phase 2</b>: the largest element is at the root; swap it with the last element of the heap, shrink the heap by one — the largest is now in its final position — and sift the new root down to restore the heap property. Repeat n − 1 times. Each sift-down is O(log n), so heap sort is <b>O(n log n) in the worst case</b>, uses O(1) extra space, and has no bad inputs. It is <em>not stable</em>, and its scattered memory accesses make it slower than quick sort in practice; it is the choice when you need a guaranteed bound and no extra memory — in embedded systems, or as the fallback in <em>introsort</em> (quick sort that switches to heap sort if the recursion gets too deep). Our run needs <b>${S.heap.comparisons}</b> comparisons and <b>${S.heap.moves}</b> moves.</p>`,
        figs: [lab('sorting', { algo: 'heap', values: v }, 'Heap sort.', ['comparisons'], { caption: 'heap sort', name: 'hs' })],
        qs: [q('heapz', 'Heap sort’s main advantage over merge sort?', ['It sorts in place with guaranteed O(n log n).', 'Merge sort needs O(n) extra space.'], [['It is stable.', 'Heap sort is not stable.'], ['It is faster on sorted input.', 'Not specially.']]), q('heapphase', 'During the second phase of heap sort, what is done with the root of the max-heap?', ['It is swapped with the last element of the heap, which then leaves the heap in its final position.', 'The heap shrinks by one and the new root is sifted down.'], [['It is deleted from memory.', 'It is placed at the end of the array.'], ['It is compared with every element.', 'Only with its children during sift-down.']])],
      }),

      sec('linear', '7.10', 'Sorting without comparing: counting and radix sort', { eyebrow: 'Beating n log n',
        body: `<p>The n log n barrier holds only for comparison sorts. If the keys are small integers we can sort in <em>linear</em> time by using them as array indices. <b>Counting sort</b> for keys in 0…k: make a count array of size k + 1, count how many times each key occurs, then write the keys back in order (or, for records, turn the counts into starting positions by a prefix sum and place each record, which makes the sort stable). Time O(n + k), space O(k). It is superb when k is not much larger than n — sorting ages, exam marks, or the digits inside radix sort — and hopeless when k is huge (32-bit integers would need a 4-billion-entry array). The program sorts ten numbers in 0…8 by counting.</p><p>${term('Radix sort')} extends the idea to larger keys by processing one digit at a time: distribute the numbers into ten buckets by the <em>least significant</em> digit, collect them in bucket order, then repeat on the next digit, up to the most significant. Each pass is a counting sort, and it <b>must be stable</b> so the order from earlier digits survives within each later bucket. With d digits and base k the cost is O(d·(n + k)). The card sorts 170 45 75 90 802 24 2 66 into <b>${rd.sorted}</b> in three passes (units, tens, hundreds). <b>Bucket sort</b> spreads keys uniformly distributed over an interval into n buckets, sorts each with insertion sort, and concatenates: O(n) expected.</p>`,
        figs: [lab('sorting', { algo: 'radix', values: '170 45 75 90 802 24 2 66' }, 'One stable pass per digit.', ['sorted'], { caption: 'LSD radix sort', name: 'rx' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int a[10] = {4, 2, 2, 8, 3, 3, 1, 4, 2, 0};
  int cnt[9];
  for (int i = 0; i < 9; i++) cnt[i] = 0;
  for (int i = 0; i < 10; i++) cnt[a[i]]++;
  int k = 0;
  for (int v = 0; v < 9; v++)
    for (int c = 0; c < cnt[v]; c++) a[k++] = v;
  for (int i = 0; i < 10; i++) cout << a[i] << " ";
  cout << endl;
  return 0;
}`, 'No comparisons between elements: one pass to count, one to write.', { output: '0 1 2 2 2 3 3 4 4 8' })],
        worked: [step('Radix sort 329 457 657 839 436 720 355 by units digit: buckets 0:720 · 5:355 · 7:457 657 · 6:436 · 9:329 839. Collect in order 0…9.', '720\\ 355\\ 436\\ 457\\ 657\\ 329\\ 839', { toc: 'Units' }), step('Now by tens digit (stably): 2:720 329 · 3:436 839 · 5:355 457 657 → 720 329 436 839 355 457 657.', '', { toc: 'Tens' }), step('Finally by hundreds: 3:329 355 · 4:436 457 · 6:657 · 7:720 · 8:839.', '329\\ 355\\ 436\\ 457\\ 657\\ 720\\ 839', { hero: true, toc: 'Hundreds' })],
        qs: [q('rx', 'Why must each radix pass be stable?', ['So the order from earlier (less significant) digits survives within each later bucket.', 'Otherwise earlier work would be undone.'], [['To use less memory.', 'Unrelated.'], ['Because buckets are small.', 'Unrelated.']]), q('countk', 'When is counting sort a poor choice?', ['When the key range k is much larger than n, so the count array dominates time and space.', 'It costs O(n + k).'], [['When the keys are small integers.', 'That is where it shines.'], ['When n is large.', 'Large n is fine if k is small.']])],
        probs: [pr('p-cmp', '<p>Sort 5 1 4 2 8 9 3 with each algorithm and compare the comparison counts.</p>', `Bubble ${S.bubble.comparisons}, selection ${S.selection.comparisons}, insertion ${S.insertion.comparisons}, shell ${S.shell.comparisons}, quick ${S.quick.comparisons}, merge ${S.merge.comparisons}, heap ${S.heap.comparisons}. The quadratic sorts do visibly more work, and the gap widens quickly with n.`), pr('p-count', '<p>Counting sort the keys 3 0 2 3 1 0 2 (range 0…3). Give the count array and the sorted output.</p>', 'Counts for keys 0,1,2,3: <b>[2, 1, 2, 2]</b>. Output: <b>0 0 1 2 2 3 3</b>.')],
      }),

      sec('choose', '7.11', 'Choosing a sort', { eyebrow: 'Decision table',
        body: `<p>No algorithm wins every contest, so the choice follows from the constraints. <b>Small arrays</b> (under ~20 elements): insertion sort. <b>General purpose, in memory</b>: quick sort (with a good pivot) or the library’s introsort/Timsort. <b>Need a worst-case guarantee and little memory</b>: heap sort. <b>Need stability or sorting linked lists or external files</b>: merge sort (Python’s and Java’s object sorts are Timsort, a merge/insertion hybrid that exploits existing runs). <b>Data nearly sorted</b>: insertion sort or Timsort. <b>Small integer keys</b>: counting or radix sort. <b>Writes are expensive</b>: selection sort minimises swaps. The table collects the facts; everything in it follows from the analysis above.</p>`,
        figs: [cmpTable],
        qs: [q('choose1', 'You must sort 10 million records stably and the data does not fit in memory. Which approach?', ['External merge sort: sort chunks that fit in memory, then merge them from disk.', 'Merge sort is stable and works well with sequential disk access.'], [['Heap sort.', 'Not stable, and random access is bad on disk.'], ['Bubble sort.', 'Far too slow.']]), q('choose2', 'Which sort is the best choice for 12 elements, nearly sorted already?', ['Insertion sort.', 'Linear time on nearly sorted input and tiny overhead.'], [['Quick sort.', 'Overhead and a risk of bad partitions for little gain.'], ['Heap sort.', 'No benefit.']])],
        probs: [pr('p-tab', '<p>Fill the blank: the only sort in the table that is both stable and O(n log n) in every case is ______; the one that is O(n log n) in every case and in place is ______.</p>', 'Merge sort; heap sort.')],
      }),

      sec('summary', '7.12', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Properties: stable, in place, adaptive, internal/external; comparison sorts need ≥ log₂ n! = Ω(n log n) comparisons in the worst case.</li><li>O(n²): bubble (adjacent swaps; n with early exit), selection (min each round; n − 1 swaps), insertion (shift into prefix; best for small or nearly sorted).</li><li>Shell sort: insertion sort with shrinking gaps, about O(n^{4/3})–O(n²) depending on gaps.</li><li>Merge sort: always n log n, stable, O(n) space; quick sort: n log n average, n² worst (sorted input with a fixed pivot), in place; heap sort: n log n worst case, in place, unstable.</li><li>Counting and radix sort beat n log n by not comparing: O(n + k) and O(d(n + k)), stable, for small integer keys.</li></ul>` }),
    ],
  })
}
