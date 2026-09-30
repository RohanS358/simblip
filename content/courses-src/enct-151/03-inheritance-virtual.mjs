import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Inheritance and polymorphism',
  kicker: 'ENCT 151 · Object Oriented Programming · Chapters 5–6',
  subtitle: 'Reuse a class, specialise it, and let one call do the right thing for every kind of object.',
  sections: [
    sec('inh', '5.1', 'Inheritance', { eyebrow: 'is-a',
      body: `<p><code>class Dog : public Animal</code> makes Dog a specialisation of Animal: it <b>inherits</b> Animal’s members and may add or replace some. Use it for “is-a” relationships (a Dog is an Animal); use <b>composition</b> (a member object) for “has-a” (a Car has an Engine). Public inheritance is the usual form; private members of the base stay inaccessible to the derived class, <code>protected</code> ones are visible.</p>`,
      figs: [dia(`direction: down
{Animal | name | speak()} as a
{Dog | breed | fetch()} as d
{Cat | indoor | purr()} as c
d -> a : is-a
c -> a : is-a`, 'Arrows point from the specialised class to the general one.', { caption: 'inheritance' })],
      qs: [q('isa', 'Which fits composition (has-a) rather than inheritance?', ['Car and Engine.', 'A car has an engine; it is not one.'], [['Dog and Animal.', 'That is is-a.'], ['Circle and Shape.', 'That is is-a.']])] }),
    sec('order', '5.2', 'Constructor and destructor order', { eyebrow: 'Base first',
      body: `<p>Creating a derived object runs the <b>base</b> constructor first, then the derived one; destruction is the reverse (derived destructor first, then base). The base part must exist before the derived part can rely on it.</p>`,
      figs: [dia(`mode: sequence
[main] as m
[Base] as b
[Derived] as d
m -> d : create Derived
d -> b : Base() runs first
b --> d : base part ready
d -> d : Derived() body
m -> d : object destroyed
d -> d : ~Derived() first
d -> b : ~Base() last
@0 m -> d : create Derived
@1 d -> b : Base() runs first
@2 b -> d : base part ready
@3 d -> d : Derived() body
@4 m -> d : object destroyed
@5 d -> d : ~Derived() first
@6 d -> b : ~Base() last`, 'Build from the foundation up, tear down in reverse.', { caption: 'construction order' })],
      qs: [q('ord', 'Destroying a Derived object calls destructors in the order…', ['Derived, then Base.', 'Reverse of construction.'], [['Base, then Derived.', 'That is construction order.'], ['Only Base.', 'Both run.']])] }),
    sec('over', '5.3', 'Overriding and hiding', { eyebrow: 'Specialising behaviour',
      body: `<p>A derived class can redefine a base method. Without <code>virtual</code> the version chosen depends on the <b>declared</b> (static) type of the pointer or reference; with <code>virtual</code> it depends on the <b>actual</b> object type. Multiple inheritance (several bases) is allowed but can cause the diamond problem; <code>virtual</code> base classes solve it.</p>`,
      qs: [q('hide', 'Without virtual, <code>Animal* p = new Dog(); p-&gt;speak();</code> calls…', ['Animal::speak (chosen by the pointer type).', 'Static binding.'], [['Dog::speak.', 'That needs virtual.'], ['Neither.', 'One is called.']])] }),
    sec('virt', '6.1', 'Virtual functions and dynamic dispatch', { eyebrow: 'Polymorphism',
      body: `<p>Declare the base method <code>virtual</code> and the call through a base pointer runs the override of the <i>actual</i> object. Internally each object with virtual functions carries a hidden pointer (vptr) to its class’s table (vtable) of function addresses; the call looks up the slot at run time.</p>`,
      figs: [dia(`mode: sequence
[Animal* p] as p
[vptr → Dog vtable] as v
[Dog::speak] as d
[Animal::speak] as a
p -> v : p->speak()
v -> d : look up slot 0
d --> p : "Woof"
@0 p -> v : p->speak()
@1 v -> d : look up slot 0
@2 d -> p : "Woof"`, 'The vtable sends the call to Dog::speak; Animal::speak is never used.', { caption: 'virtual dispatch' })],
      worked: [step('Three objects in an Animal* array: Dog, Cat, Cow, each overriding speak().', '', { toc: 'Setup' }), step('One loop calling p[i]->speak() produces three different outputs — no if/else on type.', '', { hero: true, toc: 'Payoff' })],
      qs: [q('vt', 'Dynamic dispatch chooses the function by…', ['The actual type of the object at run time.', 'Looked up through the vtable.'], [['The declared pointer type.', 'That is static binding.'], ['The return type.', 'Irrelevant.']])] }),
    sec('abs', '6.2', 'Abstract classes and virtual destructors', { eyebrow: 'Interfaces',
      body: `<p>A <b>pure virtual</b> function (<code>virtual double area() = 0;</code>) has no body and makes the class abstract — it cannot be instantiated and acts as an interface that derived classes must implement. Always give a polymorphic base a <b>virtual destructor</b>, or <code>delete</code> through a base pointer skips the derived destructor and leaks.</p>`,
      figs: [dia(`direction: down
{Shape (abstract) | | area() = 0 ; virtual ~Shape()} as s
{Circle | r | area()} as c
{Rect | w ; h | area()} as r
c -> s
r -> s`, 'Each concrete shape supplies its own area().', { caption: 'abstract Shape' })],
      worked: [step('Shapes: Circle r = 2 (π = 3.14), Rect 3 × 5.', '', { toc: 'Shapes' }), step('Areas via one loop over Shape*: 3.14·2² = 12.56 and 15; total 27.56.', '', { hero: true, toc: 'Total' })],
      qs: [q('pure', 'A class with a pure virtual function…', ['Cannot be instantiated.', 'It is abstract.'], [['Must be a struct.', 'No.'], ['Has no data.', 'Not required.']])],
      probs: [pr('p-vd', '<p>Why must the base class destructor be virtual when objects are deleted through base pointers?</p>', 'Otherwise only the base destructor runs, so the derived part is never cleaned up (leak/undefined behaviour).')] }),
    sec('rtti', '6.3', 'Late binding cost and design tips', { eyebrow: 'Practical advice',
      body: `<p>A virtual call costs one extra indirection and prevents inlining; it is negligible except in tight loops. Prefer small interfaces, favour composition over deep hierarchies, and mark overrides with <code>override</code> so the compiler catches signature mismatches.</p>`,
      qs: [q('ov', 'The <code>override</code> keyword helps by…', ['Making the compiler check you really override a virtual function.', 'Catches typos in the signature.'], [['Speeding up the call.', 'No.'], ['Hiding the base.', 'No.']])] }),
  ],
})
