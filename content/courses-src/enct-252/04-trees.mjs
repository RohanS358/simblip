import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, q, pr, step, sec, term, run }) => {
  const avl = run('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }), plain = run('bst', { mode: 'bst', ops: '10;20;30;40;50' })
  const h = run('huffman', { text: 'aaaabbc' }), big = run('huffman', { text: 'f:5 e:9 c:12 b:13 d:16 a:45' })
  const bt = run('btree', { variant: 'btree', order: 3, keys: '1 2 3 4 5 6 7' })
  return lesson({
    title: 'Binary trees, BST, AVL, heaps and B-trees',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 5',
    subtitle: 'Hierarchies that keep search fast — provided they stay balanced.',
    sections: [
      sec('terms', '5.1', 'Trees and traversals', { eyebrow: 'Vocabulary',
        body: `<p>A ${term('tree')} has a ${term('root')}, each node has ${term('children')}; a node without children is a ${term('leaf')}; the ${term('height')} is the longest root-to-leaf path. A ${term('binary tree')} has at most two children per node. Three depth-first traversals visit the root <em>pre</em>, <em>in</em> or <em>post</em> the subtrees: preorder root-left-right, inorder left-root-right, postorder left-right-root. Inorder on a BST gives sorted order.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
struct Node { int val; Node* left; Node* right; };
Node* make(int v) { Node* n = new Node(); n->val = v; n->left = nullptr; n->right = nullptr; return n; }
void inorder(Node* r) { if (r == nullptr) return; inorder(r->left); cout << r->val << " "; inorder(r->right); }
int main() {
  Node* root = make(50);
  root->left = make(30);
  root->right = make(70);
  root->left->left = make(20);
  root->left->right = make(40);
  inorder(root);
  cout << endl;
  return 0;
}`, 'The lab draws the pointers as a tree; inorder prints the keys sorted.', { output: '20 30 40 50 70' })],
        qs: [q('ino', 'Inorder traversal of a binary search tree yields…', ['The keys in ascending order.', 'Left subtree (smaller) first, then the node, then the larger right subtree.'], [['Level by level.', 'That is breadth-first.'], ['Descending order.', 'That would be reverse inorder.']])] }),
      sec('bst', '5.2', 'Binary search trees', { eyebrow: 'Ordered',
        body: `<p>In a ${term('BST')} everything in a node’s left subtree is smaller and everything in its right subtree larger. Search, insert and delete follow one root-to-leaf path: O(height). Deleting a node with two children replaces it with its inorder successor (the smallest key of the right subtree). The catch: insert sorted keys 10, 20, 30, 40, 50 and the tree degenerates into a chain of height <b>${plain.height}</b> — O(n) search.</p>`,
        figs: [lab('bst', { mode: 'bst', ops: '10;20;30;40;50' }, 'Sorted input turns the BST into a list.', ['height', 'inorder'], { caption: 'an unbalanced BST', name: 'bst' })],
        qs: [q('skew', 'Inserting already-sorted keys into a plain BST gives…', ['A chain of height n: search becomes O(n).', 'Each new key goes to the right of the previous one.'], [['A perfectly balanced tree.', 'That needs rotations.'], ['An error.', 'It works, badly.']])] }),
      sec('avl', '5.3', 'AVL trees: staying balanced', { eyebrow: 'Rotations',
        body: `<p>An ${term('AVL tree')} keeps the heights of every node’s two subtrees within 1 (balance factor −1, 0, +1). After an insertion or deletion that breaks this, a <b>rotation</b> restores it: single rotations fix left-left and right-right imbalances; double rotations fix left-right and right-left. Height stays O(log n). The same keys that made a chain now give root <b>${avl.root}</b> and height <b>${avl.height}</b>.</p>`,
        figs: [lab('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }, 'Each step names the imbalance and the rotation.', ['root', 'height', 'inorder'], { caption: 'AVL insertions', name: 'avl' })],
        qs: [q('rot', 'Which rotation fixes inserting 30 under 20 under 10 (a right-right chain)?', ['A single left rotation about 10.', '20 becomes the root with 10 and 30 as children.'], [['A right rotation.', 'That fixes a left-left chain.'], ['No rotation.', 'Balance factor 2 must be fixed.']])],
        probs: [pr('p-avl', '<p>Insert 10, 20, 30, 40, 50, 25 into an AVL tree. What is the final root and height?</p>', `Root <b>${avl.root}</b>, height <b>${avl.height}</b>, inorder ${avl.inorder}.`, { verify: lab('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }, 'The rotations.', ['root'], { caption: 'answer', name: 'ans' }) })] }),
      sec('heap', '5.4', 'Heaps and priority queues', { eyebrow: 'Top priority',
        body: `<p>A binary ${term('heap')} is a complete binary tree stored in an array where every parent is ≤ its children (min-heap). Children of index <i>i</i> are 2i+1 and 2i+2. Insert at the end and ${term('sift up')}; remove the minimum by moving the last element to the root and ${term('sift down')} — both O(log n). Building a heap of n items is O(n). Heaps power priority queues and heap sort.</p>`,
        figs: [lab('heap', { kind: 'min', ops: '5 3 8 1 9 extract extract' }, 'Sift up on insert, sift down on extract.', ['array'], { caption: 'a min-heap', name: 'hp' })],
        worked: [step('A min-heap is stored as [2, 5, 9, 7, 6]. Where are the children of the node at index 1 (value 5)?', '2i+1,\\ 2i+2', { toc: 'Index rule' }), step('Children are at indexes 3 and 4: values 7 and 6, both ≥ 5, so the heap order holds there. Its parent is ⌊(1−1)/2⌋ = 0 (value 2).', '2(1)+1=3,\\ 2(1)+2=4', { hero: true, toc: 'Check' })],
        qs: [q('heapmin', 'Where is the smallest element of a min-heap?', ['At the root (index 0).', 'Every parent is ≤ its children, so the minimum cannot be below another node.'], [['At a leaf.', 'Leaves hold larger values.'], ['At the last index.', 'No guarantee.']])] }),
      sec('huff', '5.5', 'Huffman coding', { eyebrow: 'Greedy compression',
        body: `<p>Give frequent symbols short codes. ${term('Huffman’s algorithm')} repeatedly merges the two lightest trees into one, then reads the code from the path (left 0, right 1). The result is an optimal prefix code. For aaaabbc: <b>${h.totalBits}</b> bits instead of ${h.asciiBits}. For the classic frequencies f:5 e:9 c:12 b:13 d:16 a:45 the total cost is <b>${big.totalBits}</b> bits over 100 characters.</p>`,
        figs: [lab('huffman', { text: 'aaaabbc' }, 'Merge the two smallest each time.', ['totalBits', 'codes'], { caption: 'building the tree', name: 'hf' })],
        qs: [q('prefix', 'What does “prefix code” guarantee?', ['No codeword is the start of another, so a bit stream decodes unambiguously.', 'Symbols sit at leaves of the tree.'], [['All codes have equal length.', 'That is fixed-length coding.'], ['Codes are in alphabetical order.', 'Unrelated.']])] }),
      sec('btree', '5.6', 'B-trees', { eyebrow: 'Wide trees for disks',
        body: `<p>A ${term('B-tree')} of order <i>m</i> has up to m−1 keys and m children per node and all leaves at the same depth. Insert into a leaf; if it overflows, split it around the median and push the median up — possibly all the way to a new root. Wide nodes make the tree shallow, so a disk search reads few blocks. Inserting 1…7 into an order-3 tree gives root key <b>${bt.rootKeys}</b> and height <b>${bt.height}</b>.</p>`,
        figs: [lab('btree', { variant: 'btree', order: 3, keys: '1 2 3 4 5 6 7' }, 'Splits propagate upward.', ['rootKeys', 'height'], { caption: 'B-tree insertion', name: 'bt' })],
        qs: [q('bwhy', 'Why are B-trees used for disk indexes?', ['Wide nodes keep the tree very shallow, so few disk blocks are read.', 'Each node is sized to a disk block.'], [['They are binary.', 'They are multiway.'], ['They never need splitting.', 'Splitting keeps them balanced.']])] }),
      sec('summary', '5.7', 'Summary', { eyebrow: 'Recap', body: `<ul><li>BST operations cost O(height); AVL rotations keep height O(log n).</li><li>Heap = partial order in an array; Huffman = greedy merging; B-tree = wide and shallow.</li></ul>` }),
    ],
  })
}
