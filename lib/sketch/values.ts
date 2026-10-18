// Values written beside a part — "10k", "4.7k", "9V", "100n" — read from ink.
//
//   small strokes ──▶ characters (strokes that touch) ──▶ lines of text
//        ──▶ each character named by the small character network
//        ──▶ a value string, checked by the same unit parser the compiler uses
//        ──▶ attached to the nearest part, as that part's main parameter
//
// Free-form handwriting is not attempted. The alphabet is the digits and the SI
// prefixes and unit letters that follow them, so the network is tiny; anything
// it is not sure of is left as ink and flagged, never guessed. A '.' is told
// apart by size before any network sees it (normalised, a dot looks like an 'o').
//
// Text must be found BEFORE the symbols are read: written 30 px from a resistor it
// would otherwise be swept into the resistor's stroke group and spoil it.

import { boxGap, median, unionBox, type Box } from './geom'
import { mainParamOf, parseQuantity } from './compile'
import { bestSymbol } from './neural-pick'
import type { Shape, Recogniser } from './extract'

export interface TextRead {
  /** What was read, e.g. "4.7k". */
  text: string
  box: Box
  strokeIds: string[]
  /** Lowest character confidence in the line. */
  conf: number
  /** The text parsed as a quantity (value + unit). */
  ok: boolean
}

interface Cluster {
  shapes: Shape[]
  box: Box
  tiny: boolean
}

const heightOf = (b: Box) => b.y1 - b.y0
const widthOf = (b: Box) => b.x1 - b.x0
const centerOf = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]

/**
 * Characters: strokes whose boxes touch or nearly touch belong to one character.
 * A tiny stroke (a decimal point) never joins one — it sits between two characters
 * and would otherwise be absorbed into a neighbour.
 */
function clusterChars(shapes: Shape[], pad: number, tinyDiag: number): Cluster[] {
  const tiny = shapes.filter((s) => s.diag <= tinyDiag)
  const rest = shapes.filter((s) => s.diag > tinyDiag)
  const groups: Shape[][] = []
  for (const s of rest) {
    const hits = groups.filter((g) => g.some((o) => boxGap(o.box, s.box) <= pad))
    if (hits.length === 0) groups.push([s])
    else {
      hits[0].push(s)
      for (const extra of hits.slice(1)) {
        hits[0].push(...extra)
        groups.splice(groups.indexOf(extra), 1)
      }
    }
  }
  return [
    ...groups.map((g) => ({ shapes: g, box: g.map((s) => s.box).reduce(unionBox), tiny: false })),
    ...tiny.map((s) => ({ shapes: [s], box: s.box, tiny: true })),
  ]
}

/** Minimum probability for a character to be believed. */
export const CHAR_MIN_P = 0.5

const believed = (p: { cls: string; conf: number }) => p.cls !== 'unknown' && p.conf >= CHAR_MIN_P

/**
 * Handwriting touches: "2k" written close together is one cluster of strokes. If
 * the network cannot name the cluster as one character, try cutting it between
 * strokes (left to right) and keep the cut whose pieces it CAN name. A cluster it
 * names confidently is left whole, so a two-stroke "4" is never torn apart.
 */
function splitTouching(c: Cluster, chars: Recogniser): Cluster[] {
  if (c.tiny || c.shapes.length < 2 || c.shapes.length > 7) return [c]
  const whole = chars.predict(c.shapes.map((s) => s.pts))
  if (believed(whole) && whole.conf >= 0.9) return [c]
  const strokes = c.shapes.slice().sort((a, b) => a.box.x0 + a.box.x1 - (b.box.x0 + b.box.x1))
  const n = strokes.length
  const score = new Map<string, number>()
  const seg = (i: number, j: number): number => {
    const key = `${i}-${j}`
    if (!score.has(key)) {
      const p = chars.predict(strokes.slice(i, j).map((s) => s.pts))
      score.set(key, believed(p) ? p.conf : 0)
    }
    return score.get(key)!
  }
  // best[i]: the best total confidence of cutting the first i strokes into believed pieces
  const best: number[] = [0]
  const cut: number[] = [0]
  for (let i = 1; i <= n; i++) {
    best[i] = -1
    for (let j = 0; j < i; j++) {
      const sc = seg(j, i)
      if (sc > 0 && best[j] >= 0 && best[j] + sc > best[i]) {
        best[i] = best[j] + sc
        cut[i] = j
      }
    }
  }
  if (best[n] < 0) return [c]
  const pieces: Cluster[] = []
  for (let i = n; i > 0; i = cut[i]) {
    const part = strokes.slice(cut[i], i)
    pieces.unshift({ shapes: part, box: part.map((s) => s.box).reduce(unionBox), tiny: false })
  }
  return pieces.length > 1 && best[n] / pieces.length >= whole.conf * 0.9 ? pieces : believed(whole) ? [c] : pieces
}

/**
 * Read the text in `shapes` (small strokes and candidate decimal points). `unit`
 * is the drawing's symbol size, used to size the grouping tolerances.
 */
