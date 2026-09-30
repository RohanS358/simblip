import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'The communication model',
  kicker: 'ENCT 253 · Data Communication · Chapter 1',
  subtitle: 'Every link, from a USB cable to a satellite, is the same five boxes.',
  sections: [
    sec('model', '1.1', 'Source, transmitter, medium, receiver, destination', { eyebrow: 'The model',
      body: `<p>A ${term('source')} produces information; a ${term('transmitter')} converts it into a signal suited to the ${term('transmission medium')}; the medium carries it (and corrupts it with ${term('noise')}); a ${term('receiver')} recovers the information and hands it to the ${term('destination')}. A telephone call, a Wi-Fi download and a radio broadcast fit this chain exactly.</p>`,
      figs: [dia(`direction: right
(Source: voice, bits) as s
[Transmitter: encode / modulate] as t #blue
[Medium: copper, fibre, air] as m #amber
[Receiver: demodulate / decode] as r #blue
(Destination) as d
[Noise] as n #rose
s -> t
t -> m : signal
m -> r : signal + noise
r -> d
n --> m
@0 s -> t : message
@1 t -> m : signal
@2 m -> r : noisy signal
@3 r -> d : message
loop 5`, 'Press Simulate: the message becomes a signal and back.', { caption: 'the communication model' })],
      qs: [q('noise', 'Where does noise enter the communication model?', ['In the transmission medium (and the receiver), corrupting the signal.', 'That is why receivers need margins and error control.'], [['At the source only.', 'The source is the information.'], ['Nowhere — digital signals are perfect.', 'Digital signals are also corrupted; they are just easier to regenerate.']])] }),
    sec('flow', '1.2', 'Data flow and network types', { eyebrow: 'Directions',
      body: `<p>${term('Simplex')}: one direction only (broadcast TV). ${term('Half duplex')}: both directions, one at a time (walkie-talkie). ${term('Full duplex')}: both at once (telephone, modern Ethernet). A ${term('LAN')} spans a building, a ${term('WAN')} a country; the OSI model organises the protocols in seven layers (see the Computer Networks course).</p>`,
      qs: [q('duplex', 'A walkie-talkie is…', ['Half duplex.', 'Both can talk but not simultaneously.'], [['Full duplex.', 'That allows simultaneous talk and listen.'], ['Simplex.', 'That is one-way only.']])] }),
    sec('analog', '1.3', 'Analog and digital', { eyebrow: 'Two kinds of data and signal',
      body: `<p>${term('Analog')} data (voice, temperature) varies continuously; ${term('digital')} data is a set of discrete values. Either can travel as an analog signal (telephone line, radio) or a digital one (voltage pulses). Digital signals can be <em>regenerated</em> at repeaters, removing accumulated noise; analog signals can only be amplified, noise included — the core advantage of digital transmission.</p>`,
      figs: [dia(`direction: right
[Analog data → analog signal: telephone] as a #amber
[Analog data → digital signal: PCM] as b #mint
[Digital data → analog signal: modem, Wi-Fi] as c #blue
[Digital data → digital signal: Ethernet] as d #violet
a -> b : sample + quantise
b -> c : modulate
c -> d : line code`, 'All four combinations exist.', { caption: 'data vs signal' })],
      qs: [q('regen', 'Why can digital signals be regenerated?', ['Only a few discrete levels exist, so the receiver can decide which was sent and re-create a clean signal.', 'An analog repeater amplifies the noise too.'], [['They contain no noise.', 'They do; it is removed at decisions.'], ['They are slower.', 'Unrelated.']])],
      probs: [pr('p1', '<p>Give an example of (a) digital data over an analog signal, and (b) analog data over a digital signal.</p>', '(a) A modem or Wi-Fi sending bits by modulating a carrier. (b) A digital phone call: voice is sampled and encoded by PCM.')] }),
    sec('perf', '1.4', 'Performance measures', { eyebrow: 'Numbers',
      body: `<p>${term('Bandwidth')}: range of frequencies (Hz) — or, loosely, the bit rate a link supports. ${term('Throughput')}: bits actually delivered per second. ${term('Latency')}: time for a bit to arrive = propagation + transmission + queueing. ${term('Jitter')}: variation in latency (bad for voice). Bandwidth–delay product = capacity × delay = bits in flight.</p>`,
      worked: [step('A 10 Mb/s link, 2000 km of fibre (propagation 2×10⁸ m/s), sending a 1000-byte packet.', '', { toc: 'Given' }), step('Transmission time = 8000 bits / 10⁷ = 0.8 ms. Propagation = 2×10⁶ m / 2×10⁸ = 10 ms.', 't_{tx}=0.8\\ \\text{ms},\\ t_{p}=10\\ \\text{ms}', { toc: 'Components' }), step('Bandwidth–delay product = 10⁷ × 0.01 s = 10⁵ bits in flight.', '10^7\\times0.01=10^5\\ \\text{bits}', { hero: true, toc: 'BDP' })],
      qs: [q('lat', 'Which component of delay grows with distance?', ['Propagation delay.', 'The signal travels at a finite speed.'], [['Transmission delay.', 'It depends on packet size and bit rate.'], ['Queueing delay.', 'It depends on load.']])] }),
    sec('summary', '1.5', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Source → transmitter → medium (+noise) → receiver → destination.</li><li>Digital signals can be regenerated; analog can only be amplified.</li><li>Delay = transmission + propagation (+queueing).</li></ul>` }),
    sec('extra', '1.6', 'The enterprise view', { eyebrow: 'Where it is used', body: `<p>Today’s enterprise network links branch LANs over WAN services, carries voice and video alongside data (which is why jitter matters), and depends on cloud and mobile access. The protocols and encodings in the following chapters are the machinery beneath all of it.</p>`, qs: [q('voip', 'Which measure matters most for a live voice call?', ['Jitter and latency.', 'Packets must arrive on time and evenly spaced.'], [['Raw bandwidth only.', 'Voice needs little bandwidth.'], ['File size.', 'Not relevant.']])] }),
  ],
})
