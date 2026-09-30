import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const reno = run('tcp', { variant: 'reno', rounds: 16, ssthresh: 8, dupacks: '9' }), tahoe = run('tcp', { variant: 'tahoe', rounds: 16, ssthresh: 8, dupacks: '9' })
  return lesson({
    title: 'TCP and UDP',
    kicker: 'ENCT 304 · Computer Networks · Chapter 5',
    subtitle: 'IP delivers packets when it feels like it. TCP turns that into a reliable, ordered stream — and learns how fast it may go.',
    sections: [
      sec('ports', '5.1', 'Process-to-process delivery', { eyebrow: 'Transport',
        body: `<p>The network layer gets a packet to a <em>host</em>; the transport layer gets it to a <em>process</em>. A 16-bit ${term('port number')} identifies the process; the pair (IP, port) is a ${term('socket')}. The sender ${term('multiplexes')} many applications onto one network connection; the receiver ${term('demultiplexes')} by port. ${term('UDP')} adds only ports and a checksum: fast, connectionless, no guarantees (DNS, streaming, games). ${term('TCP')} adds connections, reliability, ordering, flow and congestion control (web, email, files).</p>`,
        qs: [q('udp', 'Why would an application choose UDP?', ['It wants low latency and no connection set-up, and can tolerate or handle loss itself.', 'DNS queries and live video do not want to wait for retransmissions.'], [['It needs guaranteed delivery.', 'That is TCP.'], ['It needs flow control.', 'UDP has none.']])] }),
      sec('hs', '5.2', 'The three-way handshake', { eyebrow: 'Connections',
        body: `<p>Before data flows TCP agrees initial sequence numbers: the client sends SYN, the server replies SYN-ACK, the client ACKs. Teardown uses FIN and ACK in each direction (a four-step close), since each side closes its half independently. Press Simulate to watch the segments cross.</p>`,
        figs: [dia(`mode: sequence
[Client] as c
[Server] as s
c -> s : SYN, seq = x
s --> c : SYN-ACK, seq = y, ack = x+1
c -> s : ACK, ack = y+1
c -> s : data
s --> c : ACK
c -> s : FIN
s --> c : ACK + FIN
c -> s : ACK`, 'Open, transfer, close.', { caption: 'TCP connection life cycle' })],
        qs: [q('syn', 'Why three messages rather than two?', ['Both sides must learn the other’s initial sequence number and confirm it was received.', 'Two messages would leave the server unsure that the client got its SYN-ACK.'], [['To encrypt the connection.', 'TCP does not encrypt.'], ['Because of the OSI model.', 'Unrelated.']])] }),
      sec('reliable', '5.3', 'Reliability and flow control', { eyebrow: 'Sequence and window',
        body: `<p>TCP numbers every byte. The receiver's acknowledgement is cumulative ("I have everything up to byte N"). Loss is detected by a timeout or by three duplicate ACKs (fast retransmit). The receiver also advertises a ${term('window')}, the free space in its buffer, and the sender never has more than that outstanding: ${term('flow control')} stops a fast sender overrunning a slow receiver. It is the sliding window of the previous chapter, applied to a byte stream.</p>`,
        worked: [step('A receiver advertises a 4000-byte window; the sender has sent bytes 1000–2999 unacknowledged.', '', { toc: 'Given' }), step('It may send 4000 − 2000 = 2000 more bytes.', 'W - \\text{in flight}=4000-2000', { hero: true, toc: 'Allowed' })],
        qs: [q('dup', 'Three duplicate ACKs signal…', ['A probably lost segment — retransmit without waiting for the timeout.', 'Later segments are arriving, so only one is missing.'], [['The receiver is full.', 'That is a window of 0.'], ['The connection closed.', 'That is FIN.']])] }),
      sec('cc', '5.4', 'Congestion control', { eyebrow: 'Sharing the network',
        body: `<p>Flow control protects the receiver; ${term('congestion control')} protects the network. TCP keeps a congestion window <i>cwnd</i>. ${term('Slow start')}: cwnd doubles each RTT from 1 until it reaches <i>ssthresh</i>. ${term('Congestion avoidance')}: +1 segment per RTT. On three duplicate ACKs, Reno halves the threshold and continues from there (fast recovery); Tahoe restarts from 1. A timeout sends both back to 1. The saw-tooth is the signature of TCP.</p>`,
        figs: [lab('tcp', { variant: 'reno', rounds: 16, ssthresh: 8, dupacks: '9' }, 'Reno: growth, a loss at RTT 9, then halving.', ['cwnd'], { caption: 'TCP Reno', name: 'reno' }), lab('tcp', { variant: 'tahoe', rounds: 16, ssthresh: 8, dupacks: '9' }, 'Tahoe restarts from 1 after the same loss.', ['cwnd'], { caption: 'TCP Tahoe', name: 'tahoe' })],
        qs: [q('ss', 'During slow start, how does cwnd grow?', ['It doubles every RTT (exponentially).', 'Each ACK adds one segment, so a full window of ACKs doubles the window.'], [['By one segment per RTT.', 'That is congestion avoidance.'], ['It stays constant.', 'Then it would never probe the capacity.']])],
        probs: [pr('p-cwnd', '<p>Reno with ssthresh 8 and a 3-dup-ACK loss at RTT 9: list cwnd for the first 16 RTTs (Tahoe too).</p>', `Reno: <b>${reno.cwnd}</b>. Tahoe: <b>${tahoe.cwnd}</b>. Reno resumes at half the window; Tahoe falls back to slow start.`, { verify: lab('tcp', { variant: 'reno', rounds: 16, ssthresh: 8, dupacks: '9' }, 'Reno.', ['cwnd'], { caption: 'answer', name: 'ans' }) })] }),
      sec('sockets', '5.5', 'Sockets', { eyebrow: 'Programming',
        body: `<p>A ${term('socket')} is the programmer’s handle on this machinery. A server calls <code>socket → bind → listen → accept</code> and then <code>recv/send</code>; a client calls <code>socket → connect</code> then <code>send/recv</code>. <code>accept</code> returns a new socket for each client while the listening socket keeps waiting.</p>`,
        figs: [dia(`mode: sequence
[Client] as c
[Server] as s
s -> s : socket, bind, listen
c -> c : socket
c -> s : connect, then handshake
s -> s : accept → new socket
c -> s : send(request)
s --> c : send(response)
c -> s : close`, 'The call order on each side.', { caption: 'socket calls' })],
        qs: [q('accept', 'What does accept() return?', ['A new socket dedicated to the connecting client.', 'The original listening socket remains open for more clients.'], [['The client’s IP address only.', 'It returns a socket (address available separately).'], ['Nothing.', 'It returns a descriptor.']])] }),
      sec('summary', '5.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Ports pick processes; TCP = reliable stream, UDP = datagrams.</li><li>Handshake: SYN, SYN-ACK, ACK.</li><li>Flow control = receiver’s window; congestion control = cwnd (slow start, AIMD).</li></ul>` }),
    ],
  })
}
