import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, q, pr, step, sec, term, run }) => {
  const sc = run('sched', { algo: 'rr', quantum: 4, procs: 'P1,0,24;P2,0,3;P3,0,3' }), ca = run('cache', { lines: 4, block: 1, addrs: '0 8 0 6 8', mapping: 'direct' }), mm = run('mm1', { lambda: 0.5, mu: 1, customers: 2000, seed: 3 })
  return lesson({
    title: 'Simulation tools and simulating computer systems',
    kicker: 'ENCT 353 · Simulation and Modeling · Chapters 9–10',
    subtitle: 'From Python to GPSS, and using simulation to design the very machines that run it.',
    sections: [
      sec('lang', '9.1', 'Simulation languages and tools', { eyebrow: 'The landscape',
        body: `<p>You can write a simulator in any language — Java, Python (SimPy), C++ — but dedicated tools save effort. ${term('GPSS')} models a system as transactions flowing through blocks (GENERATE, QUEUE, SEIZE, ADVANCE, RELEASE, TERMINATE). Commercial packages (Arena, AnyLogic, Simulink) add graphical building and animation. Whatever the tool, the core is the same: a clock, an event list, random streams and statistics collectors.</p>`,
        figs: [dia(`direction: right
(GENERATE arrivals) as g
[QUEUE wait] as q #amber
[SEIZE server] as s #blue
[ADVANCE service time] as a #violet
[RELEASE server] as r #blue
(TERMINATE) as t
g -> q
q -> s
s -> a
a -> r
r -> t
@0 g -> q : customer
@1 q -> s : next
@2 s -> a : service
@3 a -> r : done
@4 r -> t : leaves
loop 6`, 'A GPSS single-server model as a block chain.', { caption: 'a GPSS model' })],
        qs: [q('gpss', 'In GPSS, transactions represent…', ['The entities moving through the system (customers, jobs, packets).', 'Blocks describe what happens to them.'], [['The servers.', 'Servers are facilities.'], ['The random numbers.', 'Those come from streams.']])] }),
      sec('code', '9.2', 'A queue simulator in code', { eyebrow: 'From scratch',
        body: `<p>Even a few lines of C++ give a working model. This program simulates a single-server queue with a deterministic pattern (arrival every 3 units, service of 2 each) and prints each customer’s wait — run it and step through with the DSA Lab.</p>`,
        figs: [cpp(`#include <iostream>
using namespace std;
int main() {
  int serverFree = 0, totalWait = 0;
  for (int i = 0; i < 5; i++) {
    int arrive = i * 3;
    int start = arrive > serverFree ? arrive : serverFree;
    totalWait += start - arrive;
    serverFree = start + 2;
  }
  cout << totalWait << endl;
  return 0;
}`, 'Service (2) is faster than arrivals (every 3), so nobody waits: total wait 0.', { output: '0' })],
        worked: [step('Arrival every 3, service 2 ⇒ the server is free before each arrival.', '', { toc: 'Why no wait' }), step('Change the service time to 4: customer i starts at max(arrival, previous finish).', '0,1,2,3,4\\ \\text{wait units}\\to 10', { hero: true, toc: 'Try it' })],
        qs: [q('det', 'Why is this model’s total wait 0?', ['Service time 2 is less than the inter-arrival gap 3, so the server is always free.', 'ρ = 2/3 with no randomness.'], [['The code is wrong.', 'It is correct.'], ['The clock is broken.', 'Nothing is broken.']])] }),
      sec('cpu', '10.1', 'CPU and memory simulation', { eyebrow: 'Designing hardware',
        body: `<p>Computer architects evaluate designs before building them. A ${term('CPU simulator')} executes instructions and counts cycles; a ${term('memory simulator')} replays an address trace through a cache model. The scheduling chapter's Round Robin with quantum 4 yields an average wait of <b>${sc.avgWT}</b>; a direct-mapped cache on the address trace 0 8 0 6 8 suffers <b>${ca.misses}</b> misses. Changing the parameters and re-running is exactly a simulation experiment.</p>`,
        figs: [lab('sched', { algo: 'rr', quantum: 4, procs: 'P1,0,24;P2,0,3;P3,0,3' }, 'A scheduler is a simulation of a CPU.', ['avgWT'], { caption: 'CPU scheduling simulation', name: 'cpu' }), lab('cache', { lines: 4, block: 1, addrs: '0 8 0 6 8', mapping: 'direct' }, 'A cache is a simulation of memory.', ['misses', 'hitRate'], { caption: 'cache simulation', name: 'mem' })],
        qs: [q('trace', 'Trace-driven simulation of a cache replays…', ['A recorded sequence of memory addresses through the cache model.', 'Changing cache parameters is then cheap.'], [['Random numbers only.', 'That is synthetic.'], ['The compiler output.', 'Not a trace.']])] }),
      sec('net', '10.2', 'Network simulation', { eyebrow: 'Packets and links',
        body: `<p>Network simulators (ns-3, OMNeT++, Cisco Packet Tracer) model nodes, links, queues and protocols as discrete events: a packet arrives at a router, waits in a queue, is transmitted, propagates. A router output port is exactly an M/M/1-style queue: at ρ = 0.5 the simulated utilisation is <b>${mm.utilisation}</b> and the mean number in system <b>${mm.avgInSystem}</b>.</p>`,
        figs: [lab('mm1', { lambda: 0.5, mu: 1, customers: 2000, seed: 3 }, 'A router port as a queue.', ['utilisation', 'avgInSystem', 'theoryL'], { caption: 'a router output queue', name: 'rt' })],
        qs: [q('ns', 'What kind of simulation are network simulators?', ['Discrete-event: state changes at packet events.', 'The clock jumps between arrivals, transmissions and timeouts.'], [['Continuous.', 'Packets are discrete.'], ['Monte Carlo without time.', 'They model time explicitly.']])],
        probs: [pr('p1', '<p>Why simulate a new cache design rather than build it?</p>', 'Building hardware costs months and millions; a trace-driven simulator evaluates hit rate and AMAT for many sizes and policies in minutes and reveals the best design before any silicon is made.')] }),
      sec('tools', '10.3', 'High-level system simulation', { eyebrow: 'Whole-machine',
        body: `<p>Full-system simulators (gem5, QEMU) boot an operating system on a model of a computer, trading speed for detail — cycle-accurate is slowest. Choosing the abstraction level is the main design decision: the right model answers the question at the lowest cost.</p>`,
        qs: [q('level', 'A more detailed simulator is…', ['Usually slower, because it models more.', 'Pick the least detail that answers the question.'], [['Always better.', 'Cost matters.'], ['Always faster.', 'The opposite.']])] }),
      sec('summary', '10.4', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Simulation languages package the clock, event list, streams and statistics.</li><li>CPU, memory and network simulators are DES in disguise.</li></ul>` }),
    ],
  })
}
