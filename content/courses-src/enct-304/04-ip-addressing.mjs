import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const s = run('subnet', { address: '192.168.10.77/26' }), v = run('subnet', { address: '192.168.1.0/24', hosts: '100 50 20 10' })
  return lesson({
    title: 'IPv4 addressing and subnetting',
    kicker: 'ENCT 304 · Computer Networks · Chapter 4 (addressing)',
    subtitle: 'An IP address is a 32-bit number cut into “which network” and “which host”. Every subnetting question is where to cut.',
    sections: [
      sec('addr', '4.1', 'Reading an address', { eyebrow: 'The format',
        body: `<p>An IPv4 address is 32 bits written as four decimal bytes. The ${term('subnet mask')} (or prefix length /<i>n</i>) marks the first <i>n</i> bits as the <b>network</b> part; the rest identify the <b>host</b>. Originally the split was fixed by ${term('class')}: A (first bit 0, /8), B (10, /16), C (110, /24), D (1110, multicast), E (reserved). Modern ${term('CIDR')} allows any prefix length.</p>`,
        figs: [lab('subnet', { address: '192.168.10.77/26' }, `192.168.10.77/26 is on network ${s.network} with broadcast ${s.broadcast} and ${s.hosts} usable hosts.`, ['network', 'broadcast', 'hosts'], { caption: 'address, mask, network, broadcast', name: 'sn' })],
        qs: [q('class', 'Which class is 172.16.5.9 (original classful addressing)?', ['B — the first byte 172 is between 128 and 191.', 'Class B starts with bits 10.'], [['A.', 'Class A is 1–126.'], ['C.', 'Class C is 192–223.']])] }),
      sec('subnet', '4.2', 'Network, broadcast and usable hosts', { eyebrow: 'The three numbers',
        body: `<p>AND the address with the mask to get the <b>network address</b>; set all host bits to 1 for the <b>broadcast address</b>; the usable hosts lie between them: 2<sup>h</sup> − 2 where <i>h</i> is the number of host bits (the all-zeros and all-ones addresses are reserved).</p>`,
        worked: [step('192.168.10.77/26: the last byte 77 = 01001101, and /26 leaves 6 host bits.', '77 = 01\\,001101', { toc: 'Binary' }), step('Network: zero the host bits → 01000000 = 64. Broadcast: set them → 01111111 = 127.', `${s.network}\\ \\text{to}\\ ${s.broadcast}`, { toc: 'Network and broadcast' }), step('Usable hosts.', `2^6-2=${s.hosts}`, { hero: true, toc: 'Hosts' })],
        qs: [q('hosts', 'How many usable hosts in a /27?', ['30.', '32 − 5 = 27 bits network leaves 5 host bits: 2⁵ − 2 = 30.'], [['32.', 'Two addresses are reserved.'], ['27.', 'That is the prefix length.']])] }),
      sec('vlsm', '4.3', 'VLSM: sizing each subnet', { eyebrow: 'Variable length',
        body: `<p>${term('VLSM')} gives each network just the block it needs. Sort requirements largest first, give each the smallest power-of-two block that fits its hosts + 2, and place blocks back to back so they stay aligned. From 192.168.1.0/24 for 100, 50, 20 and 10 hosts: <b>${v.vlsm}</b>.</p>`,
        figs: [lab('subnet', { address: '192.168.1.0/24', hosts: '100 50 20 10' }, 'Largest first keeps the blocks aligned.', ['vlsm'], { caption: 'VLSM allocation', name: 'vl' })],
        qs: [q('vorder', 'Why allocate the largest subnet first?', ['Big blocks must start on big alignment boundaries; allocating them first avoids wasted gaps.', 'Small blocks can fill the leftover space.'], [['It is alphabetical.', 'No.'], ['Routers require it.', 'It is a planning convention.']])],
        probs: [pr('p-vlsm', '<p>Divide 192.168.1.0/24 into subnets for 100, 50, 20 and 10 hosts.</p>', `100 hosts → /25 (126 usable); 50 → /26 (62); 20 → /27 (30); 10 → /28 (14). Result: <b>${v.vlsm}</b>.`, { verify: lab('subnet', { address: '192.168.1.0/24', hosts: '100 50 20 10' }, 'The allocation.', ['vlsm'], { caption: 'answer', name: 'ans' }) })] }),
      sec('special', '4.4', 'Private, public, NAT and multicast', { eyebrow: 'Special ranges',
        body: `<p>Private ranges (10/8, 172.16/12, 192.168/16) are not routed on the Internet; ${term('NAT')} rewrites a private source address and port to the router’s public address, keeping a table so replies return to the right host. Unicast goes to one host, broadcast to all hosts on a network, multicast (224/4) to a group. IPv6 (128-bit, written in hex) removes the address shortage and most need for NAT; transition uses dual stack, tunnelling or translation.</p>`,
        figs: [dia(`mode: sequence
[Host 192.168.1.5] as h
[NAT router] as r
[Server 203.0.113.9] as s
h -> r : src 192.168.1.5:5000
r -> s : src 198.51.100.1:40001 (table entry made)
s --> r : dst 198.51.100.1:40001
r --> h : dst 192.168.1.5:5000`, 'The NAT table maps the public port back to the private host.', { caption: 'NAT in action' })],
        qs: [q('nat', 'Why can several hosts share one public IP through NAT?', ['The router tells their connections apart by port number and remembers each mapping.', 'The translation table records (private IP, port) ↔ (public IP, port).'], [['They all have the same private address.', 'Private addresses are unique inside.'], ['NAT removes the need for ports.', 'Ports make it work.']])] }),
      sec('magic', '4.5', 'Subnetting by the “magic number”', { eyebrow: 'A quick method',
        body: `<p>For a mask whose interesting byte is <i>m</i>, the block size ("magic number") is 256 − <i>m</i>. Subnets start at multiples of it. For /26 the mask byte is 192, the block size 64, so subnets start at 0, 64, 128, 192 — and 77 falls in the block starting at 64.</p>`,
        worked: [step('Which subnet holds 10.1.1.130/27?', '', { toc: 'Question' }), step('/27 → mask byte 224 → block 32. Multiples of 32: …, 96, 128, 160. 130 lies in the block starting at 128.', '128\le130<160', { hero: true, toc: 'Block' }), step('So network 10.1.1.128, broadcast 10.1.1.159, usable .129–.158.', '', { toc: 'Range' })],
        qs: [q('block', 'Block size of a /28?', ['16.', '/28 leaves 4 host bits: 2⁴ = 16 addresses per subnet.'], [['28.', 'That is the prefix.'], ['14.', 'That is the usable hosts.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Network = address AND mask; broadcast = host bits all 1; hosts = 2ʰ − 2.</li><li>VLSM: largest block first.</li><li>NAT trades address space for a translation table.</li></ul>` }),
    ],
  })
}
