import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const loop = 'MVI B,5\nMVI A,0\nLOOP: ADD B\nDCR B\nJNZ LOOP\nHLT'
  const l = run('cpu8085', { program: loop, memory: '', watch: '' })
  const call = run('cpu8085', { program: 'LXI SP,3000H\nMVI A,7\nCALL DBL\nHLT\nDBL: ADD A\nRET', memory: '', watch: '' })
  return lesson({
    title: 'Registers, stacks and addressing modes',
    kicker: 'ENCT 303 · Computer Organization and Architecture · Chapter 2',
    subtitle: 'Instructions are bit patterns; the CPU’s registers, flags and addressing modes decide what they can reach.',
    sections: [
      sec('regs', '2.1', 'Registers and flags', { eyebrow: 'Inside the CPU',
        body: `<p>Registers are the processor’s fastest memory. There are general-purpose ones, a ${term('program counter')}, a ${term('stack pointer')}, and a ${term('status register')} of flags set by the ALU: <b>zero</b> (result was 0), <b>sign</b> (negative), <b>carry</b> (unsigned overflow out of the top bit), <b>parity</b>, <b>auxiliary carry</b>. Conditional jumps test these flags.</p>`,
        figs: [lab('cpu8085', { program: 'MVI A,0FFH\nADI 01H\nHLT', memory: '', watch: '' }, 'FFH + 1 = 00H with carry out: Z = 1, CY = 1.', ['A', 'Z', 'CY'], { caption: 'flags after FFH + 1', name: 'flags' })],
        qs: [q('carry', 'After 0FFH + 01H in an 8-bit register, which flags are set?', ['Zero and carry.', 'The 8-bit result is 00H (zero), and a 1 was carried out of bit 7.'], [['Only sign.', 'The result is 00H, which is not negative.'], ['None — no overflow occurs.', 'Unsigned overflow is exactly what the carry flag reports.']])] }),
      sec('stack', '2.2', 'Stack organisation and reverse Polish notation', { eyebrow: 'LIFO',
        body: `<p>A ${term('stack')} grows in memory from the stack pointer: <b>push</b> writes then moves the pointer, <b>pop</b> moves back and reads. Calls push the return address; returns pop it. A stack machine evaluates ${term('reverse Polish notation')} directly: push operands, and each operator pops two and pushes the result. To evaluate (A+B)×C, write <code>A B + C ×</code> — no parentheses and no precedence rules needed.</p>`,
        figs: [lab('cpu8085', { program: 'LXI SP,3000H\nMVI A,7\nCALL DBL\nHLT\nDBL: ADD A\nRET', memory: '', watch: '' }, `CALL pushes the return address; RET pops it. A ends as ${call.A}H (7 doubled).`, ['A'], { caption: 'call and return', name: 'cr' })],
        worked: [step('Evaluate 3 4 + 2 × in RPN with a stack.', '', { toc: 'Expression' }), step('Push 3, push 4, then + pops both and pushes 7. Push 2; × pops 2 and 7, pushes 14.', '3\\ 4\\ +\\ \\to 7;\\quad 7\\ 2\\ \\times\\ \\to 14', { hero: true, toc: 'Stack trace' })],
        qs: [q('rpn', 'The RPN form of A × (B + C) is…', ['A B C + ×', 'Operands first, then operators in the order they are applied: B C + first, then multiply by A.'], [['A B × C +', 'That is (A×B)+C.'], ['× A + B C', 'That is prefix (Polish) notation.']])] }),
      sec('formats', '2.3', 'Instruction formats', { eyebrow: 'Encoding',
        body: `<p>An instruction word holds an ${term('opcode')} and zero to three operand fields. <b>Three-address</b> instructions (ADD R1,R2,R3) are compact in program length; <b>two-address</b> overwrite one source; <b>one-address</b> use an implicit accumulator; <b>zero-address</b> use the stack. Fewer addresses make each instruction shorter but need more instructions.</p>`,
        worked: [step('Compute X = (A+B)×(C+D) on each machine type.', '', { toc: 'Task' }), step('Three-address: ADD R1,A,B; ADD R2,C,D; MUL X,R1,R2 → 3 instructions. One-address (accumulator): LOAD A; ADD B; STORE T; LOAD C; ADD D; MUL T; STORE X → 7.', '3 \\text{ vs } 7', { hero: true, toc: 'Count' })],
        qs: [q('zero', 'Which format needs no operand fields for arithmetic instructions?', ['Zero-address (stack) — the operands are implicit on top of the stack.', 'Only push/pop name a memory address.'], [['One-address.', 'It names one operand; the accumulator is the other.'], ['Three-address.', 'Names everything.']])] }),
      sec('modes', '2.4', 'Addressing modes', { eyebrow: 'Finding the operand',
        body: `<p>How does an instruction say where its data is? ${term('Immediate')}: the value is in the instruction (MVI A,05H). ${term('Direct')}: the instruction holds the address (LDA 2050H). ${term('Register')}: the operand is in a register (MOV A,B). ${term('Register indirect')}: a register holds the address (MOV A,M uses HL). ${term('Indexed')}/${term('base-relative')}: address = register + offset, ideal for arrays. Each trades instruction length and speed for flexibility.</p>`,
        figs: [lab('cpu8085', { program: 'MVI A,05H\nLDA 2050H\nMOV B,A\nLXI H,2051H\nMOV C,M\nHLT', memory: '2050=0A;2051=0C', watch: '2050,2051' }, 'Immediate, direct, register and register-indirect in one program.', ['A', 'B', 'C'], { caption: 'four addressing modes', name: 'modes' })],
        qs: [q('indirect', 'Which mode makes stepping through an array easiest?', ['Register indirect or indexed — increment the register to move to the next element.', 'The instruction stays the same; only the register changes.'], [['Immediate.', 'The value is fixed in the instruction.'], ['Direct.', 'The address is fixed in the instruction.']])],
        probs: [pr('p-loop', `<p>What is left in A after <code>MVI B,5 / MVI A,0 / LOOP: ADD B / DCR B / JNZ LOOP</code>?</p>`, `The loop adds 5+4+3+2+1 = <b>${parseInt(l.A, 16)}</b> (= ${l.A}H) and exits when B reaches zero (Z = ${l.Z}).`, { verify: lab('cpu8085', { program: loop, memory: '', watch: '' }, 'The loop, run.', ['A', 'Z'], { caption: 'answer', name: 'ans' }) })] }),
      sec('interrupts', '2.5', 'Interrupts', { eyebrow: 'Breaking the flow',
        body: `<p>An ${term('interrupt')} diverts the CPU to an ${term('interrupt service routine')} (ISR) when a device needs attention, an error occurs, or a timer fires. Between instructions the CPU checks for one; if accepted it saves the program counter and flags, jumps to the ISR (found through a vector table), runs it, and returns to exactly where it left off.</p>`,
        figs: [dia(`mode: sequence
[Program] as p
[CPU] as c
[ISR] as i
p -> c : executing instruction n
c -> c : interrupt pending? yes
c -> i : save PC + flags, jump to vector
i --> c : service device, return
c --> p : resume at instruction n+1`, 'The interrupted program never notices.', { caption: 'interrupt handling' })],
        qs: [q('when', 'When is an interrupt normally accepted?', ['Between instructions, never in the middle of one.', 'That keeps the machine state consistent so the program can resume cleanly.'], [['Immediately, even mid-instruction.', 'Half-finished instructions would corrupt state.'], ['Only at program end.', 'Then interrupts would be useless.']])] }),
      sec('summary', '2.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Flags record ALU outcomes; jumps read them.</li><li>Stacks serve calls, returns and RPN evaluation.</li><li>Fewer address fields mean shorter instructions but more of them.</li><li>Addressing modes choose how an operand is found.</li></ul>` }),
    ],
  })
}
