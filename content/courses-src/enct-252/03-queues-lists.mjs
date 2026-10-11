import { lesson } from '../kit.mjs'
export default ({ dia, cpp, scr, q, pr, step, sec, term }) => {
  const cmp = scr(`var t = create("table", { headers: "Operation;Array;Singly linked list;Doubly linked list", data: ${JSON.stringify([['Access k-th element', 'O(1)', 'O(n)', 'O(n)'], ['Insert at head', 'O(n) shift', 'O(1)', 'O(1)'], ['Insert at tail', 'O(1) amortised', 'O(n) (O(1) with tail ptr)', 'O(1) with tail ptr'], ['Insert after a known node', 'O(n) shift', 'O(1)', 'O(1)'], ['Delete a known node', 'O(n) shift', 'O(n) (need predecessor)', 'O(1)'], ['Search (unsorted)', 'O(n)', 'O(n)', 'O(n)'], ['Extra memory per item', '0', '1 pointer', '2 pointers']])}, summary: "None" });`, 'Neither wins everywhere — choose by the operation you do most.', { caption: 'array versus linked lists' })
  return lesson({
    title: 'Queues and linked lists',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapters 3–4',
    subtitle: 'First in, first out; and a chain of nodes that grows one link at a time. The chapter builds queues (linear, circular, deque, priority) and the linked list family, then compares them with arrays.',
    sections: [
      sec('queue', '3.1', 'The queue ADT', { eyebrow: 'FIFO',
        body: `<p>People wait in a line at a ticket counter: the first to arrive is the first to be served. A ${term('queue')} models that. Items are added at one end, the ${term('rear')} (or tail), by <b>enqueue</b>, and removed from the other end, the ${term('front')} (or head), by <b>dequeue</b>: first in, first out, ${term('FIFO')}. You may also read the front item (<b>peek</b>/<b>front</b>) and test for <b>isEmpty</b> and <b>isFull</b>. Where the stack reverses order, the queue preserves it.</p><p>Queues are everywhere that work must be handled fairly in arrival order: the OS ready queue and printer spooler, network routers buffering packets, keyboard input buffers, call-centre systems, and the breadth-first search algorithm we meet in the graphs chapter. Their cost model is the same as the stack’s: with a good implementation both enqueue and dequeue are O(1). The program below enqueues 10, 20, 30, 40 and drains them — the same numbers as in the stack chapter, now coming out in arrival order.</p>`,
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
        qs: [q('fifo', 'Enqueue 1, 2, 3 then dequeue once. What is at the front?', ['2.', '1 left first.'], [['1.', 'It was removed.'], ['3.', 'It is the rear.']]), q('stackvs', 'Items 1, 2, 3 are inserted in that order. Which structure returns them as 3, 2, 1?', ['A stack.', 'Last in, first out reverses the arrival order.'], [['A queue.', 'A queue returns them as 1, 2, 3.'], ['Both.', 'Only the stack reverses.']])],
      }),

      sec('impl', '3.2', 'Array implementations and the circular queue', { eyebrow: 'Wrap around',
        body: `<p>Implement a queue on an array with two indices, <code>front</code> and <code>rear</code>. Enqueue stores at <code>rear</code> and increments it; dequeue reads <code>front</code> and increments it. There is a flaw: both indices only move forward, so after N enqueues and dequeues <code>rear</code> reaches the end even though the array may be nearly empty — the front slots are wasted. Shifting every element down on each dequeue fixes it but makes dequeue O(n).</p><p>The elegant fix is the ${term('circular queue')}: treat the array as a ring by advancing indices with modulo arithmetic, <code>i = (i + 1) % N</code>. When rear reaches the last slot the next enqueue wraps to slot 0, reusing the space freed by dequeues. One subtlety: if front == rear means empty, then a completely full queue would look the same. The usual remedy is to leave <b>one slot unused</b>: the queue is empty when front == rear and full when (rear + 1) % N == front. Alternatively keep a separate count. Both enqueue and dequeue are then O(1) with a fixed capacity.</p><p>The program simulates a ring of N = 5 slots (capacity 4 because one slot stays empty) receiving 1…7 and, when full, discarding the oldest — as a log buffer does. After seven insertions the ring holds 4, 5, 6, 7.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int N = 5;
  int a[5];
  int front = 0, rear = 0;
  for (int v = 1; v <= 7; v++) {
    if ((rear + 1) % N == front) {
      cout << "full at " << v << endl;
      front = (front + 1) % N;
    }
    a[rear] = v;
    rear = (rear + 1) % N;
  }
  cout << front << " " << rear << endl;
  return 0;
}`, 'Watch rear wrap from 4 back to 0; front is pushed forward when the ring is full.', { output: 'full at 5\nfull at 6\nfull at 7\n3 2' })],
        worked: [step('N = 5, front = 3, rear = 4. Enqueue one item.', '', { toc: 'Given' }), step('rear becomes (4 + 1) mod 5 = 0 — it wrapped.', '(4+1)\\bmod 5=0', { toc: 'Wrap' }), step('Full check: (rear + 1) mod N = 1 ≠ front = 3, so there is still room. The number of items is (rear − front + N) mod N.', '(0-3+5)\\bmod5=2', { hero: true, toc: 'Count' })],
        qs: [q('full', 'Why do circular queues usually leave one slot unused?', ['To tell a full queue apart from an empty one (front == rear in both cases otherwise).', 'The sacrificed slot makes the two conditions different.'], [['To speed up enqueue.', 'Not the reason.'], ['Because arrays start at 0.', 'Unrelated.']]), q('linearflaw', 'What is wrong with a simple (non-circular) array queue?', ['After many enqueue/dequeue pairs the rear index hits the end although the front slots are free, wasting space.', 'Circular indexing reuses the vacated slots.'], [['Dequeue is O(n) always.', 'Only if you shift elements; the simple version does not shift.'], ['It cannot store integers.', 'It can store anything.']])],
        probs: [pr('p-circ', '<p>A circular queue has N = 8, front = 6 and rear = 2. How many items does it hold, and in which array positions are they?</p>', 'Count = (rear − front + N) mod N = (2 − 6 + 8) mod 8 = <b>4</b>. Positions: 6, 7, 0, 1 (rear = 2 is the next free slot).'), pr('p-full', '<p>N = 6, front = 2. At which value of rear is the queue full?</p>', 'Full when (rear + 1) mod 6 = 2 → rear = <b>1</b> (holding 5 items, one slot unused).')],
      }),

      sec('variants', '3.3', 'Deque and priority queue', { eyebrow: 'Variations',
        body: `<p>Two relatives of the queue deserve their own names. A ${term('deque')} (double-ended queue, “deck”) allows insertion and removal at <em>both</em> ends — push_front, push_back, pop_front, pop_back. It generalises both stack and queue and is used for sliding-window algorithms and work-stealing schedulers. Variants restrict one end: an <em>input-restricted</em> deque inserts at one end only, an <em>output-restricted</em> one removes from one end only.</p><p>A ${term('priority queue')} abandons FIFO: every item carries a priority and <b>dequeue removes the item with the highest priority</b>, whatever its arrival order. It models hospital triage, CPU priority scheduling, event simulation and Dijkstra’s algorithm. The naive implementation — an unsorted list (O(1) insert, O(n) remove-max) or a sorted list (O(n) insert, O(1) remove-max) — is improved to O(log n) for both by a <b>heap</b>, which the trees chapter builds. The programs show both: a deque pushed at both ends, and a priority queue returning the largest first even though 50 arrived third.</p>`,
        figs: [cpp(`#include <iostream>
#include <deque>
using namespace std;
int main() {
  deque<int> d;
  d.push_back(2);
  d.push_back(3);
  d.push_front(1);
  d.push_front(0);
  cout << d.front() << " " << d.back() << " ";
  d.pop_front();
  d.pop_back();
  cout << d.front() << " " << d.back() << endl;
  return 0;
}`, 'Both ends are open: 0 1 2 3, then trim both ends.', { output: '0 3 1 2' }), cpp(`#include <iostream>
#include <queue>
using namespace std;
int main() {
  priority_queue<int> pq;
  pq.push(30);
  pq.push(10);
  pq.push(50);
  pq.push(20);
  while (!pq.empty()) {
    cout << pq.top() << " ";
    pq.pop();
  }
  cout << endl;
  return 0;
}`, 'Largest first, regardless of arrival order.', { output: '50 30 20 10' })],
        qs: [q('pq', 'Which structure returns the item with the highest priority regardless of arrival order?', ['A priority queue.', 'FIFO order is replaced by priority order.'], [['A plain queue.', 'It returns the oldest item.'], ['A stack.', 'It returns the newest item.']]), q('deque', 'A deque supports which operations?', ['Insertion and removal at both ends.', 'It behaves as a stack if you use one end and a queue if you use both ends in opposite roles.'], [['Only removal at both ends.', 'It supports insertion at both ends too.'], ['Random access in O(1) only.', 'That describes an array.']])],
        probs: [pr('p-pqcost', '<p>Compare the cost of enqueue and remove-max for a priority queue built on (a) an unsorted array, (b) a sorted array, (c) a heap.</p>', '(a) insert O(1), remove-max O(n). (b) insert O(n) (find place, shift), remove-max O(1). (c) heap: both <b>O(log n)</b>.')],
      }),

      sec('qapps', '3.4', 'Using queues: buffering, scheduling and simulation', { eyebrow: 'Applications',
        body: `<p>A queue decouples a producer from a consumer that run at different speeds. A keyboard driver enqueues keystrokes as they happen; the program dequeues them when it is ready. A router enqueues arriving packets and forwards them at the link speed — when the queue is full, packets are dropped. The OS ready queue and I/O device queues are FIFO lists of process control blocks. Breadth-first search uses a queue to visit vertices level by level. And a queue is the core of a <b>simulation</b>: customers arrive, wait in line, and are served one per tick; the queue length tells you whether the system is overloaded.</p><p>The program simulates six time steps with arrivals of 1, 0, 2, 0, 1 and 1 customers; one customer is served per step. Five are served and the queue ends empty, so the server kept up. If one more customer had arrived at the start, a backlog would have remained.</p>`,
        figs: [cpp(`#include <iostream>
#include <queue>
using namespace std;
int main() {
  queue<int> q;
  int served = 0;
  int arrivals[6] = {1, 0, 2, 0, 1, 1};
  for (int t = 0; t < 6; t++) {
    for (int k = 0; k < arrivals[t]; k++) q.push(t);
    if (!q.empty()) {
      q.pop();
      served++;
    }
  }
  cout << served << " " << q.size() << endl;
  return 0;
}`, 'Customers served and the queue length left at the end.', { output: '5 0' })],
        qs: [q('qbuf', 'A fast producer feeds a slow consumer through a bounded queue. What happens when the queue fills?', ['The producer must wait or items must be dropped, depending on the design.', 'A bounded buffer’s limit is its safety valve.'], [['The queue grows without limit.', 'A bounded queue cannot.'], ['The consumer speeds up.', 'It does not.']])],
      }),

      sec('list', '4.1', 'The linked list', { eyebrow: 'Nodes and pointers',
        body: `<p>An array keeps its items side by side in one block of memory, which is why indexing is instant — and why inserting in the middle means shifting everything after it, and growing means copying. A ${term('linked list')} makes the opposite trade. Each item lives in its own ${term('node')} that holds the value and a <code>next</code> pointer to the following node; nodes can be anywhere in memory. You keep a single pointer, the ${term('head')}, to the first node; the last node’s next is <code>null</code>. To reach the k-th item you must follow k pointers — O(k) — so there is no index access; in exchange, once you stand at a position, insertion and deletion there are O(1) because only pointers change, and the list grows one node at a time with no copying and no pre-declared size.</p><p>In C++ a node is a struct: <code>struct Node { int val; Node* next; };</code> and a node is created with <code>new</code> and destroyed with <code>delete</code>. The program inserts 10, 20, 30 at the head, one after another: each new node points to the old head and becomes the head, so the list reads 30 20 10 — reversed. Step through it in the DSA Lab and watch the pointer arrows.</p><p>Three variants matter. A ${term('doubly linked')} list adds a <code>prev</code> pointer, so you can walk both ways and delete a node given only the node itself (O(1)), at the cost of an extra pointer per node. A ${term('circular')} list links the last node back to the first, useful for round-robin scheduling. A <b>header node</b> (sentinel) before the first item removes the special case for the empty list.</p>`,
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
}`, 'Inserting at the head reverses the order; watch the pointer arrows.', { output: '30 20 10' }), cmp],
        qs: [q('ins', 'Cost of inserting at the head of a singly linked list?', ['O(1).', 'Create a node, point it at the old head, move the head — no shifting.'], [['O(n).', 'That is inserting at the tail without a tail pointer.'], ['O(log n).', 'Not a tree.']]), q('access', 'Why is reading the 100th element of a linked list slower than of an array?', ['You must follow 99 next pointers from the head; an array computes the address directly.', 'That is O(n) versus O(1).'], [['Linked lists are stored on disk.', 'Both live in memory.'], ['Because nodes are bigger.', 'The problem is the traversal, not the size.']]), q('doubly', 'What does a doubly linked list gain over a singly linked one?', ['O(1) deletion of a node given only the node, and traversal in both directions, at the cost of an extra pointer.', 'The prev pointer replaces the search for the predecessor.'], [['It uses less memory.', 'It uses more — two pointers per node.'], ['It has O(1) indexing.', 'Indexing is still O(n).']])],
      }),

      sec('ops', '4.2', 'Insert, delete, search', { eyebrow: 'Pointer surgery',
        body: `<p>Every list operation is a careful rearrangement of pointers, and every bug is a pointer set in the wrong order. <b>Insert at the head</b>: <code>n->next = head; head = n;</code>. <b>Insert after node p</b>: <code>n->next = p->next; p->next = n;</code> — set the new node’s pointer <em>first</em>, or you lose the rest of the list. <b>Insert at the tail</b>: walk to the last node (O(n)) unless you keep a tail pointer. <b>Delete the node after p</b>: <code>q = p->next; p->next = q->next; delete q;</code>. <b>Delete the head</b>: <code>t = head; head = head->next; delete t;</code>. <b>Search</b>: walk from the head until the value matches or you reach null — O(n). Always ask the four questions: what if the list is empty? what if there is one node? what if the target is the head? the tail?</p><p>Deleting the node after the one holding 2 in the list 1 2 3 4 5 re-links 2 to 4 and frees 3, leaving 1 2 4 5. To delete a node you must first have its <em>predecessor</em>, which is why a singly linked deletion by value needs a trailing pointer, and why a doubly linked list (which stores the predecessor in the node) deletes in O(1).</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* next; };
int main() {
  Node* head = nullptr;
  for (int i = 5; i >= 1; i--) {
    Node* n = new Node();
    n->val = i;
    n->next = head;
    head = n;
  }
  Node* p = head;
  while (p->val != 2) p = p->next;
  Node* q = p->next;
  p->next = q->next;
  delete q;
  for (Node* x = head; x != nullptr; x = x->next) cout << x->val << " ";
  cout << endl;
  return 0;
}`, 'Delete the node after 2: its pointer skips over 3.', { output: '1 2 4 5' }), dia(`direction: right
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
        qs: [q('del', 'To delete the node after p you must…', ['Re-link p->next past it (and free it).', 'Otherwise the chain is broken or memory leaks.'], [['Only free it.', 'p would keep pointing at freed memory.'], ['Move the head.', 'Unrelated.']]), q('order', 'When inserting new node n after p, which assignment must come first?', ['n->next = p->next;', 'If p->next = n came first, the old successor would be lost.'], [['p->next = n;', 'This would orphan the rest of the list.'], ['Either order works.', 'The order matters.']])],
        probs: [pr('p-del', '<p>List: 4 → 7 → 9 → 12. Write the pointer assignments to insert 8 after 7, giving 4 → 7 → 8 → 9 → 12.</p>', '<code>n = new Node(8); n->next = p->next; p->next = n;</code> where p points at 7. n now points to 9 and 7 points to n.')],
      }),

      sec('reverse', '4.3', 'Reversing a list and finding the middle', { eyebrow: 'Classic exercises',
        body: `<p>Two exercises appear in almost every exam. <b>Reverse a list in place</b> with three pointers: <code>prev</code> (initially null), <code>cur</code> (the head) and <code>nxt</code>. For each node: save <code>nxt = cur->next</code>, flip the link <code>cur->next = prev</code>, then advance <code>prev = cur; cur = nxt</code>. When <code>cur</code> is null, <code>prev</code> is the new head. It takes O(n) time and O(1) extra space. Run the program: the list 40 30 20 10 becomes 10 20 30 40.</p><p><b>Find the middle</b> in a single pass with two pointers moving at different speeds: <code>slow</code> advances one node per step and <code>fast</code> two. When fast reaches the end, slow is at the middle — no need to count the length first. The same “tortoise and hare” idea detects a cycle (Floyd’s algorithm): if the list loops back on itself, fast eventually laps slow and they meet; if it has an end, fast reaches null. For 1…7 the middle is the 4th node, value 4.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* next; };
Node* push(Node* head, int v) {
  Node* n = new Node();
  n->val = v;
  n->next = head;
  return n;
}
Node* reverse(Node* head) {
  Node* prev = nullptr;
  Node* cur = head;
  while (cur != nullptr) {
    Node* nxt = cur->next;
    cur->next = prev;
    prev = cur;
    cur = nxt;
  }
  return prev;
}
int main() {
  Node* head = nullptr;
  for (int i = 1; i <= 4; i++) head = push(head, i * 10);
  for (Node* p = head; p != nullptr; p = p->next) cout << p->val << " ";
  cout << endl;
  head = reverse(head);
  for (Node* p = head; p != nullptr; p = p->next) cout << p->val << " ";
  cout << endl;
  return 0;
}`, 'Three pointers walk the list, flipping each link.', { output: '40 30 20 10 \n10 20 30 40' }), cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* next; };
int main() {
  Node* head = nullptr;
  for (int i = 7; i >= 1; i--) {
    Node* n = new Node();
    n->val = i;
    n->next = head;
    head = n;
  }
  Node* slow = head;
  Node* fast = head;
  while (fast != nullptr && fast->next != nullptr) {
    slow = slow->next;
    fast = fast->next->next;
  }
  cout << slow->val << endl;
  return 0;
}`, 'slow moves 1, fast moves 2: when fast ends, slow is in the middle.', { output: '4' })],
        worked: [step('Reverse 1 → 2 → 3 by hand. Start: prev = null, cur = 1.', '', { toc: 'Start' }), step('Node 1: nxt = 2; 1.next = null; prev = 1; cur = 2.', '1\\to\\text{null}', { toc: 'Step 1' }), step('Node 2: nxt = 3; 2.next = 1; prev = 2; cur = 3. Node 3: nxt = null; 3.next = 2; prev = 3; cur = null.', '3\\to2\\to1', { hero: true, toc: 'Done' })],
        qs: [q('rev', 'What is the time and extra space of in-place list reversal?', ['O(n) time, O(1) extra space.', 'One pass with three pointers; no new nodes.'], [['O(n²) time.', 'A single pass suffices.'], ['O(n) extra space.', 'It reuses the existing nodes.']]), q('floyd', 'Why do slow and fast pointers meet if the list has a cycle?', ['Fast gains one node per step on slow inside the loop, so it must eventually catch up.', 'If the list ends, fast reaches null and the test stops.'], [['They start at the same node.', 'They start together but separate; meeting later requires a loop.'], ['Because the list is circular by default.', 'Only a list with a cycle is circular.']])],
        probs: [pr('p-mid', '<p>With slow/fast pointers on a list of 8 nodes, which node does slow stop at?</p>', 'Fast steps: 1→3→5→7→(null after 9). Slow steps 1→2→3→4→5: after fast falls off the end slow is at the <b>5th node</b> (the second of the two middle nodes).')],
      }),

      sec('apps', '4.4', 'Applications: stack, queue and polynomials', { eyebrow: 'Uses',
        body: `<p>A linked list makes a stack with no size limit: push and pop both work at the head in O(1). It makes a queue too if you keep both a head pointer (dequeue here) and a tail pointer (enqueue here), both O(1). Many other structures are lists in disguise: the chains in a hash table, the adjacency lists of a graph, the free-block list of a memory manager, the undo history of an editor.</p><p>A classic example is polynomial arithmetic. A polynomial such as 5x¹⁰⁰ + 3x² + 1 has a huge degree but only three non-zero terms. Stored in an array it would need 101 slots; stored as a list of (coefficient, exponent) nodes in decreasing exponent it needs three. Adding two polynomials is exactly the merge of two sorted lists: compare the exponents of the current terms; if equal add the coefficients, otherwise copy the term with the larger exponent and advance that list. Adding 3x² + 2x + 1 and x² + 5 gives 4x² + 2x + 6 in one pass of cost O(m + n).</p>`,
        worked: [step('Add 3x² + 2x + 1 and x² + 5.', '', { toc: 'Task' }), step('Merge by exponent: x² terms add; x term alone; constants add.', '4x^2 + 2x + 6', { hero: true, toc: 'Result' })],
        qs: [q('poly', 'Why is a linked list good for sparse polynomials like x¹⁰⁰ + 1?', ['Only non-zero terms are stored.', 'An array would need 101 slots.'], [['Lists are faster for arithmetic.', 'Not inherently.'], ['Lists cannot store exponents.', 'They can.']]), q('listq', 'To make O(1) enqueue and dequeue on a linked list you need…', ['Both a head pointer and a tail pointer.', 'Enqueue at the tail, dequeue at the head.'], [['Only a head pointer.', 'Enqueue at the tail would take O(n).'], ['A doubly linked list with no pointers kept.', 'You still need to know where the ends are.']])],
        probs: [pr('p1', '<p>Array vs linked list: which is better for frequent random access by index? For frequent insertion in the middle?</p>', 'Random access: <b>array</b> (O(1) vs O(n)). Insertion in the middle once you hold the position: <b>linked list</b> (O(1) vs O(n) shifting).'), pr('p-poly', '<p>Multiply nothing — just add (4x³ + 2x) and (5x³ − 3x² + 7). Give the result list.</p>', 'Merge by exponent: x³: 4 + 5 = 9; x²: −3; x: 2; constant: 7 → <b>9x³ − 3x² + 2x + 7</b>.')],
      }),

      sec('choose', '4.5', 'Arrays versus linked lists: how to choose', { eyebrow: 'Decision',
        body: `<p>The comparison table in section 4.1 is worth learning, but the choice is usually decided by one question: <em>what do you do most?</em> If you index by position, scan sequentially or keep the data sorted for binary search, use an array — and note that arrays are very friendly to the CPU cache because neighbouring elements are loaded together, a real-world advantage that Big-O hides. If you insert and delete often at known positions, if the size is unpredictable and you cannot afford the occasional O(n) resize, or if you need to splice lists together in O(1), use a linked list. Memory matters too: a singly linked list spends a pointer (8 bytes) per item on top of the value, so a list of ints uses three times the memory of an array of ints.</p>`,
        qs: [q('cachefriendly', 'Besides indexing, why do arrays often beat linked lists in practice?', ['Contiguous elements share cache lines, so sequential scans are much faster than chasing scattered pointers.', 'Big-O ignores this constant factor.'], [['Arrays have O(1) insertion in the middle.', 'They have O(n) insertion.'], ['Linked lists cannot be traversed.', 'They can, just with poorer locality.']])],
        probs: [pr('p-memory', '<p>A list of 1,000,000 ints (4 bytes) with 8-byte pointers: memory for an array versus a singly linked list (ignore allocator overhead)?</p>', 'Array: 4 MB. Linked list: (4 + 8) × 10⁶ = <b>12 MB</b>, three times larger (and more with alignment padding).')],
      }),

      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Queue = FIFO; enqueue at the rear, dequeue at the front, O(1). Circular arrays reuse space with modulo arithmetic and one spare slot.</li><li>Deque: both ends; priority queue: highest priority out first (heap gives O(log n)).</li><li>Linked list: nodes joined by pointers; O(1) insert/delete at a known place, O(n) access and search; doubly and circular variants.</li><li>Pointer surgery rules: set the new node’s pointer first; handle empty, single-node, head and tail cases.</li><li>Reverse with prev/cur/next; find the middle and detect cycles with slow/fast pointers.</li><li>Choose arrays for indexing and cache-friendly scans, lists for frequent insertion and unpredictable size.</li></ul>` }),
    ],
  })
}
