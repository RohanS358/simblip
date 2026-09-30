import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Layers, encapsulation and devices',
  kicker: 'ENCT 304 · Computer Networks · Chapter 1',
  subtitle: 'A network is a stack of small promises: each layer uses the one below and offers a simpler service to the one above.',
  sections: [
    sec('why', '1.1', 'Why layers', { eyebrow: 'The idea',
      body: `<p>Sending a web page across the world involves electrical signals, error checking, finding a route, making delivery reliable and speaking HTTP. Nobody builds that as one program. A ${term('layered architecture')} splits the job: each layer talks to the <em>same layer</em> on the other machine through a ${term('protocol')}, and uses only the service of the layer beneath it. Layers can be replaced independently — Wi-Fi for Ethernet — without touching the layers above.</p><p>The ${term('OSI')} model has seven layers (physical, data link, network, transport, session, presentation, application); the ${term('TCP/IP')} model that the Internet actually uses has four: link, internet, transport, application.</p>`,
      figs: [dia(`direction: right
group "OSI" { o7, o6, o5, o4, o3, o2, o1 }
[7 Application] as o7 #blue
[6 Presentation] as o6 #blue
[5 Session] as o5 #blue
[4 Transport] as o4 #mint
[3 Network] as o3 #amber
[2 Data link] as o2 #violet
[1 Physical] as o1 #rose
o7 -> o6
o6 -> o5
o5 -> o4
o4 -> o3
o3 -> o2
o2 -> o1`, 'TCP/IP folds layers 5–7 into “application” and 1–2 into “link”.', { caption: 'the OSI stack' })],
      qs: [q('layer', 'Which layer is responsible for end-to-end delivery between processes?', ['Transport.', 'IP moves packets between hosts; transport (TCP/UDP) connects a process on one host to a process on the other using port numbers.'], [['Network.', 'It addresses hosts and finds routes, not processes.'], ['Data link.', 'It handles one hop only.']])] }),
    sec('encap', '1.2', 'Encapsulation', { eyebrow: 'Wrapping',
      body: `<p>Going down the stack each layer adds its own header (the data link layer also a trailer) around what it was given. The application data becomes a TCP <em>segment</em>, then an IP <em>packet</em>, then an Ethernet <em>frame</em>, then bits. The receiver peels the headers off in reverse. Each header carries exactly what that layer needs: ports, IP addresses, MAC addresses.</p>`,
      figs: [dia(`direction: right
[Application data] as a #blue
[TCP header + data = segment] as t #mint
[IP header + segment = packet] as i #amber
[Frame header + packet + trailer = frame] as f #violet
(Bits on the wire) as w
a -> t : add ports
t -> i : add IP addresses
i -> f : add MAC addresses + CRC
f -> w
@0 a -> t : data
@1.2 t -> i : segment
@2.4 i -> f : packet
@3.6 f -> w : frame
loop 5`, 'Press Simulate to watch the headers accumulate.', { caption: 'encapsulation' })],
      worked: [step('A 1000-byte application message goes through TCP (20-byte header), IP (20) and Ethernet (14 + 4 trailer).', '', { toc: 'Given' }), step('Frame size = 1000 + 20 + 20 + 14 + 4.', '1058\\ \\text{bytes}', { hero: true, toc: 'On the wire' }), step('Overhead fraction.', '\\frac{58}{1058}\\approx 5.5\\%', { toc: 'Overhead' })],
      qs: [q('hdr', 'In which order are headers added as data travels down the stack?', ['Transport, then network, then data link.', 'Each layer wraps what it receives from above, so the lowest layer’s header ends up outermost.'], [['Data link first, then network.', 'That is the order they are removed at the receiver.'], ['All at once by the application.', 'Each layer adds its own.']])] }),
    sec('types', '1.3', 'Networks and topologies', { eyebrow: 'Shapes',
      body: `<p>A ${term('LAN')} covers a building, a ${term('MAN')} a city, a ${term('WAN')} a country or more. Topologies: ${term('bus')} (one shared cable), ${term('star')} (all to a central switch — the modern LAN), ${term('ring')}, ${term('mesh')} (many links, resilient). In a ${term('client–server')} network servers provide services; in ${term('peer-to-peer')} every host is both.</p>`,
      qs: [q('star', 'Why do modern LANs use a star rather than a bus?', ['A fault in one cable affects one host, and a switch gives each link its own bandwidth.', 'On a bus a single break or collision disturbs everyone.'], [['A star uses less cable.', 'It uses more.'], ['Switches are free.', 'They cost money; the benefit is isolation.']])] }),
    sec('devices', '1.4', 'Devices by layer', { eyebrow: 'Hardware',
      body: `<p>A ${term('repeater')}/${term('hub')} regenerates bits (layer 1, floods every port, one collision domain). A ${term('bridge')}/${term('switch')} forwards frames by MAC address (layer 2), learning which address lives on which port. A ${term('router')} forwards packets between networks by IP address (layer 3). A ${term('gateway')} translates between different protocol stacks, often at the application layer.</p>`,
      figs: [dia(`direction: right
[Hub: layer 1, floods] as h #rose
[Switch: layer 2, by MAC] as s #violet
[Router: layer 3, by IP] as r #amber
[Gateway: layer 7, translates] as g #blue
h -> s
s -> r
r -> g`, 'Each step up the layers sees more of the packet.', { caption: 'devices and layers' })],
      qs: [q('sw', 'A switch receives a frame for a MAC address it has not seen before. What does it do?', ['Floods it out of every port except the one it came from, then learns the sender’s port.', 'Once the destination replies, the switch knows its port.'], [['Drops it.', 'That would make a new host unreachable.'], ['Sends it to the router.', 'Switches do not reason about IP.']])] }),
    sec('addr', '1.5', 'Addressing at each layer', { eyebrow: 'Who is who',
      body: `<p>Four kinds of address work together: a <b>port</b> picks the process (transport), an <b>IP address</b> picks the host across networks (network), a <b>MAC address</b> picks the interface on one link (data link), and a <b>name</b> such as <code>example.com</code> is turned into an IP by DNS (application). Along a route the IP addresses stay the same end to end while the MAC addresses change at every hop.</p>`,
      probs: [pr('p1', '<p>A host sends a packet to a server in another network. Which addresses change at the router and which stay the same?</p>', 'Source and destination <b>IP</b> addresses stay the same (except with NAT); the frame’s <b>MAC</b> source and destination are rewritten at each hop because MAC addresses only mean something on one link.')],
      qs: [q('mac', 'Which address is rewritten at every router along the path?', ['The MAC addresses.', 'Each hop is a new link with its own frame.'], [['The IP addresses.', 'They are end-to-end (barring NAT).'], ['The port numbers.', 'They name processes and stay put.']])] }),
    sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Layers hide complexity; each talks to its peer via a protocol.</li><li>Going down, headers are added; going up, removed.</li><li>Hub → switch → router see layers 1 → 2 → 3.</li></ul>` }),
  ],
})
