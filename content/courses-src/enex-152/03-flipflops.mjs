import { lesson } from '../kit.mjs'
export default ({ dia, scr, q, pr, step, sec, term }) => lesson({
  title: 'Latches and flip-flops',
  kicker: 'ENEX 152 · Digital Logic · Sequential Logic Circuits',
  subtitle: 'Combinational logic has no memory. Feed an output back to an input and you get a circuit that remembers.',
  sections: [
    sec('seq', '3.1', 'Memory from feedback', { eyebrow: 'Sequential vs combinational',
      body: `<p>A combinational output depends only on the present inputs. A ${term('sequential')} circuit’s output also depends on its <i>state</i> — what happened before — stored in latches or flip-flops. The simplest memory is two cross-coupled NOR (or NAND) gates: each output feeds the other’s input, so the pair holds whichever state it was last pushed into.</p>`,
      qs: [q('mem', 'What distinguishes a sequential circuit?', ['Its output depends on stored state, not only current inputs.', 'It has memory.'], [['It uses more gates.', 'Not the definition.'], ['It has no clock.', 'Many have one.']])] }),
    sec('sr', '3.2', 'The SR latch', { eyebrow: 'Set and Reset',
      body: `<p>Inputs S (set) and R (reset): S = 1 forces Q = 1; R = 1 forces Q = 0; S = R = 0 <b>holds</b> the previous Q; S = R = 1 is forbidden (both outputs collapse, and releasing both at once is unpredictable). Toggle S and R below and watch Q remember.</p>`,
      figs: [scr(`var s = create("input", { value: 0, name: "S" });
var r = create("input", { value: 0, name: "R" });
var l = create("sr-latch", { name: "SR" });
var q = create("output", { name: "Q" });
connect(s.out, l.s, "wire");
connect(r.out, l.r, "wire");
connect(l.q, q.in, "wire");
var s_s = create("slider", { min: 0, max: 1, step: 1, value: 0, label: "S", targetObjectId: s, targetParamName: "value" });
var s_r = create("slider", { min: 0, max: 1, step: 1, value: 0, label: "R", targetObjectId: r, targetParamName: "value" });`, 'Pulse S to 1 then back to 0: Q stays 1.', { caption: 'SR latch' })],
      worked: [step('Start with Q = 0. Set S = 1, R = 0 → Q = 1. Return S to 0.', '', { toc: 'Set' }), step('With S = R = 0 the latch holds Q = 1: memory.', 'Q=1', { hero: true, toc: 'Hold' })],
      qs: [q('sr11', 'Which SR input combination is forbidden?', ['S = 1 and R = 1.', 'Both outputs are forced the same way.'], [['S = 0 and R = 0.', 'That is the hold state.'], ['S = 1 and R = 0.', 'That is set.']])] }),
    sec('d', '3.3', 'Gated latch and the D flip-flop', { eyebrow: 'Clocked storage',
      body: `<p>A <b>D latch</b> is transparent while the enable is high — its output follows D. A <b>D flip-flop</b> is edge-triggered: it samples D only at the clock’s rising edge and holds it until the next. Edge triggering makes whole systems predictable: every flip-flop changes at the same instant.</p>`,
      figs: [scr(`var d = create("input", { value: 1, name: "D" });
var c = create("clock", { f: 1, name: "CLK" });
var ff = create("d-ff", { name: "D-FF" });
var q = create("output", { name: "Q" });
connect(d.out, ff.d, "wire");
connect(c.out, ff.clk, "wire");
connect(ff.q, q.in, "wire");
var s_d = create("slider", { min: 0, max: 1, step: 1, value: 1, label: "D", targetObjectId: d, targetParamName: "value" });`, 'Change D between clock edges: Q only follows on a rising edge.', { caption: 'D flip-flop' })],
      qs: [q('edge', 'A D flip-flop updates Q…', ['Only at the active clock edge.', 'Between edges D is ignored.'], [['Whenever D changes.', 'That is a latch.'], ['Only when reset.', 'No.']])] }),
    sec('jkt', '3.4', 'JK and T flip-flops', { eyebrow: 'More behaviours',
      body: `<table><thead><tr><th>J K</th><th>Next Q</th></tr></thead><tbody><tr><td>0 0</td><td>Q (hold)</td></tr><tr><td>0 1</td><td>0 (reset)</td></tr><tr><td>1 0</td><td>1 (set)</td></tr><tr><td>1 1</td><td>Q′ (toggle)</td></tr></tbody></table><p>The JK fixes the forbidden state by making 1,1 toggle. Tie J and K together and you get a T flip-flop: T = 1 toggles every clock, which <b>halves the frequency</b>.</p>`,
      worked: [step('A T flip-flop with T = 1 is clocked at 8 MHz.', '', { toc: 'Input' }), step('Q toggles once per clock, so one full Q cycle takes two clocks.', 'f_Q=\\tfrac{8}{2}=4\\ \\text{MHz}', { hero: true, toc: 'Output' })],
      qs: [q('tog', 'J = K = 1 makes a JK flip-flop…', ['Toggle on each clock.', 'Next Q = Q′.'], [['Hold.', 'That is 0 0.'], ['Reset.', 'That is 0 1.']])],
      probs: [pr('p-t', '<p>Three T flip-flops (T = 1) are cascaded, each clocked by the previous output, starting from a 24 MHz clock. Frequency at the last output?</p>', '24 → 12 → 6 → <b>3 MHz</b> (÷8).')] }),
    sec('time', '3.5', 'Setup and hold time', { eyebrow: 'Timing',
      body: `<p>D must be stable for a <b>setup time</b> before the clock edge and a <b>hold time</b> after it, or the flip-flop may go metastable (neither 0 nor 1 for a while). The clock period must cover clock-to-Q delay + logic delay + setup time.</p>`,
      worked: [step('t_cq = 2 ns, logic = 8 ns, setup = 1 ns.', '', { toc: 'Delays' }), step('Minimum period = 11 ns, so f_max ≈ 91 MHz.', 'T_{min}=11\\ \\text{ns}', { hero: true, toc: 'Period' })],
      qs: [q('su', 'Violating setup time can cause…', ['Metastability / a wrong stored value.', 'D changed too close to the edge.'], [['Extra power only.', 'Function fails first.'], ['Nothing.', 'It is a real failure mode.']])] }),
    sec('tbl', '3.6', 'Characteristic tables and excitation', { eyebrow: 'Design tools',
      body: `<p>The <b>characteristic equation</b> gives the next state: D: Q⁺ = D; T: Q⁺ = T⊕Q; JK: Q⁺ = JQ′ + K′Q. The <b>excitation table</b> runs the other way: given the wanted transition Q → Q⁺, what inputs are needed? For JK, 0→1 needs J = 1 (K = X); 1→0 needs K = 1 (J = X). Used when designing counters and state machines.</p>`,
      qs: [q('ex', 'A JK flip-flop must go 0 → 1. Which inputs work?', ['J = 1, K = don’t-care.', 'Set or toggle both give 1.'], [['J = 0, K = 1.', 'That resets.'], ['J = 0, K = 0.', 'That holds 0.']])] }),
  ],
})
