import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'I/O methods and multiprocessors',
  kicker: 'ENCT 303 · Computer Organization and Architecture · Chapters 7–8',
  subtitle: 'Three ways to talk to a device, and how many processors are connected and kept in agreement.',
  sections: [
    sec('prog', '7.1', 'Programmed I/O', { eyebrow: 'The CPU waits',
      body: `<p>With ${term('programmed I/O')} the CPU issues a command and then <em>polls</em> the device’s status register until it is ready, then moves the data itself. It is simple but wastes the CPU: a keyboard polled at full speed spends virtually all its time looking at nothing.</p>`,
      figs: [dia(`mode: sequence
[CPU] as c
[I/O module] as m
c -> m : command (read)
m --> c : status: busy
c -> m : poll status
m --> c : status: busy
c -> m : poll status
m --> c : status: ready + data`, 'The repeated polls are wasted cycles.', { caption: 'programmed I/O' })],
      qs: [q('poll', 'Main drawback of programmed I/O?', ['The CPU busy-waits and does no useful work.', 'Polling occupies the processor for the whole device delay.'], [['It needs DMA hardware.', 'That is DMA.'], ['It cannot transfer data.', 'It can, slowly.']])] }),
    sec('int', '7.2', 'Interrupt-driven I/O', { eyebrow: 'Do other work',
      body: `<p>The CPU starts the operation and goes on running other instructions. When the device is ready it raises an interrupt; the CPU finishes its current instruction, saves state, runs a service routine that moves the word, and returns. Efficiency is much better, but every word still costs an interrupt — too expensive for disks.</p>`,
      figs: [dia(`mode: sequence
[CPU] as c
[I/O module] as m
c -> m : command (read)
c -> c : run other instructions
m --> c : interrupt: data ready
c -> m : read data word
c -> c : resume program`, 'No polling.', { caption: 'interrupt-driven I/O' })],
      qs: [q('intadv', 'Advantage over programmed I/O?', ['The CPU is free during the device’s delay.', 'It is only interrupted when the device is ready.'], [['No overhead at all.', 'Each interrupt has a cost.'], ['Faster devices.', 'The device is the same.']])] }),
    sec('dma', '7.3', 'Direct memory access', { eyebrow: 'Move blocks without the CPU',
      body: `<p>A ${term('DMA controller')} is given the memory address, the count and the direction, then transfers the whole block between device and memory by itself, stealing bus cycles ("cycle stealing") from the CPU, and interrupts once at the end. One interrupt per block instead of one per word.</p>`,
      worked: [step('Transfer a 4 KB block from a device that gives one 4-byte word per transfer.', '', { toc: 'Task' }), step('Interrupt-driven: one interrupt per word. DMA: one interrupt per block.', '\\frac{4096}{4}=1024\\ \\text{interrupts vs }1', { hero: true, toc: 'Interrupt count' })],
      figs: [dia(`mode: sequence
[CPU] as c
[DMA controller] as d
[Memory] as m
[Disk] as k
c -> d : address, count, direction
d -> k : request block
k --> d : data words
d -> m : write words (cycle stealing)
d --> c : one interrupt at the end`, 'The CPU only starts and finishes the transfer.', { caption: 'a DMA transfer' })],
      qs: [q('dmaint', 'How many interrupts does a DMA block transfer cause?', ['One, at completion.', 'The controller handles every word itself.'], [['One per word.', 'That is interrupt-driven I/O.'], ['None.', 'There is a completion interrupt.']])] }),
    sec('chan', '7.4', 'Channels and interfaces', { eyebrow: 'Bigger systems',
      body: `<p>An ${term('I/O channel')} is a small processor that runs its own I/O program, freeing the CPU further (mainframes); a front-end processor does the same for communications. External interfaces are point-to-point (USB, SATA) or multipoint buses (SCSI): serial links are replacing wide parallel ones because they scale in speed.</p>`,
      qs: [q('chan', 'An I/O channel differs from a DMA controller because…', ['It executes its own I/O instructions rather than just moving one block.', 'It is a specialised processor.'], [['It has no memory access.', 'It accesses memory.'], ['It is slower.', 'Not the defining difference.']])] }),
    sec('mp', '8.1', 'Multiprocessors and interconnection', { eyebrow: 'Many CPUs',
      body: `<p>A tightly-coupled ${term('multiprocessor')} shares memory. Processors are joined by a time-shared <b>common bus</b> (cheap, one at a time), <b>multiport memory</b>, a <b>crossbar switch</b> (any processor to any memory, n² crosspoints), a <b>multistage network</b> (log₂ n stages of small switches) or a <b>hypercube</b> (n = 2ᵈ nodes, each with d neighbours). Arbitration decides who wins a contested resource.</p>`,
      worked: [step('Crossbar for 8 processors and 8 memories needs 8 × 8 crosspoints. An omega network needs (n/2) log₂ n 2×2 switches.', '64\\ \\text{vs}\\ 4\\cdot3=12', { hero: true, toc: 'Cost' })],
      figs: [dia(`direction: right
group "Common bus" { a1, a2, abus }
[P1] as a1 #blue
[P2] as a2 #blue
[Shared bus] as abus #amber
[Memory] as m #mint
a1 -> abus
a2 -> abus
abus -> m`, 'Cheap, but only one transfer at a time.', { caption: 'a common bus' })],
      qs: [q('cube', 'How many neighbours does each node of a 4-dimensional hypercube have?', ['4.', 'In a d-dimensional hypercube every node links to d others, one per bit that can flip.'], [['16.', 'That is the number of nodes.'], ['2.', 'That would be a ring.']])],
      probs: [pr('p1', '<p>A multi-stage omega network connects 16 processors to 16 memories using 2×2 switches. How many stages and how many switches?</p>', 'Stages = log₂16 = <b>4</b>; each stage has 16/2 = 8 switches → <b>32</b> switches (versus 256 crosspoints for a crossbar).')] }),
    sec('summary', '8.2', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Polling wastes CPU; interrupts free it; DMA moves whole blocks with one interrupt.</li><li>Interconnect choice trades cost against simultaneous transfers.</li></ul>` }),
  ],
})
