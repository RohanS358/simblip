import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Functions, recursion and structures',
  kicker: 'ENCT 101 · Computer Programming · Chapters 7–8',
  subtitle: 'Break a big problem into named pieces, and group related data into one unit.',
  sections: [
    sec('fn', '7.1', 'Defining and calling functions', { eyebrow: 'Reuse with a name',
      body: `<p>A function has a return type, name, parameters and body: <code>int square(int x) { return x * x; }</code>. Declare a <b>prototype</b> before use so the compiler knows the signature. <code>void</code> functions return nothing. Benefits: reuse, testing one piece at a time, readability.</p>`,
      qs: [q('proto', 'A function prototype tells the compiler…', ['The name, parameter types and return type.', 'So calls can be checked before the body is seen.'], [['The function’s algorithm.', 'That is the body.'], ['Where the function is stored.', 'The linker finds that.']])] }),
    sec('scope', '7.2', 'Scope and lifetime', { eyebrow: 'Where a name is visible',
      body: `<p>Local variables live inside a function (or block) and vanish when it returns; each call has its own copy. Global variables are visible everywhere but make code harder to reason about. <code>static</code> locals keep their value between calls.</p>`,
      qs: [q('loc', 'Two different functions each declare <code>int i</code>. They are…', ['Separate variables.', 'Locals are private to their function.'], [['The same variable.', 'Only globals are shared.'], ['A compile error.', 'Perfectly legal.']])] }),
    sec('stack', '7.3', 'The call stack', { eyebrow: 'What happens on a call',
      body: `<p>Each call pushes a <b>stack frame</b> holding parameters, locals and the return address; return pops it. Recursion simply stacks many frames.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int fact(int n) {
  if (n <= 1) return 1;
  return n * fact(n - 1);
}
int main() {
  cout << fact(5) << endl;
  return 0;
}`, 'Five nested frames build up, then unwind multiplying.', { output: '120' })],
      worked: [step('fact(4) = 4 × fact(3) = 4 × 3 × fact(2).', '', { toc: 'Expand' }), step('= 4 × 3 × 2 × 1.', '24', { hero: true, toc: 'Unwind' })],
      qs: [q('base', 'A recursive function must have…', ['A base case that stops the calls.', 'Otherwise the stack overflows.'], [['No parameters.', 'Not required.'], ['A loop.', 'Not required.']])],
      probs: [pr('p-fib', '<p>Given fib(0)=0, fib(1)=1, fib(n)=fib(n−1)+fib(n−2), find fib(6).</p>', '0,1,1,2,3,5,<b>8</b>.')] }),
    sec('rec', '7.4', 'Recursion vs iteration', { eyebrow: 'Two ways to repeat',
      body: `<p>Anything recursive can be written with a loop. Recursion is natural for trees and divide-and-conquer; iteration is cheaper (no frames). The naive recursive Fibonacci recomputes subproblems: fib(6) makes 25 calls.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int fib(int n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
int main() {
  cout << fib(6) << endl;
  return 0;
}`, 'Step through to see the overlapping calls.', { output: '8' })],
      qs: [q('ri', 'Why is iteration usually cheaper than recursion?', ['No stack frame per step.', 'Less memory and overhead.'], [['Loops are always shorter.', 'Not always.'], ['Recursion is illegal in C.', 'It is legal.']])] }),
    sec('struct', '8.1', 'Structures', { eyebrow: 'Grouping data',
      body: `<p>A <code>struct</code> bundles fields of different types: <code>struct Student { int roll; int marks; };</code>. Access with the dot operator (<code>s.marks</code>), or arrow through a pointer (<code>p-&gt;marks</code>). Assigning one struct to another copies every field.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
struct Student { int roll; int marks; };
int main() {
  Student s;
  s.roll = 7;
  s.marks = 88;
  Student t = s;
  t.marks = 90;
  cout << s.marks << " " << t.marks << endl;
  return 0;
}`, 'Copying a struct copies the fields; t is independent of s.', { output: '88 90' })],
      worked: [step('struct { char c; int i; } on a typical machine: c takes 1 byte, then 3 bytes of padding so i is 4-aligned.', '', { toc: 'Layout' }), step('Total size 1 + 3 + 4.', '8\\ \\text{bytes}', { hero: true, toc: 'Size' })],
      qs: [q('arrow', 'Given <code>struct S *p</code>, field x is reached by…', ['p->x.', 'Arrow dereferences and selects.'], [['p.x', 'Only for a struct value.'], ['*p.x', 'Wrong precedence.']])],
      probs: [pr('p-pad', '<p>struct { int a; char b; int c; } with 4-byte alignment: size?</p>', 'a 4 + b 1 + 3 pad + c 4 = <b>12 bytes</b>.')] }),
    sec('union', '8.2', 'Arrays of structs, unions, enums', { eyebrow: 'Combining',
      body: `<p>An array of structs models a table (students). A <code>union</code> shares one memory slot between its members (size = largest member). <code>enum</code> gives names to integer constants (<code>enum {RED, GREEN, BLUE};</code> = 0, 1, 2). <code>typedef</code> creates a shorter type name.</p>`,
      qs: [q('un', 'A union of an int (4 B) and a double (8 B) occupies…', ['8 bytes.', 'Members overlap; size is the largest.'], [['12 bytes.', 'That is a struct with no padding.'], ['4 bytes.', 'Too small for the double.']])] }),
  ],
})
