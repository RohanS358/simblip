import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Multiplexing, spread spectrum and switching',
  kicker: 'ENCT 253 · Data Communication · Chapter 5',
  subtitle: 'How many conversations share one wire, and how a call finds its way across a network.',
  sections: [
    sec('fdm', '5.1', 'Frequency-division and time-division multiplexing', { eyebrow: 'Sharing a link',
      body: `<p>${term('Multiplexing')} combines many signals onto one medium. ${term('FDM')} gives each signal its own frequency band (radio stations, cable TV) with guard bands between them. ${term('TDM')} gives each signal the whole channel for a short time slot in rotation: synchronous TDM wastes slots when a source is idle; statistical TDM allocates slots on demand. ${term('WDM')} is FDM for light: each colour carries a channel on one fibre.</p>`,
      figs: [dia(`direction: right
[Source 1] as a #blue
[Source 2] as b #mint
[Source 3] as c #amber
[Multiplexer] as m #violet
[One shared link] as l #grey
[Demultiplexer] as d #violet
a -> m
b -> m
c -> m
m -> l
l -> d
@0 a -> m : slot 1
@1 b -> m : slot 2
@2 c -> m : slot 3
@3 m -> l : frame
@4 l -> d : frame
loop 6`, 'Three sources take turns in fixed time slots.', { caption: 'time-division multiplexing' })],
      worked: [step('A T1 line multiplexes 24 voice channels, each 64 kb/s, plus 8 kb/s framing.', '', { toc: 'Given' }), step('24 × 64 = 1536 kb/s; add 8 kb/s framing.', '24\\times64+8=1544\\ \\text{kb/s}', { hero: true, toc: 'T1 rate' })],
      qs: [q('guard', 'Why does FDM need guard bands?', ['To keep neighbouring signals from interfering as filters are not perfectly sharp.', 'Each band is separated by unused spectrum.'], [['To save power.', 'Not the purpose.'], ['To synchronise clocks.', 'That is TDM.']])] }),
    sec('dsl', '5.2', 'ADSL and xDSL', { eyebrow: 'Broadband over the phone line',
      body: `<p>${term('ADSL')} uses the copper pair in three frequency bands: voice (0–4 kHz), upstream and a much wider downstream band — asymmetric because home users download more than they upload. It uses discrete multitone: the band is split into 4 kHz sub-channels, each modulated with as many bits as its own signal-to-noise ratio allows. Speed falls with distance from the exchange.</p>`,
      qs: [q('adsl', 'What does the “A” in ADSL stand for?', ['Asymmetric — downstream is faster than upstream.', 'Most traffic flows toward the user.'], [['Analog.', 'DSL is digital.'], ['Advanced.', 'Not the meaning.']])] }),
    sec('ss', '5.3', 'Spread spectrum and CDMA', { eyebrow: 'Hiding in the noise',
      body: `<p>${term('Spread spectrum')} deliberately uses far more bandwidth than needed: ${term('FHSS')} hops the carrier among frequencies in a pseudo-random sequence; ${term('DSSS')} multiplies each bit by a fast chipping code. In ${term('CDMA')} every user has a different orthogonal code and all transmit at once on the same band; the receiver recovers one user by correlating with that user’s code — the others average to zero.</p>`,
      worked: [step('Two users with orthogonal codes c₁ = (+1 +1 +1 +1) and c₂ = (+1 −1 +1 −1). User 1 sends bit +1, user 2 sends bit −1.', '', { toc: 'Setup' }), step('The channel carries the sum: c₁ − c₂ = (0, 2, 0, 2).', '(0,2,0,2)', { toc: 'Sum' }), step('Receiver for user 1 correlates with c₁ and divides by 4.', '\\frac{0+2+0+2}{4}=+1', { hero: true, toc: 'Recover user 1' }), step('For user 2: correlate with c₂ = (0·1 + 2·(−1) + 0·1 + 2·(−1))/4 = −1 ✓.', '-1', { toc: 'Recover user 2' })],
      qs: [q('cdma', 'In CDMA how does a receiver pick out one user from the combined signal?', ['By correlating with that user’s spreading code.', 'Orthogonal codes make other users cancel.'], [['By listening on a special frequency.', 'All share the band.'], ['By waiting for its time slot.', 'That is TDMA.']])] }),
    sec('sw', '5.4', 'Circuit, message and packet switching', { eyebrow: 'Crossing a network',
      body: `<p>${term('Circuit switching')} reserves a path for the whole call (telephone): guaranteed rate, set-up delay, idle capacity wasted. ${term('Message switching')} stores and forwards whole messages. ${term('Packet switching')} cuts data into packets routed separately: efficient for bursty traffic, variable delay. Two flavours: ${term('datagram')} (each packet routed independently, may arrive out of order) and ${term('virtual circuit')} (a path is set up first; packets follow it in order).</p>`,
      figs: [dia(`mode: sequence
[Sender] as s
[Switch A] as a
[Switch B] as b
[Receiver] as r
s -> a : call setup
a -> b : setup
b -> r : setup
r --> s : connected
s -> r : data over the reserved path
s -> r : teardown`, 'Circuit switching: three phases.', { caption: 'a circuit-switched call' })],
      worked: [step('Send a 1.5 MB file over 4 hops of 1 Mb/s each, propagation ignored. Packet size 1500 B, 1000 packets.', '', { toc: 'Given' }), step('Store-and-forward message switching: each hop retransmits the whole file: 4 × 12 s = 48 s.', '4\\times\\frac{12\\times10^6}{10^6}=48\\ \\text{s}', { toc: 'Message' }), step('Packet switching pipelines: first hop takes 12 s, then the last packet needs 3 more hop-times of 12 ms: ≈ 12.04 s.', '12+3(0.012)\\approx12.04\\ \\text{s}', { hero: true, toc: 'Packets' })],
      qs: [q('pkt', 'Why is packet switching better for bursty data?', ['Capacity is shared; nothing is reserved during silences.', 'Circuit switching wastes the idle reserved path.'], [['It guarantees constant delay.', 'Delay varies.'], ['It needs no addresses.', 'Each packet carries one.']])] }),
    sec('dev', '5.5', 'Switching devices', { eyebrow: 'Hardware',
      body: `<p>A crossbar switch connects any input to any output with n² crosspoints; multistage (Banyan/Clos) networks use fewer small switches at the price of possible blocking. A packet switch adds buffers to hold packets contending for the same output.</p>`,
      probs: [pr('p1', '<p>A 16 × 16 crossbar has how many crosspoints, and an omega network with 2×2 switches how many switches?</p>', 'Crossbar: 16² = <b>256</b>. Omega: (16/2) × log₂16 = 8 × 4 = <b>32</b> switches.')],
      qs: [q('xbar', 'Crosspoints in an n × n crossbar?', ['n².', 'One crosspoint for every input–output pair.'], [['n log n.', 'That is a multistage network.'], ['2n.', 'Too few.']])] }),
    sec('summary', '5.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>FDM splits frequency, TDM splits time, WDM splits colour, CDMA splits by code.</li><li>Circuit switching reserves; packet switching shares.</li></ul>` }),
  ],
})
