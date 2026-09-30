import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, q, pr, step, sec, term, run }) => {
  const p = run('infix', { expr: 'A+B*C-(D/E)' }), v = run('infix', { expr: '(2+3)*4-6/2' }), h = run('hanoi', { disks: 4 })
  return lesson({
    title: 'Stacks, expressions and recursion',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 2',
    subtitle: 'Last in, first out — and why that is exactly the shape of function calls.',
    sections: [
      sec('stack', '2.1', 'The stack ADT', { eyebrow: 'LIFO',
        body: `<p>A ${term('stack')} allows insertion and removal only at one end, the top: <b>push</b> adds, <b>pop</b> removes, <b>peek</b> reads. The last item pushed is the first popped (LIFO). An array with a <code>top</code> index implements it; overflow (push on full) and underflow (pop on empty) must be checked. All operations are O(1).</p>`,
        figs: [cpp(`#include <iostream>
#include <stack>
using namespace std;
int main() {
  stack<int> s;
  for (int i = 1; i <= 4; i++) s.push(i * 10);
  while (!s.empty()) {
    cout << s.top() << " ";
    s.pop();
  }
  cout << endl;
  return 0;
}`, 'Pushed 10 20 30 40; popped in reverse.', { output: '40 30 20 10' })],
        qs: [q('lifo', 'Push 1, 2, 3 then pop twice. What is on top?', ['1.', '3 and 2 leave first; 1 remains.'], [['3.', 'It was popped first.'], ['2.', 'It was popped second.']])] }),
      sec('postfix', '2.2', 'Infix to postfix with a stack', { eyebrow: 'Expressions',
        body: `<p>Humans write ${term('infix')} (A+B) which needs precedence rules; ${term('postfix')} (AB+) does not. To convert: operands go straight to the output; an operator first pops any stacked operator of higher or equal precedence, then is pushed; "(" is pushed, ")" pops until "(". At the end pop everything. A+B*C−(D/E) becomes <b>${p.postfix}</b>.</p>`,
        figs: [lab('infix', { expr: 'A+B*C-(D/E)' }, 'Stack on the bottom row, output above it.', ['postfix'], { caption: 'infix → postfix', name: 'inf' })],
        worked: [step('Evaluate the postfix of (2+3)*4−6/2 using a stack of numbers: push operands, each operator pops two.', '', { toc: 'Method' }), step('2 3 + → 5; 5 4 × → 20; 6 2 / → 3; 20 3 − → 17.', `${v.postfix}\\ \\Rightarrow\\ ${v.value}`, { hero: true, toc: 'Result' })],
        qs: [q('prec', 'In A+B*C, which operator is applied first, and what does the postfix look like?', ['* first; postfix A B C * +.', '* has higher precedence, so B and C are multiplied before the addition.'], [['+ first; A B + C *.', 'That would be (A+B)*C.'], ['Left to right; A B + C *.', 'Precedence overrides left-to-right.']])],
        probs: [pr('p-pf', '<p>Convert A+B*C−(D/E) to postfix.</p>', `<b>${p.postfix}</b>`, { verify: lab('infix', { expr: 'A+B*C-(D/E)' }, 'The conversion.', ['postfix'], { caption: 'answer', name: 'ans' }) })] }),
      sec('rec', '2.3', 'Recursion', { eyebrow: 'A function that calls itself',
        body: `<p>A ${term('recursive')} function solves a problem by calling itself on a smaller one. It needs a <b>base case</b> (stop) and a step that moves toward it. Each call gets its own frame on the ${term('call stack')}; returns unwind it. Factorial: n! = n × (n−1)!, with 0! = 1. Run it and the Lab shows the stack grow and shrink.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int fact(int n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
int main() {
  cout << fact(5) << endl;
  return 0;
}`, 'fact(5) makes 5 nested calls, then multiplies on the way back.', { output: '120' })],
        qs: [q('base', 'What happens if a recursive function has no base case?', ['It recurses until the stack overflows.', 'Every call makes another call; frames pile up without end.'], [['It returns 0.', 'Nothing returns.'], ['It runs once.', 'It keeps calling itself.']])] }),
      sec('hanoi', '2.4', 'Tower of Hanoi', { eyebrow: 'Recursion at its best',
        body: `<p>Move <i>n</i> disks from A to C using B, one at a time, never a larger on a smaller. Recursively: move n−1 disks A→B, move the largest A→C, move n−1 disks B→C. The count satisfies T(n) = 2T(n−1) + 1, so T(n) = 2ⁿ − 1. For 4 disks: <b>${h.moves}</b> moves.</p>`,
        figs: [lab('hanoi', { disks: 3 }, 'Seven moves for three disks.', ['moves'], { caption: 'three disks', name: 'h3' })],
        worked: [step('T(1) = 1 and T(n) = 2T(n−1) + 1.', '', { toc: 'Recurrence' }), step('Expanding: T(n) = 2ⁿ − 1.', 'T(4)=2^4-1=15', { hero: true, toc: 'Closed form' })],
        qs: [q('hn', 'Moves needed for 5 disks?', ['31.', '2⁵ − 1.'], [['25.', 'Not exponential.'], ['32.', 'One too many.']])] }),
      sec('iter', '2.5', 'Recursion versus iteration', { eyebrow: 'Choosing',
        body: `<p>Anything recursive can be written with a loop and an explicit stack. Recursion is natural for trees and divide-and-conquer; it costs stack space and call overhead. ${term('Tail recursion')} (the recursive call is the last action) can be turned into a loop by the compiler. Naive Fibonacci recurses twice and recomputes the same values exponentially — memoisation fixes it.</p>`,
        qs: [q('fib', 'Why is naive recursive Fibonacci slow?', ['It recomputes the same sub-problems exponentially many times.', 'fib(n) calls fib(n−1) and fib(n−2), which overlap heavily.'], [['Recursion is always slow.', 'Not always.'], ['The base case is missing.', 'It has one.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Stack = LIFO, O(1) push/pop; it underlies calls, undo and expression evaluation.</li><li>Recursion = base case + smaller problem; the call stack holds the frames.</li></ul>` }),
    ],
  })
}
