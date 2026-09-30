import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'Hardwired and microprogrammed control',
  kicker: 'ENCT 303 · Computer Organization and Architecture · Chapter 3',
  subtitle: 'The control unit turns an opcode into the exact sequence of signals that move data through the machine.',
  sections: [
    sec('micro', '3.1', 'Micro-operations', { eyebrow: 'The smallest steps',
      body: `<p>An instruction is carried out as a sequence of ${term('micro-operations')}, each a register-transfer that fits in one clock. Fetch, for example, is: MAR ← PC; MDR ← Memory[MAR]; IR ← MDR; PC ← PC + 1. A ${term('control word')} is the set of signals (which register loads, which bus is driven, what the ALU does) asserted in one step.</p>`,
      figs: [dia(`direction: right
[PC] as pc #blue
[MAR] as mar #violet
[Memory] as mem #mint
[MDR] as mdr #violet
[IR] as ir #amber
pc -> mar : T1: MAR ← PC
mar -> mem : T2: read
mem -> mdr : MDR ← M[MAR]
mdr -> ir : T3: IR ← MDR
@0 pc -> mar : PC
@1.2 mar -> mem : address
@2.4 mem -> mdr : data
@3.6 mdr -> ir : opcode
loop 5`, 'Four micro-operations make up instruction fetch.', { caption: 'instruction fetch' })],
      qs: [q('ctl', 'What is a control word?', ['The bundle of control signals asserted during one micro-operation step.', 'Each bit enables a register load, selects a bus source or picks an ALU function.'], [['The opcode.', 'The opcode chooses which sequence of control words to issue.'], ['The data being processed.', 'Data travels on the data path; control words steer it.']])] }),
    sec('hard', '3.2', 'Hardwired control', { eyebrow: 'Logic gates',
      body: `<p>A ${term('hardwired')} control unit generates signals with combinational logic: a step counter decoded to timing signals T1, T2…, an opcode decoder, and gates that AND them together (e.g. “load IR = T3”). It is very fast, but changing the instruction set means redesigning the logic — the usual choice for RISC.</p>`,
      qs: [q('hw', 'Main advantage of hardwired control?', ['Speed — signals come straight out of gates with no memory lookup.', 'The price is that it is hard to modify.'], [['Easy to change.', 'That is the microprogrammed advantage.'], ['Needs less hardware.', 'Complex instruction sets need a lot of logic.']])] }),
    sec('mp', '3.3', 'Microprogrammed control', { eyebrow: 'A computer inside the computer',
      body: `<p>In a ${term('microprogrammed')} unit the control words are stored in a fast ${term('control memory')}. Each instruction’s opcode selects the start of a ${term('microroutine')}; a ${term('micro-program counter')} steps through it, reading one ${term('microinstruction')} per clock and sending its bits to the data path. A microinstruction also says what comes next: fall through, jump, or branch on a condition flag. Changing or extending the instruction set is just rewriting the microcode (Wilkes’ original idea), which is why CISC machines use it.</p>`,
      figs: [dia(`direction: right
[Instruction register (opcode)] as ir #blue
[Mapping: opcode → start address] as map #amber
[Micro-program counter] as upc #violet
[Control memory] as cm #mint
[Control word → data path] as cw #rose
ir -> map
map -> upc : load
upc -> cm : address
cm -> cw : microinstruction
cm --> upc : next address / branch
@0 ir -> map : opcode
@1.2 map -> upc : start address
@2.4 upc -> cm : µPC
@3.6 cm -> cw : control word
loop 5`, 'Each clock reads one microinstruction.', { caption: 'microprogrammed control unit' })],
      worked: [step('A machine has 64 micro-routines of at most 16 microinstructions each and 40 control signals.', '', { toc: 'Given' }), step('Control memory holds 64 × 16 = 1024 words. Each word carries the 40 signals plus a next-address field of ⌈log₂1024⌉ = 10 bits.', '1024\\times(40+10)=51200\\ \\text{bits}', { hero: true, toc: 'Size' })],
      qs: [q('mpadv', 'Why do CISC designers like microprogramming?', ['New or complex instructions are added by writing microcode, not redesigning logic.', 'Flexibility is bought with an extra memory lookup per step.'], [['It is the fastest method.', 'Hardwired is faster.'], ['It needs no memory.', 'It needs a control store.']])] }),
    sec('horiz', '3.4', 'Horizontal and vertical microcode', { eyebrow: 'Encoding',
      body: `<p>${term('Horizontal')} microinstructions give every control signal its own bit: wide, fast, highly parallel. ${term('Vertical')} ones encode the signals in fields (like opcodes) and need decoders: narrow but slower. Real designs mix them.</p>`,
      qs: [q('wide', 'A horizontal microinstruction is…', ['Wide, with one bit per control signal.', 'That allows many micro-operations in the same clock.'], [['Narrow and encoded.', 'That is vertical.'], ['Stored in the main memory.', 'It lives in control memory.']])] }),
    sec('seq', '3.5', 'Sequencing the microprogram', { eyebrow: 'What runs next',
      body: `<p>After each microinstruction the next address comes from: the incremented µPC (most steps), a jump field, a conditional branch on a flag, a mapping from the opcode (at the start), or a stack for microsubroutines. Address generation is the control unit’s own program counter logic.</p>`,
      figs: [dia(`direction: down
(Fetch microroutine) as f
[Map opcode to start] as m
<Condition met?> as c
[µPC ← branch target] as b
[µPC ← µPC + 1] as n
(Execute next microinstruction) as e
f -> m
m -> c
c -> b : yes
c -> n : no
b -> e
n -> e`, 'A conditional microbranch.', { caption: 'microinstruction sequencing' })],
      qs: [q('next', 'Which source normally supplies the next microaddress?', ['µPC + 1.', 'Most microinstructions simply fall through to the next word.'], [['A random number.', 'No.'], ['The data bus.', 'Not normally.']])] }),
    sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Instructions = sequences of micro-operations; a control word drives one step.</li><li>Hardwired: fast, rigid. Microprogrammed: flexible, a bit slower.</li><li>Horizontal = wide and parallel; vertical = narrow and encoded.</li></ul>` }),
  ],
})
