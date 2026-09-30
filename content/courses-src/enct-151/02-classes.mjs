import { lesson } from '../kit.mjs'
export default ({ dia, cpp, q, pr, step, sec, term }) => lesson({
  title: 'Classes, constructors and operator overloading',
  kicker: 'ENCT 151 · Object Oriented Programming · Chapters 3–4',
  subtitle: 'Put the data behind a wall and let the methods guard it.',
  sections: [
    sec('cls', '3.1', 'Defining a class', { eyebrow: 'Data + methods',
      body: `<p>Members are <code>private</code> by default in a <code>class</code> (public in a <code>struct</code>). Keep data private and offer public methods: the class can then enforce rules (balance never negative) that raw data cannot. Watch the guard in action — the negative deposit is ignored.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
class Account {
private:
  int balance;
public:
  Account(int b) { balance = b; }
  void deposit(int x) { if (x > 0) balance += x; }
  int get() { return balance; }
};
int main() {
  Account a(100);
  a.deposit(50);
  a.deposit(-20);
  cout << a.get() << endl;
  return 0;
}`, 'Encapsulation: the invalid deposit never changes the balance.', { output: '150' })],
      qs: [q('priv', 'Why keep data members private?', ['So the class controls every change and can protect its rules.', 'Invariants cannot be broken from outside.'], [['To save memory.', 'No effect.'], ['Because C++ requires it.', 'Only a convention.']])] }),
    sec('ctor', '3.2', 'Constructors and destructors', { eyebrow: 'Birth and death',
      body: `<p>A constructor has the class name, no return type, and runs when an object is created — use it (and the initialiser list) to put the object in a valid state. A destructor <code>~Name()</code> runs when it is destroyed: close files, free memory. A <b>copy constructor</b> builds a new object from an existing one; if the class owns a raw pointer, copy the pointed data (deep copy), not just the pointer.</p>`,
      figs: [dia(`mode: sequence
[main] as m
[Resource object] as r
m -> r : construct (acquire)
r -> r : use
m -> r : scope ends
r -> m : destructor runs (release)
@0 m -> r : construct (acquire)
@1 r -> r : use
@2 m -> r : scope ends
@3 r -> m : destructor runs (release)`, 'RAII: acquire in the constructor, release in the destructor.', { caption: 'object lifetime' })],
      qs: [q('dtor', 'A destructor is called…', ['When the object is destroyed (scope end or delete).', 'Automatically.'], [['Only by the programmer.', 'Automatic for locals.'], ['When the object is created.', 'That is the constructor.']])] }),
    sec('this', '3.3', 'this, static and const', { eyebrow: 'Finer points',
      body: `<p><code>this</code> is a pointer to the current object. A <code>static</code> member belongs to the class, shared by all objects (an instance counter). A <code>const</code> method promises not to change the object, so it can be called on const objects.</p>`,
      figs: [cpp(`#include <iostream>
using namespace std;
class P {
public:
  int x;
  P(int x) { this->x = x; }
  P* self() { return this; }
};
int main() {
  P p(4);
  cout << p.self()->x << endl;
  return 0;
}`, 'this->x is the member; plain x is the parameter.', { output: '4' })],
      qs: [q('st', 'A static data member is…', ['Shared by all objects of the class.', 'One copy in total.'], [['Copied per object.', 'That is an ordinary member.'], ['Constant.', 'Not implied.']])] }),
    sec('ovl', '4.1', 'Operator overloading', { eyebrow: 'Natural syntax for new types',
      body: `<p>C++ lets a class define what <code>+ - == &lt;&lt; []</code> mean for it: <code>Vec operator+(const Vec&amp; o) const</code> makes <code>a + b</code> work on vectors. Rules: you cannot invent new operators or change precedence; <code>:: . .* ?:</code> cannot be overloaded; keep the meaning intuitive. The expression <code>a + b</code> is just sugar for <code>a.operator+(b)</code>.</p>`,
      figs: [dia(`mode: sequence
[Code: c = a + b] as s
[a : Vec(1,2)] as a
[b : Vec(3,4)] as b
[c : Vec] as c
s -> a : a.operator+(b)
a -> b : read b.x, b.y
a -> c : construct Vec(4,6)
c --> s : returned
@0 s -> a : a.operator+(b)
@1 a -> b : read b.x, b.y
@2 a -> c : construct Vec(4,6)
@3 c -> s : returned`, 'The operator is an ordinary method call in disguise.', { caption: 'a + b' })],
      worked: [step('Vec(1,2) + Vec(3,4), component-wise.', '', { toc: 'Rule' }), step('Result.', '(1+3,\\ 2+4)=(4,6)', { hero: true, toc: 'Sum' })],
      qs: [q('ops', 'Which operator cannot be overloaded?', ['The scope operator ::', 'One of the few exceptions.'], [['+', 'Overloadable.'], ['==', 'Overloadable.']])],
      probs: [pr('p-vec', '<p>Complex(2,3) + Complex(1,−5) with operator+ adding parts. Result?</p>', '<b>(3, −2)</b>.')] }),
    sec('friend', '4.2', 'Friends and stream operators', { eyebrow: 'Outside but trusted',
      body: `<p>A <code>friend</code> function may touch private members. It is how <code>operator&lt;&lt;(ostream&amp;, const T&amp;)</code> is usually written — the left operand is the stream, not your class, so it cannot be a member. Return the stream to allow chaining: <code>cout &lt;&lt; a &lt;&lt; b</code>.</p>`,
      qs: [q('fr', 'Why is <code>operator&lt;&lt;</code> for printing usually a non-member?', ['The left operand is the ostream, not your class.', 'A member would need your object on the left.'], [['Members cannot be public.', 'They can.'], ['It is faster.', 'Not the reason.']])] }),
    sec('conv', '4.3', 'Conversions', { eyebrow: 'Between types',
      body: `<p>A one-argument constructor is an implicit conversion (mark it <code>explicit</code> to stop surprises). A conversion operator <code>operator double()</code> converts out. Use them sparingly: hidden conversions make code harder to read.</p>`,
      qs: [q('ex', 'The <code>explicit</code> keyword on a constructor…', ['Forbids implicit conversions through it.', 'Avoids accidental conversions.'], [['Makes it faster.', 'No.'], ['Makes it private.', 'No.']])] }),
  ],
})
