import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'JavaScript, the DOM and the event loop',
  kicker: 'ENCT 302 · Web Application Programming · Chapter 2',
  subtitle: 'JavaScript runs one thing at a time — yet handles clicks, timers and network replies. The event loop is the trick.',
  sections: [
    sec('lang', '2.1', 'The language in brief', { eyebrow: 'Basics',
      body: `<p>Variables: <code>let</code>, <code>const</code> (block-scoped; prefer const). Types: number, string, boolean, null, undefined, object, array, function. Functions are values: <code>const add = (a, b) =&gt; a + b</code>. Use <code>===</code>, not <code>==</code>, to avoid coercion surprises (<code>0 == '0'</code> is true).</p>`,
      qs: [q('eq', '0 === "0" is…', ['false.', 'Strict equality compares type too.'], [['true.', 'That is == behaviour.'], ['An error.', 'No error.']])] }),
    sec('dom', '2.2', 'The DOM and events', { eyebrow: 'Changing the page',
      body: `<p>The ${term('DOM')} is the page as a tree of objects. <code>document.querySelector('#btn')</code> finds a node; <code>el.textContent = …</code> changes it; <code>el.addEventListener('click', fn)</code> reacts. Events <b>bubble</b> up from the target to ancestors, so one listener on a list can handle all its items (event delegation).</p>`,
      qs: [q('bub', 'Event bubbling means an event…', ['Travels from the target up through its ancestors.', 'So parents can listen.'], [['Stays on the target.', 'No.'], ['Goes only to siblings.', 'No.']])] }),
    sec('loop', '2.3', 'The event loop', { eyebrow: 'One thread, many tasks',
      body: `<p>JavaScript has one call stack. Slow work (timers, network, I/O) is handed to the browser; when it finishes, a callback is queued. The ${term('event loop')} moves a queued callback onto the stack only when the stack is empty. <b>Microtasks</b> (promise callbacks) run before the next <b>macrotask</b> (timer, event).</p>`,
      figs: [dia(`mode: sequence
[Call stack] as s
[Web APIs] as w
[Task queue] as q
s -> w : setTimeout(cb, 0)
s -> s : run remaining code
w -> q : timer done, enqueue cb
q -> s : stack empty, push cb
s -> s : run cb
@0 s -> w : setTimeout(cb, 0)
@1 s -> s : run remaining code
@2 w -> q : timer done, enqueue cb
@3 q -> s : stack empty, push cb
@4 s -> s : run cb`, 'A 0 ms timer still waits for the stack to empty.', { caption: 'timer and event loop' })],
      qs: [q('to', '`setTimeout(f, 0); console.log("a")` prints…', ['“a” first, then f runs.', 'The callback waits until the stack is empty.'], [['f first.', 'It is queued, not immediate.'], ['Nothing.', 'Both run.']])] }),
    sec('async', '2.4', 'Promises and async/await', { eyebrow: 'Waiting without blocking',
      body: `<p>A <code>Promise</code> represents a future value: pending → fulfilled or rejected. <code>await</code> pauses an <code>async</code> function (not the thread) until the promise settles: <code>const res = await fetch(url); const data = await res.json();</code>. Handle failure with <code>try/catch</code>; run independent requests together with <code>Promise.all</code>.</p>`,
      worked: [step('Two independent requests take 300 ms and 200 ms.', '', { toc: 'Times' }), step('Sequential: 500 ms. With Promise.all: the max of the two.', '300\\ \\text{ms}', { hero: true, toc: 'Parallel' })],
      qs: [q('pall', 'Promise.all([a, b]) of 300 ms and 200 ms calls takes about…', ['300 ms.', 'They run concurrently; total is the slowest.'], [['500 ms.', 'That is sequential.'], ['200 ms.', 'Must wait for both.']])],
      probs: [pr('p-pa', '<p>Three independent fetches take 100, 250 and 150 ms. Time with Promise.all vs one after another?</p>', 'Parallel: <b>250 ms</b>; sequential: 500 ms.')] }),
    sec('fetch', '2.5', 'Fetch in action', { eyebrow: 'Talking to a server',
      body: `<p>A click handler calls <code>fetch('/api/items')</code>, awaits JSON and updates the DOM — no page reload. The browser’s same-origin policy blocks reading responses from other origins unless the server allows it via CORS headers.</p>`,
      figs: [dia(`mode: sequence
[User] as u
[Browser JS] as j
[Server] as s
u -> j : click Load
j -> s : fetch /api/items
s --> j : 200 JSON
j -> j : update DOM
j --> u : list appears
@0 u -> j : click Load
@1 j -> s : fetch /api/items
@2 s -> j : 200 JSON
@3 j -> j : update DOM
@4 j -> u : list appears`, 'The page never reloads.', { caption: 'AJAX update' })],
      qs: [q('cors', 'CORS is a rule enforced by…', ['The browser, based on server headers.', 'It protects users across origins.'], [['The DNS server.', 'No.'], ['The operating system.', 'No.']])] }),
    sec('spa', '2.6', 'Frameworks and state', { eyebrow: 'Structuring big UIs',
      body: `<p>Frameworks (React, Vue, Svelte) describe the UI as a function of <b>state</b>: change the state and the framework updates only the DOM parts that differ (virtual DOM or fine-grained reactivity). Keep state minimal, derive the rest, and lift shared state up to the nearest common parent.</p>`,
      qs: [q('st', 'In a component framework the UI is…', ['A function of the state.', 'Change state, UI follows.'], [['Edited by hand per click.', 'That is manual DOM work.'], ['Independent of state.', 'Then it could not change.']])] }),
  ],
})
