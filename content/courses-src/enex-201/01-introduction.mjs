import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'The stored-program computer and its buses',
  kicker: 'ENEX 201 · Microprocessors · Chapter 1',
  subtitle: 'A processor, a memory and a few wires — and the one idea that made it programmable: instructions are data.',
  sections: [
    sec('mp', '1.1', 'Microprocessor, microcomputer, microcontroller', { eyebrow: 'Terms',
      body: `<p>A ${term('microprocessor')} is a CPU on one chip (ALU, registers, control). A ${term('microcomputer')} adds memory and I/O chips around it. A ${term('microcontroller')} puts CPU, memory, timers and I/O on a single chip — the heart of appliances and embedded devices. History in one line: 4004 (4-bit, 1971) → 8080/8085 (8-bit) → 8086 (16-bit) → 386 (32-bit) → 64-bit multicore.</p>`,
      qs: [q('mc', 'What distinguishes a microcontroller from a microprocessor?', ['It integrates memory and I/O on the chip, for self-contained embedded use.', 'A microprocessor needs external memory and peripherals.'], [['It is faster.', 'Usually slower.'], ['It has no CPU.', 'It contains one.']])] }),
    sec('von', '1.2', 'Von Neumann architecture', { eyebrow: 'The idea',
      body: `<p>Program and data share one memory, one address space, one bus (von Neumann). The CPU fetches an instruction, then fetches its operands, all over the same bus — the “von Neumann bottleneck”. The ${term('Harvard')} architecture keeps separate memories and buses for code and data, so both can be fetched at once (microcontrollers, DSPs, caches).</p>`,
      figs: [dia(`direction: right
[CPU: control + ALU + registers] as cpu #blue
[Memory: program + data] as mem #mint
[I/O devices] as io #amber
cpu -> mem : address bus
mem -> cpu : data bus (instructions and data)
cpu -> io : control bus
@0 cpu -> mem : address
@1.2 mem -> cpu : instruction
@2.4 cpu -> mem : address
@3.6 mem -> cpu : operand
loop 5`, 'Instructions and operands compete for the same bus.', { caption: 'the von Neumann machine' })],
      qs: [q('harv', 'Harvard architecture differs from von Neumann in having…', ['Separate memories and buses for instructions and data.', 'Both can be accessed simultaneously.'], [['One memory for both.', 'That is von Neumann.'], ['No memory.', 'Nonsense.']])] }),
    sec('bus', '1.3', 'The three buses', { eyebrow: 'Wires',
      body: `<p>The ${term('address bus')} (one-way, CPU → memory) selects a location; its width fixes the address space: n lines address 2ⁿ locations (the 8085’s 16 lines: 64 KB). The ${term('data bus')} (two-way) carries the value, its width the word size (8 bits). The ${term('control bus')} carries signals such as RD, WR, ALE and IO/M̅.</p>`,
      worked: [step('A processor has 20 address lines and an 8-bit data bus.', '', { toc: 'Given' }), step('Addressable memory = 2²⁰ bytes.', '2^{20}=1\\ \\text{MB}', { hero: true, toc: 'Address space' })],
      probs: [pr('p1', '<p>How many address lines are needed to address 4 MB?</p>', '4 MB = 2²² bytes → <b>22</b> address lines.')],
      qs: [q('addr', 'Why is the address bus unidirectional?', ['Only the CPU (or DMA) chooses which location is accessed.', 'Memory never drives an address.'], [['Because it is narrow.', 'Width is unrelated.'], ['To save power.', 'Not the reason.']])] }),
    sec('cycle', '1.4', 'Processing cycle', { eyebrow: 'Fetch – decode – execute',
      body: `<p>The CPU repeatedly: puts the program counter on the address bus and reads the opcode (fetch), decodes it, reads any operands, executes it, updates the PC. Step the 8085 below and watch the program counter move and the registers change.</p>`,
      figs: [lab('cpu8085', {}, 'The highlighted line is the instruction about to run.', ['A', 'tstates'], { caption: 'an 8085 fetch-execute loop', name: 'cpu' })],
      qs: [q('pc', 'What does the program counter hold?', ['The address of the next instruction to fetch.', 'It advances after each fetch and is overwritten by jumps.'], [['The current instruction.', 'That is the instruction register.'], ['The stack top.', 'That is the stack pointer.']])] }),
    sec('mem', '1.5', 'Memory classes', { eyebrow: 'Storage',
      body: `<p>ROM holds the program permanently (boot code); RAM holds data that changes (static SRAM: fast, flip-flops; dynamic DRAM: denser, needs refresh). Flash/EEPROM are electrically rewritable. The system combines them in one address space: for instance ROM at 0000–1FFF, RAM at 2000–3FFF.</p>`,
      qs: [q('ram', 'Why is ROM placed at the start of the address space in many 8085 systems?', ['The processor begins execution at address 0000H after reset, so boot code must be there.', 'RAM contents are undefined at power-up.'], [['ROM is faster.', 'Not usually.'], ['RAM cannot be addressed at 0.', 'It can.']])] }),
    sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Stored program: code and data in the same memory.</li><li>Address lines fix memory size (2ⁿ); data lines fix word size.</li></ul>` }),
  ],
})
