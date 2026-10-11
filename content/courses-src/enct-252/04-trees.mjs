import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => {
  const avl = run('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }), plain = run('bst', { mode: 'bst', ops: '10;20;30;40;50' })
  const h = run('huffman', { text: 'aaaabbc' }), big = run('huffman', { text: 'f:5 e:9 c:12 b:13 d:16 a:45' })
  const bt = run('btree', { variant: 'btree', order: 3, keys: '1 2 3 4 5 6 7' })
  const N = [0, 1]
  for (let k = 2; k <= 9; k++) N.push(N[k - 1] + N[k - 2] + 1)
  const avlTable = scr(`var t = create("table", { headers: "Height h;Fewest nodes N(h) = N(h−1)+N(h−2)+1;Most nodes 2^h − 1", data: ${JSON.stringify(N.slice(1).map((v, i) => [String(i + 1), String(v), String(2 ** (i + 1) - 1)]))}, summary: "None" });`, 'An AVL tree of height h always holds at least Fibonacci-many nodes, so its height is at most about 1.44 log₂ n.', { caption: 'how lopsided can an AVL tree be?' })
  return lesson({
    title: 'Binary trees, BST, AVL, heaps and B-trees',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 5',
    subtitle: 'Hierarchies that keep search fast — provided they stay balanced. The chapter builds the tree vocabulary, traversals, the binary search tree, AVL rotations, the heap, Huffman coding and the B-tree.',
    sections: [
      sec('terms', '5.1', 'Trees and their vocabulary', { eyebrow: 'Hierarchies',
        body: `<p>Arrays and lists are linear: every element has a predecessor and a successor. Many things are not — a family tree, a file system, an organisation chart, the nesting of an arithmetic expression. A ${term('tree')} captures hierarchy: one special node, the ${term('root')}, and below it zero or more subtrees, each itself a tree. Formally a tree with n nodes has exactly n − 1 edges and exactly one path between any two nodes; add another edge and you create a cycle (a graph, the next chapter).</p><p>The vocabulary is used in every question. A node’s ${term('children')} are the nodes directly below it; its <b>parent</b> is the one above; nodes with the same parent are <b>siblings</b>. A node with no children is a ${term('leaf')}; the others are <b>internal</b>. The <b>degree</b> of a node is its number of children and the degree of a tree is the largest node degree. The <b>depth</b> (level) of a node is the number of edges from the root to it, root at 0; the ${term('height')} of a node is the longest downward path to a leaf, and the height of the tree is the height of the root. A <b>subtree</b> is a node together with all its descendants.</p><p>A ${term('binary tree')} restricts every node to at most two children, called left and right — and order matters, so a node with only a left child is different from one with only a right child. Special shapes have names: a <b>full</b> binary tree has 0 or 2 children everywhere; a <b>perfect</b> tree is full with all leaves at the same depth; a <b>complete</b> tree is filled level by level, left to right, with only the last level possibly short — the shape of a heap.</p>`,
        worked: [step('A binary tree has height h (counting edges). The maximum number of nodes at level i is 2^i, so the whole tree holds at most:', '1+2+4+\\dots+2^{h}', { toc: 'Level sum' }), step('A geometric series.', '2^{h+1}-1', { toc: 'Sum' }), step('Inverting: n nodes need height at least ⌈log₂(n+1)⌉ − 1. A million nodes can fit in a tree of height only 19 — the reason balanced trees are fast.', 'h\\ge\\lceil\\log_2(n+1)\\rceil-1', { hero: true, toc: 'Minimum height' })],
        qs: [q('edges', 'A tree has 25 nodes. How many edges?', ['24.', 'Every node except the root has exactly one parent edge: n − 1.'], [['25.', 'That would give a cycle.'], ['26.', 'No such relationship.']]), q('perfect', 'How many nodes does a perfect binary tree of height 3 have (root at height 3, leaves at height 0)?', ['15.', '2⁴ − 1 = 1 + 2 + 4 + 8.'], [['7.', 'That is height 2.'], ['8.', 'That is just the number of leaves.']])],
        probs: [pr('p-height', '<p>What is the minimum possible height of a binary tree with 100 nodes? The maximum?</p>', 'Minimum: ⌈log₂ 101⌉ − 1 = 7 − 1 = <b>6</b> (a complete tree). Maximum: <b>99</b> (a chain, each node with one child).')],
      }),

      sec('props', '5.2', 'Binary tree properties and representations', { eyebrow: 'Counting',
        body: `<p>Two facts about binary trees are proved in every exam. First, at level i there are at most 2^i nodes, and a tree of height h has at most 2^{h+1} − 1 nodes. Second, if n₀ is the number of leaves and n₂ the number of nodes with two children, then n₀ = n₂ + 1. The proof counts edges two ways: edges = n − 1, and also edges = n₁ + 2n₂ (each node contributes its number of children); with n = n₀ + n₁ + n₂ we get n₀ + n₁ + n₂ − 1 = n₁ + 2n₂, hence n₀ = n₂ + 1.</p><p>How is a tree stored? The <b>linked representation</b> gives each node a value and two pointers, <code>left</code> and <code>right</code> — flexible, any shape. The <b>array representation</b> stores a complete tree level by level: the root at index 1, and for the node at index i the left child at 2i, the right child at 2i + 1 and the parent at ⌊i/2⌋. No pointers are needed; it wastes space for sparse trees but is perfect for heaps. The program below builds a five-node tree with pointers and prints it three ways, which is the next section’s topic.</p>`,
        deriv: [
          step('Let n₀, n₁, n₂ be the numbers of nodes with 0, 1 and 2 children. The total number of nodes is their sum.', 'n=n_0+n_1+n_2', { toc: 'Nodes' }),
          step('Every node except the root is the child of exactly one parent edge, so the number of edges is one less than the number of nodes.', 'E=n-1', { toc: 'Edges (1)' }),
          step('Counting edges from the parent side: a node with k children contributes k edges.', 'E=n_1+2n_2', { toc: 'Edges (2)' }),
          step('Equate the two counts and substitute n.', 'n_0+n_1+n_2-1=n_1+2n_2\\ \\Rightarrow\\ n_0=n_2+1', { hero: true, toc: 'Result' }),
        ],
        qs: [q('leaves', 'A binary tree has 12 nodes with two children. How many leaves?', ['13.', 'n₀ = n₂ + 1.'], [['12.', 'One too few.'], ['24.', 'Not related by doubling.']]), q('arr', 'In the array representation with root at index 1, where is the left child of the node at index 5?', ['Index 10.', '2i = 10; the right child is 11 and the parent is ⌊5/2⌋ = 2.'], [['Index 6.', 'That would be i + 1.'], ['Index 11.', 'That is the right child.']])],
        probs: [pr('p-n0', '<p>A binary tree has 7 leaves and no node with exactly one child. How many nodes does it have in total?</p>', 'n₂ = n₀ − 1 = 6 and n₁ = 0, so n = 7 + 0 + 6 = <b>13</b>.')],
      }),

      sec('trav', '5.3', 'Traversals', { eyebrow: 'Visiting every node',
        body: `<p>To process every node of a tree, we need a systematic order. The three <b>depth-first</b> traversals visit the root <em>pre</em>, <em>in</em> or <em>post</em> the subtrees: <b>preorder</b> is root, left, right; <b>inorder</b> is left, root, right; <b>postorder</b> is left, right, root. Each is a three-line recursive function — the recursion stack is the stack ADT of Chapter 2. <b>Level-order</b> (breadth-first) visits nodes level by level using a <em>queue</em>: dequeue a node, visit it, enqueue its children.</p><p>Each has its use. Preorder copies a tree (parents before children). Postorder deletes a tree or evaluates an expression tree (children before parents). Inorder on a binary <em>search</em> tree yields the keys in sorted order. And a deep fact: a binary tree is determined uniquely by its inorder sequence together with its preorder (or postorder) sequence, but not by preorder and postorder alone. For the tree below — 1 with children 2 and 3, and 2 with children 4 and 5 — the lab prints 1 2 4 5 3 (pre), 4 2 5 1 3 (in) and 4 5 2 3 1 (post). Every traversal visits every node once: O(n) time, O(h) stack space.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* left; Node* right; };
Node* make(int v) { Node* n = new Node(); n->val = v; n->left = nullptr; n->right = nullptr; return n; }
void pre(Node* r) { if (r == nullptr) return; cout << r->val << " "; pre(r->left); pre(r->right); }
void in(Node* r) { if (r == nullptr) return; in(r->left); cout << r->val << " "; in(r->right); }
void post(Node* r) { if (r == nullptr) return; post(r->left); post(r->right); cout << r->val << " "; }
int main() {
  Node* root = make(1);
  root->left = make(2);
  root->right = make(3);
  root->left->left = make(4);
  root->left->right = make(5);
  pre(root); cout << endl;
  in(root); cout << endl;
  post(root); cout << endl;
  return 0;
}`, 'The lab draws the tree; the three lines are pre-, in- and postorder.', { output: '1 2 4 5 3 \n4 2 5 1 3 \n4 5 2 3 1' })],
        worked: [step('Rebuild a tree from preorder 1 2 4 5 3 and inorder 4 2 5 1 3. The first preorder item is the root: 1.', '', { toc: 'Root' }), step('In the inorder sequence, everything left of 1 (4 2 5) is the left subtree and everything right (3) the right subtree.', '\\underbrace{4\\ 2\\ 5}_{\\text{left}}\\ 1\\ \\underbrace{3}_{\\text{right}}', { toc: 'Split' }), step('Repeat: the left subtree’s preorder is 2 4 5, so its root is 2 with left subtree {4} and right {5}.', '', { hero: true, toc: 'Recurse' })],
        qs: [q('ino', 'Inorder traversal of a binary search tree yields…', ['The keys in ascending order.', 'Left subtree (smaller) first, then the node, then the larger right subtree.'], [['Level by level.', 'That is breadth-first.'], ['Descending order.', 'That would be reverse inorder.']]), q('post', 'Which traversal is the right choice to delete all nodes of a tree safely?', ['Postorder — children are freed before their parent.', 'Freeing the parent first would lose the pointers to the children.'], [['Preorder.', 'The parent would be freed before its children are reached.'], ['Level order.', 'It works with a queue but is not the natural recursion.']]), q('uniq', 'Which pair of sequences does NOT always determine the tree uniquely?', ['Preorder and postorder.', 'Without inorder, a node with a single child is ambiguous: left or right?'], [['Inorder and preorder.', 'These determine it uniquely.'], ['Inorder and postorder.', 'These determine it uniquely.']])],
        probs: [pr('p-trav', '<p>For the tree with root A, left child B (with children D and E) and right child C (with right child F), write the preorder, inorder and postorder.</p>', 'Preorder: <b>A B D E C F</b>. Inorder: <b>D B E A C F</b>. Postorder: <b>D E B F C A</b>.'), pr('p-level', '<p>Give the level-order sequence of the same tree.</p>', 'Level by level: <b>A B C D E F</b> (queue order).')],
      }),

      sec('bst', '5.4', 'Binary search trees', { eyebrow: 'Ordered for fast search',
        body: `<p>Searching a sorted array by halving is fast, but inserting into one is slow. A ${term('binary search tree')} (BST) gets both. The rule: for every node, all keys in its left subtree are <em>smaller</em> and all keys in its right subtree <em>larger</em>. To search for k, compare with the root: if equal, done; if smaller, go left; if larger, go right; an empty subtree means “not found”. Each comparison discards a whole subtree, just like halving, so the cost is O(height). Insertion is a search that ends at an empty spot, where the new node is attached. The program builds the tree from 50 30 70 20 40 60 80 (height 3, perfectly balanced) and prints the keys in order; searching for 60 takes 3 comparisons.</p><p><b>Deletion</b> has three cases. A <em>leaf</em>: just remove it. A node with <em>one child</em>: splice it out by linking its parent to that child. A node with <em>two children</em>: replace its key by its <b>inorder successor</b> (the smallest key in the right subtree — go right once, then left as far as possible; or the predecessor), then delete that successor node, which has at most one child. The deletion program removes 20 (a leaf), 70 (it now has one child) and 50 (the root, two children): the keys left are 30 40 60 80 and the new root is 60, the old root’s successor.</p><p>The catch is the shape. The cost O(height) is only O(log n) if the tree is balanced, and a BST does nothing to ensure it. Insert the keys in sorted order — 10, 20, 30, 40, 50 — and every key goes to the right of the previous: the tree degenerates into a chain of height <b>${plain.height}</b> and search becomes O(n), no better than a linked list. The card shows exactly that.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* left; Node* right; };
Node* insert(Node* r, int v) {
  if (r == nullptr) { Node* n = new Node(); n->val = v; n->left = nullptr; n->right = nullptr; return n; }
  if (v < r->val) r->left = insert(r->left, v);
  else r->right = insert(r->right, v);
  return r;
}
int height(Node* r) {
  if (r == nullptr) return 0;
  int a = height(r->left), b = height(r->right);
  return 1 + (a > b ? a : b);
}
void in(Node* r) { if (r == nullptr) return; in(r->left); cout << r->val << " "; in(r->right); }
int main() {
  int keys[7] = {50, 30, 70, 20, 40, 60, 80};
  Node* root = nullptr;
  for (int i = 0; i < 7; i++) root = insert(root, keys[i]);
  in(root); cout << endl;
  cout << height(root) << endl;
  Node* chain = nullptr;
  for (int i = 1; i <= 7; i++) chain = insert(chain, i * 10);
  cout << height(chain) << endl;
  return 0;
}`, 'Same seven-ish keys: height 3 in a lucky order, height 7 when inserted sorted.', { output: '20 30 40 50 60 70 80 \n3\n7' }), cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* left; Node* right; };
Node* insert(Node* r, int v) {
  if (r == nullptr) { Node* n = new Node(); n->val = v; n->left = nullptr; n->right = nullptr; return n; }
  if (v < r->val) r->left = insert(r->left, v);
  else r->right = insert(r->right, v);
  return r;
}
Node* minNode(Node* r) { while (r->left != nullptr) r = r->left; return r; }
Node* del(Node* r, int v) {
  if (r == nullptr) return r;
  if (v < r->val) r->left = del(r->left, v);
  else if (v > r->val) r->right = del(r->right, v);
  else {
    if (r->left == nullptr) return r->right;
    if (r->right == nullptr) return r->left;
    Node* s = minNode(r->right);
    r->val = s->val;
    r->right = del(r->right, s->val);
  }
  return r;
}
void in(Node* r) { if (r == nullptr) return; in(r->left); cout << r->val << " "; in(r->right); }
int main() {
  int keys[7] = {50, 30, 70, 20, 40, 60, 80};
  Node* root = nullptr;
  for (int i = 0; i < 7; i++) root = insert(root, keys[i]);
  root = del(root, 20);
  root = del(root, 70);
  root = del(root, 50);
  in(root); cout << endl;
  cout << root->val << endl;
  return 0;
}`, 'Delete a leaf, a one-child node and the two-child root.', { output: '30 40 60 80 \n60' }), lab('bst', { mode: 'bst', ops: '10;20;30;40;50' }, 'Sorted input turns the BST into a list.', ['height', 'inorder'], { caption: 'an unbalanced BST', name: 'bst' })],
        qs: [q('skew', 'Inserting already-sorted keys into a plain BST gives…', ['A chain of height n: search becomes O(n).', 'Each new key goes to the right of the previous one.'], [['A perfectly balanced tree.', 'That needs rotations.'], ['An error.', 'It works, badly.']]), q('succ', 'To delete a BST node with two children you replace its key with…', ['The inorder successor (the smallest key in its right subtree), then delete that node.', 'The successor is the next key in sorted order, so the BST property is preserved.'], [['Its left child.', 'That would break the ordering of the right subtree.'], ['The root’s key.', 'Unrelated.']]), q('bstcost', 'What is the worst-case cost of searching a BST with n keys?', ['O(n) — when the tree is a chain.', 'The cost is O(height), which ranges from log n to n.'], [['O(log n) always.', 'Only if balanced.'], ['O(1).', 'No.']])],
        probs: [pr('p-bst', '<p>Insert 45, 20, 60, 10, 30, 50, 70, 25 into an empty BST. Give the height and the inorder sequence. Which keys are on the path when searching for 25?</p>', 'Height (counting nodes on the longest path) = 4 (45 → 20 → 30 → 25). Inorder: <b>10 20 25 30 45 50 60 70</b>. Search path for 25: <b>45, 20, 30, 25</b>.'), pr('p-bdel', '<p>In that tree delete 20 (two children). What replaces it, and what is the new left subtree of 45?</p>', 'Inorder successor of 20 is the smallest key in its right subtree {30, 25}: <b>25</b>. 20’s key becomes 25 and the old node 25 is removed, leaving 25 with children 10 and 30.')],
      }),

      sec('avl', '5.5', 'AVL trees: staying balanced', { eyebrow: 'Rotations',
        body: `<p>The BST’s weakness is that its shape depends on insertion order. An ${term('AVL tree')} (Adelson-Velsky and Landis, 1962, the first self-balancing tree) repairs the shape after every update. It stores at each node the <b>balance factor</b> BF = height(left) − height(right) and insists that it is −1, 0 or +1 everywhere. Search stays O(height) and the height is now guaranteed O(log n); insertion and deletion cost O(log n) including the repairs.</p><p>How tall can an AVL tree get? Let N(h) be the fewest nodes an AVL tree of height h can have. The sparsest such tree has a root, one subtree of height h − 1 (also sparsest) and one of height h − 2: N(h) = N(h − 1) + N(h − 2) + 1 — a Fibonacci-like recurrence. It grows like φʰ with φ ≈ 1.618, so n ≥ φʰ and therefore h ≤ 1.44 log₂ n: at most 44 % taller than perfect. The table shows how few nodes each height needs.</p><p>When an insertion makes some node’s balance factor ±2, the lowest such node is repaired by a <b>rotation</b>, one of four cases named by where the extra height lies. <b>Left-left</b> (a chain leaning left): one <em>right</em> rotation about the unbalanced node. <b>Right-right</b>: one <em>left</em> rotation — in a rotation the middle node becomes the new subtree root, its former parent becomes its child, and one subtree changes parent so the BST order is preserved. <b>Left-right</b> (a bend): a left rotation on the child, then a right rotation on the node. <b>Right-left</b>: the mirror image. Rotations are O(1) and do not change the inorder sequence. Inserting 10, 20, 30, 40, 50, 25 in order, which made a chain in a plain BST, now yields root <b>${avl.root}</b> and height <b>${avl.height}</b>. Step through the card: each frame names the imbalance and the rotation.</p>`,
        figs: [avlTable, lab('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }, 'Each step names the imbalance and the rotation.', ['root', 'height', 'inorder'], { caption: 'AVL insertions', name: 'avl' })],
        deriv: [
          step('Let N(h) be the minimum number of nodes in an AVL tree of height h. A sparsest tree of height h has a root, a sparsest subtree of height h − 1 and a sparsest subtree of height h − 2 (a difference of 2 would violate the balance rule).', 'N(h)=N(h-1)+N(h-2)+1', { toc: 'Recurrence' }),
          step('Compare with Fibonacci numbers: the solution satisfies N(h) + 1 = F(h + 2), so it grows exponentially.', 'N(h)\\ge\\varphi^{h},\\ \\varphi=\\tfrac{1+\\sqrt5}{2}\\approx1.618', { toc: 'Growth' }),
          step('Take logarithms of n ≥ N(h) ≥ φ^h.', 'h\\le\\log_{\\varphi}n=1.44\\log_2 n', { hero: true, toc: 'Height bound' }),
        ],
        qs: [q('rot', 'Which rotation fixes inserting 30 under 20 under 10 (a right-right chain)?', ['A single left rotation about 10.', '20 becomes the root with 10 and 30 as children.'], [['A right rotation.', 'That fixes a left-left chain.'], ['No rotation.', 'Balance factor 2 must be fixed.']]), q('lr', 'Insert 30, then 10, then 20. Which rotation(s) rebalance?', ['A left-right double rotation: left on 10, then right on 30 (20 becomes the root).', 'The bend 30 → 10 → 20 is a left-right case.'], [['A single right rotation.', 'That is for a straight left-left chain.'], ['A single left rotation.', 'That is for right-right.']]), q('bf', 'In an AVL tree what are the allowed balance factors?', ['−1, 0 and +1.', 'A node whose subtree heights differ by 2 or more must be rebalanced.'], [['Only 0.', 'That would force perfect trees.'], ['Any value.', 'That is an ordinary BST.']])],
        probs: [pr('p-avl', '<p>Insert 10, 20, 30, 40, 50, 25 into an AVL tree. What is the final root and height?</p>', `Root <b>${avl.root}</b>, height <b>${avl.height}</b>, inorder ${avl.inorder}.`, { verify: lab('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }, 'The rotations.', ['root'], { caption: 'answer', name: 'ans' }) }), pr('p-avlh', '<p>What is the minimum number of nodes in an AVL tree of height 5 (using N(1) = 1, N(2) = 2)? What is the maximum height of an AVL tree with 100 nodes (approximately)?</p>', `N(3) = 4, N(4) = 7, N(5) = <b>12</b>. For n = 100: h ≤ 1.44 · log₂ 100 ≈ 1.44 × 6.64 ≈ <b>9.6</b>, i.e. height at most about 9 — against 99 for a bad BST.`)],
      }),

      sec('heap', '5.6', 'Heaps and priority queues', { eyebrow: 'Top priority',
        body: `<p>A priority queue repeatedly needs “the smallest (or largest) item”. Searching an array each time is O(n). A ${term('heap')} gets it in O(1) and keeps insertion and removal at O(log n) with a simple trick: demand <em>less</em> order than a BST. A binary <b>min-heap</b> is a <em>complete</em> binary tree in which every node’s key is ≤ its children’s keys (the <b>heap property</b>). There is no left/right ordering between siblings, so the minimum is always at the root. Because the tree is complete it is stored in a plain array with no pointers: with a 1-based array the children of index i are 2i and 2i + 1 and the parent is ⌊i/2⌋ (with 0-based indexing, 2i + 1, 2i + 2 and ⌊(i − 1)/2⌋). The height is ⌊log₂ n⌋.</p><p><b>Insert</b> places the new key at the first free position (the end of the array) and ${term('sifts up')}: while it is smaller than its parent, swap them — at most height swaps, O(log n). <b>Extract-min</b> returns the root, moves the <em>last</em> element to the root and ${term('sifts down')}: swap with the smaller child until the order is restored — O(log n). <b>Building</b> a heap from n arbitrary keys by sifting down every internal node from the last to the first is O(n), not n log n, because most nodes are near the bottom and sift only a short way (the sum of heights is Σ h·n/2^{h+1} = O(n)). <b>Heap sort</b> builds a max-heap and repeatedly swaps the root to the end and shrinks the heap: O(n log n) time, in place, O(1) extra space.</p>`,
        figs: [lab('heap', { kind: 'min', ops: '5 3 8 1 9 extract extract' }, 'Sift up on insert, sift down on extract.', ['array'], { caption: 'a min-heap', name: 'hp' })],
        worked: [step('A min-heap is stored 0-based as [2, 5, 9, 7, 6]. Where are the children of the node at index 1 (value 5)?', '2i+1,\\ 2i+2', { toc: 'Index rule' }), step('Children are at indexes 3 and 4: values 7 and 6, both ≥ 5, so the heap order holds there. Its parent is ⌊(1−1)/2⌋ = 0 (value 2).', '2(1)+1=3,\\ 2(1)+2=4', { toc: 'Check' }), step('Insert 3: append at index 5, parent index 2 holds 9 &gt; 3 → swap; new parent index 0 holds 2 &lt; 3 → stop. Result [2, 5, 3, 7, 6, 9].', '[2,5,3,7,6,9]', { hero: true, toc: 'Insert 3' })],
        qs: [q('heapmin', 'Where is the smallest element of a min-heap?', ['At the root (index 0).', 'Every parent is ≤ its children, so the minimum cannot be below another node.'], [['At a leaf.', 'Leaves hold larger values.'], ['At the last index.', 'No guarantee.']]), q('heapcost', 'What is the cost of build-heap on n keys?', ['O(n).', 'Most nodes sit near the bottom and sift only a little; the total work sums to a linear bound.'], [['O(n log n).', 'That is the cost of n separate inserts, a looser bound.'], ['O(log n).', 'Far too small — every key must be looked at.']]), q('heapsort', 'Which statement about heap sort is true?', ['It sorts in O(n log n) time using O(1) extra space.', 'It rearranges the array in place.'], [['It is stable.', 'Heap sort is not stable.'], ['It needs an extra array as large as the input.', 'That is merge sort.']])],
        probs: [pr('p-heapins', '<p>Insert 10, 4, 7, 1, 8 one by one into an empty min-heap. Give the array after each insertion.</p>', '[10] → [4,10] → [4,10,7] → insert 1: [4,10,7,1] swaps with parent 10 then 4 → [1,4,7,10] → insert 8: [1,4,7,10,8] (parent 4 &lt; 8, stays). Final <b>[1, 4, 7, 10, 8]</b>.'), pr('p-heapext', '<p>Do one extract-min on [1, 4, 7, 10, 8].</p>', 'Return 1. Move the last element 8 to the root: [8, 4, 7, 10]. Sift down: smaller child is 4 &lt; 8 → swap → [4, 8, 7, 10]; 8’s child 10 is larger → stop. Result <b>[4, 8, 7, 10]</b>.')],
      }),

      sec('huff', '5.7', 'Huffman coding', { eyebrow: 'Greedy compression',
        body: `<p>Text is normally stored with a fixed number of bits per character (8 in ASCII). But letters are not equally common: in English, E appears far more often than Z. If the common letters get <em>short</em> codes and the rare ones <em>long</em> codes, the average length drops. The problem is decoding: if A = 0 and B = 01, then “001” could be AAB or AB… A <b>prefix code</b> forbids ambiguity: no codeword is a prefix of another, so a bit stream can be decoded greedily. A prefix code is exactly a binary tree with the symbols at the <em>leaves</em>, the code being the path (left 0, right 1).</p><p>${term('Huffman’s algorithm')} (1952) builds the optimal prefix code greedily: make a leaf for each symbol, weighted by its frequency; repeatedly remove the <em>two lightest</em> trees, merge them under a new node whose weight is their sum, and put it back (a priority queue, so O(n log n)); when one tree remains, read the codes from the paths. It is optimal because the two rarest symbols can always be siblings at the deepest level. For <code>aaaabbc</code> the three symbols need <b>${h.totalBits}</b> bits instead of the ${h.asciiBits} bits of ASCII. For the classic frequencies f:5 e:9 c:12 b:13 d:16 a:45 the total cost is <b>${big.totalBits}</b> bits over 100 characters (2.24 bits per character against 3 for a fixed code of six symbols). Step through the card: it merges the two smallest each time.</p>`,
        figs: [lab('huffman', { text: 'aaaabbc' }, 'Merge the two smallest each time.', ['totalBits', 'codes'], { caption: 'building the tree', name: 'hf' }), lab('huffman', { text: 'f:5 e:9 c:12 b:13 d:16 a:45' }, 'The textbook frequencies.', ['totalBits'], { caption: 'textbook example', name: 'hf2' })],
        worked: [step('Frequencies a:5, b:2, c:1, d:1. Merge the two lightest (c and d): weight 2.', '1+1=2', { toc: 'Merge 1' }), step('Now b:2 and the new node (2) are the lightest: merge to 4. Finally merge a:5 with 4 to 9.', '2+2=4,\\ 5+4=9', { toc: 'Merge 2, 3' }), step('Depths: a = 1, b = 2, c = 3, d = 3. Total bits = 5·1 + 2·2 + 1·3 + 1·3.', '5+4+3+3=15\\ \\text{bits for 9 symbols}', { hero: true, toc: 'Cost' })],
        qs: [q('prefix', 'What does “prefix code” guarantee?', ['No codeword is the start of another, so a bit stream decodes unambiguously.', 'Symbols sit at leaves of the tree.'], [['All codes have equal length.', 'That is fixed-length coding.'], ['Codes are in alphabetical order.', 'Unrelated.']]), q('greedy', 'Which choice defines Huffman’s greedy step?', ['Always merge the two trees of smallest weight.', 'The rarest symbols end up deepest, with the longest codes.'], [['Always merge the two heaviest trees.', 'That would give the most frequent symbols the longest codes.'], ['Always pick a random pair.', 'That gives no optimality guarantee.']])],
        probs: [pr('p-huff', '<p>Symbols with frequencies A:40, B:30, C:15, D:10, E:5. Build the Huffman tree, give the code lengths and the average bits per symbol.</p>', 'Merge E+D = 15; then C + 15 = 30; then B + 30 = 60 (or A first; ties allowed); then A + 60 = 100. Depths: A 1, B 2, C 3, D 4, E 4 → average = 0.40·1 + 0.30·2 + 0.15·3 + 0.10·4 + 0.05·4 = <b>2.05 bits</b> per symbol.')],
      }),

      sec('btree', '5.8', 'B-trees', { eyebrow: 'Wide trees for disks',
        body: `<p>Binary trees are tall: a million keys need at least 20 levels, and if each level means a disk read at 10 ms, a search costs 200 ms. A disk reads a whole block (4 KB) at once, so the cure is to make each node as wide as a block. A ${term('B-tree')} of order <i>m</i> is a balanced multiway search tree: every node has at most m children and m − 1 keys, every internal node except the root has at least ⌈m/2⌉ children, a node with k children holds k − 1 keys in sorted order, and <b>all leaves are at the same depth</b>. Because every node is at least half full the height is at most log_{⌈m/2⌉} of about n/2 — tiny when m is in the hundreds.</p><p><b>Search</b> binary-searches the keys inside a node, then follows the child pointer between the two surrounding keys. <b>Insertion</b> always goes into a leaf. If the leaf now holds m keys it overflows: <b>split</b> it around the median — the median key moves up to the parent, the two halves become separate nodes — and if that makes the parent overflow, split it too; if the root splits, a new root is created and the tree grows by one level, <em>from the top</em>, which is how all leaves stay at the same depth. Inserting 1…7 into an order-3 B-tree gives root key <b>${bt.rootKeys}</b> and height <b>${bt.height}</b>. A <b>B⁺-tree</b> stores all records in the leaves, chained left to right for range scans, with internal nodes holding only separator keys; it is the structure behind nearly every database index and file system.</p>`,
        figs: [lab('btree', { variant: 'btree', order: 3, keys: '1 2 3 4 5 6 7' }, 'Splits propagate upward.', ['rootKeys', 'height'], { caption: 'B-tree insertion', name: 'bt' })],
        worked: [step('A node is one 4 KB disk block. A key is 8 bytes and a child pointer 8 bytes, so a node with m children holds 8(m − 1) + 8m ≤ 4096 bytes. Largest order:', '16m-8\\le4096\\Rightarrow m\\le256', { toc: 'Order' }), step('Every non-root node has at least ⌈256/2⌉ = 128 children. For one billion keys, the height is at most:', 'h\\le\\log_{128}\\!\\left(\\tfrac{10^{9}+1}{2}\\right)', { toc: 'Height' }), step('log₁₂₈(5 × 10⁸) = ln(5×10⁸)/ln 128 ≈ 20.0/4.85 ≈ 4.1, so at most 5 levels — five disk reads to find any of a billion keys.', 'h\\approx4\\text{–}5', { hero: true, toc: 'Result' })],
        qs: [q('bwhy', 'Why are B-trees used for disk indexes?', ['Wide nodes keep the tree very shallow, so few disk blocks are read.', 'Each node is sized to a disk block.'], [['They are binary.', 'They are multiway.'], ['They never need splitting.', 'Splitting keeps them balanced.']]), q('bsplit', 'A B-tree node of order 4 (max 3 keys) receives a fourth key. What happens?', ['The node splits around the median; the median key moves up to the parent.', 'Splitting keeps every node at least half full and the leaves at equal depth.'], [['The new key is discarded.', 'Keys are never lost.'], ['The tree grows downward at the leaves.', 'B-trees grow upward, at the root.']]), q('bplus', 'What is the main difference of a B⁺-tree?', ['All data records are in the leaves, which are linked for fast range scans; internal nodes hold only keys.', 'It makes sequential access over a key range efficient.'], [['It is binary.', 'It is multiway.'], ['It stores data only in the root.', 'The leaves hold the data.']])],
        probs: [pr('p-bins', '<p>Insert 5, 3, 8, 1 into an empty B-tree of order 3 (max 2 keys per node). Show the tree after each overflow.</p>', '5 → [5]; 3 → [3 5]; 8 → [3 5 8] overflows, split: median 5 rises: root [5] with children [3] and [8]. Insert 1 → goes to the left leaf: [1 3]. Final: root <b>[5]</b>, leaves <b>[1 3]</b> and <b>[8]</b>.')],
      }),

      sec('summary', '5.9', 'Summary', { eyebrow: 'Recap', body: `<ul><li>A tree has n − 1 edges; binary-tree facts: ≤ 2^i nodes at level i, n₀ = n₂ + 1; array form uses 2i / 2i + 1.</li><li>Traversals: pre (root first), in (sorted for a BST), post (children first), level (queue); inorder plus pre- or postorder fixes the tree.</li><li>BST: search, insert and delete in O(height); deletion with two children uses the inorder successor; sorted input degenerates to a chain.</li><li>AVL keeps |balance factor| ≤ 1 with single and double rotations, giving h ≤ 1.44 log₂ n.</li><li>Heap = complete tree with the heap property, stored in an array; insert/extract O(log n), build O(n), heap sort O(n log n) in place.</li><li>Huffman builds an optimal prefix code by greedily merging the two lightest trees.</li><li>B-tree: wide, balanced, all leaves at one depth, splits propagate upward; B⁺-trees power database indexes.</li></ul>` }),
    ],
  })
}
