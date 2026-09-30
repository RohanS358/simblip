import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Queues and linked lists',
  kicker: 'ENCT 252 · Data Structure and Algorithms · Chapters 3–4',
  subtitle: 'First in, first out; and a chain of nodes that grows one link at a time.',
  sections: [
    sec('queue', '3.1', 'The queue ADT', { eyebrow: 'FIFO',
      body: `<p>A ${term('queue')} adds at the ${term('rear')} (enqueue) and removes from the ${term('front')} (dequeue): first in, first out. Think of a print queue. A plain array queue wastes space as the front creeps forward; a ${term('circular queue')} wraps the indices with modulo, so the array is fully reused. A ${term('deque')} allows both ends; a ${term('priority queue')} removes the highest-priority item first (implemented by a heap).</p>`,
      figs: [cpp(`#include <iostream>
#include <queue>
using namespace std;
int main() {
  queue<int> q;
  for (int i = 1; i <= 4; i++) q.push(i * 10);
  while (!q.empty()) {
    cout << q.front() << " ";
    q.pop();
  }
  cout << endl;
  return 0;
}`, 'The same four numbers as the stack — now in arrival order.', { output: '10 20 30 40' })],
      qs: [q('fifo', 'Enqueue 1, 2, 3 then dequeue once. What is at the front?', ['2.', '1 left first.'], [['1.', 'It was removed.'], ['3.', 'It is the rear.']])] }),
    sec('circ', '3.2', 'Circular queue arithmetic', { eyebrow: 'Wrap around',
      body: `<p>With array size <i>N</i>, advance an index by <code>i = (i + 1) % N</code>. The queue is empty when front == rear and (keeping one slot unused) full when (rear + 1) % N == front. Otherwise empty and full look identical.</p>`,
      worked: [step('N = 5, front = 3, rear = 4. Enqueue one item.', '', { toc: 'Given' }), step('rear becomes (4 + 1) mod 5 = 0 — it wrapped.', '(4+1)\\bmod 5=0', { hero: true, toc: 'Wrap' }), step('Full check: (rear+1) mod N = 1 ≠ front 3, so there is still room.', '', { toc: 'Full?' })],
      qs: [q('full', 'Why do circular queues usually leave one slot unused?', ['To tell a full queue apart from an empty one (front == rear in both cases otherwise).', 'The sacrificed slot makes the two conditions different.'], [['To speed up enqueue.', 'Not the reason.'], ['Because arrays start at 0.', 'Unrelated.']])] }),
    sec('list', '4.1', 'The linked list', { eyebrow: 'Nodes and pointers',
      body: `<p>A ${term('linked list')} stores each item in a node with a <code>next</code> pointer; you hold only the ${term('head')}. Insert at the head is O(1); insert after a known node is O(1); search is O(n); there is no index access. Nodes are allocated individually, so the list grows without a fixed size. ${term('Doubly linked')} nodes add a <code>prev</code> pointer (traverse both ways; deletion given the node is O(1)); ${term('circular')} lists link the last node back to the first.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
struct Node {
  int val;
  Node* next;
};
int main() {
  Node* head = nullptr;
  for (int i = 1; i <= 3; i++) {
    Node* n = new Node();
    n->val = i * 10;
    n->next = head;
    head = n;
  }
  for (Node* p = head; p != nullptr; p = p->next) cout << p->val << " ";
  cout << endl;
  return 0;
}`, 'Inserting at the head reverses the order; watch the pointer arrows.', { output: '30 20 10' })],
      qs: [q('ins', 'Cost of inserting at the head of a singly linked list?', ['O(1).', 'Create a node, point it at the old head, move the head — no shifting.'], [['O(n).', 'That is inserting at the tail without a tail pointer.'], ['O(log n).', 'Not a tree.']])] }),
    sec('ops', '4.2', 'Insert, delete and reverse', { eyebrow: 'Pointer surgery',
      body: `<p>To delete the node after <code>p</code>: <code>q = p->next; p->next = q->next; delete q;</code>. To reverse: keep <code>prev</code>, <code>cur</code>, <code>next</code>; for each node save next, point cur->next at prev, then advance all three. Always handle the empty list and the single-node case.</p>`,
      figs: [dia(`direction: right
[head] as h #blue
[10] as a #mint
[20] as b #mint
[30] as c #mint
(null) as n
h -> a
a -> b
b -> c
c -> n
@0 h -> a : p
@1 a -> b : p
@2 b -> c : p
@3 c -> n : stop
loop 5`, 'Traversal follows next until null.', { caption: 'walking a list' })],
      qs: [q('del', 'To delete the node after p you must…', ['Re-link p->next past it (and free it).', 'Otherwise the chain is broken or memory leaks.'], [['Only free it.', 'p would keep pointing at freed memory.'], ['Move the head.', 'Unrelated.']])] }),
    sec('apps', '4.3', 'Applications: stack, queue and polynomials', { eyebrow: 'Uses',
      body: `<p>A list makes a stack (push/pop at the head) and a queue (insert at tail, remove at head, with a tail pointer) without a size limit. A polynomial is stored as a list of (coefficient, exponent) nodes in decreasing exponent; adding two polynomials walks both lists like merging sorted lists.</p>`,
      worked: [step('Add 3x² + 2x + 1 and x² + 5.', '', { toc: 'Task' }), step('Merge by exponent: x² terms add; x term alone; constants add.', '4x^2 + 2x + 6', { hero: true, toc: 'Result' })],
      qs: [q('poly', 'Why is a linked list good for sparse polynomials like x¹⁰⁰ + 1?', ['Only non-zero terms are stored.', 'An array would need 101 slots.'], [['Lists are faster for arithmetic.', 'Not inherently.'], ['Lists cannot store exponents.', 'They can.']])],
      probs: [pr('p1', '<p>Array vs linked list: which is better for frequent random access by index? For frequent insertion in the middle?</p>', 'Random access: <b>array</b> (O(1) vs O(n)). Insertion in the middle once you hold the position: <b>linked list</b> (O(1) vs O(n) shifting).')] }),
    sec('summary', '4.4', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Queue = FIFO; circular arrays reuse space.</li><li>Linked list: O(1) insertion at a known place, O(n) search.</li></ul>` }),
  ],
})
