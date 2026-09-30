import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Cellular systems and 5G',
  kicker: 'ENCT 253 · Data Communication · Chapter 6',
  subtitle: 'Reusing the same radio frequencies in neighbouring cells is what makes mobile phones scale.',
  sections: [
    sec('cell', '6.1', 'The cellular idea', { eyebrow: 'Reuse',
      body: `<p>Radio spectrum is scarce. Instead of one powerful transmitter for a city, divide the area into ${term('cells')}, each with a low-power base station. Cells far enough apart can reuse the same frequencies. A ${term('cluster')} of <i>N</i> cells uses all the available channels once; with N cells per cluster each cell gets 1/N of the total. Hexagons are the usual picture because they tile the plane.</p>`,
      figs: [dia(`direction: right
group "Cluster of 3" { c1, c2, c3 }
[Cell A · f1] as c1 #blue
[Cell B · f2] as c2 #mint
[Cell C · f3] as c3 #amber
[Next cluster reuses f1, f2, f3] as r #grey
c1 -> c2
c2 -> c3
c3 -> r : reuse`, 'Neighbouring cells use different frequency sets.', { caption: 'frequency reuse' })],
      worked: [step('A system has 120 channels and a cluster size N = 4.', '', { toc: 'Given' }), step('Each cell gets 120 / 4 = 30 channels; a city of 100 cells then supports 3000 simultaneous calls instead of 120.', '\\frac{120}{4}=30,\\ 100\\times30=3000', { hero: true, toc: 'Capacity' })],
      qs: [q('reuse', 'What does a smaller cluster size N give?', ['More channels per cell (more capacity) but more co-channel interference.', 'Same-frequency cells are closer together.'], [['Fewer channels per cell.', 'The opposite: 1/N each.'], ['No change.', 'N directly sets the channels per cell.']])] }),
    sec('interf', '6.2', 'Interference and handoff', { eyebrow: 'Problems',
      body: `<p>${term('Co-channel interference')} comes from cells reusing your frequency; ${term('adjacent-channel interference')} from neighbouring frequencies. As a moving phone leaves a cell the network performs a ${term('handoff')} to the next cell without dropping the call: the signal strength from the old station falls below a threshold while the new one rises. Hard handoff breaks before making; soft handoff (CDMA) connects to both for a moment.</p>`,
      figs: [dia(`mode: sequence
[Phone] as p
[Base station 1] as b1
[Base station 2] as b2
[Switching centre] as m
p -> b1 : measure signal (strong)
p -> b2 : measure signal (rising)
b1 -> m : signal below threshold
m -> b2 : prepare channel
m --> p : switch to base station 2
p -> b2 : continues the call`, 'The network, not the phone, decides.', { caption: 'a handoff' })],
      qs: [q('hand', 'What triggers a handoff?', ['The signal from the current base station dropping below a threshold while a neighbour is stronger.', 'The mobile keeps measuring neighbours.'], [['The user dialling.', 'Unrelated.'], ['A cluster change.', 'Not a cause.']])] }),
    sec('gens', '6.3', 'From 1G to 5G', { eyebrow: 'Generations',
      body: `<p>1G: analog voice (AMPS). 2G: digital voice and SMS (GSM, TDMA; GPRS brought packet data). 3G: CDMA-based, mobile internet (UMTS). 4G (LTE): all-IP, OFDMA, tens to hundreds of Mb/s. 5G: higher speeds, very low latency (~1 ms), massive device counts, using sub-6 GHz and millimetre-wave bands and network slicing. GSM architecture: mobile station, base transceiver station, base station controller, mobile switching centre with home/visitor registers.</p>`,
      figs: [dia(`direction: right
[Mobile station + SIM] as ms #blue
[Base transceiver station] as bts #mint
[Base station controller] as bsc #amber
[Mobile switching centre] as msc #violet
[HLR / VLR registers] as reg #grey
ms -> bts : radio
bts -> bsc
bsc -> msc
msc -> reg : where is the subscriber?`, 'The GSM chain from phone to core.', { caption: 'GSM architecture' })],
      qs: [q('gsm', 'Which generation first used digital voice?', ['2G (GSM).', '1G was analog.'], [['1G.', 'Analog FM.'], ['4G.', 'Much later.']])] }),
    sec('five', '6.4', '5G, SDN, IoT and the cloud', { eyebrow: 'Latest trends',
      body: `<p>5G’s three use cases: enhanced mobile broadband, ultra-reliable low-latency communication (remote surgery, vehicles) and massive machine-type communication (IoT sensors). Software-defined networking and network function virtualisation run core functions as software in the cloud; edge computing puts processing near the user to cut latency.</p>`,
      qs: [q('urllc', 'Which 5G use case targets self-driving vehicles?', ['Ultra-reliable low-latency communication.', 'Decisions cannot wait tens of milliseconds.'], [['Enhanced mobile broadband.', 'That is high speed for phones.'], ['Massive machine-type communication.', 'That is many small sensors.']])] }),
    sec('prac', '6.5', 'Numericals', { eyebrow: 'Practice',
      probs: [pr('p1', '<p>A cellular system has 280 channels, cluster size 7. How many channels per cell? If a region has 140 cells, how many simultaneous calls?</p>', '280 / 7 = <b>40</b> channels per cell; 140 × 40 = <b>5600</b> simultaneous calls.'), pr('p2', '<p>Why is a hexagon used to model a cell?</p>', 'It is the regular shape closest to a circle (the ideal coverage of an omnidirectional antenna) that still tiles the plane without gaps or overlaps, unlike circles.')],
      worked: [step('The reuse distance D relates to cell radius R and cluster size N by D = R√(3N).', '', { toc: 'Formula' }), step('For N = 7 and R = 2 km.', 'D = 2\\sqrt{21}\\approx9.2\\ \\text{km}', { hero: true, toc: 'Reuse distance' })],
      qs: [q('dist', 'Increasing the cluster size N makes the reuse distance…', ['Larger, reducing co-channel interference.', 'D = R√(3N).'], [['Smaller.', 'The formula grows with N.'], ['Unchanged.', 'N appears in it.']])] }),
    sec('summary', '6.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Reuse frequencies across clusters; handoff keeps calls alive.</li><li>Generations: analog → digital → CDMA → all-IP → low latency + massive IoT.</li></ul>` }),
  ],
})
