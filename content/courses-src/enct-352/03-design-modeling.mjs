import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Architecture and UML models',
  kicker: 'ENCT 352 · Software Engineering · Chapters 4–5',
  subtitle: 'Draw the system before you build it: boxes for structure, sequences for behaviour.',
  sections: [
    sec('arch', '4.1', 'Architectural styles', { eyebrow: 'Shape of the whole',
      body: `<p>Architecture = the major components and how they communicate. Common styles: <b>layered</b> (UI → business → data), <b>client–server</b>, <b>MVC</b>, <b>pipe-and-filter</b>, <b>microservices</b>, <b>event-driven</b>. Each trades simplicity, scalability and independence.</p>`,
      figs: [dia(`direction: down
[Presentation layer] as u
[Business logic] as b
[Data access] as d
[|Database|] as db
u -> b : calls
b -> d : calls
d -> db : SQL
@0 u -> b
@1 b -> d
@2 d -> db
loop 2`, 'Each layer talks only to the one below.', { caption: 'layered architecture' })],
      qs: [q('lay', 'In a strict layered style the UI may call…', ['Only the layer directly beneath it.', 'Keeps layers independent.'], [['The database directly.', 'Skips the business rules.'], ['Any layer both ways.', 'Creates a tangle.']])] }),
    sec('mvc', '4.2', 'MVC request path', { eyebrow: 'Separating concerns',
      body: `<p>Model holds data and rules, View renders, Controller handles input and coordinates. Changing the UI does not touch the rules.</p>`,
      figs: [dia(`mode: sequence
[Browser] as b
[Controller] as c
[Model] as m
[View] as v
b -> c : GET /orders/7
c -> m : find(7)
m --> c : order
c -> v : render(order)
v --> b : HTML
@0 b -> c : GET /orders/7
@1 c -> m : find(7)
@2 m -> c : order
@3 c -> v : render(order)
@4 v -> b : HTML`, 'The controller never builds HTML itself.', { caption: 'MVC request' })],
      qs: [q('mvcq', 'Business rules belong in the…', ['Model.', 'Views should only display.'], [['View.', 'Presentation only.'], ['Browser.', 'Not trusted.']])] }),
    sec('uc', '5.1', 'Use case diagrams', { eyebrow: 'Who does what',
      body: `<p>Actors (people or systems) sit outside a system boundary; ovals are use cases; lines show participation; <i>include</i> (mandatory sub-behaviour) and <i>extend</i> (optional) relate use cases.</p>`,
      figs: [dia(`direction: right
[Customer] as c
(Place order) as po
(Pay) as pay
[Admin] as a
(Manage stock) as ms
c -> po
po -> pay : includes
a -> ms`, 'Placing an order always includes paying.', { caption: 'use cases' })],
      qs: [q('inc', '“Place order” always needs “Pay”. Relationship?', ['Include.', 'Mandatory reuse.'], [['Extend.', 'That is optional.'], ['Inheritance between actors.', 'Different relation.']])] }),
    sec('class', '5.2', 'Class diagrams', { eyebrow: 'Static structure',
      body: `<p>Boxes with name, attributes, operations; lines show association (with multiplicity), aggregation/composition (whole–part), inheritance (is-a).</p>`,
      figs: [dia(`direction: down
{Customer | name ; email | placeOrder()} as c
{Order | date ; total | addItem()} as o
{Item | sku ; price} as i
c -> o : 1 places 0..*
o -> i : 1 contains 1..*`, 'Multiplicity reads “one customer, many orders”.', { caption: 'class diagram' })],
      qs: [q('mult', '“1 to 0..*” between Customer and Order means…', ['A customer may have zero or many orders; each order has one customer.', 'Read each end separately.'], [['Every customer has exactly one order.', 'That is 1..1.'], ['Orders own customers.', 'Reversed.']])] }),
    sec('seq', '5.3', 'Sequence diagrams', { eyebrow: 'Behaviour over time',
      body: `<p>Lifelines run downward; arrows are messages in order; dashed arrows are returns. They show one scenario of one use case.</p>`,
      figs: [dia(`mode: sequence
[Customer] as c
[Shop UI] as u
[Order service] as o
[Payment] as p
c -> u : checkout
u -> o : createOrder
o -> p : charge
p --> o : approved
o --> u : order id
u --> c : confirmation
@0 c -> u : checkout
@1 u -> o : createOrder
@2 o -> p : charge
@3 p -> o : approved
@4 o -> u : order id
@5 u -> c : confirmation`, 'Replay to watch control pass between objects.', { caption: 'checkout scenario' })],
      qs: [q('sq', 'A dashed arrow back in a sequence diagram is…', ['A return or reply.', 'Solid arrows are calls.'], [['A lost message.', 'Different notation.'], ['A deleted object.', 'That is an X on the lifeline.']])] }),
    sec('dfd', '5.4', 'Data flow and activity diagrams', { eyebrow: 'Flow of data and control',
      body: `<p>A DFD shows processes (circles), stores (open rectangles), external entities (squares) and data flows; it has <b>levels</b> — level 0 is the context diagram. An <b>activity diagram</b> shows the control flow of a process with decisions and parallel forks.</p>`,
      figs: [dia(`direction: right
[Student] as s
((1 Register)) as r
[|Student records|] as db
((2 Issue ID)) as i
s -> r : form
r -> db : record
db -> i : record
i -> s : ID card`, 'A level-1 DFD fragment.', { caption: 'DFD' })],
      worked: [step('A DFD process has 3 inputs and 1 output: it must change data, not just pass it on — otherwise it is not a process.', '', { hero: true, toc: 'Rule' })],
      qs: [q('dfdq', 'A data store in a DFD may connect directly to…', ['A process only.', 'Stores exchange data through processes.'], [['Another data store.', 'Not allowed.'], ['An external entity.', 'Must go through a process.']])] }),
  ],
})
