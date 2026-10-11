import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => {
  const lin = run('hashing', { method: 'linear', size: 7, keys: '50 700 76 85 92 73 101' }), ch = run('hashing', { method: 'chaining', size: 5, keys: '5 10 3 8' }), qd = run('hashing', { method: 'quadratic', size: 7, keys: '50 700 76 85 92 73 101' }), dbl = run('hashing', { method: 'double', size: 7, keys: '50 700 76 85 92 73 101' })
  const al = [0.25, 0.5, 0.7, 0.8, 0.9, 0.95]
  const probes = scr(`var t = create("table", { headers: "Load factor α;Chaining (miss) 1+α;Linear probing (miss) ½(1+1/(1−α)²);Linear probing (hit) ½(1+1/(1−α))", data: ${JSON.stringify(al.map((a) => [a.toFixed(2), (1 + a).toFixed(2), (0.5 * (1 + 1 / (1 - a) ** 2)).toFixed(1), (0.5 * (1 + 1 / (1 - a))).toFixed(1)]))}, summary: "None" });`, 'Open addressing falls off a cliff as the table fills: at α = 0.9 an unsuccessful search takes about 50 probes.', { caption: 'expected probes' })
  return lesson({
    title: 'Searching and hashing',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 8',
    subtitle: 'From scanning every item to jumping straight to it — and what to do when two keys want the same slot. The chapter covers sequential and binary search with their analysis, hash functions, chaining and the three probing schemes, and the cost of load.',
    sections: [
      sec('seq', '8.1', 'The search problem and sequential search', { eyebrow: 'Looking',
        body: `<p>Searching is the most common operation a program performs: find a student by roll number, a word in a dictionary, a customer by account. Given a collection of records and a key, return the record with that key or report that none exists. The method depends on how the data is organised, and the cost is measured by counting <b>key comparisons</b> — the same unit we used for sorting.</p><p>The baseline is ${term('sequential (linear) search')}: examine records one by one from the start until the key is found or the data runs out. It needs no preparation and works on arrays and linked lists, sorted or not. For n records a successful search takes 1 comparison at best, n at worst, and (n + 1)/2 on average if every position is equally likely; an unsuccessful search always takes n. It is O(n). A small speed-up is the <b>sentinel</b>: put a copy of the key after the last element so the loop need not test for the end of the array on every pass. On a sorted array an unsuccessful search can stop as soon as it meets a larger key — saving half the comparisons on average, but it is still O(n). For tiny collections, or one-off searches in unsorted data, sequential search is exactly right; for repeated searches in large collections we need something smarter.</p>`,
        qs: [q('seqavg', 'The key is equally likely to be at any of the 100 positions of an array. What is the average number of comparisons of a successful sequential search?', ['50.5.', '(n + 1)/2 = 101/2.'], [['100.', 'That is the worst case.'], ['1.', 'That is the best case.']]), q('sequnsucc', 'How many comparisons does an unsuccessful sequential search of an unsorted array of n items take?', ['n — every item must be examined.', 'Only an ordered list lets you stop early.'], [['n/2.', 'That is the average for a successful search.'], ['log n.', 'That requires sorted data and binary search.']])],
        probs: [pr('p-seq', '<p>An unsorted array of 1000 records is searched 500 times for random keys that are always present. Estimate the total comparisons.</p>', 'Average (1000 + 1)/2 ≈ 500 per search × 500 searches ≈ <b>250,000</b> comparisons. (Sorting once and using binary search would need about 500 × 10 = 5,000 plus the sort.)')],
      }),

      sec('bs', '8.2', 'Binary search', { eyebrow: 'Halve the problem',
        body: `<p>Open a dictionary to find “mango”. You do not start at A: you open near the middle, see that you are at “L”, so you know the word is in the second half, and halve again. ${term('Binary search')} does exactly that on a <b>sorted array</b>: compare the key with the middle element; if equal, done; if the key is smaller, discard the upper half; if larger, discard the lower half; repeat on what remains until the range is empty. Each comparison halves the candidates, so the number of probes is at most ⌊log₂ n⌋ + 1: one million sorted items need at most 20 probes, a billion at most 30. The price is the requirement of <b>sorted data with random access</b> — it does not work on a linked list (no O(1) middle) or an unsorted array — and the cost of keeping the data sorted when it changes.</p><p>The code is a loop with two indices, <code>lo</code> and <code>hi</code>, and <code>mid = (lo + hi) / 2</code> (to avoid overflow on huge arrays write <code>lo + (hi − lo)/2</code>). Take care with the boundaries: it is the single most commonly mis-coded algorithm. The program searches 53 in a ten-element array — three probes — and then the absent key 10, which takes three probes before the range empties. The recursive version, which passes lo and hi as parameters, has the recurrence T(n) = T(n/2) + 1 from Chapter 1: O(log n).</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a[10] = {3, 9, 14, 19, 25, 31, 42, 47, 53, 64};
  int target = 53, lo = 0, hi = 9, probes = 0, found = -1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    probes++;
    if (a[mid] == target) { found = mid; break; }
    if (a[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  cout << found << " " << probes << endl;
  return 0;
}`, 'Probes a[4] = 25, then a[7] = 47, then a[8] = 53: index 8 after 3 probes.', { output: '8 3' }), cpp(`#include <iostream>
using namespace std;
int probes = 0;
int bs(int a[], int lo, int hi, int t) {
  if (lo > hi) return -1;
  int mid = (lo + hi) / 2;
  probes++;
  if (a[mid] == t) return mid;
  if (a[mid] < t) return bs(a, mid + 1, hi, t);
  return bs(a, lo, mid - 1, t);
}
int main() {
  int a[8] = {1, 3, 5, 7, 9, 11, 13, 15};
  cout << bs(a, 0, 7, 13) << " " << probes << endl;
  return 0;
}`, 'The recursive form: each call searches half the range.', { output: '6 3' })],
        worked: [step('Worst-case probes for n sorted items is ⌊log₂ n⌋ + 1 (each probe at least halves the range, and a range of size 1 needs one final probe).', '', { toc: 'Formula' }), step('For n = 1 000 000.', '\\lfloor\\log_2 10^6\\rfloor+1=\\lfloor19.93\\rfloor+1=20', { hero: true, toc: 'Million items' }), step('Compare with sequential search: 20 probes against 1,000,000 in the worst case, 50,000 times fewer. For n = 10 the gap is only 4 against 10 — which is why small arrays are searched linearly.', '\\tfrac{10^6}{20}=50{,}000', { toc: 'Comparison' })],
        deriv: [
          step('Let T(n) be the worst-case probes on n sorted items. One probe, then the problem is at most half the size.', 'T(n)=T(\\lfloor n/2\\rfloor)+1,\\quad T(1)=1', { toc: 'Recurrence' }),
          step('After k probes at most n/2^k items remain; the search must end when this drops below 1.', '\\tfrac{n}{2^{k}}<1\\iff k>\\log_2 n', { toc: 'Stopping' }),
          step('So the number of probes is bounded by the first integer exceeding log₂ n.', 'T(n)=\\lfloor\\log_2 n\\rfloor+1=O(\\log n)', { hero: true, toc: 'Result' }),
        ],
        qs: [q('bs', 'Binary search requires…', ['The data to be sorted.', 'Discarding half is only valid if order tells you which half.'], [['Unique keys only.', 'Duplicates are allowed.'], ['A linked list.', 'It needs random access.']]), q('bsprobes', 'About how many probes does binary search need in the worst case on 1,000 sorted items?', ['10.', '⌊log₂ 1000⌋ + 1 = 9 + 1.'], [['1,000.', 'That is sequential search.'], ['500.', 'Binary search halves; it does not subtract.']]), q('bsbug', 'Why is mid = lo + (hi − lo)/2 preferred to (lo + hi)/2 in real code?', ['(lo + hi) can overflow an int when the indices are large; the first form cannot.', 'This famous bug sat in widely used libraries for years.'], [['It is faster.', 'Both are one expression.'], ['It finds the first duplicate.', 'Duplicates are a different issue.']])],
        probs: [pr('p-bsmax', '<p>What is the maximum number of probes needed to search a sorted array of 255 elements? Of 256?</p>', '255 elements: ⌊log₂ 255⌋ + 1 = 7 + 1 = <b>8</b> probes. 256 elements: ⌊log₂ 256⌋ + 1 = 8 + 1 = <b>9</b> probes. (A perfect tree of 255 nodes has 8 levels.)'), pr('p-bstrace', '<p>Array 2 5 8 12 16 23 38. Trace the probes for the key 16 and for 7.</p>', 'Key 16: mid = 12 → larger, go right; mid = 23 → smaller, go left; mid = 16 → found at index 4 (3 probes). Key 7: mid = 12 → go left; mid = 5 → larger, go right; mid = 8 → smaller, go left; range empty → not found (3 probes).')],
      }),

      sec('hashidea', '8.3', 'The hashing idea', { eyebrow: 'Direct addressing by computation',
        body: `<p>Binary search finds a key in O(log n). Can we find it in O(1)? If the keys were small integers we could use the key itself as the array index — <b>direct addressing</b>: the record for roll number 305 is stored at table[305]. Search, insert and delete are then a single array access. The trouble is the size of the key space. Student numbers might run from 0 to 99,999,999 for a class of 60; reserving 100 million slots to hold 60 records is absurd, and names or phone numbers are not even integers.</p><p><b>Hashing</b> keeps the speed and shrinks the table. Choose a table of m slots, much smaller than the key space, and a ${term('hash function')} h that maps any key to an index in 0…m − 1. Store the record at table[h(key)]; to look it up, compute h(key) again and go straight there. Search, insert and delete are O(1) <em>on average</em>. The catch is unavoidable: if there are more possible keys than slots, two different keys must sometimes map to the same slot — a ${term('collision')} — and every hash table needs a strategy to resolve them. The table of m slots holding n keys has a ${term('load factor')} α = n/m; the whole performance story depends on keeping α moderate.</p>`,
        qs: [q('load', 'What is the load factor?', ['n / m — stored items divided by table slots.', 'As α rises, collisions become more likely.'], [['m / n.', 'Inverted.'], ['The size of the hash function.', 'No.']]), q('collision', 'Why can collisions not be avoided entirely?', ['There are far more possible keys than table slots, so by the pigeonhole principle some keys must share a slot.', 'We can only choose a function that spreads keys evenly.'], [['Because hash functions are random.', 'Good hash functions are deterministic; the cause is the size mismatch.'], ['Because tables are too small by mistake.', 'Even a well-sized table will see collisions.']])],
      }),

      sec('hfn', '8.4', 'Hash functions', { eyebrow: 'Spreading keys evenly',
        body: `<p>A good hash function is fast to compute, always returns the same value for the same key, and spreads typical keys <em>uniformly</em> across the table, so each slot is equally likely to be chosen. Several classic recipes exist. The <b>division method</b> uses <code>h(k) = k mod m</code>: simple and fast, but m must be chosen carefully — a power of 2 (which just keeps the low bits) or a number sharing factors with the key patterns gives poor spread, so <em>a prime not close to a power of 2</em> is the usual choice. The <b>multiplication method</b> takes the fractional part of k·A (A ≈ 0.618, the golden ratio fraction) and scales it by m; it works with any m. The <b>mid-square method</b> squares the key and takes the middle digits: 1234² = 1,522,756, whose middle two digits are 27. <b>Folding</b> splits the key into parts and adds them: 123 456 78 → 123 + 456 + 78 = 657, then mod 100 gives 57.</p><p>For strings, treat the characters as digits of a number in some base and reduce modulo m as you go — <b>polynomial hashing</b>: h = (h·31 + c) mod m for each character c. For the string “cab” with a = 1, b = 2, c = 3 this gives 3, then 3·31 + 1 = 94, then 94·31 + 2 = 2916 ≡ 88 (mod 101). The factor 31 (or another prime) ensures that “ab” and “ba” hash differently. Never use the sum of the character codes alone: anagrams would all collide. Cryptographic hashes (SHA-256) are far slower and are used for integrity and passwords, not for table lookups.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int keys[6] = {123456, 987654, 55, 4096, 100, 77};
  for (int k = 0; k < 6; k++) cout << keys[k] % 11 << " ";
  cout << endl;
  int x = 1234;
  int sq = x * x;
  cout << sq << " " << (sq / 100) % 100 << endl;
  int folded = 123 + 456 + 78;
  cout << folded << " " << folded % 100 << endl;
  return 0;
}`, 'Division, mid-square and folding on the keys from the text.', { output: '3 8 0 4 1 0 \n1522756 27\n657 57' }), cpp(`#include <iostream>
#include <string>
using namespace std;
int main() {
  string s = "cab";
  int h = 0;
  for (int i = 0; i < s.size(); i++)
    h = (h * 31 + (s[i] - 'a' + 1)) % 101;
  cout << h << endl;
  return 0;
}`, 'A polynomial string hash: 3 → 94 → 88.', { output: '88' })],
        qs: [q('hm', 'Why is a prime table size recommended for the division method?', ['It avoids patterns where keys share a factor with m and all land in few slots.', 'A power of 2 would use only the low bits of the key.'], [['A prime makes the table faster.', 'Speed is not the reason.'], ['Primes are required by C++.', 'No such rule.']]), q('anagram', 'Why is “sum of character codes” a poor string hash?', ['Anagrams and many unrelated strings have the same sum, causing many collisions.', 'Position must influence the result, as in polynomial hashing.'], [['It is too slow.', 'It is fast; it is bad at spreading.'], ['It overflows.', 'The problem is distribution, not overflow.']])],
        probs: [pr('p-hfn', '<p>With h(k) = k mod 10 and table size 10, where do keys 27, 17, 35, 45 and 100 go? Which collide?</p>', 'Slots: 27 → 7, 17 → 7, 35 → 5, 45 → 5, 100 → 0. Collisions: <b>27 and 17</b> (slot 7), <b>35 and 45</b> (slot 5). A table size of 10 clusters keys ending in the same digit — a prime such as 11 would spread them.')],
      }),

      sec('coll', '8.5', 'Resolving collisions: separate chaining', { eyebrow: 'Two keys, one slot',
        body: `<p>The simplest remedy is to let a slot hold more than one key. In ${term('separate chaining')} each slot of the table is the head of a linked list; to insert, compute h(k) and add the key to that list (at the front, O(1)); to search, compute h(k) and scan only that list; to delete, remove the node from the list. The table never “fills”: chains just grow. With n keys in m slots the average chain has length α = n/m, so an unsuccessful search costs about 1 + α probes (one for the slot, α for the chain) and a successful one about 1 + α/2. Keep α near 1 or below and every operation is O(1) on average. The weakness is extra memory for the pointers and poorer cache behaviour; chains can be kept sorted or replaced by balanced trees (Java’s HashMap does this for long chains) to bound the worst case.</p><p>Insert 5, 10, 3, 8 into five slots with h(k) = k mod 5: 5 and 10 both hash to slot 0 and 3 and 8 to slot 3, giving the table <b>${ch.table}</b> — two chains of length two, four probes in total. The card shows the chains growing.</p>`,
        figs: [lab('hashing', { method: 'chaining', size: 5, keys: '5 10 3 8' }, 'Chaining keeps colliding keys in a list.', ['table'], { caption: 'chaining', name: 'chn' })],
        qs: [q('chain', 'In separate chaining with load factor α, the expected cost of an unsuccessful search is about…', ['1 + α probes.', 'One for the slot plus a scan of the average chain of length α.'], [['log n.', 'That is a tree.'], ['n.', 'That is the worst case with every key in one chain.']]), q('chainfull', 'Can a chained hash table become “full”?', ['No — chains simply grow longer, though performance degrades as α rises.', 'Rehashing into a larger table restores speed.'], [['Yes, when every slot has a key.', 'A slot can hold many keys.'], ['Yes, after m insertions.', 'There is no limit of m.']])],
        probs: [pr('p-chain', '<p>Insert 12, 44, 13, 88, 23, 94, 11, 39, 20, 16 into a table of 11 slots with h(k) = k mod 11 using chaining. Give the length of each non-empty chain.</p>', 'Hashes: 12→1, 44→0, 13→2, 88→0, 23→1, 94→6, 11→0, 39→6, 20→9, 16→5. Chains: slot 0: {44, 88, 11} (3); slot 1: {12, 23} (2); slot 2: {13}; slot 5: {16}; slot 6: {94, 39} (2); slot 9: {20}. Load factor 10/11 ≈ 0.91; longest chain 3.')],
      }),

      sec('open', '8.6', 'Open addressing: linear, quadratic and double hashing', { eyebrow: 'Probe for another slot',
        body: `<p>The other family keeps everything inside the table array, with no pointers. In ${term('open addressing')}, if the home slot h(k) is occupied, <em>probe</em> a fixed sequence of other slots until a free one is found. To search, follow the same sequence until you find the key or reach an empty slot (meaning it is absent). The table can hold at most m keys and must stay well below full. The probe sequence defines the scheme. In ${term('linear probing')} the i-th probe is (h(k) + i) mod m — try the next slot, then the next. It is simple and cache-friendly, but suffers <b>primary clustering</b>: runs of occupied slots grow, and any key hashing into a run extends it, so probe lengths balloon. ${term('Quadratic probing')} uses (h(k) + i²) mod m, jumping 1, 4, 9 slots away; it breaks up primary clusters but keys with the same home slot still share a probe sequence (<em>secondary clustering</em>), and for guaranteed success the table size should be prime and the load below ½. ${term('Double hashing')} uses a second hash for the step, (h₁(k) + i·h₂(k)) mod m, so different keys with the same home slot follow different sequences; with h₂ never 0 (for instance 1 + k mod (m − 1)) and m prime it comes closest to the ideal of uniform probing.</p><p>Insert 50, 700, 76, 85, 92, 73, 101 into seven slots, h = k mod 7. Linear probing gives <b>${lin.table}</b> using ${lin.probes} probes in total; quadratic gives <b>${qd.table}</b> (${qd.probes} probes); double hashing gives <b>${dbl.table}</b> (${dbl.probes} probes). The first keys fall in their home slots (50 → 1, 700 → 0, 85 → 1…), then collide: 85 finds slot 1 taken by 50 and moves on. Step through the cards and watch the probe sequences — red slots were probed and found occupied. The first program reproduces the linear-probing table, including 13 probes.</p><p><b>Deletion</b> needs care. If you simply empty a slot, you may cut a probe sequence in the middle: a later search for a key stored beyond it would stop at the hole and wrongly report “absent”. The standard fix is a <b>tombstone</b>: mark the slot “deleted”; searches continue past it, and insertions may reuse it. Too many tombstones degrade performance and trigger a rehash.</p>`,
        figs: [lab('hashing', { method: 'linear', size: 7, keys: '50 700 76 85 92 73 101' }, 'Red slots were probed and found occupied.', ['table', 'probes'], { caption: 'linear probing', name: 'lp' }), lab('hashing', { method: 'quadratic', size: 7, keys: '50 700 76 85 92 73 101' }, `Quadratic probing: ${qd.table}.`, ['table'], { caption: 'quadratic probing', name: 'qp' }), lab('hashing', { method: 'double', size: 7, keys: '50 700 76 85 92 73 101' }, 'Double hashing: the step depends on the key.', ['table'], { caption: 'double hashing', name: 'dh' }), cpp(`#include <iostream>
using namespace std;
int main() {
  int m = 7;
  int table[7];
  for (int i = 0; i < m; i++) table[i] = -1;
  int keys[7] = {50, 700, 76, 85, 92, 73, 101};
  int totalProbes = 0;
  for (int k = 0; k < 7; k++) {
    int h = keys[k] % m;
    int p = 1;
    while (table[h] != -1) {
      h = (h + 1) % m;
      p++;
    }
    table[h] = keys[k];
    totalProbes += p;
  }
  for (int i = 0; i < m; i++) cout << table[i] << " ";
  cout << "| " << totalProbes << endl;
  return 0;
}`, 'Linear probing: the table 700 50 85 92 73 101 76 and 13 probes.', { output: '700 50 85 92 73 101 76 | 13' })],
        worked: [step('Linear probing, m = 7. Insert 50: 50 mod 7 = 1 → slot 1 (empty). Insert 700: 700 mod 7 = 0 → slot 0.', '', { toc: 'First two' }), step('Insert 76: 76 mod 7 = 6 → slot 6. Insert 85: 85 mod 7 = 1 → slot 1 is taken → try 2: empty → place there (2 probes).', '85\\to\\text{slot }1\\text{ (taken)}\\to\\text{slot }2', { toc: '85 collides' }), step('Insert 92: 92 mod 7 = 1 → slots 1, 2 taken → slot 3. Insert 73: 73 mod 7 = 3 → taken → slot 4. Insert 101: 101 mod 7 = 3 → 3, 4 taken → 5. The cluster 1–5 grew with each arrival.', '[700,50,85,92,73,101,76]', { hero: true, toc: 'Cluster' })],
        qs: [q('clust', 'What problem does linear probing suffer from?', ['Primary clustering: long runs of filled slots grow, making probes longer.', 'Keys landing in a run all extend it.'], [['It cannot handle collisions.', 'That is its purpose.'], ['It needs a list per slot.', 'That is chaining.']]), q('tomb', 'Why can a deleted slot in open addressing not simply be set to empty?', ['It could break the probe sequence of another key stored beyond it, making that key unfindable.', 'A tombstone marker keeps the search going.'], [['Empty slots cannot be reused.', 'They can.'], ['It would change the hash function.', 'The hash function is unaffected.']]), q('dbl', 'What advantage does double hashing have over linear probing?', ['Keys with the same home slot follow different probe sequences, avoiding clustering.', 'The step size depends on the key through a second hash.'], [['It needs no table.', 'It still uses an array.'], ['It avoids a hash function.', 'It uses two.']]), q('quadfail', 'Quadratic probing may fail to find an empty slot even when the table is not full if…', ['The table size is not prime or the load factor is above ½.', 'The i² offsets may cycle through only a subset of slots.'], [['The keys are strings.', 'Key type is irrelevant.'], ['The table is a power of 10.', 'Powers of two or ten can give short cycles; the rule is about prime sizes and load.']])],
        probs: [pr('p-hash', '<p>Insert 50, 700, 76, 85, 92, 73, 101 into a table of size 7 with h(k) = k mod 7 and linear probing. Show the table.</p>', `Slots 0…6 hold <b>${lin.table}</b> (probes: ${lin.probes}).`, { verify: lab('hashing', { method: 'linear', size: 7, keys: '50 700 76 85 92 73 101' }, 'Step through.', ['table'], { caption: 'answer', name: 'ans' }) }), pr('p-quad', '<p>The quadratic and double-hashing tables for the same keys differ from the linear one. Which probing scheme needed the fewest probes in total here?</p>', `Linear: <b>${lin.probes}</b> probes; quadratic: <b>${qd.probes}</b>; double hashing: <b>${dbl.probes}</b>. The schemes that avoid long clusters need fewer probes.`)],
      }),

      sec('perf', '8.7', 'Cost of hashing and rehashing', { eyebrow: 'Expectations',
        body: `<p>How much does collision resolution cost? Under the usual assumption of uniform hashing the expected number of probes depends only on the load factor α. With chaining: 1 + α for an unsuccessful search and 1 + α/2 for a successful one. With linear probing the classic results (Knuth) are about ½(1 + 1/(1 − α)²) probes for an unsuccessful search and ½(1 + 1/(1 − α)) for a successful one; uniform probing (the ideal that double hashing approaches) gives 1/(1 − α) and (1/α) ln(1/(1 − α)). The table shows how sharply open addressing degrades as the table fills: at α = 0.5 an unsuccessful linear-probing search costs 2.5 probes, at 0.8 it costs 13, at 0.9 it costs 50.5.</p><p>The practical rules follow directly. Keep α below about 0.5–0.7 for open addressing and below about 1–2 for chaining. When the load exceeds the threshold, <b>rehash</b>: allocate a larger table (about double, then the next prime), and re-insert every key with the new hash function, since the index depends on m. A single rehash costs O(n), but as with the doubling array it is amortised: inserting n keys costs O(n) in total, so each insertion is O(1) amortised.</p>`,
        figs: [probes],
        worked: [step('Table with α = 0.5 and chaining.', '', { toc: 'Given' }), step('Expected unsuccessful probes.', '1+\\alpha=1.5', { toc: 'Chaining' }), step('Same load with linear probing: unsuccessful search.', '\\tfrac12\\left(1+\\tfrac{1}{(1-0.5)^{2}}\\right)=\\tfrac12(1+4)=2.5', { hero: true, toc: 'Linear probing' })],
        qs: [q('resize', 'Why resize a hash table when it gets too full?', ['Probe sequences and chains lengthen sharply, destroying O(1) behaviour.', 'Doubling and rehashing restores a low load factor.'], [['To change the hash function.', 'Not necessary.'], ['To sort the keys.', 'Hashing does not sort.']]), q('rehashwhy', 'After doubling a hash table’s size, why must every key be re-inserted rather than copied to the same index?', ['The index is h(k) mod m; with a new m the home slot changes.', 'The probe sequences also change.'], [['Because keys change value.', 'Keys are unchanged.'], ['Because the old array is deleted.', 'The issue is the modulus.']])],
        probs: [pr('p-load', '<p>A table with 1000 slots holds 700 keys. Give α and the expected probes for an unsuccessful search with (a) chaining, (b) linear probing.</p>', 'α = 0.7. (a) 1 + 0.7 = <b>1.7</b>. (b) ½(1 + 1/0.09) = ½(1 + 11.1) = <b>6.1</b>. Chaining tolerates a fuller table.'), pr('p-amor', '<p>A table of size 8 is doubled whenever it is full (α = 1). How many total key re-insertions occur while inserting 64 keys?</p>', 'Rehash happens when the table is full at 8, 16, 32 keys: re-inserting 8 + 16 + 32 = <b>56</b>, plus the 64 normal insertions — about two insertions per key: O(1) amortised.')],
      }),

      sec('use', '8.8', 'Where hashing is used — and where it is not', { eyebrow: 'Applications',
        body: `<p>Hash tables are the workhorse of everyday programming: dictionaries and sets (C++ <code>unordered_map</code> and <code>unordered_set</code>, Python <code>dict</code>, Java <code>HashMap</code>), symbol tables in compilers, caches, database hash indexes and hash joins, de-duplication, counting frequencies, and memoisation tables. Related uses of hash <em>functions</em> include checksums, the Rabin–Karp string-matching algorithm, Bloom filters (a compact probabilistic “probably present” test) and password storage with a salted cryptographic hash. The program counts word frequencies — the classic hash-table job.</p><p>But hashing scatters keys, so it keeps <b>no order</b>. Finding the smallest key, the next larger key, or all keys in a range is O(n) on a hash table; a balanced tree or B-tree answers those in O(log n) and lists the results in sorted order. If you need only exact-match lookup, use a hash table; if you need order or range queries, use a tree. Worst-case guarantees also differ: a hash table can degrade to O(n) with bad luck or an adversary choosing colliding keys (defended by randomised hash functions), while a balanced tree is O(log n) always. <b>Perfect hashing</b> for a fixed key set and <b>cuckoo hashing</b> (two tables, each key has two possible homes) give O(1) <em>worst-case</em> lookups.</p>`,
        figs: [cpp(`#include <iostream>
#include <unordered_map>
#include <string>
using namespace std;
int main() {
  string w[6] = {"red", "blue", "red", "green", "blue", "red"};
  unordered_map<string, int> freq;
  for (int i = 0; i < 6; i++) freq[w[i]]++;
  cout << freq["red"] << " " << freq["blue"] << " " << freq["green"] << endl;
  return 0;
}`, 'Counting words is the classic hash-table job.', { output: '3 2 1' })],
        qs: [q('order', 'Which query is hash tables’ weak spot?', ['Range queries and sorted traversal.', 'Hashing scatters neighbouring keys.'], [['Exact-match lookup.', 'That is their strength.'], ['Insertion.', 'Average O(1).']]), q('which', 'You need to find the 10 smallest keys among a million. Which structure suits better?', ['A balanced search tree or heap — order is available.', 'A hash table would need a full scan and sort.'], [['A hash table.', 'It keeps no order.'], ['A linked list.', 'It needs a full scan.']])],
        probs: [pr('p-use', '<p>For each task choose a hash table, a balanced tree, or either: (a) membership test for visited URLs; (b) print all students with marks between 60 and 80, sorted; (c) count word frequencies.</p>', '(a) <b>hash table</b> (exact match). (b) <b>balanced tree</b> (range query and sorted output). (c) <b>hash table</b> (counting by exact key); a tree also works at O(log n) per update.')],
      }),

      sec('summary', '8.9', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Sequential search: O(n), any data; average (n + 1)/2. Binary search: O(log n), needs sorted random-access data; at most ⌊log₂ n⌋ + 1 probes.</li><li>Hashing maps keys to slots with h(k); load factor α = n/m; collisions are unavoidable.</li><li>Good hash functions spread keys evenly: division (prime m), multiplication, mid-square, folding, polynomial for strings.</li><li>Chaining: lists per slot, expected 1 + α probes. Open addressing: linear (clusters), quadratic, double hashing; deletion needs tombstones.</li><li>Open addressing degrades sharply with α, so rehash (double and re-insert) around 0.5–0.7; amortised O(1) per insertion.</li><li>Hash tables give O(1) exact lookup but no order; use trees for range and sorted queries.</li></ul>` }),
    ],
  })
}
