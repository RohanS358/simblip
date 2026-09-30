import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'How the web works',
  kicker: 'ENCT 302 · Web Application Programming · Chapter 1',
  subtitle: 'Type a URL, press Enter — and a dozen systems cooperate in under a second. Follow one request all the way.',
  sections: [
    sec('url', '1.1', 'URLs and clients/servers', { eyebrow: 'The vocabulary',
      body: `<p>The web is a client–server system: a <b>browser</b> (client) requests resources from a <b>web server</b>. A ${term('URL')} such as <code>https://example.com:443/docs?page=2#top</code> has scheme (protocol), host, port, path, query string and fragment. The fragment never leaves the browser.</p>`,
      qs: [q('frag', 'In https://a.com/x?y=1#z, the part “z” is…', ['A fragment used only by the browser.', 'It is not sent to the server.'], [['The query string.', 'That is y=1.'], ['The host.', 'The host is a.com.']])] }),
    sec('dns', '1.2', 'DNS: names to addresses', { eyebrow: 'Finding the server',
      body: `<p>Computers route by IP address, so the browser first asks DNS to resolve the host name. The answer is cached at several levels (browser, OS, resolver) for its TTL, so repeat visits skip the lookup.</p>`,
      figs: [dia(`mode: sequence
[Browser] as b
[Resolver] as r
[Root / TLD / authoritative] as a
b -> r : example.com ?
r -> a : ask authoritative
a --> r : 93.184.216.34
r --> b : 93.184.216.34
@0 b -> r : example.com ?
@1 r -> a : ask authoritative
@2 a -> r : 93.184.216.34
@3 r -> b : 93.184.216.34`, 'The resolver does the legwork and caches the answer.', { caption: 'DNS lookup' })],
      qs: [q('ttl', 'DNS TTL controls…', ['How long an answer may be cached.', 'Time to live.'], [['The page load time.', 'Unrelated.'], ['The number of servers.', 'Unrelated.']])] }),
    sec('http', '1.3', 'HTTP request and response', { eyebrow: 'The conversation',
      body: `<p>HTTP is a text protocol: the client sends a <b>request</b> (method, path, headers, optional body); the server answers with a <b>response</b> (status code, headers, body). Methods: GET (read), POST (create), PUT/PATCH (update), DELETE. Status families: 2xx success, 3xx redirect, 4xx client error, 5xx server error. HTTP is ${term('stateless')}: each request stands alone; cookies and tokens carry identity.</p>`,
      figs: [dia(`mode: sequence
[Browser] as b
[DNS] as d
[Server] as s
b -> d : resolve example.com
d --> b : IP address
b -> s : TCP + TLS handshake
s --> b : secure channel
b -> s : GET /index.html
s --> b : 200 OK + HTML
b -> s : GET /style.css
s --> b : 200 OK + CSS
@0 b -> d : resolve example.com
@1 d -> b : IP address
@2 b -> s : TCP + TLS handshake
@3 s -> b : secure channel
@4 b -> s : GET /index.html
@5 s -> b : 200 OK + HTML
@6 b -> s : GET /style.css
@7 s -> b : 200 OK + CSS`, 'One page view is many round trips.', { caption: 'loading a page' })],
      qs: [q('stat', 'Status 404 means…', ['The resource was not found (client error).', '4xx = client side.'], [['The server crashed.', 'That is 5xx.'], ['Redirect.', 'That is 3xx.']])] }),
    sec('latency', '1.4', 'Why latency matters', { eyebrow: 'Numbers',
      body: `<p>Each round trip costs the network RTT. A page needing DNS (1 RTT), TCP (1), TLS (1–2), then the request (1) needs about 4–5 RTTs before the first byte. HTTP/2 multiplexes requests on one connection; HTTP/3 uses QUIC to cut handshakes.</p>`,
      worked: [step('RTT = 50 ms. Steps: DNS, TCP, TLS, request = 4 round trips.', '', { toc: 'RTTs' }), step('Time to first byte ≥ 4 × 50 ms.', '200\\ \\text{ms}', { hero: true, toc: 'TTFB' })],
      qs: [q('rtt', 'The best way to cut page-load time on a high-RTT link is…', ['Fewer round trips (cache, reuse connections, bundle).', 'Latency multiplies with trips.'], [['A bigger monitor.', 'Irrelevant.'], ['More CSS.', 'Adds requests.']])],
      probs: [pr('p-rtt', '<p>RTT is 80 ms. A fresh page needs DNS, TCP, TLS (2 RTT) and the GET. Minimum time to first byte?</p>', '5 round trips × 80 = <b>400 ms</b>.')] }),
    sec('html', '1.5', 'HTML, CSS and JavaScript', { eyebrow: 'The three layers',
      body: `<p><b>HTML</b> is structure (headings, links, forms); <b>CSS</b> is presentation (layout, colour); <b>JavaScript</b> is behaviour. The browser parses HTML into the DOM tree, CSS into a style tree, combines them to lay out and paint. Keep the three separate so each can change alone.</p>`,
      qs: [q('lay', 'Which layer changes a button’s colour?', ['CSS.', 'Presentation.'], [['HTML.', 'Structure.'], ['DNS.', 'Network naming.']])] }),
    sec('static', '1.6', 'Static, dynamic and SPA', { eyebrow: 'Kinds of sites',
      body: `<p><b>Static</b> sites serve the same files to all; <b>dynamic</b> sites build pages per request on the server; <b>single-page apps (SPAs)</b> load one page and update it with JavaScript, fetching JSON. SPAs feel fast after first load but cost a heavy first load and need care for SEO.</p>`,
      qs: [q('spa', 'A SPA typically fetches…', ['JSON data, then updates the page in the browser.', 'It avoids full page reloads.'], [['A full HTML page for every click.', 'That is a multi-page app.'], ['Nothing.', 'It needs data.']])] }),
  ],
})
