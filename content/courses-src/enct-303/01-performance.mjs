import { lesson } from '../kit.mjs'
export default ({ lab, dia, cpp, q, pr, step, sec, term, run }) => {
  const add = run('cpu8085', {})
  return lesson({
    title: 'Performance and the instruction cycle',
    kicker: 'ENCT 303 · Computer Organization and Architecture · Chapter 1',
    subtitle: 'How to say a computer is “fast” with a number, and what the processor actually does between two ticks.',
    sections: [
      sec('orgarch', '1.1', 'Organisation versus architecture', { eyebrow: 'Vocabulary',
        body: `<p>${term('Computer architecture')} is what a programmer can see: the instruction set, registers, addressing modes and data types. ${term('Computer organisation')} is how it is built to provide that: control signals, buses, cache design, the technology. Two machines with the same architecture (two x86 chips) can have very different organisations — and different speeds.</p><p>A computer is a ${term('processor')} that fetches instructions and data from ${term('memory')}, with ${term('I/O')} to the outside world, joined by a ${term('bus')}. A multi-core processor simply puts several processors on one chip sharing the memory system.</p>`,
        figs: [dia(`direction: right
[CPU: control unit + ALU + registers] as cpu #blue
[Main memory] as mem #mint
[I/O modules] as io #amber
cpu -> mem : address bus, data bus
mem -> cpu : data
cpu -> io : control bus
io -> cpu : interrupt
@0 cpu -> mem : address
@1.2 mem -> cpu : instruction
@2.4 cpu -> io : command
@3.6 io -> cpu : interrupt
loop 5`, 'The three buses carry addresses, data and control signals.', { caption: 'the von Neumann machine' })],
        qs: [q('arch', 'Two processors run the same programs but one is faster. What differs?', ['Organisation — same architecture, different implementation.', 'The instruction set is identical (that is what “same programs” means); speed comes from pipelines, caches and clock rate.'], [['Architecture.', 'A different architecture could not run the same binaries.'], ['The programs.', 'The programs are given as identical.']])] }),
      sec('cycle', '1.2', 'The instruction cycle', { eyebrow: 'The heartbeat',
        body: `<p>Every instruction goes through the same loop: ${term('fetch')} it from the address in the program counter, ${term('decode')} what it asks for, ${term('execute')} it (possibly fetching operands and writing a result), then advance the program counter. A jump simply loads a new address into the counter. Interrupts are checked between instructions.</p><p>Watch an Intel 8085 do exactly this: each step is one instruction, the highlighted row is the one about to run, and the registers and flags change beneath.</p>`,
        figs: [lab('cpu8085', {}, `Adds 25H + 17H: the result ${add.m2052}H lands in memory at 2052H.`, ['A', 'm2052', 'tstates'], { caption: 'fetch – decode – execute', name: 'cpu' })],
        qs: [q('pc', 'After a normal (non-jump) instruction executes, what happens to the program counter?', ['It is advanced to the next instruction (by the instruction’s length).', 'A jump, call or return overwrites it; everything else just steps forward, which is why straight-line code runs in order.'], [['It stays at the same address.', 'Then the same instruction would run forever.'], ['It is cleared to zero.', 'Only reset does that.']])] }),
      sec('perf', '1.3', 'Measuring performance', { eyebrow: 'Numbers',
        body: `<p>Execution time = instruction count × ${term('CPI')} (cycles per instruction) × clock period. The clock rate is only one of the three factors; a faster clock with a worse CPI can be slower. ${term('MIPS')} = instruction count / (time × 10⁶) = clock rate / (CPI × 10⁶), but MIPS misleads across different instruction sets.</p>`,
        worked: [step('A 2 GHz processor runs a program of 10⁹ instructions at CPI 1.5.', '', { toc: 'Given' }), step('Cycles = instructions × CPI. Time = cycles / clock.', 't = \\frac{10^9\\times1.5}{2\\times10^9}=0.75\\ \\text{s}', { hero: true, toc: 'Execution time' }), step('MIPS = clock / (CPI × 10⁶).', '\\text{MIPS}=\\frac{2000}{1.5}\\approx1333', { toc: 'MIPS' })],
        qs: [q('cpi', 'A compiler change cuts the instruction count by 20% but raises CPI by 30%. Net effect on time?', ['Slower by 4%: 0.8 × 1.3 = 1.04.', 'Time scales with the product; a saving in one factor can be eaten by another.'], [['20% faster.', 'That ignores the CPI penalty.'], ['No change.', '0.8 × 1.3 is not 1.']])] }),
      sec('amdahl', '1.4', "Amdahl's law", { eyebrow: 'Limits',
        body: `<p>Speeding up only a fraction <i>f</i> of a program by a factor <i>s</i> gives overall speed-up 1 / ((1 − f) + f/s). The serial part (1 − f) caps everything: even with infinite <i>s</i> the limit is 1/(1 − f). This is why adding cores helps a little for mostly-serial programs.</p>`,
        worked: [step('A program spends 80% of its time in a part that can be made 4× faster.', 'f = 0.8,\\ s = 4', { toc: 'Given' }), step('Apply the law.', '\\text{speed-up}=\\frac{1}{0.2+0.8/4}=\\frac{1}{0.4}=2.5', { hero: true, toc: 'Speed-up' })],
        qs: [q('cap', 'If 10% of a program is serial, the maximum speed-up with unlimited processors is…', ['10×.', '1 / (1 − f) = 1 / 0.1.'], [['Unlimited.', 'The serial part never shrinks.'], ['90×.', 'Confuses the parallel fraction with the speed-up.']])],
        probs: [pr('p1', '<p>A 500 MHz machine executes 10⁸ instructions with a CPI of 2.5. Execution time?</p>', 'Cycles = 2.5 × 10⁸; time = 2.5×10⁸ / 5×10⁸ = <b>0.5 s</b>.'), pr('p2', '<p>Half of a program is sped up 10×. Overall speed-up?</p>', '1 / (0.5 + 0.5/10) = 1 / 0.55 ≈ <b>1.82</b>. The untouched half dominates.')] }),
      sec('risc', '1.5', 'RISC and CISC', { eyebrow: 'Two philosophies',
        body: `<p>${term('CISC')} machines (x86) have many complex, variable-length instructions, some of which do a lot of work. ${term('RISC')} machines (ARM, RISC-V, MIPS) have few, simple, fixed-length instructions, use load/store for all memory access and keep many registers — which makes pipelining easy. Berkeley RISC added ${term('overlapped register windows')}: each procedure gets a window of registers that overlaps its caller's, so parameters are passed without touching memory.</p>`,
        figs: [dia(`direction: right
group "CISC" { c1, c2 }
group "RISC" { r1, r2 }
[Few instructions? No: many, complex, variable length] as c1 #amber
[Microcode decodes them] as c2 #amber
[Few, simple, fixed length] as r1 #mint
[Hardwired + pipelined] as r2 #mint
c1 -> c2
r1 -> r2`, 'Complexity lives in microcode (CISC) or in the compiler (RISC).', { caption: 'RISC vs CISC' })],
        qs: [q('load', 'Why do RISC processors allow only load/store instructions to touch memory?', ['It keeps every other instruction register-to-register and fixed in duration, which makes pipelining simple.', 'Uniform timing is the key enabler of a smooth pipeline.'], [['To save registers.', 'RISC has more registers, not fewer.'], ['Because memory is unreliable.', 'Irrelevant.']])] }),
      sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Architecture = visible contract; organisation = implementation.</li><li>Time = instructions × CPI × period.</li><li>Amdahl: the serial fraction limits speed-up.</li><li>The instruction cycle: fetch, decode, execute, repeat.</li></ul>` }),
    ],
  })
}
