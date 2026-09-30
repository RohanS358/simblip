import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'From problem to running program',
  kicker: 'ENCT 101 · Computer Programming · Chapters 1–2',
  subtitle: 'A computer does exactly what it is told, nothing more. Learn to tell it clearly: plan, write, compile, run, fix.',
  sections: [
    sec('ps', '1.1', 'Problem solving', { eyebrow: 'Think before typing',
      body: `<p>Programming starts with a precise problem statement: what are the inputs, what output is wanted, and what rule links them? An ${term('algorithm')} is a finite, unambiguous sequence of steps that solves it. Write it first as plain steps (pseudocode) or a flowchart, then translate to code. Good algorithms are correct, finite, and efficient.</p>`,
      qs: [q('alg', 'Which is NOT required of an algorithm?', ['That it is written in C.', 'It can be in any notation; it must be finite, definite and correct.'], [['That it ends after finite steps.', 'Required.'], ['That each step is unambiguous.', 'Required.']])] }),
    sec('flow', '1.2', 'Flowcharts', { eyebrow: 'Algorithms you can see',
      body: `<p>Ovals start/stop, parallelograms do input/output, rectangles process, diamonds decide. Follow the arrows: this chart finds the larger of two numbers.</p>`,
      figs: [dia(`direction: down
[Start] as s
[Read a, b] as r
<Is a larger than b?> as d
[Print a] as pa
[Print b] as pb
[Stop] as e
s -> r
r -> d
d -> pa : yes
d -> pb : no
pa -> e
pb -> e
@0 s -> r
@1 r -> d
@2 d -> pa : yes
@3 pa -> e`, 'The token takes the “yes” branch.', { caption: 'larger of two' })],
      qs: [q('dia', 'A diamond in a flowchart represents…', ['A decision with yes/no branches.', 'Two exits.'], [['Input or output.', 'That is a parallelogram.'], ['The start.', 'That is an oval.']])] }),
    sec('pipe', '1.3', 'Compile, link, run', { eyebrow: 'From text to behaviour',
      body: `<p>C source (<code>.c</code>) is turned into a program by stages: the <b>preprocessor</b> expands <code>#include</code> and macros; the <b>compiler</b> translates to machine code in object files (<code>.o</code>) and reports syntax errors; the <b>linker</b> joins object files and libraries into an executable; the <b>loader</b> puts it in memory to run. Errors come in three kinds: syntax (compile time), logic (wrong answer) and runtime (crash).</p>`,
      figs: [dia(`direction: right
[prog.c] as a
[Preprocessor] as b
[Compiler] as c
[prog.o] as d
[Linker + libs] as e
[a.out] as f
a -> b
b -> c
c -> d
d -> e
e -> f
@0 a -> b
@1 b -> c
@2 c -> d
@3 d -> e
@4 e -> f
loop 2`, 'Each stage feeds the next.', { caption: 'build pipeline' })],
      qs: [q('link', 'An “undefined reference” error comes from the…', ['Linker.', 'A function was declared but no code was found.'], [['Preprocessor.', 'That handles #include.'], ['Editor.', 'Not a tool stage.']])] }),
    sec('struct', '2.1', 'Structure of a C program', { eyebrow: 'The skeleton',
      body: `<p>Every program has <code>main()</code>, where execution starts; statements end with <code>;</code>; blocks use <code>{ }</code>; <code>/* … */</code> and <code>//</code> are comments. Below, run it and watch each line execute. (The lab runs a C/C++ subset: <code>cout</code> here plays the role of <code>printf</code>.)</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a = 12;
  int b = 5;
  int sum = a + b;
  cout << sum << endl;
  return 0;
}`, 'Declare, compute, print.', { output: '17' })],
      qs: [q('mainq', 'Execution of a C program begins at…', ['main().', 'The entry point.'], [['The first function written.', 'Order in the file does not matter.'], ['#include.', 'Preprocessor only.']])] }),
    sec('types', '2.2', 'Variables and data types', { eyebrow: 'Named boxes in memory',
      body: `<p>A variable is a named memory location with a type that fixes its size and meaning: <code>char</code> (1 byte), <code>int</code> (usually 4), <code>float</code> (4, ≈7 digits), <code>double</code> (8, ≈15 digits). Declare before use; initialise before reading — an uninitialised local holds garbage. Identifiers: letters, digits, underscore; not starting with a digit; case-sensitive.</p>`,
      worked: [step('A signed 8-bit char can hold 2⁸ = 256 values.', '', { toc: 'Count' }), step('Range is −128 … 127.', '-2^{7}\\ \\text{to}\\ 2^{7}-1', { hero: true, toc: 'Range' })],
      qs: [q('rng', 'An unsigned 8-bit variable holds…', ['0 to 255.', '2⁸ − 1.'], [['−128 to 127.', 'That is signed.'], ['0 to 256.', 'Off by one.']])],
      probs: [pr('p-rng', '<p>What is the largest value of a signed 16-bit integer?</p>', '2¹⁵ − 1 = <b>32767</b>.')] }),
    sec('const', '2.3', 'Constants and style', { eyebrow: 'Readable code',
      body: `<p>Use <code>const</code> or <code>#define</code> for fixed values (PI, MAX) instead of “magic numbers”. Choose descriptive names, indent consistently, comment the <i>why</i>. Code is read far more often than it is written.</p>`,
      qs: [q('mag', 'Why prefer <code>const int MAX = 100;</code> to writing 100 everywhere?', ['One named place to change and the meaning is clear.', 'Avoids magic numbers.'], [['It makes the program faster.', 'No difference in speed.'], ['It is required by C.', 'Not required.']])] }),
  ],
})
