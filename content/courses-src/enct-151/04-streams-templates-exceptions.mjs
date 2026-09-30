import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Streams, templates and exceptions',
  kicker: 'ENCT 151 · Object Oriented Programming · Chapters 7–9',
  subtitle: 'Generic code that works for any type, input/output as flowing streams, and errors that jump to where they can be handled.',
  sections: [
    sec('stream', '7.1', 'Streams', { eyebrow: 'Data as a flow',
      body: `<p>A stream is a sequence of characters flowing between a program and a device. <code>cin</code> (input), <code>cout</code> (output), <code>cerr</code> (errors). <code>&lt;&lt;</code> inserts, <code>&gt;&gt;</code> extracts, and both chain. The stream classes form a hierarchy: <code>ios</code> → <code>istream</code>/<code>ostream</code> → <code>ifstream</code>/<code>ofstream</code> (files) and <code>stringstream</code> (strings).</p>`,
      figs: [dia(`direction: down
{ios | state flags} as i
{istream | cin | operator>>} as is
{ostream | cout | operator<<} as os
{ifstream | file in} as ifs
{ofstream | file out} as ofs
is -> i
os -> i
ifs -> is
ofs -> os`, 'File streams specialise the console streams.', { caption: 'stream classes' })],
      qs: [q('ifs', 'ifstream is derived from…', ['istream.', 'A file is just another input stream.'], [['ostream.', 'That is for output.'], ['cin.', 'cin is an object, not a class.']])] }),
    sec('fmt', '7.2', 'Formatting and file I/O', { eyebrow: 'Manipulators',
      body: `<p>Manipulators format output: <code>setw(6)</code> width, <code>setprecision(2)</code> with <code>fixed</code>, <code>endl</code> newline-and-flush. Files: <code>ofstream f("a.txt"); f &lt;&lt; 42;</code> — the destructor closes it (RAII). Check <code>if (!f)</code> after opening.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a = 12, b = 7;
  cout << a << " + " << b << " = " << a + b << endl;
  return 0;
}`, 'Insertion operators chain left to right.', { output: '12 + 7 = 19' })],
      qs: [q('chain', 'Why can <code>cout &lt;&lt; a &lt;&lt; b</code> chain?', ['Each << returns the stream.', 'So the next << has a stream on its left.'], [['Because cout is global.', 'Not the reason.'], ['<< is special syntax.', 'It is an ordinary overloaded operator.']])] }),
    sec('tmpl', '8.1', 'Function templates', { eyebrow: 'Generic code',
      body: `<p><code>template &lt;typename T&gt; T maxOf(T a, T b) { return a &gt; b ? a : b; }</code> is a recipe; when you call <code>maxOf(3, 9)</code> the compiler <b>instantiates</b> a version with T = int, and <code>maxOf(2.5, 1.5)</code> another with T = double. One source, many type-specific functions, all checked at compile time with no run-time cost. The type must support the operations used (here <code>&gt;</code>).</p>`,
      figs: [dia(`mode: sequence
[Your code] as c
[Compiler] as k
[maxOf<int>] as i
[maxOf<double>] as d
c -> k : maxOf(3, 9)
k -> i : instantiate T = int
c -> k : maxOf(2.5, 1.5)
k -> d : instantiate T = double
@0 c -> k : maxOf(3, 9)
@1 k -> i : instantiate T = int
@2 c -> k : maxOf(2.5, 1.5)
@3 k -> d : instantiate T = double`, 'The template is only a recipe until used.', { caption: 'instantiation' })],
      qs: [q('ti', 'A template function is generated…', ['At compile time, once per type used.', 'Each instantiation is ordinary code.'], [['At run time per call.', 'No.'], ['Once, for all types.', 'Each type gets its own.']])] }),
    sec('ctmpl', '8.2', 'Class templates and the STL', { eyebrow: 'Containers',
      body: `<p><code>template &lt;class T&gt; class Stack { T data[100]; int top; … };</code> gives <code>Stack&lt;int&gt;</code>, <code>Stack&lt;string&gt;</code>. The Standard Template Library supplies containers (<code>vector</code>, <code>list</code>, <code>map</code>, <code>set</code>), iterators and algorithms (<code>sort</code>, <code>find</code>) all built from templates.</p>`,
      worked: [step('vector<int> v = {5, 2, 9}; sort(v.begin(), v.end());', '', { toc: 'Sort' }), step('Result order.', '2,\\ 5,\\ 9', { hero: true, toc: 'Sorted' })],
      qs: [q('stl', 'The STL is built mainly from…', ['Templates.', 'Generic containers and algorithms.'], [['Macros.', 'Not primarily.'], ['Virtual functions.', 'Mostly not.']])],
      probs: [pr('p-vec', '<p>Which container gives O(1) access by index: vector or list?</p>', '<b>vector</b> (contiguous memory); a list needs O(n) traversal.')] }),
    sec('exc', '9.1', 'Exceptions: throw, try, catch', { eyebrow: 'Errors that unwind',
      body: `<p>When a function cannot continue, it <code>throw</code>s an object. The runtime unwinds the call stack, destroying locals on the way, until it finds a matching <code>catch</code>. If none is found the program terminates. <code>try { risky(); } catch (const runtime_error&amp; e) { … }</code>. Use exceptions for exceptional conditions, not ordinary control flow.</p>`,
      figs: [dia(`mode: sequence
[main try] as m
[f()] as f
[g()] as g
m -> f : call f
f -> g : call g
g -> g : throw runtime_error
g -> f : unwind (locals destroyed)
f -> m : unwind
m -> m : catch handles error
@0 m -> f : call f
@1 f -> g : call g
@2 g -> g : throw runtime_error
@3 g -> f : unwind (locals destroyed)
@4 f -> m : unwind
@5 m -> m : catch handles error`, 'Control leaps straight to the handler; f and g never resume.', { caption: 'stack unwinding' })],
      qs: [q('unw', 'While an exception propagates, local objects are…', ['Destroyed (destructors run).', 'That is why RAII makes exceptions safe.'], [['Leaked.', 'Not if RAII is used.'], ['Copied.', 'No.']])] }),
    sec('safe', '9.2', 'Exception safety', { eyebrow: 'Writing code that survives errors',
      body: `<p>Acquire resources in objects whose destructors release them (RAII, smart pointers) and exceptions cannot leak. Catch by <code>const&amp;</code>, order handlers from most specific to most general, <code>catch (...)</code> catches anything, and never throw from a destructor. Levels of guarantee: basic (no leak), strong (all-or-nothing), no-throw.</p>`,
      worked: [step('Order catch blocks: derived exception types before their base.', '', { toc: 'Rule' }), step('catch (const base&) first would swallow every derived type, hiding the specific handlers.', '', { hero: true, toc: 'Why' })],
      qs: [q('ord', 'Catch blocks should be ordered…', ['Most specific first.', 'Otherwise a base handler catches everything.'], [['Most general first.', 'Shadows the rest.'], ['Alphabetically.', 'No.']])] }),
  ],
})
