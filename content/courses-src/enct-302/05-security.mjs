import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'XSS, CSRF, injection and tokens',
  kicker: 'ENCT 302 · Web Application Programming · Chapter 5',
  subtitle: 'Every input is hostile until proven otherwise. See how the classic attacks work — and the one habit that stops each.',
  sections: [
    sec('mind', '5.1', 'The security mindset', { eyebrow: 'Principles',
      body: `<p>Never trust client input; give the least privilege; layer defences; fail closed. The ${term('OWASP Top 10')} lists the most common flaws (broken access control, injection, cryptographic failures, insecure design, …). HTTPS protects data in transit but does nothing about these bugs.</p>`,
      qs: [q('trust', 'Validation in the browser alone is…', ['Not enough: an attacker can skip the browser.', 'Always re-validate on the server.'], [['Sufficient.', 'Requests can be forged.'], ['Forbidden.', 'Useful for UX.']])] }),
    sec('sqli', '5.2', 'SQL injection', { eyebrow: 'Input becomes code',
      body: `<p>Pasting input into SQL: <code>"SELECT * FROM users WHERE name='" + n + "'"</code> with n = <code>' OR '1'='1</code> returns every user. Fix: <b>parameterised queries</b> (<code>WHERE name = ?</code>) so the input is always data, never code.</p>`,
      figs: [dia(`mode: sequence
[Attacker] as a
[App] as p
[Database] as d
a -> p : name = ' OR '1'='1
p -> d : SELECT * WHERE name='' OR '1'='1'
d --> p : all users
p --> a : everyone's data
@0 a -> p : name = ' OR '1'='1
@1 p -> d : SELECT * WHERE name='' OR '1'='1'
@2 d -> p : all users
@3 p -> a : everyone's data`, 'The quote in the input closes the string.', { caption: 'SQL injection' })],
      qs: [q('pq', 'The standard defence against SQL injection is…', ['Parameterised queries.', 'Input stays data.'], [['Longer passwords.', 'Unrelated.'], ['Hiding error messages only.', 'Not a fix.']])] }),
    sec('xss', '5.3', 'Cross-site scripting (XSS)', { eyebrow: 'Their script on your page',
      body: `<p>If a site echoes user text into a page unescaped, an attacker can make it include <code>&lt;script&gt;</code> that runs in victims’ browsers with the site’s privileges (stealing cookies, acting as them). Defences: <b>escape output</b> for its context, a Content-Security-Policy, <code>HttpOnly</code> cookies, and frameworks that escape by default.</p>`,
      figs: [dia(`mode: sequence
[Attacker] as a
[Site] as s
[Victim browser] as v
a -> s : post comment with script
s --> a : saved
v -> s : view page
s --> v : page containing the script
v -> a : script sends cookie
@0 a -> s : post comment with script
@1 s -> a : saved
@2 v -> s : view page
@3 s -> v : page containing the script
@4 v -> a : script sends cookie`, 'Stored XSS hits everyone who views the comment.', { caption: 'stored XSS' })],
      qs: [q('xssq', 'Displaying user text safely means…', ['Escaping it for HTML.', '< becomes &lt; so it cannot start a tag.'], [['Trusting it.', 'Attack path.'], ['Storing it longer.', 'Irrelevant.']])] }),
    sec('csrf', '5.4', 'Cross-site request forgery (CSRF)', { eyebrow: 'Their request, your cookie',
      body: `<p>While you are logged in to a bank, a malicious page makes your browser send <code>POST /transfer</code> — the browser attaches your cookie automatically. Defences: a secret <b>CSRF token</b> in forms, <code>SameSite</code> cookies, re-authenticating for sensitive actions.</p>`,
      figs: [dia(`mode: sequence
[Victim] as v
[Evil site] as e
[Bank] as b
v -> e : visit page
e --> v : hidden form auto-submits
v -> b : POST /transfer (cookie attached)
b --> v : done, money moved
@0 v -> e : visit page
@1 e -> v : hidden form auto-submits
@2 v -> b : POST /transfer (cookie attached)
@3 b -> v : done, money moved`, 'The bank cannot tell the request was not intended.', { caption: 'CSRF' })],
      qs: [q('cs', 'A CSRF token defends because…', ['The attacker’s page cannot read or guess it.', 'The server checks the token matches.'], [['It encrypts the cookie.', 'No.'], ['It hides the URL.', 'No.']])] }),
    sec('pw', '5.5', 'Passwords and tokens', { eyebrow: 'Storing credentials',
      body: `<p>Never store passwords in plain text: store a salted, slow hash (bcrypt, scrypt, Argon2). The salt is random per user, so identical passwords hash differently and rainbow tables fail; slowness limits guessing. Add rate limiting and multi-factor authentication. A password of length L over an alphabet of A symbols has A<sup>L</sup> possibilities.</p>`,
      worked: [step('Lowercase letters only (A = 26), length 8.', '26^8', { toc: 'Space' }), step('Number of passwords ≈ 2.1 × 10¹¹; with A = 94 printable symbols it is 94⁸ ≈ 6.1 × 10¹⁵, about 29 000× more.', '', { hero: true, toc: 'Compare' })],
      qs: [q('salt', 'A per-user salt prevents…', ['Precomputed (rainbow table) attacks and duplicate hashes.', 'Each hash is unique.'], [['Forgetting the password.', 'No.'], ['Network sniffing.', 'That is TLS.']])],
      probs: [pr('p-pw', '<p>How many 6-digit numeric PINs exist?</p>', '10⁶ = <b>1,000,000</b>.')] }),
    sec('hdr', '5.6', 'Security headers and a checklist', { eyebrow: 'Habits',
      body: `<ul><li>HTTPS everywhere with HSTS</li><li>Content-Security-Policy</li><li>Escape output, parameterise queries</li><li>Hash passwords with salt</li><li>CSRF tokens + SameSite cookies</li><li>Least privilege; update dependencies</li></ul>`,
      qs: [q('chk', 'Which measure reduces the damage of an XSS bug?', ['A strict Content-Security-Policy and HttpOnly cookies.', 'Limits what injected script can do.'], [['Longer URLs.', 'No.'], ['More images.', 'No.']])] }),
  ],
})
