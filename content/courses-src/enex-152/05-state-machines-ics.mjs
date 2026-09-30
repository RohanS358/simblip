import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const spec = 'start: q0\naccept: q2\nq0,0 -> q0\nq0,1 -> q1\nq1,0 -> q0\nq1,1 -> q2\nq2,0 -> q0\nq2,1 -> q2'
  const d1 = run('dfa', { spec, input: '0110111' })
  const d2 = run('dfa', { spec, input: '0101' })
  return lesson({
    title: 'State machines and logic families',
    kicker: 'ENEX 152 · Digital Logic · Sequential Machine Design and Digital ICs',
    subtitle: 'Turn a behaviour described in words into states, a transition table and finally flip-flops and gates — then meet the silicon it runs on.',
    sections: [
      sec('fsm', '5.1', 'Finite state machines', { eyebrow: 'Behaviour as states',
        body: `<p>A ${term('finite state machine')} has a set of states, inputs, a next-state rule and outputs. In a <b>Moore</b> machine the output depends only on the state; in a <b>Mealy</b> machine on state <i>and</i> input (so it can react a clock earlier and may need fewer states). A state diagram draws states as circles and transitions as labelled arrows.</p>`,
        qs: [q('mm', 'In a Moore machine the output depends on…', ['The current state only.', 'Mealy adds the input.'], [['The current input only.', 'That is combinational.'], ['The previous output.', 'Not the definition.']])] }),
      sec('seq', '5.2', 'A sequence detector', { eyebrow: 'Recognise “11”',
        body: `<p>Design a detector that raises its output when the input ends in <b>11</b>. States: q0 (no progress), q1 (last bit was a 1), q2 (saw 11). On input 1 move forward (q0→q1→q2, and q2 stays); on input 0 fall back to q0. The machine accepts <b>${d1.accepted}</b> for 0110111 (final ${d1.final}) and <b>${d2.accepted}</b> for 0101 (final ${d2.final}).</p>`,
        figs: [lab('dfa', { spec, input: '0110111' }, 'Step through the string; the machine lives in q2 only after two 1s in a row.', ['accepted', 'final'], { caption: 'ends in 11', name: 'sd' })],
        qs: [q('ov', 'With overlapping detection, after seeing “111” the machine should be in…', ['The accepting state q2.', 'The last two bits are still 11.'], [['q0.', 'That would forget the 1s.'], ['q1.', 'q2 already holds “11”.']])] }),
      sec('design', '5.3', 'From diagram to circuit', { eyebrow: 'The design recipe',
        body: `<p>1) Draw the state diagram. 2) Assign binary codes to states (n flip-flops for up to 2ⁿ states). 3) Write the state table: present state, input → next state, output. 4) Use each flip-flop’s excitation table to get input equations; simplify them with K-maps. 5) Draw the circuit and check unused states go somewhere safe.</p>`,
        figs: [dia(`direction: down
(Word description) as a
[State diagram] as b
[State table] as c
[Assign state codes] as d
[Flip-flop input equations + K-maps] as e
[Circuit: flip-flops + gates] as f
a -> b
b -> c
c -> d
d -> e
e -> f
@0 a -> b
@1 b -> c
@2 c -> d
@3 d -> e
@4 e -> f
loop 2`, 'Each step refines the previous one.', { caption: 'FSM design flow' })],
        worked: [step('A machine has 5 states. Flip-flops needed:', '', { toc: 'States' }), step('2² = 4 < 5 ≤ 8 = 2³.', '\\lceil\\log_2 5\\rceil=3', { hero: true, toc: 'Answer' })],
        qs: [q('ff', 'Minimum flip-flops for a 9-state machine:', ['4.', '2³ = 8 < 9 ≤ 16.'], [['3.', 'Only 8 codes.'], ['9.', 'Binary coding needs far fewer.']])],
        probs: [pr('p-ff', '<p>A traffic-light controller has 6 states. How many flip-flops with binary coding, and how many codes are unused?</p>', '3 flip-flops; 2³ − 6 = <b>2 unused</b> codes (design them to return to a valid state).')] }),
      sec('ttl', '5.4', 'Logic families and their numbers', { eyebrow: 'Real chips',
        body: `<p>Gates are built in families. <b>TTL</b> (bipolar, 5 V) is fast but power-hungry; <b>CMOS</b> (complementary MOSFETs) uses almost no power except when switching and is the basis of all modern chips. Key figures: propagation delay (how long an output takes to change), power dissipation, <b>noise margin</b> (NM = V<sub>IH</sub> − V<sub>OH</sub> style gap between output and input thresholds) and <b>fan-out</b> (how many inputs one output can drive).</p>`,
        worked: [step('A gate outputs at least 4.0 V for a 1 and the next gate accepts any input ≥ 3.5 V as 1.', '', { toc: 'Levels' }), step('High-level noise margin = V_OH(min) − V_IH(min).', 'NM_H=4.0-3.5=0.5\\ \\text{V}', { hero: true, toc: 'Margin' })],
        qs: [q('nm', 'A larger noise margin means the circuit…', ['Tolerates more noise before misreading a bit.', 'Safer signalling.'], [['Runs faster.', 'Unrelated.'], ['Uses less power.', 'Unrelated.']])] }),
      sec('cmos', '5.5', 'CMOS inverter and NAND', { eyebrow: 'Switches in pairs',
        body: `<p>A CMOS inverter is a PMOS (pull-up to V<sub>DD</sub>) over an NMOS (pull-down to ground) sharing gate and output: input 0 turns the PMOS on, output 1; input 1 turns the NMOS on, output 0. Only one conducts in steady state, so static power is near zero; power is spent charging and discharging load capacitance: P = C·V²·f. A NAND puts two NMOS in series and two PMOS in parallel.</p>`,
        figs: [dia(`direction: down
[VDD] as v
[PMOS: on when input = 0] as p
[Output] as o
[NMOS: on when input = 1] as n
[Ground] as g
v -> p
p -> o
o -> n
n -> g
@0 v -> p
@1 p -> o : input 0 → out 1
loop 1`, 'With input 0 the PMOS connects the output to VDD.', { caption: 'CMOS inverter' })],
        worked: [step('C = 10 pF, V = 3.3 V, f = 50 MHz.', '', { toc: 'Data' }), step('Dynamic power P = C V² f.', 'P=10\\text{pF}\\cdot3.3^2\\cdot50\\text{MHz}=5.4\\ \\text{mW}', { hero: true, toc: 'Power' })],
        qs: [q('cp', 'Why does CMOS use almost no static power?', ['One transistor of the pair is always off.', 'No steady path from VDD to ground.'], [['It has no transistors.', 'It does.'], ['It is slower.', 'Not the reason.']])],
        probs: [pr('p-pw', '<p>Halving the supply voltage of a CMOS chip (same C and f) changes dynamic power by what factor?</p>', 'P ∝ V², so ÷4 — <b>one quarter</b>.')] }),
      sec('mem', '5.6', 'Programmable logic and memory', { eyebrow: 'Flexible hardware',
        body: `<p>Instead of wiring gates, load a configuration: a ROM is a look-up table (2ⁿ words of m bits implement any m functions of n inputs); a PLA/PAL programs AND and OR planes; an FPGA has thousands of small look-up tables and flip-flops joined by programmable routing. Memory: SRAM (flip-flop cell, fast, 6 transistors) vs DRAM (capacitor, dense, refreshed).</p>`,
        worked: [step('A 4-input look-up table stores one output bit for each input pattern.', '', { toc: 'Table' }), step('Number of bits stored: 2⁴.', '16', { hero: true, toc: 'Size' })],
        qs: [q('lut', 'A 6-input LUT can implement…', ['Any function of 6 variables.', 'It stores the full 64-row truth table.'], [['Only AND of 6 inputs.', 'It is fully general.'], ['Only sequential logic.', 'Combinational.']])] }),
    ],
  })
}
