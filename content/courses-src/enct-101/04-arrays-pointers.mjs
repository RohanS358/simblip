import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Arrays, memory and pointers',
  kicker: 'ENCT 101 · Computer Programming · Chapter 6',
  subtitle: 'Memory is a long row of numbered boxes. An array is a run of them; a pointer is a box that holds a box’s number.',
  sections: [
    sec('arr', '6.1', 'Arrays', { eyebrow: 'Many values, one name',
      body: `<p><code>int a[5] = {10, 20, 30, 40, 50};</code> reserves 5 consecutive ints. Indexes run 0 to 4; <code>a[5]</code> is out of bounds and C does <b>not</b> check — it silently reads or corrupts neighbouring memory. Initialise, then process with a loop.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a[4] = {10, 20, 30, 40};
  int sum = 0;
  for (int i = 0; i < 4; i++) sum += a[i];
  cout << sum << endl;
  return 0;
}`, 'Watch i walk along the array.', { output: '100' })],
      qs: [q('idx', 'The last valid index of <code>int a[8]</code> is…', ['7.', 'Indexes start at 0.'], [['8.', 'Out of bounds.'], ['9.', 'Out of bounds.']])] }),
    sec('addr', '6.2', 'Addresses: memory picture', { eyebrow: 'Where things live',
      body: `<p>Each byte has an address. <code>&amp;x</code> is the address of x. An int array of 4 elements occupies 16 bytes; element i lives at base + 4·i. So the name <code>a</code> itself acts as the address of <code>a[0]</code>.</p>`,
      figs: [dia(`direction: right
[a[0]=10 @1000] as a
[a[1]=20 @1004] as b
[a[2]=30 @1008] as c
[a[3]=40 @1012] as d
a -> b
b -> c
c -> d`, 'Four-byte ints sit 4 addresses apart.', { caption: 'array in memory' })],
      worked: [step('Base address 1000, 4-byte ints. Address of a[3]:', '', { toc: 'Formula' }), step('base + 3 × 4.', '1000+12=1012', { hero: true, toc: 'Address' })],
      qs: [q('ad', 'Base 2000, int = 4 bytes. Address of a[5] is…', ['2020.', '2000 + 5·4.'], [['2005.', 'Forgot the element size.'], ['2024.', 'That is a[6].']])],
      probs: [pr('p-ad', '<p>A <code>double</code> array (8 bytes each) starts at 5000. Address of element 6?</p>', '5000 + 6·8 = <b>5048</b>.')] }),
    sec('ptr', '6.3', 'Pointers', { eyebrow: 'A variable that holds an address',
      body: `<p><code>int *p = &amp;x;</code> — p stores x’s address; <code>*p</code> (dereference) means “the thing p points to”. <code>*p = 9</code> changes x. A pointer must be initialised before use; a NULL pointer points nowhere. Pointer arithmetic scales by the element size: <code>p + 1</code> moves to the next int.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int a[4] = {10, 20, 30, 40};
  int *p = a;
  p = p + 2;
  cout << *p << " " << a[1] << " " << *(a + 3) << endl;
  return 0;
}`, 'p + 2 lands on the third element.', { output: '30 20 40' })],
      qs: [q('dr', 'After <code>int x = 4; int *p = &amp;x; *p = 7;</code> x is…', ['7.', 'Writing through the pointer changes x.'], [['4.', 'Unchanged only if p were a copy.'], ['The address of x.', 'That is p.']])] }),
    sec('byref', '6.4', 'Pointers and function arguments', { eyebrow: 'Why they matter',
      body: `<p>C passes arguments <b>by value</b> — a function gets copies. To let a function change the caller’s variable, pass its address: <code>swap(&amp;x, &amp;y)</code> with <code>void swap(int *a, int *b)</code>. Arrays are passed as the address of their first element, so a function can modify them.</p>`,
      figs: [dia(`mode: sequence
[main: x=1, y=2] as m
[swap(int *a, int *b)] as s
m -> s : pass &x, &y
s -> s : t = *a; *a = *b; *b = t
s -> m : return
m -> m : x=2, y=1
@0 m -> s : pass &x, &y
@1 s -> s : t = *a; *a = *b; *b = t
@2 s -> m : return
@3 m -> m : x=2, y=1`, 'swap works on the caller’s variables through their addresses.', { caption: 'swap by pointer' })],
      qs: [q('sw', 'Why can\'t <code>void swap(int a, int b)</code> swap the caller’s variables?', ['It receives copies.', 'C is pass-by-value.'], [['It is too short.', 'Length is irrelevant.'], ['It needs a return.', 'Returning one value would not swap both.']])] }),
    sec('str', '6.5', 'Strings', { eyebrow: 'Arrays of char',
      body: `<p>A C string is a char array ending with the null character <code>'\\0'</code>: "hi" occupies 3 bytes (h, i, \\0). <code>strlen</code> counts up to, not including, the null. Forgetting room for the terminator is a classic overflow.</p>`,
      worked: [step('How many bytes does char s[] = "hello"; take?', '', { toc: 'Count' }), step('5 letters + 1 null.', '6', { hero: true, toc: 'Size' })],
      qs: [q('nul', 'The string “code” needs an array of at least…', ['5 chars.', 'Four letters plus the null.'], [['4 chars.', 'No room for \\0.'], ['3 chars.', 'Too small.']])] }),
    sec('dyn', '6.6', 'Dynamic memory', { eyebrow: 'Memory on demand',
      body: `<p><code>malloc(n)</code> asks the heap for n bytes and returns a pointer; <code>free(p)</code> gives it back. Forgetting to free leaks memory; using memory after freeing (dangling pointer) or freeing twice is undefined. Pair every malloc with one free.</p>`,
      qs: [q('leak', 'A memory leak happens when you…', ['Allocate memory and never free it.', 'The heap slowly fills.'], [['Free twice.', 'That is a double free.'], ['Use a local variable.', 'Locals are automatic.']])] }),
  ],
})
