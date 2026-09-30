import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const add = run('cpu8085', { program: 'LXI H,2050H\nMOV A,M\nINX H\nADD M\nINX H\nMOV M,A\nHLT', memory: '2050=25,17', watch: '2050,2051,2052' })
  const sum = run('cpu8085', { program: 'MVI B,5\nMVI A,0\nLOOP: ADD B\nDCR B\nJNZ LOOP\nHLT', memory: '', watch: '' })
  const bcd = run('cpu8085', { program: 'MVI A,38H\nADI 45H\nDAA\nHLT', memory: '', watch: '' })
  const big = run('cpu8085', { program: 'LDA 2050H\nMOV B,A\nLDA 2051H\nCMP B\nJNC DONE\nMOV A,B\nDONE: STA 2052H\nHLT', memory: '2050=25,17', watch: '2050,2051,2052' })
  const arr = run('cpu8085', { program: 'LXI H,2050H\nMVI C,04H\nMVI A,00H\nNEXT: ADD M\nINX H\nDCR C\nJNZ NEXT\nSTA 2060H\nHLT', memory: '2050=01,02,03,04', watch: '2050,2051,2052,2053,2060' })
  return lesson({
    title: '8085 assembly programming',
    kicker: 'ENEX 201 · Microprocessors · Chapter 2 (programs)',
    subtitle: 'Write it, assemble it, single-step it. Every program below runs in the simulator with real opcodes, flags and T-states.',
    sections: [
      sec('first', '2.7', 'Your first program: add two numbers', { eyebrow: 'Arithmetic',
        body: `<p>Memory holds 25H at 2050H and 17H at 2051H. Load HL with the address, fetch the first byte into A, step to the next, add it, step on, and store. Result <b>${add.m2052}H</b> at 2052H (25H + 17H = 3CH). No carry, so CY = <b>${add.CY}</b>.</p>`,
        figs: [lab('cpu8085', { program: 'LXI H,2050H\nMOV A,M\nINX H\nADD M\nINX H\nMOV M,A\nHLT', memory: '2050=25,17', watch: '2050,2051,2052' }, 'Watch HL walk along memory.', ['A', 'm2052', 'CY', 'tstates'], { caption: 'add two bytes', name: 'add' })],
        qs: [q('inx', 'Why INX H between the reads?', ['To advance the memory pointer HL to the next byte.', 'MOV A,M and ADD M always use the address in HL.'], [['To set the carry flag.', 'INX affects no flags.'], ['To halt.', 'That is HLT.']])] }),
      sec('loop', '2.8', 'Loops and conditions', { eyebrow: 'Repeating',
        body: `<p>A loop is a counter, a body and a conditional jump back. Sum 5+4+3+2+1: B counts down, A accumulates, <code>JNZ LOOP</code> repeats while the zero flag is clear. Result <b>${sum.A}H</b> (15), and on exit Z = <b>${sum.Z}</b>.</p>`,
        figs: [lab('cpu8085', { program: 'MVI B,5\nMVI A,0\nLOOP: ADD B\nDCR B\nJNZ LOOP\nHLT', memory: '', watch: '' }, 'DCR sets Z when B reaches 0; JNZ then falls through.', ['A', 'Z'], { caption: 'sum 1 to 5', name: 'loop' })],
        worked: [step('Unroll the loop: A = 0, then add B = 5, 4, 3, 2, 1.', '', { toc: 'Trace' }), step('0 + 5 + 4 + 3 + 2 + 1 = 15 = 0FH.', '15_{10} = 0F_{16}', { hero: true, toc: 'Result' })],
        qs: [q('jnz', 'JNZ LOOP jumps when…', ['The zero flag is 0 (last result was not zero).', 'So the loop ends when DCR makes B zero.'], [['The carry is 1.', 'That is JC.'], ['Z = 1.', 'That is JZ.']])] }),
      sec('cmp', '2.9', 'Comparison and branching', { eyebrow: 'Decisions',
        body: `<p>CMP r compares A with r without changing A: Z = 1 if equal, CY = 1 if A &lt; r. This program stores the larger of two numbers at 2052H: 25H vs 17H → <b>${big.m2052}H</b>. Decision-making is always “set flags, then conditional jump”.</p>`,
        figs: [lab('cpu8085', { program: 'LDA 2050H\nMOV B,A\nLDA 2051H\nCMP B\nJNC DONE\nMOV A,B\nDONE: STA 2052H\nHLT', memory: '2050=25,17', watch: '2050,2051,2052' }, 'CMP sets carry when A < B.', ['m2052', 'CY'], { caption: 'the larger of two', name: 'max' })],
        qs: [q('cy', 'After CMP B, when is CY = 1?', ['When A < B (unsigned).', 'The internal subtraction needed a borrow.'], [['When A = B.', 'That sets Z.'], ['When A > B.', 'CY = 0 then.']])] }),
      sec('arr', '2.10', 'Arrays and table processing', { eyebrow: 'Memory blocks',
        body: `<p>Sum four bytes at 2050H–2053H: HL points to the array, C counts four, A accumulates. Result <b>${arr.m2060}H</b> at 2060H (1+2+3+4 = 10 = 0AH). This “pointer + counter + loop” pattern handles any block.</p>`,
        figs: [lab('cpu8085', { program: 'LXI H,2050H\nMVI C,04H\nMVI A,00H\nNEXT: ADD M\nINX H\nDCR C\nJNZ NEXT\nSTA 2060H\nHLT', memory: '2050=01,02,03,04', watch: '2050,2051,2052,2053,2060' }, 'Four passes through the loop.', ['A', 'm2060', 'instructions'], { caption: 'sum a table', name: 'arr' })],
        qs: [q('ptr', 'In the array loop, what moves the pointer?', ['INX H.', 'HL advances one byte per pass.'], [['DCR C.', 'That counts passes.'], ['ADD M.', 'That adds the byte; it does not move HL.']])] }),
      sec('bcd', '2.11', 'BCD arithmetic and DAA', { eyebrow: 'Decimal on binary hardware',
        body: `<p>In BCD each decimal digit occupies a nibble. Adding 38 and 45 in plain binary gives 7DH, not the BCD 83. <code>DAA</code> (decimal adjust accumulator) fixes it: add 6 to a nibble above 9 or with auxiliary carry. Here 38H + 45H = 7DH → DAA → <b>${bcd.A}H</b> (= 83 decimal).</p>`,
        figs: [lab('cpu8085', { program: 'MVI A,38H\nADI 45H\nDAA\nHLT', memory: '', watch: '' }, 'Step past ADI and again past DAA.', ['A', 'CY'], { caption: 'BCD addition', name: 'bcd' })],
        probs: [pr('p-bcd', '<p>Add 99 and 01 in BCD on the 8085. What are A and CY afterwards?</p>', 'Binary: 99H + 01H = 9AH. DAA adds 66H → 00H with a carry out: <b>A = 00H, CY = 1</b> (the decimal 100).', { verify: lab('cpu8085', { program: 'MVI A,99H\nADI 01H\nDAA\nHLT', memory: '', watch: '' }, 'Run it.', ['A', 'CY'], { caption: 'answer', name: 'ans' }) })],
        qs: [q('daa', 'What does DAA do?', ['Corrects the accumulator after a binary addition of BCD digits.', 'It adds 6 to any nibble greater than 9.'], [['Doubles A.', 'No.'], ['Decrements A.', 'That is DCR.']])] }),
      sec('sub', '2.12', 'Subroutines and the stack', { eyebrow: 'Reuse',
        body: `<p>CALL pushes the return address on the stack (SP decreases by 2) and jumps; RET pops it. Always initialise SP first (LXI SP,…). PUSH/POP save registers around a call. The stack grows downward in memory.</p>`,
        figs: [lab('cpu8085', { program: 'LXI SP,3000H\nMVI A,7\nCALL DBL\nHLT\nDBL: ADD A\nRET', memory: '', watch: '' }, 'After CALL, SP has dropped by 2; after RET it is restored.', ['A'], { caption: 'call and return', name: 'call' })],
        qs: [q('sp', 'After CALL, the stack pointer…', ['Decreases by 2 (the return address is pushed).', 'The 8085 stack grows toward lower addresses.'], [['Increases by 2.', 'It grows downward.'], ['Is unchanged.', 'The return address is stored there.']])] }),
    ],
  })
}
