import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'Memory, I/O interfacing and interrupts',
  kicker: 'ENEX 201 · Microprocessors · Chapters 4–6',
  subtitle: 'Connecting real chips to the bus so the processor reaches each one at exactly the right address.',
  sections: [
    sec('decode', '4.1', 'Address decoding', { eyebrow: 'Chip select',
      body: `<p>Each memory or I/O chip has a chip-select input; ${term('address decoding')} turns the high address lines into select signals so exactly one chip responds. ${term('Full (unique) decoding')} uses all the high lines, so each location has one address; ${term('partial (non-unique) decoding')} ignores some, so the chip appears at several addresses (simpler hardware). Decoders (74LS138 3-to-8) or NAND gates generate the selects.</p>`,
      figs: [dia(`direction: right
[A15 A14 A13] as hi #blue
[3-to-8 decoder] as dec #violet
[Y0 → ROM 0000-1FFF] as y0 #mint
[Y1 → RAM 2000-3FFF] as y1 #mint
[Y2 → PPI 4000-5FFF] as y2 #amber
hi -> dec
dec -> y0 : 000
dec -> y1 : 001
dec -> y2 : 010`, 'Three upper address lines pick one 8 KB block.', { caption: 'a decoder selects a chip' })],
      worked: [step('An 8 KB RAM (2000H–3FFFH) on an 8085. Which lines select it?', '', { toc: 'Question' }), step('8 KB = 2¹³, so A0–A12 go to the chip. The range 2000H–3FFFH has A15A14A13 = 001.', '\\text{A15 A14 A13}=0\\,0\\,1', { hero: true, toc: 'Select code' })],
      probs: [pr('p1', '<p>A 4 KB ROM must start at 4000H. What is its address range, and which address lines are decoded?</p>', '4 KB = 2¹² → 12 lines on the chip (A0–A11). Range <b>4000H–4FFFH</b>; A15–A12 = 0100 must be decoded.')],
      qs: [q('dec', 'Why must address decoding ensure only one chip responds?', ['Two chips driving the data bus at once would cause bus contention and corrupt data.', 'The decoder guarantees exclusive selection.'], [['To save memory.', 'Not the reason.'], ['To speed up the clock.', 'Unrelated.']])] }),
    sec('map', '4.2', 'Memory-mapped I/O versus I/O-mapped I/O', { eyebrow: 'Where are the devices?',
      body: `<p>In ${term('memory-mapped')} I/O a device lives in the memory address space, so ordinary instructions (MOV, LDA, STA) access it, at the cost of memory addresses. In ${term('I/O-mapped')} (isolated) I/O a separate 256-port space is reached by IN and OUT with the IO/M̅ line high; the memory map stays free.</p>`,
      qs: [q('io', 'Which instructions access an I/O-mapped device on the 8085?', ['IN port and OUT port.', 'They assert IO/M̅ so memory does not respond.'], [['LDA and STA.', 'Those are memory operations.'], ['PUSH and POP.', 'Those are stack operations.']])] }),
    sec('ppi', '4.3', 'Parallel interface: the 8255 PPI', { eyebrow: 'Ports',
      body: `<p>The 8255 gives three 8-bit ports (A, B, C) programmed through a control word. Mode 0: simple input/output; Mode 1: strobed I/O with handshake; Mode 2: bidirectional. Handshaking: the device signals “data ready”, the processor reads and acknowledges — needed when the two run at different speeds.</p>`,
      worked: [step('Program the 8255: port A output, port B input, port C output, Mode 0. Control word: D7 = 1 (mode set), D6–D5 = 00, D4 = 0 (A out), D3 = 0 (C upper out), D2 = 0, D1 = 1 (B in), D0 = 0 (C lower out).', '10000010_2 = 82H', { hero: true, toc: 'Control word' })],
      qs: [q('hs', 'Why use handshaking?', ['So fast and slow devices transfer data without loss.', 'Each side waits for the other’s signal.'], [['To increase the data width.', 'Unrelated.'], ['To avoid using ports.', 'It uses port lines.']])] }),
    sec('serial', '4.4', 'Serial interface', { eyebrow: 'One wire',
      body: `<p>Serial transmission sends bits one after another. ${term('Asynchronous')}: each character is framed by a start bit (0) and stop bit(s) (1) so the receiver re-synchronises every byte; ${term('synchronous')}: a continuous block with a shared clock or sync characters, more efficient. RS-232 defines voltage levels and a 9/25-pin connector; USB is the modern serial bus; the 8251 USART does the conversion. Baud 9600 with 8N1 frames (10 bits/char) moves 960 characters/s.</p>`,
      worked: [step('A link at 9600 baud sends 8 data bits, no parity, 1 stop bit (8N1).', '', { toc: 'Frame' }), step('Bits per character = 1 start + 8 data + 1 stop = 10, so characters per second = 9600/10.', '960\\ \\text{chars/s}', { hero: true, toc: 'Throughput' }), step('Efficiency = 8/10 = 80%.', '', { toc: 'Efficiency' })],
      qs: [q('start', 'What is the purpose of the start bit in asynchronous serial?', ['It marks the beginning of a character so the receiver can synchronise its clock.', 'The line idles high; the falling edge is the signal.'], [['It is the parity bit.', 'No.'], ['It carries data.', 'No.']])] }),
    sec('int', '5.1', 'Interrupts', { eyebrow: 'Attention, please',
      body: `<p>Polling asks the device repeatedly; an ${term('interrupt')} lets the device ask for attention, so the CPU does useful work meanwhile. The 8085 has five hardware interrupts in priority order: TRAP (non-maskable), RST7.5, RST6.5, RST5.5 and INTR; each RST has a fixed vector (RST7.5 → 003CH, 6.5 → 0034H, 5.5 → 002CH, TRAP → 0024H). EI/DI enable and disable maskable interrupts; SIM/RIM set and read the masks. Processing: finish the instruction, push PC, jump to the vector, run the service routine, RET/EI.</p>`,
      figs: [dia(`mode: sequence
[Main program] as p
[8085] as c
[ISR at vector] as i
p -> c : executing
c -> c : interrupt request, EI is on
c -> i : push PC, jump to vector
i -> i : service the device
i --> c : EI, RET
c --> p : resume at the pushed PC`, 'The interrupted program continues unaware.', { caption: '8085 interrupt processing' })],
      qs: [q('trap', 'Which 8085 interrupt cannot be masked?', ['TRAP.', 'It is non-maskable and highest priority.'], [['INTR.', 'Maskable by DI.'], ['RST5.5.', 'Maskable by the SIM mask.']])] }),
    sec('8086', '5.2', '8086 interrupts and the vector table', { eyebrow: '256 vectors',
      body: `<p>The 8086 supports 256 interrupt types. Type <i>n</i> has a 4-byte entry (IP then CS) at address 4n in the ${term('interrupt vector table')} occupying 0000H–03FFH. Sources: hardware (NMI type 2, INTR with type from the PIC), software (<code>INT n</code>) and exceptions (divide error type 0, single-step type 1, breakpoint type 3, overflow type 4). The 8259 PIC prioritises up to 8 (cascaded, 64) devices.</p>`,
      worked: [step('Where is the vector for interrupt type 21H?', '', { toc: 'Question' }), step('Address = 4 × 21H = 84H; the four bytes at 0084H–0087H hold IP then CS of the handler.', '4\\times21_{16}=84_{16}', { hero: true, toc: 'Vector address' })],
      probs: [pr('p2', '<p>Where in memory is the vector for INT 10H?</p>', '4 × 10H = <b>40H</b>: bytes 0040H–0043H.')],
      qs: [q('vec', 'How many bytes does one 8086 interrupt vector occupy?', ['4 (a 2-byte IP and a 2-byte CS).', 'The table has 256 × 4 = 1 KB.'], [['2.', 'That is only the offset.'], ['8.', 'Too many.']])] }),
    sec('adv', '6.1', 'Advanced topics: RISC, CISC, control, DSP', { eyebrow: 'Looking outward',
      body: `<p>Accumulator-based machines (8085) route every result through A; register-based machines (8086 and later) use many registers. Hardwired control is fast; microprogrammed control is flexible. RISC (few simple instructions, pipelined) versus CISC (many complex ones). Multitasking needs protection and memory management support; a digital signal processor adds hardware multiply–accumulate and Harvard buses for real-time filtering.</p>`,
      probs: [pr('p3', '<p>Give one reason a DSP uses a Harvard architecture.</p>', 'It can fetch an instruction and two data operands in the same cycle, sustaining one multiply–accumulate per cycle for filters.')],
      qs: [q('dsp', 'What operation do DSPs optimise above all?', ['Multiply–accumulate (MAC).', 'Filters and transforms are sums of products.'], [['String search.', 'Not specifically.'], ['Branching.', 'Not the focus.']])] }),
  ],
})
