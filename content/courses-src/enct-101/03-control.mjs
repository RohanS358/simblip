import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Decisions and loops',
  kicker: 'ENCT 101 · Computer Programming · Chapter 5',
  subtitle: 'Sequence, selection, repetition: every program ever written is built from these three.',
  sections: [
    sec('if', '5.1', 'if, else if, else', { eyebrow: 'Choosing a path',
      body: `<p><code>if (cond) { … } else if (cond2) { … } else { … }</code>. Only the first true branch runs. Beware <code>=</code> (assign) versus <code>==</code> (compare) inside a condition, and the “dangling else” — an else belongs to the nearest if, so use braces.</p>`,
      figs: [dia(`direction: down
[Read marks] as r
<Marks 80 or more?> as a
<Marks 60 or more?> as b
[Print Distinction] as d
[Print Pass] as p
[Print Fail] as f
r -> a
a -> d : yes
a -> b : no
b -> p : yes
b -> f : no
@0 r -> a
@1 a -> b : no
@2 b -> p : yes`, 'Conditions are tried in order.', { caption: 'grade ladder' })],
      qs: [q('eq', '<code>if (x = 5)</code> does…', ['Assigns 5 to x and is always true.', 'A classic bug: == was meant.'], [['Compares x with 5.', 'That is ==.'], ['Is a syntax error.', 'It compiles.']])] }),
    sec('sw', '5.2', 'switch', { eyebrow: 'Many-way choice',
      body: `<p><code>switch (n) { case 1: …; break; case 2: …; break; default: … }</code> jumps to the matching case. Without <code>break</code> control falls through to the next case — sometimes useful, often a bug. The selector must be an integer or char.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int d = 3;
  switch (d) {
    case 1: cout << "Mon" << endl; break;
    case 3: cout << "Wed" << endl; break;
    default: cout << "?" << endl;
  }
  return 0;
}`, 'Jumps straight to case 3.', { output: 'Wed' })],
      qs: [q('brk', 'Forgetting <code>break</code> in a case causes…', ['Fall-through into the next case.', 'Execution continues downward.'], [['A compile error.', 'It is legal.'], ['The switch to stop.', 'The opposite.']])] }),
    sec('for', '5.3', 'for loop', { eyebrow: 'Counting',
      body: `<p><code>for (init; condition; update) body</code>: init once, test before each pass, update after each pass. Use it when the number of repetitions is known. The sum of even numbers 1–10 below is 2 + 4 + 6 + 8 + 10.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int sum = 0;
  for (int i = 1; i <= 10; i++) {
    if (i % 2 == 0) sum += i;
  }
  cout << sum << endl;
  return 0;
}`, 'Step through: watch sum grow only on even i.', { output: '30' })],
      worked: [step('Iterations of for (i = 0; i < n; i++) when n = 10.', '', { toc: 'Count' }), step('i takes 0,1,…,9: ten passes.', '10', { hero: true, toc: 'Passes' })],
      qs: [q('off', 'How many times does <code>for (i = 1; i &lt;= 5; i++)</code> run its body?', ['5.', '1, 2, 3, 4, 5.'], [['4.', 'Off by one.'], ['6.', 'Off by one the other way.']])],
      probs: [pr('p-sum', '<p>What does the program above print if the condition is changed to <code>i % 3 == 0</code>?</p>', '3 + 6 + 9 = <b>18</b>.')] }),
    sec('while', '5.4', 'while and do–while', { eyebrow: 'Repeat until',
      body: `<p><code>while (cond)</code> tests first, so may run zero times; <code>do { … } while (cond);</code> runs at least once. Use <code>while</code> when the count is unknown. <code>break</code> leaves a loop; <code>continue</code> skips to the next pass.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int n = 5, f = 1;
  while (n > 1) {
    f *= n;
    n--;
  }
  cout << f << endl;
  int k = 3;
  do { cout << k << " "; k--; } while (k > 0);
  cout << endl;
  return 0;
}`, '5! = 120; the do–while counts down.', { output: '120\n3 2 1' })],
      qs: [q('dw', 'A do–while body runs at least…', ['Once.', 'The test is at the bottom.'], [['Twice.', 'No.'], ['Zero times.', 'That is while.']])] }),
    sec('nest', '5.5', 'Nested loops and patterns', { eyebrow: 'Loops inside loops',
      body: `<p>An outer loop of m passes containing an inner loop of n passes runs the inner body m × n times — the basis of tables, matrices and patterns (and of O(n²) cost). Triangle of stars: row i prints i stars.</p>`,
      worked: [step('Outer 4 passes, inner up to row number: 1 + 2 + 3 + 4.', '', { toc: 'Rows' }), step('Total inner passes.', '\\tfrac{4\\cdot5}{2}=10', { hero: true, toc: 'Total' })],
      qs: [q('nl', 'Outer loop 6 passes, inner 7 passes. Inner body runs…', ['42 times.', '6 × 7.'], [['13 times.', 'That adds.'], ['7 times.', 'Only one outer pass.']])] }),
    sec('rec', '5.6', 'Choosing the right loop', { eyebrow: 'Summary',
      body: `<table><thead><tr><th>Need</th><th>Use</th></tr></thead><tbody><tr><td>Known count</td><td>for</td></tr><tr><td>Repeat until a condition, maybe zero times</td><td>while</td></tr><tr><td>Run once, then repeat while</td><td>do–while</td></tr><tr><td>Choose among constants</td><td>switch</td></tr></tbody></table>`,
      qs: [q('ch', 'Menu shown at least once, repeated until the user quits:', ['do–while.', 'Test after the body.'], [['for.', 'Count unknown.'], ['switch.', 'Not a loop.']])] }),
  ],
})
