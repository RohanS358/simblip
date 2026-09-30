import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Servers, routing and MVC',
  kicker: 'ENCT 302 · Web Application Programming · Chapter 3',
  subtitle: 'What happens on the other side of the request: routing, business logic, the database and the response.',
  sections: [
    sec('req', '3.1', 'Request → response', { eyebrow: 'The server’s job',
      body: `<p>A server listens on a port, parses the request, routes it to a handler, does the work (read/write a database, call services), and builds a response. A minimal Node handler: <code>app.get('/hello', (req, res) =&gt; res.send('hi'))</code>.</p>`,
      qs: [q('rt', 'Routing maps…', ['A method and path to a handler.', 'GET /users → list users.'], [['An IP to a name.', 'That is DNS.'], ['CSS to HTML.', 'No.']])] }),
    sec('mid', '3.2', 'Middleware', { eyebrow: 'A chain of steps',
      body: `<p>Middleware are functions that see every request in order: logging, parsing JSON, authentication, then the route handler; each may respond or call <code>next()</code>. Order matters: authentication must run before the handler it protects.</p>`,
      figs: [dia(`mode: sequence
[Client] as c
[Logger] as l
[Auth] as a
[Handler] as h
c -> l : request
l -> a : next()
a -> h : next() if token ok
h --> c : response
@0 c -> l : request
@1 l -> a : next()
@2 a -> h : next() if token ok
@3 h -> c : response`, 'Auth sits before the handler; a bad token would stop here.', { caption: 'middleware chain' })],
      qs: [q('mw', 'Where must an authentication middleware sit?', ['Before the protected route handler.', 'Otherwise the handler runs unchecked.'], [['After the handler.', 'Too late.'], ['Only in the browser.', 'Client checks can be bypassed.']])] }),
    sec('mvc', '3.3', 'MVC', { eyebrow: 'Separating concerns',
      body: `<p>Model: data and business rules; View: templates that render HTML; Controller: maps requests to model calls and picks a view. The router hands a request to the controller, which asks the model, then renders a view.</p>`,
      figs: [dia(`mode: sequence
[Router] as r
[Controller] as c
[Model] as m
[Database] as d
[View] as v
r -> c : GET /products/5
c -> m : find(5)
m -> d : SELECT ...
d --> m : row
m --> c : product
c -> v : render(product)
v --> r : HTML
@0 r -> c : GET /products/5
@1 c -> m : find(5)
@2 m -> d : SELECT ...
@3 d -> m : row
@4 m -> c : product
@5 c -> v : render(product)
@6 v -> r : HTML`, 'Each layer has one job.', { caption: 'MVC with a database' })],
      qs: [q('ctl', 'The controller should NOT…', ['Contain SQL and HTML building.', 'That blurs model and view.'], [['Pick the view.', 'That is its job.'], ['Call the model.', 'That is its job.']])] }),
    sec('db', '3.4', 'Databases from code', { eyebrow: 'Persistence',
      body: `<p>Use parameterised queries — never build SQL by pasting user input. An ORM maps tables to classes. Cache hot reads (Redis) and index the columns you filter by.</p>`,
      worked: [step('A product lookup takes 20 ms from the database, 1 ms from cache. 90 % of reads hit the cache.', '', { toc: 'Hit rate' }), step('Average = 0.9·1 + 0.1·20.', '2.9\\ \\text{ms}', { hero: true, toc: 'Mean' })],
      qs: [q('cache', 'A cache hit rate of 90 % makes average read time…', ['Close to the cache time.', 'Weighted average.'], [['Equal to the database time.', 'Ignores the hits.'], ['Zero.', 'Cache is not free.']])],
      probs: [pr('p-ch', '<p>Cache 2 ms, DB 40 ms, hit rate 75 %. Average time?</p>', '0.75·2 + 0.25·40 = <b>11.5 ms</b>.')] }),
    sec('sess', '3.5', 'State: cookies and sessions', { eyebrow: 'Remembering users',
      body: `<p>HTTP is stateless, so after login the server issues a session id in a <b>cookie</b>; the browser sends it with every request and the server looks up the session. Cookies should be <code>HttpOnly</code> (not readable by JS), <code>Secure</code> (HTTPS only) and <code>SameSite</code>.</p>`,
      figs: [dia(`mode: sequence
[Browser] as b
[Server] as s
[Session store] as t
b -> s : POST /login
s -> t : create session
t --> s : id=abc123
s --> b : Set-Cookie sid=abc123
b -> s : GET /profile (Cookie sid)
s -> t : lookup abc123
t --> s : user 42
s --> b : profile page
@0 b -> s : POST /login
@1 s -> t : create session
@2 t -> s : id=abc123
@3 s -> b : Set-Cookie sid=abc123
@4 b -> s : GET /profile (Cookie sid)
@5 s -> t : lookup abc123
@6 t -> s : user 42
@7 s -> b : profile page`, 'The cookie is the only thing the browser remembers.', { caption: 'session login' })],
      qs: [q('ho', 'The HttpOnly cookie flag stops…', ['JavaScript reading the cookie.', 'Limits theft by XSS.'], [['Sending the cookie.', 'It is still sent.'], ['HTTPS.', 'That is Secure.']])] }),
    sec('scale', '3.6', 'Scaling a server', { eyebrow: 'More users',
      body: `<p>Add servers behind a <b>load balancer</b>; keep servers stateless (sessions in a shared store) so any can answer. Put static files on a CDN. If one server handles 200 requests/s, how many for 1500 req/s with 25 % headroom?</p>`,
      worked: [step('Needed capacity = 1500 × 1.25.', '1875', { toc: 'Capacity' }), step('Servers = 1875/200, rounded up.', '\\lceil 9.4\\rceil=10', { hero: true, toc: 'Count' })],
      qs: [q('lb', 'A load balancer…', ['Spreads requests across servers.', 'Also detects failed ones.'], [['Encrypts the database.', 'Not its job.'], ['Stores sessions.', 'That is a session store.']])] }),
  ],
})
