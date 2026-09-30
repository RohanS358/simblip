import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'DNS, DHCP, HTTP, email and software-defined networking',
  kicker: 'ENCT 304 · Computer Networks · Chapters 6–7',
  subtitle: 'The protocols you actually see: what happens between typing a name and seeing a page, and how modern networks are managed.',
  sections: [
    sec('dhcp', '6.1', 'DHCP: getting an address', { eyebrow: 'Joining a network',
      body: `<p>A new host has no IP. ${term('DHCP')} lends one in four messages, known as DORA: Discover (broadcast), Offer, Request, Acknowledge. The lease also carries the subnet mask, default gateway and DNS server, and expires unless renewed.</p>`,
      figs: [dia(`mode: sequence
[New host] as h
[DHCP server] as d
h -> d : DISCOVER (broadcast)
d --> h : OFFER (192.168.1.50)
h -> d : REQUEST (I’ll take it)
d --> h : ACK (lease 8 h, gateway, DNS)`, 'Discover, Offer, Request, Acknowledge.', { caption: 'DORA' })],
      qs: [q('dora', 'Why is DISCOVER a broadcast?', ['The host has no address and does not know the server’s address.', 'Everyone on the link hears it; the server answers.'], [['For security.', 'Broadcast is not secure.'], ['To save bandwidth.', 'It uses more.']])] }),
    sec('dns', '6.2', 'DNS: names to addresses', { eyebrow: 'The phone book',
      body: `<p>${term('DNS')} is a distributed hierarchy: root servers know the top-level domains (.com, .np), TLD servers know the domains, and the domain’s authoritative server knows the host. Your machine asks a ${term('recursive resolver')}, which does the walking and caches the answer for its TTL.</p>`,
      figs: [dia(`mode: sequence
[Browser] as b
[Resolver] as r
[Root] as root
[.com server] as tld
[Authoritative] as a
b -> r : www.example.com?
r -> root : who knows .com?
root --> r : ask the .com server
r -> tld : who knows example.com?
tld --> r : ask ns.example.com
r -> a : www.example.com?
a --> r : 93.184.216.34
r --> b : 93.184.216.34`, 'A cold lookup walks the hierarchy; later ones hit the cache.', { caption: 'a recursive DNS lookup' })],
      worked: [step('A record has TTL 300 s. The resolver answered at t = 0.', '', { toc: 'Given' }), step('A query at t = 120 s is answered from the cache; one at t = 400 s triggers a new lookup.', '120<300,\\ 400>300', { hero: true, toc: 'Cache' })],
      qs: [q('cache', 'What does a DNS TTL control?', ['How long a cached answer may be reused.', 'After it expires the resolver must ask again.'], [['How many hops the query may take.', 'That is the IP TTL.'], ['The size of the reply.', 'No.']])] }),
    sec('http', '6.3', 'HTTP and the web', { eyebrow: 'Fetching a page',
      body: `<p>Typing a URL sets off a chain: DNS finds the IP, TCP connects (TLS for HTTPS), the browser sends <code>GET /page HTTP/1.1</code> and the server replies with a status line, headers and the body. Methods: GET (read), POST (send), PUT, DELETE. Status families: 2xx success, 3xx redirect, 4xx client error (404), 5xx server error (500). HTTP is stateless; cookies and tokens carry a session.</p>`,
      figs: [dia(`mode: sequence
[Browser] as b
[DNS] as d
[Web server] as s
b -> d : example.com?
d --> b : 93.184.216.34
b -> s : TCP handshake (+ TLS)
b -> s : GET /index.html
s --> b : 200 OK + HTML
b -> s : GET /style.css
s --> b : 200 OK + CSS`, 'The whole trip for one page.', { caption: 'a page load' })],
      qs: [q('stateless', 'HTTP is called stateless because…', ['Each request is independent: the server keeps no memory of earlier ones by itself.', 'Cookies or tokens are added to recognise a user.'], [['It cannot carry data.', 'It carries plenty.'], ['It never uses TCP.', 'HTTP/1.1 and 2 use TCP.']])] }),
    sec('mail', '6.4', 'Email: SMTP, POP3, IMAP', { eyebrow: 'Mail',
      body: `<p>${term('SMTP')} <em>pushes</em> mail from your client to your server and between servers. To <em>read</em> it, ${term('POP3')} downloads messages (usually deleting them from the server) while ${term('IMAP')} keeps them on the server and syncs folders across devices. Other services: FTP moves files; SNMP manages devices; VoIP carries voice over IP.</p>`,
      qs: [q('imap', 'Which protocol keeps mail on the server so several devices stay in sync?', ['IMAP.', 'POP3 typically downloads and removes.'], [['SMTP.', 'It sends mail.'], ['FTP.', 'It transfers files.']])] }),
    sec('sdn', '7.1', 'Software-defined networking', { eyebrow: 'Programmable networks',
      body: `<p>In a traditional router the control plane (route calculation) and data plane (forwarding) live together in each box. ${term('SDN')} separates them: a central ${term('controller')} computes behaviour and programs simple forwarding devices through an API (OpenFlow). Benefits: a global view, automation, rapid change. Related ideas: network virtualisation, content delivery networks (CDNs cache content near users), named-data and intent-based networking.</p>`,
      figs: [dia(`direction: right
group "Control plane" { app, ctl }
group "Data plane" { s1, s2 }
[Network applications] as app #blue
[SDN controller] as ctl #violet
[Switch 1] as s1 #mint
[Switch 2] as s2 #mint
app -> ctl : northbound API
ctl -> s1 : OpenFlow rules
ctl -> s2 : OpenFlow rules
@0 app -> ctl : policy
@1.2 ctl -> s1 : flow rule
@1.2 ctl -> s2 : flow rule
loop 4`, 'One brain, many simple forwarders.', { caption: 'the SDN architecture' })],
      qs: [q('sdn', 'What does SDN separate?', ['The control plane from the data plane.', 'Logic moves to a controller; devices only forward.'], [['TCP from UDP.', 'No.'], ['Hardware from software licensing only.', 'The idea is architectural.']])] }),
    sec('sec', '7.2', 'Network security in brief', { eyebrow: 'Protecting traffic',
      body: `<p>Goals: confidentiality, integrity, authentication, availability. Tools: TLS encrypts a connection; firewalls filter by address, port or application; VPNs tunnel private traffic over the Internet; intrusion detection watches for attacks. The next-generation areas (quantum networks, network virtualisation) build on the same layered ideas.</p>`,
      probs: [pr('p1', '<p>List the order of events when you open https://example.com for the first time.</p>', 'DHCP already gave your address; DNS resolves the name; TCP three-way handshake; TLS handshake agrees keys; HTTP GET; server responds 200 OK with the page; the browser fetches the page’s other resources.')],
      qs: [q('tls', 'What does TLS provide?', ['An encrypted, authenticated channel over TCP.', 'It protects against eavesdropping and tampering.'], [['Faster transfers.', 'It adds a little overhead.'], ['IP routing.', 'Not its role.']])] }),
  ],
})
