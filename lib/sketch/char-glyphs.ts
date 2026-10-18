// Stroke skeletons for the characters of a component value: the digits, and the
// SI prefixes and unit letters that follow them ("4.7k", "100n", "9V", "10mH").
//
// The same 100 × 60 frame as the symbol glyphs so one placement and one hand model
// serve both: a character stands about 48 units tall (y 6 … 54) and 26 wide,
// centred on (50, 30). Free-form handwriting recognition is deliberately not
// attempted — the alphabet is small, so the model can be tiny and accurate.
//
// '.' is not here: a dot is recognised by its size, before any model sees it
// (normalising a dot to fill the frame would make it look like an 'o').

import { arc, body, circle, line, quad, type Glyph } from './glyphs'
import type { Rng } from './rng'

/** Every character the value reader knows, as it appears in the text. 'u' is the micro prefix. */
export const CHAR_LABELS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'k', 'M', 'm', 'u', 'n', 'p', 'V', 'A', 'F', 'H', 'Ω',
] as const
export type CharLabel = (typeof CHAR_LABELS)[number]

const PI = Math.PI
type Pt = [number, number]
const g = (variant: string, ...strokes: Pt[][]): Glyph => ({ variant, strokes: strokes.map((pts) => body(pts)) })

const j = (rng: Rng, a: number) => rng.range(-a, a)

const zero = (rng: Rng) => g('oval', arc(50, 30, rng.range(10, 14), 24, -PI / 2, (3 * PI) / 2, 26))

const one = (rng: Rng) => {
  const flag: Pt[] = [[44 + j(rng, 2), 14 + j(rng, 2)], [52, 6], [52, 54]]
  return rng.chance(0.35) ? g('serif', flag, line(44, 54, 61, 54)) : g('stick', flag)
}

const two = () => g('curl', [...arc(50, 19, 12, 13, PI, 2 * PI + 0.5, 10), [38, 54], [63, 54]])

const three = (rng: Rng) =>
  rng.chance(0.3)
    ? g('flat-top', [[38, 8], [62, 8], [48, 28]], [...arc(49, 41, 13, 13, -1.9, 2.4, 12)])
    : g('round', [...arc(49, 18, 11, 12, -2.7, 1.57, 10), ...arc(49, 42, 12, 12, -1.57, 2.7, 10).slice(1)])

const four = (rng: Rng) =>
  rng.chance(0.5)
    ? g('closed', [[56, 6], [38, 36], [64, 36]], [[56, 6], [56, 54]])
    : g('open', [[40, 6], [40, 36], [62, 36]], [[56, 6], [56, 54]])

const five = () => g('flag', [[62, 7], [42, 7], [40, 28], ...arc(50, 40, 13, 14, -2.2, 2.4, 14)])

const six = () => g('loop', [...quad([58, 8], [36, 22], [38, 40]), ...arc(50, 40, 12, 14, PI, 3 * PI, 16)])

const seven = (rng: Rng) =>
  rng.chance(0.3) ? g('barred', [[38, 6], [63, 6], [46, 54]], [[42, 32], [56, 32]]) : g('plain', [[38, 6], [63, 6], [46, 54]])

const eight = (rng: Rng) =>
  rng.chance(0.5)
    ? g('two-loops', circle(50, 18, 11), circle(50, 42, 12))
    : g('s-shaped', [...arc(50, 18, 11, 12, 0.6, 2 * PI - 0.6 + 2 * PI * 0.5, 14), ...arc(50, 42, 12, 12, -PI * 0.5, 1.5 * PI, 14)])

const nine = () => g('loop-tail', circle(50, 19, 12), [[62, 19], [60, 40], [50, 54]])

const kay = (rng: Rng) =>
  rng.chance(0.5)
    ? g('two-stroke', [[41, 6], [41, 54]], [[62, 18], [42, 34], [63, 54]])
    : g('one-stroke', [[41, 6], [41, 54], [41, 36], [62, 18], [42, 34], [63, 54]])

const capM = () => g('peaks', [[36, 54], [37, 8], [50, 36], [63, 8], [64, 54]])

const lowM = () =>
  g('humps', [[38, 24], [38, 54]], [[38, 34], ...arc(46, 33, 8, 9, PI, 2 * PI, 8), [54, 54]], [[54, 34], ...arc(62, 33, 8, 9, PI, 2 * PI, 8), [70, 54]])

const mu = (rng: Rng) =>
  rng.chance(0.5)
    ? g('cup-tail', [[40, 24], [40, 44], ...arc(48, 44, 8, 10, PI, 0, 10), [56, 44], [56, 24]], [[56, 24], [56, 56]])
    : g('tailed-u', [[40, 24], [40, 58]], [[40, 40], ...arc(48, 42, 8, 10, PI, 0, 10), [56, 24]])

const en = () => g('arch', [[40, 24], [40, 54]], [[40, 34], ...arc(48, 33, 8, 9, PI, 2 * PI, 8), [56, 54]])

const pee = () => g('bowl', [[40, 24], [40, 62]], [[40, 28], ...arc(50, 38, 10, 12, -2.3, 2.3, 12)])

const vee = () => g('vee', [[36, 8], [50, 54], [64, 8]])

const ay = () => g('tent', [[36, 54], [50, 6], [64, 54]], [[42, 38], [58, 38]])

const eff = (rng: Rng) =>
  rng.chance(0.5) ? g('flagged', [[63, 6], [42, 6], [42, 54]], [[42, 28], [58, 28]]) : g('three', [[42, 6], [42, 54]], [[42, 6], [63, 6]], [[42, 28], [58, 28]])

const aitch = () => g('ladder', [[40, 6], [40, 54]], [[60, 6], [60, 54]], [[40, 30], [60, 30]])

const omega = () => g('horseshoe', [[36, 54], [44, 54], ...arc(50, 30, 14, 20, PI * 0.78, PI * 2.22, 18), [56, 54], [64, 54]])

export const CHAR_GLYPHS: Record<CharLabel, (rng: Rng) => Glyph> = {
  '0': zero, '1': one, '2': two, '3': three, '4': four, '5': five, '6': six, '7': seven, '8': eight, '9': nine,
  k: kay, M: capM, m: lowM, u: mu, n: en, p: pee, V: vee, A: ay, F: eff, H: aitch, Ω: omega,
}
