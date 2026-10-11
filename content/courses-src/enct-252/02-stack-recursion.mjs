import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, scr, q, pr, step, sec, term, run }) => {
  const p = run('infix', { expr: 'A+B*C-(D/E)' }), v = run('infix', { expr: '(2+3)*4-6/2' }), h = run('hanoi', { disks: 4 })
  return lesson({
    title: 'Stacks, expressions and recursion',
    kicker: 'ENCT 252 · Data Structure and Algorithms · Chapter 2',
    subtitle: 'Last in, first out — and why that is exactly the shape of function calls. The chapter builds the stack, uses it to evaluate and convert expressions, then shows recursion as the stack in disguise, ending with the classic recursive algorithms.',
    sections: [
      sec('stack', '2.1', 'The stack ADT', { eyebrow: 'LIFO',
        body: `<p>Think of a stack of plates in a canteen. You add a plate on top and take a plate from the top; to reach the plate at the bottom you must remove everything above it. A ${term('stack')} behaves exactly like this: insertion and removal happen at one end only, the <b>top</b>. The operations are <b>push</b> (add on top), <b>pop</b> (remove and return the top), <b>peek</b> or <b>top</b> (read the top without removing) and <b>isEmpty</b>. The last item pushed is the first popped — ${term('LIFO')}, last in, first out.</p><p>As an ADT, a stack is only this contract. Two implementations are common. In an <b>array</b>, an integer <code>top</code> records the index of the top element (−1 when empty); push increments it and stores, pop returns and decrements. The size is fixed, so pushing onto a full stack is <b>overflow</b> and must be checked, as must <b>underflow</b> (popping an empty stack). In a <b>linked list</b>, push inserts a new node at the head and pop removes the head — no size limit apart from memory. Both give O(1) for every operation, which is the stack’s selling point. C++ provides <code>std::stack</code> built on a deque; the program below pushes 10, 20, 30, 40 and pops them back in reverse order.</p>`,
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
        qs: [q('lifo', 'Push 1, 2, 3 then pop twice. What is on top?', ['1.', '3 and 2 leave first; 1 remains.'], [['3.', 'It was popped first.'], ['2.', 'It was popped second.']]), q('overflow', 'In an array-based stack of capacity 5 holding 5 items, a push is attempted. What must the code do?', ['Detect overflow and refuse (or grow the array).', 'Writing past the end would corrupt memory; checking top == capacity − 1 prevents it.'], [['Overwrite the bottom item.', 'That would destroy data and violate LIFO semantics.'], ['Ignore the check; C++ will handle it.', 'Raw arrays do no bounds checking.']]), q('complexity', 'What is the cost of push, pop and peek on a stack?', ['O(1) each.', 'They touch only the top element.'], [['O(n) for pop.', 'Pop does not search; it removes the top directly.'], ['O(log n).', 'No search is involved.']])],
        probs: [pr('p-trace', '<p>Start with an empty stack. Operations: push 5, push 8, pop, push 3, push 9, pop, pop. List the contents (bottom → top) after each operation and the popped values.</p>', '[5] → [5,8] → pop gives <b>8</b>, [5] → [5,3] → [5,3,9] → pop <b>9</b>, [5,3] → pop <b>3</b>, [5]. Popped sequence 8, 9, 3.')],
      }),

      sec('apps', '2.2', 'What stacks are used for', { eyebrow: 'Applications',
        body: `<p>Whenever something must be undone in reverse order, a stack appears. The <b>undo</b> command in an editor pushes each action and pops it to reverse. A web browser’s <b>back button</b> is a stack of visited pages. The run-time system uses a stack for <b>function calls</b> — each call pushes a frame holding its parameters, local variables and return address, and each return pops it — which is the subject of the recursion sections below. Compilers use stacks to <b>check balanced brackets</b>, to convert and evaluate expressions, and to parse nested constructs. Algorithms use them to simulate recursion (depth-first search) and for backtracking (maze solving).</p><p>The bracket-matching algorithm is the cleanest first example. Scan the text left to right; on an opening bracket (, [ or { push it; on a closing bracket, the stack must be non-empty and its top must be the matching opening bracket — pop it; any mismatch is an error; at the end the stack must be empty. Run it on <code>{[()]}(</code>: the first six characters match perfectly, but the final “(” is never closed, so the stack is not empty and the text is not balanced.</p>`,
        figs: [cpp(`#include <iostream>
#include <stack>
#include <string>
using namespace std;
int main() {
  string s = "{[()]}(";
  stack<char> st;
  bool ok = true;
  for (int i = 0; i < s.size(); i++) {
    char c = s[i];
    if (c == '(' || c == '[' || c == '{') st.push(c);
    else {
      if (st.empty()) { ok = false; break; }
      char t = st.top();
      st.pop();
      if ((c == ')' && t != '(') || (c == ']' && t != '[') || (c == '}' && t != '{')) { ok = false; break; }
    }
  }
  if (!st.empty()) ok = false;
  cout << (ok ? "balanced" : "not balanced") << endl;
  return 0;
}`, 'Change the string to {[()]} and run again: balanced.', { output: 'not balanced' })],
        qs: [q('bracket', 'Which input does the bracket-matching algorithm reject because of a MISMATCH rather than a leftover?', ['(]', 'The closing ] meets a top of ( which does not match it.'], [['((', 'This leaves two unmatched openers at the end — a leftover, not a mismatch.'], ['()', 'This is perfectly balanced.']])],
        probs: [pr('p-brk', '<p>For each string say whether it is balanced and, if not, why: (a) <code>([{}])</code> (b) <code>(()</code> (c) <code>)(</code>.</p>', '(a) balanced. (b) not balanced: one “(” left on the stack at the end. (c) not balanced: the first “)” arrives with an empty stack (underflow).')],
      }),

      sec('postfix', '2.3', 'Expressions: infix, prefix and postfix', { eyebrow: 'Notation',
        body: `<p>We normally write arithmetic in ${term('infix')} notation, with the operator between its operands: A + B. It is ambiguous without rules — what does A + B × C mean? — so we need <b>precedence</b> (× before +), <b>associativity</b> (left to right for − and /; right to left for exponentiation) and <b>parentheses</b> to override them. In ${term('postfix')} (reverse Polish, Łukasiewicz in reverse) the operator follows its operands: A B +. In ${term('prefix')} (Polish) it precedes them: + A B. Both are unambiguous without parentheses or precedence, because the position of each operator already says what it applies to. That makes them ideal for a machine, and a stack evaluates them effortlessly.</p><p><b>Evaluating postfix</b> is mechanical: scan left to right; push each operand; on an operator, pop the top two values (the first popped is the <em>right</em> operand), apply the operator, push the result. At the end the stack holds the answer. For 2 3 * 5 4 * + 9 −: push 2, 3; × gives 6; push 5, 4; × gives 20; + gives 26… the run below computes 6 + 20 − 9 = 17.</p><p><b>Converting infix to postfix</b> (Dijkstra’s shunting-yard algorithm) uses a stack of <em>operators</em>. Read tokens left to right. An operand goes straight to the output. For an operator, pop and output any stacked operator of <em>higher or equal</em> precedence (for left-associative operators), then push it. “(” is pushed; “)” pops and outputs until the matching “(” (which is discarded). At the end pop everything to the output. A + B × C − (D / E) becomes <b>${p.postfix}</b>. Step the card: the stack is the lower row, the output the row above.</p>`,
        figs: [lab('infix', { expr: 'A+B*C-(D/E)' }, 'Stack on the bottom row, output above it.', ['postfix'], { caption: 'infix → postfix', name: 'inf' }), cpp(`#include <iostream>
#include <stack>
#include <string>
using namespace std;
int main() {
  stack<int> s;
  string e = "23*54*+9-";
  for (int i = 0; i < e.size(); i++) {
    char c = e[i];
    if (c >= '0' && c <= '9') s.push(c - '0');
    else {
      int b = s.top(); s.pop();
      int a = s.top(); s.pop();
      if (c == '+') s.push(a + b);
      else if (c == '-') s.push(a - b);
      else s.push(a * b);
    }
  }
  cout << s.top() << endl;
  return 0;
}`, 'Evaluating the postfix 2 3 * 5 4 * + 9 −.', { output: '17' })],
        worked: [step('Evaluate the postfix of (2+3)*4−6/2 using a stack of numbers: push operands, each operator pops two.', '', { toc: 'Method' }), step('2 3 + → 5; 5 4 × → 20; 6 2 / → 3; 20 3 − → 17.', `${v.postfix}\\ \\Rightarrow\\ ${v.value}`, { hero: true, toc: 'Result' }), step('Order matters for − and /: when popping, the first value is the right operand. For 6 2 / the stack holds [6, 2]; pop gives b = 2 then a = 6, so the result is a / b = 3, not 2 / 6.', 'a\\ \\mathrm{op}\\ b,\\ b\\ \\text{popped first}', { toc: 'Operand order' })],
        qs: [q('prec', 'In A+B*C, which operator is applied first, and what does the postfix look like?', ['* first; postfix A B C * +.', '* has higher precedence, so B and C are multiplied before the addition.'], [['+ first; A B + C *.', 'That would be (A+B)*C.'], ['Left to right; A B + C *.', 'Precedence overrides left-to-right.']]), q('popt', 'When an operator is read during infix-to-postfix conversion, what happens first?', ['Operators on the stack of higher or equal precedence are popped to the output, then the new operator is pushed.', 'This keeps the correct order of evaluation in the output.'], [['It is output immediately.', 'Operands go to the output; operators wait on the stack.'], ['The stack is emptied completely.', 'Only operators that bind at least as tightly are popped.']]), q('rpn', 'Why do compilers like postfix?', ['It needs no parentheses or precedence rules and can be evaluated with a simple stack in one left-to-right pass.', 'The order of operators already encodes the order of evaluation.'], [['It is shorter than infix.', 'It is the same length (without the parentheses).'], ['It is easier for humans to read.', 'It usually is not; it is easier for machines.']])],
        probs: [pr('p-pf', '<p>Convert A+B*C−(D/E) to postfix.</p>', `<b>${p.postfix}</b>`, { verify: lab('infix', { expr: 'A+B*C-(D/E)' }, 'The conversion.', ['postfix'], { caption: 'answer', name: 'ans' }) }), pr('p-eval', '<p>Evaluate the postfix expression 5 1 2 + 4 * + 3 −.</p>', '1 2 + → 3; 3 4 * → 12; 5 12 + → 17; 17 3 − → <b>14</b>.'), pr('p-pre', '<p>Write (A + B) * C in prefix and in postfix.</p>', 'Postfix: <b>A B + C *</b>. Prefix: <b>* + A B C</b>.')],
      }),

      sec('rec', '2.4', 'Recursion: a function that calls itself', { eyebrow: 'The idea',
        body: `<p>Some problems contain smaller copies of themselves. To compute n!, note that n! = n × (n − 1)!: the factorial of n is n times the factorial of something smaller. A ${term('recursive')} function exploits this by calling itself on the smaller problem. Every correct recursive function has two parts: a <b>base case</b> that is answered directly (0! = 1) and stops the recursion, and a <b>recursive case</b> that reduces the problem and calls the function again, <em>moving towards the base case</em>. Leave out the base case, or fail to approach it, and the calls never stop.</p><p>How does the machine keep track? Each call gets its own ${term('activation record')} (stack frame) on the <b>call stack</b>, holding its parameters, its local variables and where to return. A new call pushes a frame; a return pops it. The run-time stack <em>is</em> the stack ADT of the previous sections, used by the machine itself. That is why a recursion that goes a million levels deep crashes with a <b>stack overflow</b>: it has run out of frame space. Run the factorial program and watch the stack grow five frames deep, then unwind as each pending multiplication completes.</p><p>Trace the figure: <code>fact(4)</code> calls <code>fact(3)</code>, which calls <code>fact(2)</code>, then <code>fact(1)</code> — the base case, which returns 1 without calling anything. Now the frames pop in reverse order: fact(2) returns 2 × 1 = 2, fact(3) returns 3 × 2 = 6, fact(4) returns 4 × 6 = 24. Nothing is multiplied on the way <em>down</em>; all the work happens on the way <em>back up</em>.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int fact(int n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
int main() {
  cout << fact(5) << endl;
  return 0;
}`, 'fact(5) makes 5 nested calls, then multiplies on the way back.', { output: '120' }), dia(`mode: sequence
[main] as m
[fact(4)] as a
[fact(3)] as b
[fact(2)] as c
[fact(1)] as d
m -> a : call
a -> b : call fact(3)
b -> c : call fact(2)
c -> d : call fact(1)
d -> c : return 1 (base case)
c -> b : return 2 × 1 = 2
b -> a : return 3 × 2 = 6
a -> m : return 4 × 6 = 24`, 'The stack grows down the page, then unwinds back up.', { caption: 'the call stack for fact(4)' })],
        qs: [q('base', 'What happens if a recursive function has no base case?', ['It recurses until the stack overflows.', 'Every call makes another call; frames pile up without end.'], [['It returns 0.', 'Nothing returns.'], ['It runs once.', 'It keeps calling itself.']]), q('frames', 'fact(5) is called. How many stack frames exist (counting main’s call as the first) when the base case fact(1) is running?', ['5 frames: fact(5), fact(4), fact(3), fact(2), fact(1).', 'Each pending call keeps its frame until its callee returns.'], [['1 frame.', 'Only one if the calls had finished — they have not.'], ['10 frames.', 'There is exactly one frame per active call.']]), q('down', 'In fact(n) = n * fact(n − 1), when do the multiplications actually happen?', ['On the way back up, after the base case returns.', 'Each frame waits for its callee’s result before multiplying.'], [['On the way down, before each call.', 'The value of fact(n − 1) is not yet known on the way down.'], ['All at once at the end.', 'They happen one by one as each frame returns.']])],
        probs: [pr('p-rectrace', '<p>Trace <code>fact(4)</code> and give the sequence of returned values.</p>', 'fact(1) → 1; fact(2) → 2; fact(3) → 6; fact(4) → <b>24</b> (returned in that order after the base case).')],
      }),

      sec('examples', '2.5', 'Classic recursive algorithms', { eyebrow: 'Practice',
        body: `<p>Four short programs teach most of what exams ask. <b>Greatest common divisor</b> (Euclid): gcd(a, b) = a if b = 0, otherwise gcd(b, a mod b). Each call shrinks the second argument, so it must reach 0. gcd(48, 18) → gcd(18, 12) → gcd(12, 6) → gcd(6, 0) = 6. <b>Digit sum</b>: sumDigits(n) = n if n &lt; 10 else (n mod 10) + sumDigits(n / 10); 9045 gives 5 + 4 + 0 + 9 = 18. <b>Fast exponentiation</b>: x^n = (x^{n/2})² for even n and x·(x^{n/2})² for odd n — halving the exponent gives O(log n) multiplications instead of n; power(2, 10) needs only 5 calls. <b>Binary search</b> (next chapters) is the same halving idea on a sorted array.</p><p>Compare fast exponentiation with the obvious loop. Computing 2¹⁰ naively takes 10 multiplications; the recursive halving version takes five calls (n = 10, 5, 2, 1, 0). For exponent a million that is 1,000,000 against about 20: the difference between a design that works and one that does not.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int gcd(int a, int b) {
  if (b == 0) return a;
  return gcd(b, a % b);
}
int main() {
  cout << gcd(48, 18) << " " << gcd(17, 5) << endl;
  return 0;
}`, 'Euclid’s algorithm: gcd(48,18) = 6 and gcd(17,5) = 1.', { output: '6 1' }), cpp(`#include <iostream>
using namespace std;
int calls = 0;
int power(int x, int n) {
  calls++;
  if (n == 0) return 1;
  int h = power(x, n / 2);
  if (n % 2 == 0) return h * h;
  return h * h * x;
}
int main() {
  cout << power(2, 10) << " " << calls << endl;
  return 0;
}`, '2¹⁰ = 1024 using only 5 calls.', { output: '1024 5' }), cpp(`#include <iostream>
using namespace std;
int sumDigits(int n) {
  if (n < 10) return n;
  return n % 10 + sumDigits(n / 10);
}
int main() {
  cout << sumDigits(9045) << endl;
  return 0;
}`, '9045 → 5 + 4 + 0 + 9.', { output: '18' })],
        worked: [step('Trace gcd(48, 18).', 'gcd(48,18)=gcd(18,48\\bmod18)=gcd(18,12)', { toc: 'First call' }), step('Continue until the second argument is 0.', 'gcd(18,12)=gcd(12,6)=gcd(6,0)', { toc: 'Reduce' }), step('The base case returns a.', 'gcd(48,18)=6', { hero: true, toc: 'Result' })],
        qs: [q('gcdcalls', 'How many calls does gcd(48, 18) make, counting the first?', ['4 — gcd(48,18), gcd(18,12), gcd(12,6), gcd(6,0).', 'The last is the base case b = 0.'], [['2.', 'The second argument shrinks slowly; four calls are needed.'], ['6.', '6 is the answer, not the number of calls.']]), q('powcalls', 'Why does power(x, n) with halving use about log₂ n calls?', ['Each call halves n, so n reaches 0 after about log₂ n steps.', 'The naive loop uses n multiplications.'], [['It uses n calls.', 'That is the naive linear version.'], ['It uses n² calls.', 'There is no nested work.']])],
        probs: [pr('p-gcd', '<p>Compute gcd(252, 105) by Euclid’s algorithm, showing each step.</p>', 'gcd(252,105) = gcd(105,42) = gcd(42,21) = gcd(21,0) = <b>21</b>.'), pr('p-pow', '<p>How many recursive calls does power(3, 13) make (counting the first)? Give the value too.</p>', 'n: 13 → 6 → 3 → 1 → 0: <b>5 calls</b>. 3¹³ = <b>1,594,323</b>.')],
      }),

      sec('hanoi', '2.6', 'Tower of Hanoi', { eyebrow: 'Recursion at its best',
        body: `<p>Three pegs, A, B and C. Peg A holds <i>n</i> disks of decreasing size, the largest at the bottom. Move them all to C, one at a time, never placing a larger disk on a smaller one, using B as a spare. Try it by hand with n = 4 and you will be lost; think recursively and it is trivial. To move n disks from A to C: first move the top n − 1 disks from A to B (using C as the spare), then move the largest disk from A to C, then move the n − 1 disks from B to C (using A). The two sub-moves are the <em>same problem</em> with one disk fewer. The base case is zero disks: do nothing.</p><p>Counting the moves gives a recurrence. Let T(n) be the number of moves. Then T(n) = T(n − 1) + 1 + T(n − 1) = 2T(n − 1) + 1 with T(0) = 0. Unrolling shows T(n) = 2ⁿ − 1: T(1) = 1, T(2) = 3, T(3) = 7, T(4) = <b>${h.moves}</b>. The cost is exponential — adding a single disk doubles the work — and it is provably the minimum number of moves, so no cleverness avoids it. The legend says monks move 64 golden disks; at one move a second that is 2⁶⁴ − 1 seconds, about 585 billion years.</p>`,
        figs: [lab('hanoi', { disks: 3 }, 'Seven moves for three disks.', ['moves'], { caption: 'three disks', name: 'h3' }), cpp(`#include <iostream>
using namespace std;
int moves = 0;
void hanoi(int n, char a, char b, char c) {
  if (n == 0) return;
  hanoi(n - 1, a, c, b);
  moves++;
  hanoi(n - 1, c, b, a);
}
int main() {
  hanoi(4, 'A', 'B', 'C');
  cout << moves << endl;
  return 0;
}`, 'The recursion counts 15 moves for 4 disks.', { output: '15' })],
        deriv: [
          step('The recursion makes two calls on n − 1 disks and one direct move.', 'T(n)=2T(n-1)+1,\\quad T(0)=0', { toc: 'Recurrence' }),
          step('Unroll once and twice to see the pattern.', 'T(n)=2(2T(n-2)+1)+1=4T(n-2)+3=8T(n-3)+7', { toc: 'Unroll' }),
          step('After k steps the coefficient of T is 2^k and the constant is 2^k − 1.', 'T(n)=2^{k}T(n-k)+(2^{k}-1)', { toc: 'Pattern' }),
          step('Stop at k = n where T(0) = 0.', 'T(n)=2^{n}-1', { hero: true, toc: 'Closed form' }),
        ],
        worked: [step('T(1) = 1 and T(n) = 2T(n−1) + 1.', '', { toc: 'Recurrence' }), step('Expanding: T(n) = 2ⁿ − 1.', 'T(4)=2^4-1=15', { hero: true, toc: 'Closed form' })],
        qs: [q('hn', 'Moves needed for 5 disks?', ['31.', '2⁵ − 1.'], [['25.', 'Not exponential.'], ['32.', 'One too many.']]), q('hbase', 'What is the base case of the Hanoi recursion?', ['Moving zero (or one) disk: nothing (or a single move) to do.', 'It stops the recursion; every other case reduces n by 1.'], [['Moving the largest disk.', 'That is a step in the recursive case.'], ['Moving all disks at once.', 'That is the original problem.']])],
        probs: [pr('p-hn', '<p>How many moves does Tower of Hanoi need for 10 disks? For 20?</p>', '2¹⁰ − 1 = <b>1,023</b>; 2²⁰ − 1 = <b>1,048,575</b>.'), pr('p-hcalls', '<p>How many calls to the hanoi function (including those with n = 0) does hanoi(3, …) make?</p>', 'Each non-trivial call makes 2 further calls. Calls form a full binary tree of height 3: 2⁴ − 1 = <b>15 calls</b> (7 that do a move, 8 base cases).')],
      }),

      sec('types', '2.7', 'Kinds of recursion and the cost of recursion', { eyebrow: 'Terminology',
        body: `<p>Recursion comes in several shapes. In <b>direct</b> recursion a function calls itself; in <b>indirect</b> (mutual) recursion f calls g and g calls f. In <b>linear</b> recursion each call makes at most one further call (factorial, gcd); in <b>binary</b> or <b>tree</b> recursion each makes two (Fibonacci, Hanoi), which is where exponential costs hide. A call is <b>tail recursive</b> if the recursive call is the very last thing the function does — there is nothing left to do after it returns, such as the multiplication in <code>n * fact(n-1)</code>. A tail-recursive function can be turned into a loop automatically (<em>tail-call optimisation</em>) so it uses no extra stack; the factorial above is <em>not</em> tail recursive, but the accumulator version <code>fact(n, acc) = fact(n − 1, n·acc)</code> is.</p><p>The costs of recursion are time (call overhead) and space (a frame per pending call, O(depth)). The danger is repeated work. The naive Fibonacci function recomputes the same values over and over: fib(10) makes 177 calls for an answer that needs only 10 additions. Remember the answers in a table — <b>memoisation</b> — and each value is computed once; fib(10) then makes only 19 calls. This is the seed of dynamic programming: when subproblems overlap, recursion needs a memory.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int calls = 0;
int fib(int n) {
  calls++;
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
int main() {
  cout << fib(10) << " " << calls << endl;
  return 0;
}`, 'Naive: 177 calls for fib(10).', { output: '55 177' }), cpp(`#include <iostream>
using namespace std;
int memo[30];
int calls = 0;
int fib(int n) {
  calls++;
  if (n < 2) return n;
  if (memo[n] != 0) return memo[n];
  memo[n] = fib(n - 1) + fib(n - 2);
  return memo[n];
}
int main() {
  cout << fib(10) << " " << calls << endl;
  return 0;
}`, 'Memoised: only 19 calls for the same answer.', { output: '55 19' })],
        qs: [q('fib', 'Why is naive recursive Fibonacci slow?', ['It recomputes the same sub-problems exponentially many times.', 'fib(n) calls fib(n−1) and fib(n−2), which overlap heavily.'], [['Recursion is always slow.', 'Not always.'], ['The base case is missing.', 'It has one.']]), q('tail', 'Which is tail recursive?', ['A function whose last action is the recursive call, such as gcd(b, a % b).', 'Nothing remains to be done after the call returns, so the frame can be reused.'], [['n * fact(n − 1).', 'A multiplication remains after the call returns.'], ['fib(n−1) + fib(n−2).', 'An addition remains after both calls.']]), q('depth', 'A linear recursion of depth n allocates no arrays. What is its space complexity?', ['O(n) for the stack frames.', 'One frame per pending call.'], [['O(1).', 'The frames are real memory.'], ['O(log n).', 'Only if the depth were logarithmic.']])],
        probs: [pr('p-memo', '<p>Naive fib(5) makes how many calls (counting the first)? Use C(n) = C(n−1) + C(n−2) + 1 with C(0) = C(1) = 1.</p>', 'C(2) = 3, C(3) = 5, C(4) = 9, C(5) = <b>15</b>. (The pattern C(n) = 2·fib(n+1) − 1 grows like 1.618ⁿ.)')],
      }),

      sec('iter', '2.8', 'Recursion versus iteration and backtracking', { eyebrow: 'Choosing',
        body: `<p>Anything recursive can be written with a loop and an explicit stack, because the call stack <em>is</em> a stack; and any loop can be written as tail recursion. Which to use? Recursion is natural when the problem or the data is recursive — trees, divide-and-conquer, backtracking — and the code mirrors the definition. Iteration is usually faster and uses O(1) stack, and is safer for very deep problems. A good rule: use recursion when it makes the algorithm clearer and the depth is modest (log n or at most a few thousand); use a loop when the recursion is linear and the depth could be large.</p><p><b>Backtracking</b> is recursion with an undo step. To solve a puzzle (eight queens, a maze, sudoku) you make a choice, recurse to try to complete the solution, and if you reach a dead end you <em>undo</em> the choice and try the next. The recursion stack remembers where to back up to. The same idea explains depth-first search in graphs, which we use two chapters from now.</p>`,
        qs: [q('rvi', 'When is iteration preferable to recursion?', ['When the recursion is linear and deep, because a loop uses O(1) stack and avoids overflow.', 'Recursion’s frames cost space and time.'], [['Never; recursion is always better.', 'Each has its place.'], ['Only when the problem is a tree.', 'Trees are where recursion shines.']]), q('bt', 'What distinguishes backtracking from plain recursion?', ['It undoes a choice and tries an alternative when a branch fails.', 'The recursive call stack remembers where to back up.'], [['It never reaches a base case.', 'It has base cases (solution found or dead end).'], ['It uses no stack.', 'It uses the call stack.']])],
        probs: [pr('p-conv', '<p>Convert the recursive sum(n) = n + sum(n − 1), sum(0) = 0 into a loop, and state the saving in space.</p>', '<code>s = 0; for (i = 1; i &lt;= n; i++) s += i;</code> The recursive version holds n frames (O(n) space); the loop holds O(1).')],
      }),

      sec('summary', '2.9', 'Summary', { eyebrow: 'Recap', body: `<ul><li>A stack is LIFO with O(1) push, pop and peek; check overflow and underflow. It powers undo, back, bracket matching, expression handling and the call stack.</li><li>Postfix needs no parentheses: evaluate with a stack of numbers; convert from infix with a stack of operators (shunting-yard).</li><li>Recursion = base case + a smaller problem; each active call has a stack frame; work happens as frames return.</li><li>Classics: factorial, gcd (Euclid), digit sum, fast exponentiation (log n), Hanoi (2ⁿ − 1 moves).</li><li>Tree recursion can be exponential (naive Fibonacci); memoisation fixes it. Tail recursion can become a loop. Backtracking is recursion with undo.</li></ul>` }),
    ],
  })
}
