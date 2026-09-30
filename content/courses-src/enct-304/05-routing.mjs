import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const d = run('routing', { algo: 'dijkstra', source: 'u' }), dv = run('routing', { algo: 'dv' })
  return lesson({
    title: 'Routing algorithms and protocols',
    kicker: 'ENCT 304 · Computer Networks · Chapter 4 (routing)',
    subtitle: 'How routers learn the cheapest path: by knowing the whole map, or by asking their neighbours.',
    sections: [
      sec('fwd', '4.6', 'Forwarding versus routing', { eyebrow: 'Two jobs',
        body: `<p>${term('Forwarding')} is the per-packet act of looking up the destination in the forwarding table and choosing the output port — fast, done in hardware. ${term('Routing')} is the slower process that <em>builds</em> that table. Routes can be static (configured by hand) or dynamic (learned by a routing protocol). Within an organisation routers use an ${term('interior')} protocol (RIP, OSPF, EIGRP); between organisations the Internet uses the exterior protocol ${term('BGP')}.</p>`,
        qs: [q('fwd', 'Which is done for every packet?', ['Forwarding — a table lookup.', 'Routing runs in the background updating the table.'], [['Routing.', 'Running Dijkstra per packet would be far too slow.'], ['Neither.', 'Every packet is forwarded.']])] }),
      sec('ls', '4.7', 'Link state: Dijkstra', { eyebrow: 'Know the map',
        body: `<p>In ${term('link-state')} routing (OSPF) every router floods the state of its links, so all routers hold the same map, then each runs Dijkstra’s algorithm to find least-cost paths from itself. Repeatedly settle the nearest unsettled node and relax its neighbours. On the textbook graph from node u the costs to v, x, w, y, z come out as <b>${d.d_v}, ${d.d_x}, ${d.d_w}, ${d.d_y}, ${d.d_z}</b>; the route to z is <b>${d.path_z}</b>.</p>`,
        figs: [lab('routing', { algo: 'dijkstra', source: 'u' }, 'Watch the tree of shortest paths grow.', ['d_z', 'path_z'], { caption: 'Dijkstra from u', name: 'dj' })],
        qs: [q('dj', 'Dijkstra’s algorithm requires that link costs be…', ['Non-negative.', 'A negative edge could make an already-settled node cheaper to reach later.'], [['All equal.', 'Weights may differ.'], ['Integers.', 'Any non-negative real works.']])],
        probs: [pr('p-dj', '<p>Find least-cost paths from u in the graph u–v 2, u–x 1, u–w 5, v–x 2, v–w 3, x–w 3, x–y 1, w–y 1, w–z 5, y–z 2.</p>', `D(v)=${d.d_v}, D(x)=${d.d_x}, D(w)=${d.d_w} (via x, y), D(y)=${d.d_y}, D(z)=${d.d_z} via <b>${d.path_z}</b>.`, { verify: lab('routing', { algo: 'dijkstra', source: 'u' }, 'Each step settles the nearest node.', ['d_z'], { caption: 'answer', name: 'ans' }) })] }),
      sec('dv', '4.8', 'Distance vector: Bellman–Ford', { eyebrow: 'Ask your neighbours',
        body: `<p>In ${term('distance-vector')} routing (RIP) each router knows only its links and its neighbours’ tables. Periodically it recomputes D(i,j) = min over neighbours k of [cost(i,k) + D(k,j)]. Information spreads one hop per round, and the tables converge to the same answers as Dijkstra. Problems: slow convergence and the ${term('count-to-infinity')} problem when a link fails, mitigated by split horizon and a small maximum hop count (RIP: 15).</p>`,
        figs: [lab('routing', { algo: 'dv' }, 'Amber entries improved this round.', ['row_u'], { caption: 'distance-vector rounds', name: 'dv' })],
        qs: [q('ctinf', 'What is the count-to-infinity problem?', ['After a failure, routers keep advertising stale routes to each other and the cost climbs slowly.', 'Each router believes a neighbour’s outdated offer; it takes many rounds to give up.'], [['Routers run out of memory.', 'Not the issue.'], ['Costs overflow.', 'The trouble is slow convergence.']])] }),
      sec('protocols', '4.9', 'RIP, OSPF, EIGRP, BGP', { eyebrow: 'In practice',
        body: `<p>RIP: distance vector, hop count, 15 max. OSPF: link state, areas, fast convergence. EIGRP: Cisco’s advanced distance vector. BGP: path-vector between autonomous systems; it is policy-driven, not cost-driven. Supporting protocols: ARP maps IP to MAC on a link; ICMP reports errors and powers ping/traceroute.</p>`,
        figs: [dia(`mode: sequence
[Host A] as a
[Router] as r
[Host B] as b
a -> r : ARP: who has gateway IP?
r --> a : ARP reply: my MAC
a -> r : IP packet for B (router MAC)
r -> b : ARP: who has B?
b --> r : B’s MAC
r -> b : IP packet (B’s MAC)`, 'ARP resolves the next hop on each link.', { caption: 'ARP around a router' })],
        qs: [q('arp', 'What does ARP do?', ['Maps an IP address to a MAC address on the local link.', 'Frames need a MAC destination even though packets carry IP.'], [['Maps names to IPs.', 'That is DNS.'], ['Finds the shortest route.', 'That is routing.']])] }),
      sec('cc', '4.10', 'Congestion and traffic shaping', { eyebrow: 'Overload',
        body: `<p>When offered load exceeds capacity, queues grow and packets are dropped. Control can be open-loop (traffic shaping with a ${term('leaky bucket')} or ${term('token bucket')}) or closed-loop (feedback such as TCP’s window, next lesson). A token bucket lets bursts through up to its depth, then enforces the average rate.</p>`,
        worked: [step('A token bucket adds tokens at 100 packets/s and holds at most 50. The source bursts.', '', { toc: 'Given' }), step('It can send 50 packets at once, then 100 per second sustained.', 'r=100\\ \\text{pkt/s},\\ b=50', { hero: true, toc: 'Behaviour' })],
        qs: [q('leaky', 'A leaky bucket smooths traffic by…', ['Releasing packets at a constant rate whatever the input burstiness.', 'Excess is queued or dropped.'], [['Letting bursts pass unchanged.', 'That is the token bucket (up to its depth).'], ['Adding delay at random.', 'No.']])] }),
      sec('summary', '4.11', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Forwarding = lookup; routing = table building.</li><li>Link state: full map + Dijkstra. Distance vector: neighbours’ tables + Bellman–Ford.</li><li>BGP glues autonomous systems together by policy.</li></ul>` }),
    ],
  })
}
