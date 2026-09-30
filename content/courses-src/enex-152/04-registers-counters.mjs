import { lesson } from '../kit.mjs'
export default ({ dia, scr, q, pr, step, sec, term }) => lesson({
  title: 'Registers and counters',
  kicker: 'ENEX 152 · Digital Logic · Registers and Counters',
  subtitle: 'Line up flip-flops and you can store a word, shift it, or count with it.',
  sections: [
    sec('reg', '4.1', 'Registers', { eyebrow: 'Storing a word',
      body: `<p>An n-bit register is n D flip-flops sharing one clock: on each clock edge all bits load in parallel. A <b>load-enable</b> input decides whether the register takes new data or holds. Registers are how a CPU keeps values between steps.</p>`,
      worked: [step('A 16-bit register has how many flip-flops?', '', { toc: 'Count' }), step('One per bit.', '16', { hero: true, toc: 'Answer' })],
      qs: [q('ld', 'Without a load-enable, a register built from D flip-flops would…', ['Take new data on every clock edge.', 'It could not hold a value.'], [['Hold forever.', 'D is sampled each edge.'], ['Never change.', 'It changes each edge.']])] }),
    sec('shift', '4.2', 'Shift registers', { eyebrow: 'Moving bits',
      body: `<p>Connect each flip-flop’s Q to the next one’s D: on every clock edge the word shifts one place. Serial-in/serial-out delays data by n clocks; serial-in/parallel-out turns a bit stream into a word (and the reverse converts parallel to serial, used in UART/SPI). Shifting left multiplies by 2; right divides by 2.</p>`,
      figs: [scr(`var d = create("input", { value: 1, name: "SIN" });
var c = create("clock", { f: 1, name: "CLK" });
var r = create("register4", { name: "SHIFT" });
var o = create("output", { name: "SOUT" });
connect(d.out, r.sin, "wire");
connect(c.out, r.clk, "wire");
connect(r.sout, o.in, "wire");
var s_d = create("slider", { min: 0, max: 1, step: 1, value: 1, label: "SIN", targetObjectId: d, targetParamName: "value" });`, 'A bit entered now comes out four clocks later.', { caption: '4-bit shift register' })],
      worked: [step('1011 shifted left by one (new bit 0).', '', { toc: 'Shift' }), step('0110 → value doubles, dropping the old top bit.', '10110_2\\to 0110_2', { hero: true, toc: 'Result' })],
      qs: [q('dly', 'A 4-bit serial-in serial-out shift register delays a bit by…', ['4 clock cycles.', 'One per stage.'], [['1 clock cycle.', 'Only one stage.'], ['No delay.', 'It always delays.']])],
      probs: [pr('p-sh', '<p>The byte 0011 0100 (52) is shifted left two places, zero-filled. Value?</p>', 'Shifting left by 2 multiplies by 4: 52 × 4 = <b>208</b> = 1101 0000.')] }),
    sec('async', '4.3', 'Asynchronous (ripple) counters', { eyebrow: 'Count in binary',
      body: `<p>Chain T flip-flops (T = 1) so each one clocks the next: the first toggles every clock, the second every two, and so on — the outputs count in binary. An n-bit counter has 2ⁿ states and its top bit runs at f/2ⁿ. Drawback: the change ripples through, so outputs briefly show wrong values (glitches) and the max clock is limited by the delay of n stages.</p>`,
      figs: [scr(`var c = create("clock", { f: 1, name: "CLK" });
var k = create("counter4", { mod: "16", dir: "0", name: "CNT" });
var q0 = create("output", { name: "Q0" });
var q1 = create("output", { name: "Q1" });
var q2 = create("output", { name: "Q2" });
var q3 = create("output", { name: "Q3" });
connect(c.out, k.clk, "wire");
connect(k.q0, q0.in, "wire");
connect(k.q1, q1.in, "wire");
connect(k.q2, q2.in, "wire");
connect(k.q3, q3.in, "wire");`, 'Q0 is half the clock, Q1 a quarter, and so on.', { caption: '4-bit counter' })],
      worked: [step('A 4-bit counter is clocked at 1600 Hz. Frequency of Q3 (the top bit):', '', { toc: 'Divide' }), step('1600 ÷ 2⁴.', '100\\ \\text{Hz}', { hero: true, toc: 'Answer' })],
      qs: [q('mod', 'An n-bit binary counter has how many states?', ['2ⁿ.', 'Counts 0 to 2ⁿ − 1.'], [['n.', 'Far too few.'], ['n².', 'No.']])] }),
    sec('sync', '4.4', 'Synchronous counters', { eyebrow: 'One clock for all',
      body: `<p>In a synchronous counter every flip-flop shares the clock and logic decides which toggle: bit k toggles when all lower bits are 1. No ripple, so it is faster and glitch-free at the cost of a few AND gates. Up/down counting just changes that logic.</p>`,
      qs: [q('sy', 'Why is a synchronous counter faster than a ripple counter?', ['All flip-flops change on the same clock edge.', 'No ripple delay.'], [['It uses fewer flip-flops.', 'Same number.'], ['It has no clock.', 'It does.']])] }),
    sec('modn', '4.5', 'Modulo-N counters', { eyebrow: 'Counting to a chosen number',
      body: `<p>To count 0…N−1, detect the state N and immediately reset (asynchronous clear) or load 0 (synchronous). A decade (mod-10) counter detects 1010 (10) and resets to 0000. Number of flip-flops needed: n = ⌈log₂ N⌉.</p>`,
      worked: [step('A mod-60 counter for seconds. Flip-flops needed:', '', { toc: 'Bits' }), step('2⁵ = 32 < 60 ≤ 64 = 2⁶, so six flip-flops.', '\\lceil\\log_2 60\\rceil=6', { hero: true, toc: 'Answer' })],
      qs: [q('dec', 'A mod-10 counter needs at least how many flip-flops?', ['4.', '2³ = 8 < 10 ≤ 16.'], [['3.', 'Only 8 states.'], ['10.', 'Not one per state.']])],
      probs: [pr('p-mod', '<p>A 1 MHz clock drives a mod-1000 counter built from mod-10 stages. Output frequency?</p>', '1 MHz ÷ 1000 = <b>1 kHz</b>.')] }),
    sec('ring', '4.6', 'Ring and Johnson counters', { eyebrow: 'Shift registers that loop',
      body: `<p>A <b>ring counter</b> circulates a single 1 round an n-bit shift register: n states, and each state is decoded by one bit (no logic). A <b>Johnson</b> (twisted-ring) counter feeds back the <i>inverted</i> last output, giving 2n states with the same flip-flops.</p>`,
      worked: [step('A 4-bit Johnson counter from 0000: 0000 → 1000 → 1100 → 1110 → 1111 → 0111 → 0011 → 0001 → 0000.', '', { toc: 'Sequence' }), step('That is 8 states from 4 flip-flops.', '2n=8', { hero: true, toc: 'Count' })],
      qs: [q('jc', 'An n-bit Johnson counter has how many states?', ['2n.', 'Inverted feedback doubles the ring.'], [['n.', 'That is the ring counter.'], ['2ⁿ.', 'That is a binary counter.']])] }),
  ],
})
