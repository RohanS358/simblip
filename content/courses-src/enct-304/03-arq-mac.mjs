import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const gbn = run('arq', { protocol: 'gbn', frames: 8, window: 4, prop: 2, lose: '2' }), sr = run('arq', { protocol: 'sr', frames: 8, window: 4, prop: 2, lose: '2' }), sw = run('arq', { protocol: 'stopwait', frames: 4, prop: 2, lose: '' })
  return lesson({
    title: 'Flow control and shared media',
    kicker: 'ENCT 304 · Computer Networks · Chapter 3',
    subtitle: 'How a sender keeps the wire busy without drowning the receiver, recovers from loss, and shares a cable with others.',
    sections: [
      sec('sw', '3.6', 'Stop-and-wait', { eyebrow: 'The simplest ARQ',
        body: `<p>In ${term('ARQ')} (automatic repeat request) the receiver acknowledges good frames and the sender retransmits after a timeout. ${term('Stop-and-wait')} sends one frame, waits for its ACK, then sends the next. It is correct and trivial, but the link sits idle for a whole round trip per frame: with a long pipe the utilisation is tiny.</p>`,
        figs: [lab('arq', { protocol: 'stopwait', frames: 4, prop: 2, lose: '' }, `Four frames take ${sw.totalTime} time units: each waits for its own acknowledgement.`, ['totalTime'], { caption: 'stop-and-wait', name: 'sw' })],
        worked: [step('1 Mb/s link, 1000-bit frames, one-way delay 20 ms.', '', { toc: 'Given' }), step('Frame time 1 ms; round trip 40 ms. Utilisation = frame time / (frame time + RTT).', 'U=\\frac{1}{1+40}\\approx 2.4\\%', { hero: true, toc: 'Utilisation' })],
        qs: [q('idle', 'Why is stop-and-wait poor on a long fast link?', ['The sender idles for a whole round trip after each frame.', 'Bandwidth × delay bits could be in flight but only one frame is.'], [['It drops frames.', 'It is reliable.'], ['It needs large buffers.', 'One frame buffer is enough.']])] }),
      sec('window', '3.7', 'Sliding window: Go-Back-N and Selective Repeat', { eyebrow: 'Keep the pipe full',
        body: `<p>A ${term('sliding window')} lets the sender have up to <i>W</i> unacknowledged frames in flight. ${term('Go-Back-N')}: the receiver accepts only the next expected frame, so one loss forces the sender to resend that frame <em>and all after it</em>. ${term('Selective Repeat')}: the receiver buffers out-of-order frames and acknowledges each, so only the lost frame is resent. With window 4 and frame 2 lost: Go-Back-N retransmits <b>${gbn.retransmissions}</b> frames, Selective Repeat just <b>${sr.retransmissions}</b>.</p>`,
        figs: [lab('arq', { protocol: 'gbn', frames: 8, window: 4, prop: 2, lose: '2' }, 'Go-Back-N: after the loss the whole window is resent.', ['retransmissions', 'totalTime'], { caption: 'Go-Back-N', name: 'gbn' }), lab('arq', { protocol: 'sr', frames: 8, window: 4, prop: 2, lose: '2' }, 'Selective Repeat: one retransmission.', ['retransmissions', 'totalTime'], { caption: 'Selective Repeat', name: 'sr' })],
        qs: [q('gbn', 'Why does Go-Back-N resend frames that arrived safely?', ['The receiver discarded them: it accepts frames only in order.', 'That keeps the receiver trivial — no buffer — at the cost of extra traffic.'], [['The ACKs for them were lost.', 'The scenario loses only frame 2.'], ['The window was too small.', 'The cause is in-order-only reception.']])],
        probs: [pr('p-win', '<p>A 1 Mb/s link, 1000-bit frames, RTT 40 ms. What window size keeps the link fully busy?</p>', 'Frame time 1 ms; RTT 40 ms. Window ≥ 1 + 40/1 = <b>41</b> frames.')] }),
      sec('mac', '3.8', 'Random access: ALOHA and CSMA', { eyebrow: 'Sharing one cable',
        body: `<p>When many stations share a medium, collisions happen. ${term('Pure ALOHA')}: transmit whenever you like — maximum throughput 18.4% (1/2e). ${term('Slotted ALOHA')}: transmit only at slot starts — 36.8% (1/e). ${term('CSMA')} listens first; ${term('CSMA/CD')} (Ethernet) also listens while sending and aborts on a collision, then waits a random back-off that doubles each time; ${term('CSMA/CA')} (Wi-Fi) cannot hear collisions, so it avoids them with random waits and acknowledgements.</p>`,
        worked: [step('Pure ALOHA throughput S = G·e^(−2G) peaks at G = 0.5.', 'S_{max}=0.5e^{-1}\\approx0.184', { toc: 'Pure' }), step('Slotted ALOHA S = G·e^(−G) peaks at G = 1.', 'S_{max}=e^{-1}\\approx0.368', { hero: true, toc: 'Slotted' })],
        qs: [q('ca', 'Why can Wi-Fi not use collision detection?', ['A station cannot hear other transmissions while it is sending on the same radio channel.', 'So it avoids collisions (CSMA/CA) rather than detecting them.'], [['Wi-Fi never has collisions.', 'It has plenty.'], ['It would be too slow.', 'The issue is physical.']])] }),
      sec('switching', '3.9', 'Switched Ethernet and VLANs', { eyebrow: 'Modern LANs',
        body: `<p>A switch gives every port its own collision domain, so modern Ethernet is full duplex and needs no CSMA/CD. A ${term('VLAN')} splits one physical switch into several logical LANs; frames carry an 802.1Q tag with a VLAN id, and only a router moves traffic between VLANs. Uses: isolate departments, limit broadcasts, apply security.</p>`,
        figs: [dia(`direction: right
group "VLAN 10 · Sales" { a, b }
group "VLAN 20 · Lab" { c, d }
[PC A] as a #blue
[PC B] as b #blue
[PC C] as c #mint
[PC D] as d #mint
[Switch] as sw #violet
[Router] as r #amber
a -> sw
b -> sw
c -> sw
d -> sw
sw -> r : tagged trunk`, 'A and B talk directly; A and C must go through the router.', { caption: 'two VLANs on one switch' })],
        qs: [q('vlan', 'Hosts in different VLANs on the same switch can talk only via…', ['A router (layer 3).', 'VLANs are separate broadcast domains.'], [['The switch alone.', 'That would defeat the separation.'], ['A hub.', 'No.']])] }),
      sec('eff', '3.10', 'Efficiency of the window', { eyebrow: 'How full is the pipe?',
        body: `<p>Link utilisation with a window of <i>W</i> frames is U = W × t<sub>frame</sub> / (t<sub>frame</sub> + RTT), capped at 1. The product bandwidth × delay tells you how many bits are needed in flight to fill the pipe; choose W at least that many frames.</p>`,
        worked: [step('100 Mb/s link, 1250-byte frames (10 000 bits), RTT 10 ms.', '', { toc: 'Given' }), step('Frame time = 10 000 / 10⁸ = 0.1 ms; RTT / frame time = 100.', 't_f=0.1\ \text{ms}', { toc: 'Frame time' }), step('Window needed to fill the pipe: 1 + 100 = 101 frames. With W = 7, utilisation is only 7 / 101.', 'U=\frac{7}{101}\approx 6.9\%', { hero: true, toc: 'Utilisation' })],
        qs: [q('bd', 'What does bandwidth × delay tell you?', ['How many bits must be in flight to keep the link busy.', 'It sizes the window.'], [['The frame error rate.', 'No.'], ['The number of routers.', 'No.']])] }),
      sec('summary', '3.11', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Sliding windows keep the pipe full; window ≥ 1 + RTT/frame-time.</li><li>GBN resends the window; SR resends only the lost frame.</li><li>CSMA/CD detects, CSMA/CA avoids.</li></ul>` }),
    ],
  })
}
