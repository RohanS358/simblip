// "Here is what I read" — a reading put into words a tutor can say, with the mistakes a student most often
// makes in a circuit sketch pointed out as questions, not corrections (the sketch may be right and the
// reader wrong). Pure: works on the reading, not on the page.

import type { CircuitGhost } from './circuit-ghost'
import { linksOf } from './circuit-ghost'
import type { MechGhost } from './mech-ghost'
import type { ReadResult } from './read-sketch'

const SOURCES = new Set(['battery', 'ac-source'])
/** Parts whose direction matters to what the circuit does. */
const POLAR = new Set(['battery', 'diode', 'led', 'opamp'])
const DIR: Record<number, string> = { 0: 'right', 90: 'down', 180: 'left', 270: 'up' }

export interface Review {
  /** One short paragraph: what was read. */
  read: string
  /** Things worth asking the student about (open circuit, no source, direction of a diode…). */
  moves: string[]
  /** Parts the reader itself is unsure of. */
  unsure: string[]
}

const nameOf = (cls: string) => cls.replace(/-/g, ' ')

export function reviewCircuit(g: CircuitGhost): Review {
  const parts = g.result.parts
  const links = linksOf(g)
  const label = (i: number) => `${nameOf(parts[i].cls)} ${i + 1}`
  const items = parts.map((p) => {
    const v = p.values ? Object.values(p.values).filter(Boolean)[0] : undefined
    return `${nameOf(p.cls)}${v ? ` ${v}` : ''}${p.conf < 0.6 ? ' (unsure)' : ''}`
  })
  const read = `I read ${parts.length} parts: ${items.join(', ')}; ${links.length} connection${links.length === 1 ? '' : 's'} between them.`

  const moves: string[] = []
  if (!parts.some((p) => SOURCES.has(p.cls))) moves.push('There is no battery or source in the drawing, so nothing pushes current round. Is one missing?')
  const used = new Set<string>()
  for (const l of links) {
    used.add(`${l.a.node}.${l.a.pin}`)
    used.add(`${l.b.node}.${l.b.pin}`)
  }
  parts.forEach((p, i) => {
    const open = p.pins.filter((q) => !used.has(`${p.id}.${q.name}`))
    if (open.length > 0 && p.pins.length > 1) {
      moves.push(`The ${label(i)} has ${open.length === 1 ? 'a terminal' : 'terminals'} (${open.map((q) => q.name).join(', ')}) joined to nothing, so the circuit is open there. Is a wire missing?`)
    }
  })
  const loose = g.result.looseEnds?.length ?? 0
  if (loose > 0) moves.push(`${loose} wire end${loose === 1 ? '' : 's'} touch nothing. Was it meant to connect?`)
  parts.forEach((p, i) => {
    if (!POLAR.has(p.cls)) return
    if (p.cls === 'battery') moves.push(`I read the ${label(i)} with its long (+) plate on the ${p.pose === 180 ? 'right' : 'left'}. Is that the side you meant for +?`)
    else if (p.cls === 'diode' || p.cls === 'led') moves.push(`I read the ${label(i)} pointing ${DIR[p.pose] ?? 'right'}, so current can only pass that way. Is that the direction you wanted?`)
    else if (p.cls === 'opamp' && p.polarityKnown === false) moves.push('I could not see the + and − marks on the op-amp, so I guessed which input is which. Which is the inverting one?')
  })
  const unsure = parts.flatMap((p, i) =>
    p.conf < 0.6 ? [`${label(i)} (${Math.round(p.conf * 100)} %, could also be ${p.alts.slice(0, 2).map((a) => nameOf(a.cls)).join(' or ') || 'something else'})`] : []
  )
  return { read, moves, unsure }
}

export function reviewMech(g: MechGhost): Review {
  const nodes = g.ir.nodes
  const names = nodes.map((n) => `${n.cls}${n.values && Object.keys(n.values).length ? ` (${Object.entries(n.values).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`)
  const moves: string[] = []
  if (g.domain === 'optics') {
    if (!nodes.some((n) => n.cls === 'light-source')) moves.push('There is no light source, so no ray will be drawn. Is one missing?')
  } else {
    if (!nodes.some((n) => n.cls === 'ground')) moves.push('There is no ground or surface under anything. Should the objects rest on something?')
    if (nodes.some((n) => n.cls === 'force' || n.cls === 'velocity')) moves.push('I could not tell from the drawing whether each arrow is a force or a velocity. Please check which is which.')
  }
  const links = g.ir.edges.length
  return { read: `I read ${nodes.length} ${g.domain} parts: ${names.join(', ')}; ${links} link${links === 1 ? '' : 's'}.`, moves, unsure: [] }
}

/** The reading in words. A failure becomes what went wrong and what to do about it. */
export function describeReading(res: ReadResult): Review & { kind: ReadResult['kind'] } {
  if (res.kind === 'circuit') return { kind: res.kind, ...reviewCircuit(res.ghost) }
  if (res.kind === 'mechanics') return { kind: res.kind, ...reviewMech(res.ghost) }
  if (res.kind === 'symbol') {
    const sure = res.tier === 'sure'
    return {
      kind: res.kind,
      read: `${sure ? 'I read a single' : 'I am not sure, but it may be a single'} ${nameOf(res.pick.cls)} (${Math.round(res.pick.p * 100)} %).`,
      moves: sure ? [] : ['Could you tell me what it is, or draw it larger with clear leads?'],
      unsure: sure ? [] : [nameOf(res.pick.cls)],
    }
  }
  return { kind: res.kind, read: `I could not read this: ${res.failure.message}`, moves: [], unsure: [] }
}
