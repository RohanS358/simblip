import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, q, pr, step, sec, term, run }) => {
  const lin = run('hashing', { method: 'linear', size: 7, keys: '50 700 76 85 92 73 101' }), ch = run('hashing', { method: 'chaining', size: 5, keys: '5 10 3 8' }), qd = run('hashing', { method: 'quadratic', size: 7, keys: '50 700 76 85 92 73 101' })
  return lesson({
    title: 'Searching and hashing',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 8',
    subtitle: 'From scanning every item to jumping straight to it — and what to do when two keys want the same slot.',
    sections: [
      sec('seq', '8.1', 'Sequential and binary search', { eyebrow: 'Looking',
        body: `<p>${term('Sequential search')} checks items one by one: O(n), works on anything. ${term('Binary search')} needs sorted data: compare with the middle item, discard half, repeat — O(log n). One million sorted items need at most 20 probes.</p>`,
        figs: [cpp(`#include <iostream>
#include <vector>
using namespace std;
int main() {
  vector<int> a = {2, 5, 8, 12, 16, 23, 38};
  int target = 16, lo = 0, hi = a.size() - 1, found = -1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    cout << a[mid] << " ";
    if (a[mid] == target) { found = mid; break; }
    if (a[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  cout << "index " << found << endl;
  return 0;
}`, 'Probes 12, then 23, then 16: three steps for seven items.', { output: '12 23 16 index 4' })],
        worked: [step('Worst case probes for n items is ⌊log₂ n⌋ + 1.', '', { toc: 'Formula' }), step('For n = 1 000 000.', '\\lfloor\\log_2 10^6\\rfloor+1=20', { hero: true, toc: 'Million items' })],
        qs: [q('bs', 'Binary search requires…', ['The data to be sorted.', 'Discarding half is only valid if order tells you which half.'], [['Unique keys only.', 'Duplicates are allowed.'], ['A linked list.', 'It needs random access.']])] }),
      sec('hash', '8.2', 'Hash tables', { eyebrow: 'Direct addressing by computation',
        body: `<p>A ${term('hash function')} turns a key into an array index, e.g. <code>h(k) = k mod m</code>. Lookup, insert and delete are O(1) on average. The table has <i>m</i> slots; the ${term('load factor')} α = n/m measures how full it is. A good hash spreads keys evenly; using a prime m helps.</p>`,
        qs: [q('load', 'What is the load factor?', ['n / m — stored items divided by table slots.', 'As α rises, collisions become more likely.'], [['m / n.', 'Inverted.'], ['The size of the hash function.', 'No.']])] }),
      sec('coll', '8.3', 'Collisions: chaining and open addressing', { eyebrow: 'Two keys, one slot',
        body: `<p>Two keys with the same hash ${term('collide')}. ${term('Chaining')}: each slot holds a list; colliding keys join it. ${term('Open addressing')}: probe other slots in a fixed sequence until a free one is found — ${term('linear')} (h, h+1, h+2…), ${term('quadratic')} (h, h+1², h+2²…, avoids long runs), ${term('double hashing')} (step from a second hash). Insert 50 700 76 85 92 73 101 into 7 slots with linear probing: table <b>${lin.table}</b>.</p>`,
        figs: [lab('hashing', { method: 'linear', size: 7, keys: '50 700 76 85 92 73 101' }, 'Red slots were probed and found occupied.', ['table', 'probes'], { caption: 'linear probing', name: 'lp' }), lab('hashing', { method: 'chaining', size: 5, keys: '5 10 3 8' }, 'Chaining keeps colliding keys in a list.', ['table'], { caption: 'chaining', name: 'chn' }), lab('hashing', { method: 'quadratic', size: 7, keys: '50 700 76 85 92 73 101' }, `Quadratic probing: ${qd.table}.`, ['table'], { caption: 'quadratic probing', name: 'qp' })],
        qs: [q('clust', 'What problem does linear probing suffer from?', ['Primary clustering: long runs of filled slots grow, making probes longer.', 'Keys landing in a run all extend it.'], [['It cannot handle collisions.', 'That is its purpose.'], ['It needs a list per slot.', 'That is chaining.']])],
        probs: [pr('p-hash', '<p>Insert 50, 700, 76, 85, 92, 73, 101 into a table of size 7 with h(k) = k mod 7 and linear probing. Show the table.</p>', `Slots 0…6 hold <b>${lin.table}</b> (probes: ${lin.probes}).`, { verify: lab('hashing', { method: 'linear', size: 7, keys: '50 700 76 85 92 73 101' }, 'Step through.', ['table'], { caption: 'answer', name: 'ans' }) })] }),
      sec('perf', '8.4', 'Cost of hashing', { eyebrow: 'Expectations',
        body: `<p>With chaining the expected cost of an unsuccessful search is 1 + α probes. For open addressing with linear probing it is about ½(1 + 1/(1−α)²): it explodes as α → 1, so keep α below about 0.7 and resize (rehash into a bigger table) when it is exceeded.</p>`,
        worked: [step('Table with α = 0.5 and chaining.', '', { toc: 'Given' }), step('Expected unsuccessful probes.', '1+\\alpha=1.5', { hero: true, toc: 'Chaining' })],
        qs: [q('resize', 'Why resize a hash table when it gets too full?', ['Probe sequences and chains lengthen sharply, destroying O(1) behaviour.', 'Doubling and rehashing restores a low load factor.'], [['To change the hash function.', 'Not necessary.'], ['To sort the keys.', 'Hashing does not sort.']])] }),
      sec('use', '8.5', 'Where hashing is used', { eyebrow: 'Applications',
        body: `<p>Dictionaries and sets (C++ <code>unordered_map</code>), symbol tables in compilers, caches, database hash indexes, password storage (with a cryptographic hash) and file deduplication. Hash tables do not keep keys in order and have no fast range queries — a balanced tree or B-tree is better there.</p>`,
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
        qs: [q('order', 'Which query is hash tables’ weak spot?', ['Range queries and sorted traversal.', 'Hashing scatters neighbouring keys.'], [['Exact-match lookup.', 'That is their strength.'], ['Insertion.', 'Average O(1).']])] }),
      sec('summary', '8.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Sequential O(n); binary O(log n) on sorted data; hashing O(1) average.</li><li>Collisions: chaining or probing; keep load factor low.</li></ul>` }),
    ],
  })
}
