import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const r = run('cpu8085', {})
  return lesson({
    title: '8085 architecture, instruction set and timing',
    kicker: 'ENEX 201 · Microprocessors · Chapter 2 (hardware)',
    subtitle: 'Seven registers, five flags, a 16-bit address bus — and a timing diagram that shows exactly when each signal moves.',
    sections: [
      sec('arch', '2.1', 'Internal architecture', { eyebrow: 'Inside the chip',
        body: `<p>The 8085 has an 8-bit ALU; the ${term('accumulator')} A; general registers B, C, D, E, H, L (usable as 16-bit pairs BC, DE, HL); the 16-bit ${term('program counter')} and ${term('stack pointer')}; an instruction register and decoder; timing and control; and five flags: Sign, Zero, Auxiliary carry, Parity, Carry. The HL pair doubles as memory pointer M.</p>`,
        figs: [dia(`direction: right
[Registers B C D E H L] as r #blue
[Accumulator A] as a #mint
[ALU + flags S Z AC P CY] as alu #amber
[PC / SP] as pc #violet
[Instruction register + decoder] as ir #rose
[Timing & control] as tc #grey
pc -> ir : fetch
ir -> tc : decode
tc -> alu : control
r -> alu
a -> alu
alu -> a : result`, 'The functional blocks of the 8085.', { caption: '8085 block diagram' })],
        qs: [q('flags', 'How many flags does the 8085 have?', ['Five: S, Z, AC, P, CY.', 'Each records an outcome of the last ALU operation.'], [['Three.', 'Fewer than it has.'], ['Eight.', 'One per register bit — no.']])] }),
      sec('pins', '2.2', 'Pins and the multiplexed bus', { eyebrow: 'Wires',
        body: `<p>To save pins the low address byte and the data share lines AD0–AD7. During T1 of a machine cycle they carry A0–A7 and the ${term('ALE')} (address latch enable) pulse tells an external 74LS373 latch to capture them; afterwards the same lines carry data. The high byte A8–A15 is on its own pins. Control signals: RD̅, WR̅, IO/M̅, S0, S1. Interrupts: TRAP, RST7.5, RST6.5, RST5.5, INTR.</p>`,
        worked: [step('Why is a latch needed?', '', { toc: 'Question' }), step('The lines AD0–AD7 carry the low address only briefly (T1). The latch holds it stable while the lines switch to carrying data.', '', { hero: true, toc: 'Answer' })],
        qs: [q('ale', 'What does ALE tell the external latch?', ['“The lines AD0–AD7 now carry the low address byte — capture it.”', 'After ALE falls they carry data.'], [['Start a read.', 'That is RD̅.'], ['Reset the CPU.', 'Unrelated.']])] }),
      sec('iset', '2.3', 'Instruction set groups and formats', { eyebrow: 'What it can do',
        body: `<p>Data transfer (MOV, MVI, LDA, STA, LXI, LDAX, PUSH, POP), arithmetic (ADD, ADI, SUB, INR, DCR, INX, DAD, DAA), logic (ANA, ORA, XRA, CMP, rotates), branch (JMP, conditional jumps, CALL, RET) and machine control (HLT, NOP, EI, DI). Instructions are 1, 2 or 3 bytes: opcode only; opcode + 8-bit data; opcode + 16-bit address or data.</p>`,
        figs: [lab('cpu8085', { program: 'MVI A,05H\nMOV B,A\nLXI H,2050H\nMOV M,B\nHLT', memory: '', watch: '2050' }, 'One-, two- and three-byte instructions: look at the machine-code column.', ['A', 'B', 'm2050'], { caption: 'instruction lengths', name: 'len' })],
        qs: [q('len', 'How many bytes is LXI H,2050H?', ['3 — opcode 21H plus the two address bytes 50H, 20H.', 'Low byte first (little-endian).'], [['2.', 'That is MVI.'], ['1.', 'That is MOV.']])] }),
      sec('modes', '2.4', 'Addressing modes', { eyebrow: 'Finding operands',
        body: `<p>Immediate (MVI B,05H), register (MOV A,B), direct (LDA 2050H), register indirect (MOV A,M — HL points to the byte), and implied (CMA, RAL act on A). Four of the five are visible in the program above.</p>`,
        qs: [q('ind', 'MOV A,M uses which addressing mode?', ['Register indirect — HL holds the address.', 'M stands for the memory byte HL points at.'], [['Immediate.', 'No value is in the instruction.'], ['Direct.', 'No address is in the instruction.']])] }),
      sec('timing', '2.5', 'Instruction cycle, machine cycle, T-state', { eyebrow: 'Timing',
        body: `<p>A ${term('T-state')} is one clock period. A ${term('machine cycle')} (opcode fetch, memory read/write, I/O read/write) takes 3–6 T-states; an ${term('instruction cycle')} is one to five machine cycles. The opcode fetch is 4 T-states (T1 address out + ALE, T2 RD̅, T3 read, T4 decode). At 3 MHz, T = 1/(3×10⁶) = 0.333 µs, so a 4-T instruction takes 1.33 µs.</p>`,
        worked: [step('LDA 2050H takes 4 machine cycles (opcode fetch, two operand reads, data read).', '', { toc: 'Cycles' }), step('T-states: 4 + 3 + 3 + 3 = 13. At 3 MHz: 13 × 0.333 µs.', '13/3\\approx4.33\\ \\mu\\text{s}', { hero: true, toc: 'Time' })],
        figs: [dia(`mode: sequence
[8085] as c
[Latch] as l
[Memory] as m
c -> l : T1: address A0-A7 on AD0-AD7, ALE high
c -> m : T1: address A8-A15
c -> m : T2: RD goes low
m --> c : T3: opcode on the data bus
c -> c : T4: decode`, 'The opcode fetch machine cycle.', { caption: 'opcode fetch timing' })],
        probs: [pr('p-t', '<p>The default program in the figure below adds two bytes. How many T-states does it take, and how long at 3 MHz?</p>', `The simulator totals <b>${r.tstates}</b> T-states → ${(Number(r.tstates) / 3).toFixed(2)} µs at 3 MHz.`, { verify: lab('cpu8085', {}, 'Run to the end and read the T-state counter.', ['tstates', 'A'], { caption: 'answer', name: 'ans' }) })],
        qs: [q('ts', 'How many T-states does an opcode fetch take on the 8085?', ['4.', 'T1 address, T2 read strobe, T3 data, T4 decode.'], [['3.', 'That is a memory read.'], ['6.', 'That is for CALL-type cycles.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>8085: A, B–L, PC, SP, five flags; 16-bit address, 8-bit data multiplexed with A0–A7.</li><li>Opcode fetch = 4 T-states; time = T-states / f.</li></ul>` }),
    ],
  })
}
