import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: '8086: BIU, EU, segments and assembly',
  kicker: 'ENEX 201 · Microprocessors · Chapter 3',
  subtitle: 'A 16-bit processor that fetches the next instruction while executing the current one — and reaches 1 MB with 16-bit registers.',
  sections: [
    sec('split', '3.1', 'BIU and EU', { eyebrow: 'Two units working at once',
      body: `<p>The 8086 is split into a ${term('Bus Interface Unit')} (BIU) that generates addresses, fetches instructions into a 6-byte ${term('queue')} and reads/writes memory, and an ${term('Execution Unit')} (EU) that decodes and executes from the queue. While the EU works on one instruction the BIU is already fetching the next: a two-stage pipeline. A jump empties the queue.</p>`,
      figs: [dia(`direction: right
[BIU: address generation, bus control] as biu #blue
[6-byte instruction queue] as q #amber
[EU: decoder, ALU, registers, flags] as eu #mint
[Memory] as mem #grey
mem -> biu : fetch next instructions
biu -> q : store
q -> eu : next instruction
eu -> biu : operand reads / writes
@0 mem -> biu : code
@1 biu -> q : bytes
@2 q -> eu : instruction
loop 4`, 'Fetch and execute overlap.', { caption: 'BIU and EU' })],
      qs: [q('queue', 'Why does a jump slow the 8086 down?', ['The prefetched bytes in the queue are the wrong ones and must be discarded.', 'The BIU restarts fetching from the new address.'], [['The ALU is slow.', 'Unrelated.'], ['Jumps use segment registers.', 'Not the reason.']])] }),
    sec('regs', '3.2', 'Registers', { eyebrow: 'Programmer’s view',
      body: `<p>General registers AX, BX, CX, DX (each splits into high/low bytes AH/AL…), pointers SP, BP, and index registers SI, DI; segment registers CS, DS, SS, ES; instruction pointer IP; and a flag register with carry, parity, auxiliary carry, zero, sign, overflow and the control flags trap, interrupt, direction. CX often counts loops; BX is a base address; DX holds I/O ports.</p>`,
      qs: [q('ax', 'AL is…', ['The low byte of AX.', 'AH and AL are its two halves.'], [['A segment register.', 'Those are CS, DS, SS, ES.'], ['The stack pointer.', 'That is SP.']])] }),
    sec('seg', '3.3', 'Segmented memory: a 20-bit address from 16-bit registers', { eyebrow: 'The key trick',
      body: `<p>16-bit registers reach only 64 KB, yet the 8086 addresses 1 MB. Every address is a <b>segment:offset</b> pair; the physical address is segment × 16 + offset (shift the segment left 4 bits and add). Code is fetched from CS:IP, data from DS:offset, the stack from SS:SP. Many pairs name the same byte: 2000:0010 and 2001:0000 are both 20010H.</p>`,
      worked: [step('Segment 2000H, offset 0050H.', '', { toc: 'Given' }), step('Physical = 2000H × 10H + 0050H.', '20000H + 0050H = 20050H', { hero: true, toc: 'Physical address' }), step('The same byte as 2005H:0000H, since 2005H × 10H = 20050H.', '', { toc: 'Aliasing' })],
      figs: [dia(`direction: right
[Segment register 2000H] as s #blue
[Shift left 4 bits: 20000H] as sh #violet
[Offset 0050H] as o #amber
[Adder] as a #mint
(Physical address 20050H) as p
s -> sh
sh -> a
o -> a
a -> p
@0 s -> sh : 2000H
@1 sh -> a : 20000H
@2 o -> a : +0050H
@3 a -> p : 20050H
loop 5`, 'Segment × 16 + offset.', { caption: 'forming a physical address' })],
      probs: [pr('p1', '<p>CS = 1234H, IP = 0020H. Physical address of the next instruction?</p>', '12340H + 0020H = <b>12360H</b>.'), pr('p2', '<p>How many bytes can one segment hold?</p>', 'The offset is 16 bits: 2¹⁶ = <b>64 KB</b>.')],
      qs: [q('seg', 'Physical address for segment 3000H and offset 0100H?', ['30100H.', '30000H + 0100H.'], [['3100H.', 'Forgot to multiply the segment by 16.'], ['300100H.', 'Shifted too far.']])] }),
    sec('modes', '3.4', 'Addressing modes', { eyebrow: 'Operands',
      body: `<p>Register (MOV AX,BX); immediate (MOV AX,1234H); direct (MOV AX,[2000H]); register indirect (MOV AX,[BX]); based (MOV AX,[BX+4]); indexed (MOV AX,[SI]); based-indexed (MOV AX,[BX+SI+8]). Memory operands default to the DS segment, except those using BP, which default to SS.</p>`,
      qs: [q('bp', 'Which segment register is used by default with [BP]?', ['SS (the stack segment).', 'BP normally addresses stack frames.'], [['DS.', 'That is for BX, SI, DI.'], ['CS.', 'That is for code.']])] }),
    sec('asm', '3.5', 'Assembly language, assembling and linking', { eyebrow: 'Writing programs',
      body: `<p>An assembly statement has label, mnemonic, operands and a comment. Directives (<code>SEGMENT</code>, <code>DB</code>, <code>DW</code>, <code>ASSUME</code>, <code>END</code>) guide the assembler but emit no instructions. The tool chain: editor → assembler (.ASM → .OBJ; a ${term('two-pass')} assembler builds the symbol table on pass 1 and emits code on pass 2) → linker (.OBJ → .EXE) → run. DOS services through <code>INT 21H</code> (AH = 09H prints a string, 4CH terminates) and <code>INT 10H</code> (video).</p>`,
      figs: [dia(`direction: right
[source.asm] as a #blue
[Assembler: pass 1 symbols, pass 2 code] as as #violet
[source.obj] as o #mint
[Linker] as l #violet
[program.exe] as e #amber
a -> as
as -> o
o -> l
l -> e
@0 a -> as : text
@1 as -> o : machine code
@2 o -> l : object
@3 l -> e : executable
loop 5`, 'From text to a running program.', { caption: 'the tool chain' })],
      qs: [q('pass', 'Why does an assembler need two passes?', ['Forward references: a jump may name a label defined later, so all labels must be known first.', 'Pass 1 records addresses, pass 2 uses them.'], [['To check spelling twice.', 'Not the reason.'], ['To link the file.', 'That is the linker.']])] }),
    sec('prog', '3.6', 'A first 8086 program, traced with the 8085 engine', { eyebrow: 'Ideas carry over',
      body: `<p>The same patterns — pointer, counter, loop, compare — apply on the 8086 with different mnemonics: <code>MOV CX,4</code>, <code>ADD AL,[SI]</code>, <code>INC SI</code>, <code>LOOP AGAIN</code> (decrements CX and jumps if non-zero). Practise the ideas on the simulator with the 8085 equivalent.</p>`,
      figs: [lab('cpu8085', { program: 'LXI H,2050H\nMVI C,03H\nMVI A,00H\nAGAIN: ADD M\nINX H\nDCR C\nJNZ AGAIN\nHLT', memory: '2050=0A,14,1E', watch: '2050,2051,2052' }, 'Sum three bytes: 0AH + 14H + 1EH = 3CH.', ['A'], { caption: 'the loop pattern', name: 'lp' })],
      worked: [step('8086 version of the same loop.', '', { toc: 'Code' }), step('MOV CX,3 / MOV SI,2050H / XOR AL,AL / AGAIN: ADD AL,[SI] / INC SI / LOOP AGAIN.', '', { hero: true, toc: 'Translation' })],
      qs: [q('loopins', 'The 8086 LOOP instruction…', ['Decrements CX and jumps if CX ≠ 0.', 'It folds the DCR + JNZ pair into one.'], [['Jumps unconditionally.', 'That is JMP.'], ['Increments CX.', 'It decrements.']])] }),
  ],
})
