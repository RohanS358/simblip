import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Objects, classes and the C++ basics',
  kicker: 'ENCT 151 · Object Oriented Programming · Chapters 1–2',
  subtitle: 'Model the problem as things that have data and can do things, then let those things talk to each other.',
  sections: [
    sec('idea', '1.1', 'Objects and classes', { eyebrow: 'The core idea',
      body: `<p>An ${term('object')} bundles <b>state</b> (data members) with <b>behaviour</b> (member functions). A ${term('class')} is the blueprint; objects are instances made from it. Programs run by objects sending each other messages (calling methods).</p>`,
      figs: [dia(`direction: right
{Account | balance : int | deposit(x) ; withdraw(x) ; get()} as a
{a1 : Account | balance = 150} as o1
{a2 : Account | balance = 40} as o2
a -> o1 : instance
a -> o2 : instance`, 'One class, many independent objects.', { caption: 'class and instances' })],
      qs: [q('obj', 'The relationship between a class and an object is like…', ['Blueprint and house.', 'One blueprint, many houses.'], [['House and blueprint.', 'Reversed.'], ['Two identical houses.', 'Not a blueprint relation.']])] }),
    sec('pillars', '1.2', 'The four pillars', { eyebrow: 'What OOP gives you',
      body: `<table><thead><tr><th>Pillar</th><th>Meaning</th></tr></thead><tbody><tr><td>Encapsulation</td><td>hide data; expose a small interface</td></tr><tr><td>Abstraction</td><td>show what, hide how</td></tr><tr><td>Inheritance</td><td>a new class reuses and extends another</td></tr><tr><td>Polymorphism</td><td>one call, different behaviour by object type</td></tr></tbody></table>`,
      qs: [q('pill', 'Making a data member private is an example of…', ['Encapsulation.', 'Access only through the public interface.'], [['Polymorphism.', 'That is about dispatch.'], ['Inheritance.', 'That is reuse.']])] }),
    sec('refs', '2.1', 'References and pass-by-reference', { eyebrow: 'An alias',
      body: `<p>A reference is another name for an existing variable: <code>int &amp;r = x;</code>. As a parameter it lets a function modify the caller’s variable without pointer syntax, and avoids copying large objects (use <code>const T&amp;</code> to forbid changes).</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
void inc(int &x) { x++; }
int main() {
  int n = 5;
  inc(n);
  inc(n);
  cout << n << endl;
  return 0;
}`, 'inc changes the caller’s n.', { output: '7' })],
      qs: [q('ref', 'Passing by reference differs from by value because…', ['The function works on the original variable.', 'No copy is made.'], [['It is slower.', 'Usually faster.'], ['It needs pointers.', 'No pointer syntax.']])] }),
    sec('ovl', '2.2', 'Overloading and default arguments', { eyebrow: 'Same name, different parameters',
      body: `<p>Functions with the same name but different parameter lists are <b>overloads</b>; the compiler picks by the argument types and count. Return type alone cannot distinguish them. Default arguments (<code>int add(int a, int b = 10)</code>) let a caller omit trailing arguments. (The DSA Lab’s interpreter is a teaching subset and does not resolve overloads or defaults faithfully, so these are explained here rather than run.)</p>`,
      figs: [dia(`mode: sequence
[Caller] as c
[Compiler] as k
[area(int s)] as a
[area(int w, int h)] as b
c -> k : area(4)
k -> a : one int argument
c -> k : area(3, 5)
k -> b : two int arguments
@0 c -> k : area(4)
@1 k -> a : one int argument
@2 c -> k : area(3, 5)
@3 k -> b : two int arguments`, 'Resolved at compile time from the argument list.', { caption: 'overload resolution' })],
      qs: [q('ov', 'Can two functions differ only by return type?', ['No.', 'The compiler cannot choose from the call alone.'], [['Yes, always.', 'Ambiguous.'], ['Only for void.', 'No such rule.']])] }),
    sec('mem', '2.3', 'Dynamic memory: new and delete', { eyebrow: 'Heap objects',
      body: `<p><code>new</code> creates an object on the heap and returns its address; <code>delete</code> destroys it. Pair them: every <code>new</code> needs one <code>delete</code> (<code>new[]</code> with <code>delete[]</code>) or memory leaks. Prefer smart pointers (<code>unique_ptr</code>) in modern C++.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int *p = new int(7);
  *p = *p + 3;
  cout << *p << endl;
  delete p;
  return 0;
}`, 'Heap cell created, changed, released.', { output: '10' })],
      worked: [step('new int[100] allocates 100 ints of 4 bytes.', '', { toc: 'Size' }), step('Bytes requested.', '100\\times4=400', { hero: true, toc: 'Bytes' })],
      qs: [q('del', 'Memory allocated with <code>new int[5]</code> is released by…', ['delete[] p;', 'Array form pairs with array form.'], [['delete p;', 'Undefined for arrays.'], ['free(p);', 'Mixes allocators.']])],
      probs: [pr('p-new', '<p>How many bytes does <code>new double[25]</code> request (8-byte doubles)?</p>', '25 × 8 = <b>200 bytes</b>.')] }),
    sec('cppc', '2.4', 'C++ over C', { eyebrow: 'What changed',
      body: `<p>C++ adds classes, references, overloading, templates, exceptions, the STL containers (<code>vector</code>, <code>map</code>, <code>string</code>), and stream I/O (<code>cin</code>, <code>cout</code>). Namespaces (<code>std::</code>) prevent name clashes.</p>`,
      qs: [q('ns', 'Namespaces exist to…', ['Avoid name collisions.', 'Two libraries can both define “sort”.'], [['Speed up code.', 'No.'], ['Hide data.', 'That is private.']])] }),
  ],
})
