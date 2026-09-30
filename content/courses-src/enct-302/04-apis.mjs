import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'REST APIs and JSON',
  kicker: 'ENCT 302 · Web Application Programming · Chapter 4',
  subtitle: 'An API is a contract between programs: what to ask, in what shape, and what comes back.',
  sections: [
    sec('rest', '4.1', 'REST principles', { eyebrow: 'Resources and verbs',
      body: `<p>${term('REST')} models an API as <b>resources</b> with URLs (<code>/books</code>, <code>/books/7</code>) and uses HTTP methods as verbs: GET read, POST create, PUT replace, PATCH change, DELETE remove. Stateless requests; standard status codes (201 Created, 400 Bad Request, 401 Unauthorized, 404 Not Found). Nouns in URLs, not verbs: <code>DELETE /books/7</code>, not <code>/deleteBook</code>.</p>`,
      qs: [q('rs', 'Which is RESTful for deleting book 7?', ['DELETE /books/7.', 'Verb is the method; noun is the URL.'], [['GET /deleteBook?id=7.', 'Verb in the URL, unsafe GET.'], ['POST /books/remove.', 'Not resource-oriented.']])] }),
    sec('json', '4.2', 'JSON', { eyebrow: 'The data format',
      body: `<p>JSON is text for objects, arrays, strings, numbers, booleans and null: <code>{"id": 7, "title": "SICP", "tags": ["cs"]}</code>. <code>JSON.stringify</code> / <code>JSON.parse</code> convert. Keys are quoted with double quotes; no trailing commas, no comments.</p>`,
      qs: [q('js', 'Which is valid JSON?', ['{"a": 1}', 'Double-quoted key.'], [["{a: 1}", 'Unquoted key.'], ["{'a': 1}", 'Single quotes.']])] }),
    sec('crud', '4.3', 'A CRUD conversation', { eyebrow: 'Create, read, update, delete',
      body: `<p>Creating returns 201 and the new resource; reading returns 200; updating returns 200 or 204; deleting 204; a missing id 404.</p>`,
      figs: [dia(`mode: sequence
[Client] as c
[API] as a
[DB] as d
c -> a : POST /books {title}
a -> d : INSERT
d --> a : id 7
a --> c : 201 Created {id 7}
c -> a : GET /books/7
a --> c : 200 {id 7, title}
c -> a : DELETE /books/7
a --> c : 204 No Content
@0 c -> a : POST /books {title}
@1 a -> d : INSERT
@2 d -> a : id 7
@3 a -> c : 201 Created {id 7}
@4 c -> a : GET /books/7
@5 a -> c : 200 {id 7, title}
@6 c -> a : DELETE /books/7
@7 a -> c : 204 No Content`, 'The same URL changes meaning with the method.', { caption: 'CRUD over HTTP' })],
      qs: [q('c201', 'A successful POST that creates a resource returns…', ['201 Created.', 'With the new resource or its URL.'], [['404.', 'Not found.'], ['301.', 'Redirect.']])] }),
    sec('idem', '4.4', 'Idempotence and safety', { eyebrow: 'Retry rules',
      body: `<p>Safe methods (GET) change nothing. Idempotent methods (GET, PUT, DELETE) give the same final state if repeated; POST is not — retrying it may create two orders. Use an idempotency key for payments.</p>`,
      worked: [step('PUT /books/7 {title: "A"} sent twice.', '', { toc: 'Repeat' }), step('Final state is the same both times — it is idempotent.', '', { hero: true, toc: 'Result' })],
      qs: [q('idm', 'Retrying a timed-out POST /orders may…', ['Create a duplicate order.', 'POST is not idempotent.'], [['Never matter.', 'It can.'], ['Always be rejected.', 'Not by default.']])] }),
    sec('auth', '4.5', 'Authentication for APIs', { eyebrow: 'Who is calling?',
      body: `<p>Clients send a credential with each request: an API key, or a bearer token in <code>Authorization: Bearer …</code>. OAuth 2.0 lets a user grant an app limited access without sharing a password; JWTs are signed, self-describing tokens (header.payload.signature) the server can verify without a lookup.</p>`,
      figs: [dia(`mode: sequence
[App] as a
[User] as u
[Auth server] as s
[API] as p
a -> u : redirect to login
u -> s : log in and approve
s --> a : authorisation code
a -> s : code for token
s --> a : access token
a -> p : GET /me (Bearer token)
p --> a : user data
@0 a -> u : redirect to login
@1 u -> s : log in and approve
@2 s -> a : authorisation code
@3 a -> s : code for token
@4 s -> a : access token
@5 a -> p : GET /me (Bearer token)
@6 p -> a : user data`, 'The app never sees the password.', { caption: 'OAuth code flow' })],
      qs: [q('oa', 'OAuth’s main benefit is…', ['Granting limited access without sharing the password.', 'The user logs in only at the auth server.'], [['Faster databases.', 'Unrelated.'], ['No need for HTTPS.', 'HTTPS is mandatory.']])] }),
    sec('ver', '4.6', 'Good API design', { eyebrow: 'Habits',
      body: `<p>Version the API (<code>/v1/</code>); paginate lists (<code>?page=2&amp;limit=20</code>); return consistent error bodies; rate-limit; document with OpenAPI. Status 429 tells a client to slow down.</p>`,
      worked: [step('1,050 records, 20 per page.', '', { toc: 'Data' }), step('Pages = ⌈1050/20⌉.', '53', { hero: true, toc: 'Pages' })],
      qs: [q('pag', 'Why paginate a list endpoint?', ['Bound response size and latency.', 'Huge lists are slow.'], [['It hides errors.', 'No.'], ['JSON requires it.', 'No.']])],
      probs: [pr('p-pg', '<p>2,345 records at 50 per page. How many pages?</p>', '⌈2345/50⌉ = <b>47</b>.')] }),
  ],
})