export function readText(shapes: Shape[], chars: Recogniser, unit: number): TextRead[] {
  if (shapes.length === 0) return []
  const tinyDiag = Math.max(5, 0.09 * unit)
  const clusters = clusterChars(shapes, Math.max(3, 0.05 * unit), tinyDiag).flatMap((c) => splitTouching(c, chars))
  // The size of a letter on this page: the median height of the characters that are not dots.
  const letters = clusters.filter((c) => !c.tiny)
  if (letters.length === 0) return []
  const H = median(letters.map((c) => heightOf(c.box)))

  // Lines: left to right; a new line starts after a wide gap or a different height.
  const sorted = clusters.slice().sort((a, b) => a.box.x0 - b.box.x0)
  const lines: Cluster[][] = []
  for (const c of sorted) {
    const [cx, cy] = centerOf(c.box)
    const home = lines.find((l) => {
      const last = l[l.length - 1]
      const [, ly] = centerOf(last.box)
      const ref = l.find((x) => !x.tiny) ?? last
      const [, ry] = centerOf(ref.box)
      return cx - last.box.x1 <= 1.2 * H && Math.abs(cy - (c.tiny ? ry + 0.3 * H : ly)) <= 0.75 * H && cx >= last.box.x0 - 0.2 * H && Math.abs(cy - ry) <= 0.75 * H
    })
    if (home) home.push(c)
    else lines.push([c])
  }

  const reads: TextRead[] = []
  for (const line of lines) {
    const real = line.filter((c) => !c.tiny)
    if (real.length === 0) continue
    // a decimal point sits low, among the characters; a stray speck above the line is not one
    const refBox = real.map((c) => c.box).reduce(unionBox)
    let text = ''
    let conf = 1
    let seen = 0
    for (const c of line) {
      if (c.tiny) {
        const cy = centerOf(c.box)[1]
        if (cy >= refBox.y0 + 0.55 * heightOf(refBox)) text += '.'
        continue
      }
      const pred = chars.predict(c.shapes.map((s) => s.pts))
      conf = Math.min(conf, pred.conf)
      if (!believed(pred)) text += '?'
      else {
        text += pred.cls
        seen++
      }
    }
    if (seen < Math.ceil(real.length * 0.6)) continue
    // The unit letter is the character most often misread (Ω especially): a number
    // that reads cleanly without it is still a number.
    let ok = !text.includes('?') && !!parseQuantity(text)
    if (!ok && text.endsWith('?') && !text.slice(0, -1).includes('?') && parseQuantity(text.slice(0, -1))) {
      text = text.slice(0, -1)
      ok = true
    }
    reads.push({
      text,
      box: line.map((c) => c.box).reduce(unionBox),
      strokeIds: line.flatMap((c) => c.shapes.map((s) => s.id)),
      conf,
      ok,
    })
  }
  return reads
}

/**
 * The text in a drawing: lines of small strokes that read as a VALUE and are not
 * a symbol. Both conditions matter. A battery's two plates look like "11" to the
 * character network, and an LED's arrows look like "7V"; the symbol network
 * recognises those as parts, and a line that is part of a symbol is not text.
 * Strokes drawn inside another stroke (the V of a voltmeter, an op-amp's +) are
 * never candidates.
 */
export function findText(candidates: Shape[], bodies: Shape[], symbols: Recogniser, chars: Recogniser, unit: number): TextRead[] {
  const inside = (s: Shape) =>
    bodies.some((o) => o !== s && o.diag > 1.6 * s.diag && s.box.x0 >= o.box.x0 && s.box.x1 <= o.box.x1 && s.box.y0 >= o.box.y0 && s.box.y1 <= o.box.y1)
  const pool = candidates.filter((s) => !inside(s))
  return readText(pool, chars, unit).filter((r) => {
    const byId = new Set(r.strokeIds)
    const strokes = pool.filter((s) => byId.has(s.id)).map((s) => s.pts)
    const sym = bestSymbol(symbols.predict(strokes))
    // text the character network is sure of beats a middling symbol guess; only a near-certain symbol wins
    return !(sym && sym.p >= Math.max(0.6, Math.min(0.95, r.conf - 0.02)))
  })
}

export interface ValuedPart {
  id: string
  cls: string
  box: Box
}

/** Distance from a point to a box (0 inside). */
function toBox(p: [number, number], b: Box): number {
  const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1)
  const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1)
  return Math.hypot(dx, dy)
}

const UNIT_PARAM: Record<string, string> = { 'Ω': 'R', V: 'V', A: 'I', F: 'C', H: 'L' }

export interface Attachment {
  partId: string
  param: string
  text: string
  strokeIds: string[]
}

/**
 * Each readable value goes to the nearest part within reach, as that part's main
 * parameter — unless its unit says it belongs to a different parameter than the
 * part has (a "9V" beside a resistor is not a resistance).
 */
export function attachValues(parts: ValuedPart[], reads: TextRead[], unit: number): { attached: Attachment[]; leftover: TextRead[] } {
  const attached: Attachment[] = []
  const taken = new Set<string>()
  const placed = new Set<TextRead>()
  const reach = 1.1 * unit
  // nearest pairs first, so two labels never fight over one part
  const pairs = reads
    .filter((r) => r.ok)
    .flatMap((r) => parts.map((p) => ({ r, p, d: toBox(centerOf(r.box), p.box) })))
    .filter((x) => x.d <= reach)
    .sort((a, b) => a.d - b.d)
  for (const { r, p } of pairs) {
    if (placed.has(r) || taken.has(p.id)) continue
    const q = parseQuantity(r.text)!
    const have = mainParamOf(p.cls)
    const wanted = q.unit ? UNIT_PARAM[q.unit] : have
    if (!have || wanted !== have) continue
    attached.push({ partId: p.id, param: have, text: r.text, strokeIds: r.strokeIds })
    taken.add(p.id)
    placed.add(r)
  }
  return { attached, leftover: reads.filter((r) => !placed.has(r)) }
}
