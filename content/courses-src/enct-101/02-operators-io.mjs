import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Operators, precedence and formatted I/O',
  kicker: 'ENCT 101 · Computer Programming · Chapters 3–4',
  subtitle: 'Expressions are evaluated in a fixed order. Know it, and you can predict any line of arithmetic.',
  sections: [
    sec('arith', '3.1', 'Arithmetic operators', { eyebrow: '+ − * / %',
      body: `<p><code>+ - * /</code> and the remainder <code>%</code>. With two integers, <code>/</code> is <b>integer division</b> (truncates): 7/2 is 3, not 3.5; <code>%</code> gives the leftover: 7 % 3 is 1. To get 3.5 make one operand a double (7/2.0).</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  cout << 7 / 2 << " " << 7 % 3 << " " << -7 / 2 << endl;
  return 0;
}`, 'Integer division truncates toward zero.', { output: '3 1 -3' })],
      qs: [q('div', '9 / 4 in C (both int) is…', ['2.', 'The fraction is discarded.'], [['2.25.', 'Needs a double.'], ['3.', 'Rounding is not done.']])] }),
    sec('prec', '3.2', 'Precedence and associativity', { eyebrow: 'Who goes first',
      body: `<p>From high to low: parentheses, unary (<code>! - ++ --</code>), <code>* / %</code>, <code>+ -</code>, relational (<code>&lt; &gt; &lt;= &gt;=</code>), equality (<code>== !=</code>), <code>&amp;&amp;</code>, <code>||</code>, assignment. Equal precedence goes left to right (assignment right to left). When unsure, add parentheses.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a = 5, b = 3;
  cout << a + b * 2 << " " << (a + b) * 2 << " " << (a > b && b < 4) << endl;
  return 0;
}`, '* before +; parentheses override.', { output: '11 16 1' })],
      worked: [step('Evaluate 2 + 3 * 4 − 6 / 2.', '', { toc: 'Plan' }), step('Multiplication and division first: 12 and 3.', '2+12-3', { toc: 'Reduce' }), step('Then left to right.', '=11', { hero: true, toc: 'Result' })],
      qs: [q('pr', '5 + 2 * 3 − 4 =', ['7.', '5 + 6 − 4.'], [['17.', 'Did + before *.'], ['13.', 'Left to right without precedence.']])],
      probs: [pr('p-pr', '<p>Evaluate 10 − 4 / 2 * 3 + 1.</p>', '4/2 = 2; 2·3 = 6; 10 − 6 + 1 = <b>5</b>.')] }),
    sec('incr', '3.3', 'Increment, compound assignment, conversion', { eyebrow: 'Shortcuts and casts',
      body: `<p><code>x += 5</code> means <code>x = x + 5</code>. <code>i++</code> uses i then adds 1; <code>++i</code> adds 1 then uses it. In mixed expressions the smaller type is promoted (int → double). A cast forces it: <code>(double)a / b</code>.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int i = 5;
  int a = i++;
  int b = ++i;
  cout << a << " " << b << " " << i << endl;
  return 0;
}`, 'Post-increment yields the old value; pre-increment the new one.', { output: '5 7 7' })],
      qs: [q('inc', 'int i = 2; int j = i++ + 3; leaves j =', ['5.', 'i++ yields 2, then i becomes 3.'], [['6.', 'Would need ++i.'], ['3.', 'Ignores i.']])] }),
    sec('logic', '3.4', 'Relational, logical and bitwise', { eyebrow: 'True and false',
      body: `<p>In C, 0 is false and any non-zero is true; comparisons yield 0 or 1. <code>&amp;&amp;</code> and <code>||</code> short-circuit: in <code>a != 0 &amp;&amp; x/a &gt; 1</code> the division is never attempted when a is 0. Bitwise: <code>&amp; | ^ ~ &lt;&lt; &gt;&gt;</code> work on bits: <code>x &lt;&lt; 1</code> doubles an integer.</p>`,
      worked: [step('12 = 1100₂, 10 = 1010₂. AND bit by bit.', '1100\\ \\&\\ 1010', { toc: 'Align' }), step('Result 1000₂.', '=8', { hero: true, toc: 'AND' })],
      qs: [q('sc', 'Why is <code>p != NULL &amp;&amp; *p &gt; 0</code> safe?', ['&amp;&amp; short-circuits, so *p is skipped when p is NULL.', 'Right side is evaluated only if the left is true.'], [['C checks pointers automatically.', 'It does not.'], ['It is not safe.', 'It is the standard idiom.']])] }),
    sec('io', '4.1', 'printf and scanf', { eyebrow: 'Talking to the user',
      body: `<p><code>printf("fmt", args)</code> writes formatted output; conversion specifiers: <code>%d</code> int, <code>%f</code> double/float, <code>%c</code> char, <code>%s</code> string, <code>%x</code> hex; <code>%5.2f</code> means width 5, 2 decimals. <code>scanf("%d", &amp;n)</code> reads input — note the <b>&amp;</b>: scanf needs the variable’s <i>address</i> so it can store into it. <code>getchar/putchar</code> handle single characters.</p>`,
      figs: [dia(`mode: sequence
[Keyboard] as k
[scanf] as s
[Variable n] as n
[printf] as p
[Screen] as c
k -> s : 42
s -> n : store at &n
n -> p : read n
p -> c : "n = 42"
@0 k -> s : 42
@1 s -> n : store at &n
@2 n -> p : read n
@3 p -> c : "n = 42"`, 'Input flows into memory; output flows from it.', { caption: 'scanf then printf' })],
      qs: [q('amp', 'Why does scanf need <code>&amp;n</code>?', ['It must know where in memory to store the value.', 'C passes by value, so the address is passed.'], [['To print n.', 'That is printf.'], ['It is optional.', 'Omitting it is a bug.']])] }),
    sec('fmt', '4.2', 'Format specifiers at a glance', { eyebrow: 'Reference',
      body: `<table><thead><tr><th>Spec</th><th>Meaning</th><th>printf(…) gives</th></tr></thead><tbody><tr><td>%d</td><td>int</td><td>42 → 42</td></tr><tr><td>%5d</td><td>width 5</td><td>42 → ···42</td></tr><tr><td>%.2f</td><td>2 decimals</td><td>3.14159 → 3.14</td></tr><tr><td>%c</td><td>char</td><td>65 → A</td></tr><tr><td>%s</td><td>string</td><td>"hi" → hi</td></tr></tbody></table>`,
      qs: [q('f2', 'Which prints 3.14 from 3.14159?', ['%.2f', 'Two digits after the point.'], [['%2d', 'Integer format.'], ['%c', 'Character.']])] }),
  ],
})
