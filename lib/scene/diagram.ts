// A text-to-diagram language, and the layout engine behind it.
//
// WHY THIS EXISTS. A block diagram used to be written by hand, object by
// object: a rect at (0,0), another at (220,0), a connect() between them, and
// the author guessing every coordinate. That is fine for two boxes and
// unusable for eight, so lessons that needed a flowchart, a classification or
// a signal chain simply did without one. This module is the same trade the
// rest of the app already makes for circuits — describe the STRUCTURE, let the
// layout be computed:
//
//     direction: down
//     [Measure V and I] as m
//     <Is R constant?> as q
//     (Ohm's law applies) as ok
//     m -> q
//     q -> ok : yes
//
// PURE. Nothing here touches the document store, React, or the DOM: it turns
// text into a list of placed boxes and routed edges. simscript.ts's diagram()
// builtin is what turns that list into real scene objects, and the lint gate
// runs the SAME parser offline to reject a broken diagram before it ships.
//
// The layout is a small Sugiyama: rank by longest path, order by barycentre,
// then place. It is deliberately not a general graph drawer — it draws the
// layered, mostly-acyclic diagrams that engineering notes actually contain,
// and says so plainly when handed something else.

export type DiagramShape = 'box' | 'round' | 'diamond' | 'circle'
export type DiagramSide = 'top' | 'right' | 'bottom' | 'left'
export type EdgeStyle = 'arrow' | 'dashed' | 'plain'
export type Direction = 'down' | 'right'

export interface DiagramNode {
  id: string
  label: string
  shape: DiagramShape
  /** A design-system accent name (blue/mint/violet/amber/rose/grey). */
  accent?: string
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
  style: EdgeStyle
}

export interface DiagramGroup {
  label: string
  members: string[]
}

export interface DiagramAst {
  direction: Direction
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  groups: DiagramGroup[]
  /** Authoring mistakes, in source order. A diagram with errors still
   *  produces the nodes it understood, so a preview shows what survived. */
  errors: string[]
}

export interface PlacedNode extends DiagramNode {
  x: number
  y: number
  w: number
  h: number
  /** The label already wrapped — the caller renders these lines verbatim. */
  lines: string[]
}

export interface PlacedEdge extends DiagramEdge {
  /** World endpoints, on the two nodes' outlines. */
  a: { x: number; y: number }
  b: { x: number; y: number }
  /** Orthogonal corners between a and b (may be empty for a straight run). */
  bends: { x: number; y: number }[]
  /** Boundary parameters for the endpoints, so the drawn connector can be
   *  ANCHORED to its nodes and stay attached when one is dragged. */
  aT: number
  bT: number
  /** Where an edge label sits, if it has one. */
  labelAt?: { x: number; y: number }
}

export interface PlacedGroup {
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface DiagramLayout {
  direction: Direction
  nodes: PlacedNode[]
  edges: PlacedEdge[]
  groups: PlacedGroup[]
  width: number
  height: number
  errors: string[]
}

// ── Metrics ─────────────────────────────────────────────────────────────────
//
// There is no text measurement available here (this runs in Node during the
// lint gate as often as in the browser), so a box is sized from a character
// advance. The constants are tuned so a label never overflows its box at the
// shape-label size; a box slightly wider than its text is invisible, a label
// spilling out of its box is not.
const CHAR_W = 7.4
/** A rendered label line, not a typographic one: the shape's label is a rich
 *  text block whose paragraphs carry their own spacing, so a box sized to
 *  19px lines came out half as tall as the text it had to hold. */
const LINE_H = 31
const PAD_X = 24
const PAD_Y = 14
const MIN_W = 116
const MAX_W = 260
const MIN_H = 52
/** Characters per line before wrapping. Long labels read better stacked than
 *  as one wide box that forces every rank to be wide. */
const WRAP_AT = 22

/** Space between ranks (along the flow) and between siblings (across it). */
const GAP_RANK = 84
const GAP_SIBLING = 40
const GROUP_PAD = 22
const GROUP_TITLE_H = 24

export function wrapLabel(label: string, wrapAt = WRAP_AT): string[] {
  const out: string[] = []
  for (const para of label.split(/\\n|\n/)) {
    const words = para.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    let line = ''
    for (const w of words) {
      if (!line) line = w
      else if ((line + ' ' + w).length <= wrapAt) line += ' ' + w
      else {
        out.push(line)
        line = w
      }
    }
    if (line) out.push(line)
  }
  return out.length ? out : ['']
}

function sizeOf(shape: DiagramShape, lines: string[]): { w: number; h: number } {
  const longest = Math.max(...lines.map((l) => l.length), 1)
  let w = Math.min(MAX_W, Math.max(MIN_W, Math.round(longest * CHAR_W + PAD_X * 2)))
  let h = Math.max(MIN_H, lines.length * LINE_H + PAD_Y * 2)
  if (shape === 'diamond') {
    // A diamond is only as wide as its box at the waist and narrows to
    // nothing at the points, so a label that fits a rectangle of the same
    // size runs over the sloped edges. Widening by half also pushes the
    // rendered wrap point out past the label, which keeps a decision on one
    // line — where a diamond reads best — instead of stacking it into the
    // narrow part of the shape.
    w = Math.round(longest * CHAR_W * 1.8 + PAD_X * 2)
    h = Math.round(lines.length * LINE_H * 1.7 + PAD_Y * 2)
  } else if (shape === 'circle') {
    const s = Math.max(w, h, 96)
    w = s
    h = s
  }
  return { w, h }
}

/**
 * Boundary parameter (0–1) of the midpoint of one side, matching
 * lib/scene/connectors.ts's `t`: clockwise from the top-left for a bbox, and
 * the ellipse angle for a circle. Returning `t` rather than a point is what
 * lets the drawn edge be anchored — the store reprojects it from `t` whenever
 * a node moves, so a diagram survives being rearranged by hand.
 */
export function sideT(shape: DiagramShape, w: number, h: number, side: DiagramSide): number {
  if (shape === 'circle') {
    return side === 'top' ? 0 : side === 'right' ? 0.25 : side === 'bottom' ? 0.5 : 0.75
  }
  const per = 2 * (w + h) || 1
  switch (side) {
    case 'top': return w / 2 / per
    case 'right': return (w + h / 2) / per
    case 'bottom': return (w + h + w / 2) / per
    default: return (w + h + w + h / 2) / per
  }
}

function sidePoint(n: PlacedNode, side: DiagramSide): { x: number; y: number } {
  switch (side) {
    case 'top': return { x: n.x + n.w / 2, y: n.y }
    case 'bottom': return { x: n.x + n.w / 2, y: n.y + n.h }
    case 'left': return { x: n.x, y: n.y + n.h / 2 }
    default: return { x: n.x + n.w, y: n.y + n.h / 2 }
  }
}

// ── Parser ──────────────────────────────────────────────────────────────────

const SHAPE_OPEN: [RegExp, DiagramShape][] = [
  [/^\(\((.+)\)\)$/, 'circle'],
  [/^\[(.+)\]$/, 'box'],
  [/^\((.+)\)$/, 'round'],
  [/^<(.+)>$/, 'diamond'],
]

const ACCENTS = new Set(['blue', 'mint', 'violet', 'amber', 'rose', 'grey', 'gray'])

/** Split an edge's right-hand side into its target and its label.
 *
 *  The colon cannot simply be the last one on the line: a node declared
 *  inline carries its own punctuation — `q -> [Diode: fixed Vf]` — and a naive
 *  split turns half the node's label into an edge label and leaves a stray
 *  bracket in the node's name. Only a colon OUTSIDE every bracket separates. */
function splitEdgeLabel(rhs: string): { target: string; label?: string } {
  let depth = 0
  for (let i = 0; i < rhs.length; i++) {
    const ch = rhs[i]
    if (ch === '[' || ch === '(' || ch === '<') depth++
    else if (ch === ']' || ch === ')' || ch === '>') depth = Math.max(0, depth - 1)
    else if (ch === ':' && depth === 0) {
      const label = rhs.slice(i + 1).trim()
      return { target: rhs.slice(0, i).trim(), ...(label ? { label } : {}) }
    }
  }
  return { target: rhs.trim() }
}

export function slug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'n'
}

/**
 * Parse the diagram language.
 *
 * Grammar, one statement per line:
 *
 *   direction: down | right
 *   [Label] as id #accent      box        (id and accent both optional)
 *   (Label)                    stadium — a start/end terminal
 *   <Label>                    diamond — a decision
 *   ((Label))                  circle  — a junction or state
 *   a -> b : label             arrow    (--> dashed, -- plain)
 *   group "Name" { a, b }      a labelled container around those nodes
 *   # comment                  ignored (also //)
 *
 * An edge may name a node that was never declared; it becomes a plain box.
 * That is deliberate — the shortest useful diagram is two names and an arrow,
 * and demanding declarations first would make it longer than the picture.
 */
export function parseDiagram(source: string): DiagramAst {
  const ast: DiagramAst = { direction: 'down', nodes: [], edges: [], groups: [], errors: [] }
  const byId = new Map<string, DiagramNode>()
  /** Label (lowercased) → id, so an edge can name a node by what it says. */
  const byLabel = new Map<string, string>()

  const declare = (label: string, shape: DiagramShape, id?: string, accent?: string): DiagramNode => {
    const nid = id ?? slug(label)
    const existing = byId.get(nid)
    if (existing) {
      // A later declaration refines a node an edge created implicitly.
      existing.label = label
      existing.shape = shape
      if (accent) existing.accent = accent
      byLabel.set(label.toLowerCase(), nid)
      return existing
    }
    const node: DiagramNode = { id: nid, label, shape, ...(accent ? { accent } : {}) }
    byId.set(nid, node)
    byLabel.set(label.toLowerCase(), nid)
    ast.nodes.push(node)
    return node
  }

  /** Resolve an edge endpoint: an id, a declared label, or a new box.
   *
   *  A shape may be declared inline — `s -> [Filter] as f` — because the
   *  alternative is writing every node twice in any diagram short enough that
   *  a declaration block would be longer than the picture. */
  const refer = (raw: string, lineNo: number): string | null => {
    let name = raw.trim().replace(/^["']|["']$/g, '')
    if (!name) {
      ast.errors.push(`line ${lineNo}: an edge is missing one of its ends`)
      return null
    }
    let inlineId: string | undefined
    let inlineAccent: string | undefined
    const withAccent = /^(.+?)\s+#([A-Za-z]+)$/.exec(name)
    if (withAccent && ACCENTS.has(withAccent[2].toLowerCase())) {
      name = withAccent[1].trim()
      inlineAccent = withAccent[2].toLowerCase()
    }
    const withId = /^(.+?)\s+as\s+([A-Za-z_][\w-]*)$/.exec(name)
    if (withId) {
      name = withId[1].trim()
      inlineId = withId[2]
    }
    const m = SHAPE_OPEN.find(([re]) => re.test(name))
    if (m) {
      const label = name.match(m[0])![1].trim()
      return declare(label, m[1], inlineId, inlineAccent).id
    }
    if (inlineId) return declare(name, 'box', inlineId, inlineAccent).id
    if (byId.has(name)) return name
    const viaLabel = byLabel.get(name.toLowerCase())
    if (viaLabel) return viaLabel
    const viaSlug = byId.get(slug(name))
    if (viaSlug) return viaSlug.id
    return declare(name, 'box').id
  }

  const lines = source.split(/\r?\n/)
  lines.forEach((raw, i) => {
    const lineNo = i + 1
    const line = raw.replace(/\s+(?:#|\/\/)\s.*$/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) return

    // direction
    const dir = /^direction\s*[:=]\s*(\w+)/i.exec(line)
    if (dir) {
      const d = dir[1].toLowerCase()
      if (['down', 'tb', 'vertical', 'v'].includes(d)) ast.direction = 'down'
      else if (['right', 'lr', 'horizontal', 'h'].includes(d)) ast.direction = 'right'
      else ast.errors.push(`line ${lineNo}: direction "${dir[1]}" is not one of down, right`)
      return
    }

    // group "Name" { a, b, c }
    const grp = /^group\s+(?:"([^"]+)"|'([^']+)'|([^{]+?))\s*\{([^}]*)\}$/i.exec(line)
    if (grp) {
      const label = (grp[1] ?? grp[2] ?? grp[3] ?? '').trim()
      const members = grp[4].split(',').map((s) => s.trim()).filter(Boolean)
      if (members.length === 0) {
        ast.errors.push(`line ${lineNo}: group "${label}" lists no members`)
        return
      }
      ast.groups.push({ label, members: members.map((m) => refer(m, lineNo)).filter((x): x is string => !!x) })
      return
    }

    // edge: A -> B : label   (--> dashed, -- plain)
    const edge = /^(.+?)\s*(-->|->|--)\s*(.+)$/.exec(line)
    if (edge && !SHAPE_OPEN.some(([re]) => re.test(line))) {
      const { target, label } = splitEdgeLabel(edge[3])
      const from = refer(edge[1], lineNo)
      const to = refer(target, lineNo)
      if (!from || !to) return
      if (from === to) {
        ast.errors.push(`line ${lineNo}: "${edge[1].trim()}" points at itself; a self-loop is not drawable here`)
        return
      }
      const style: EdgeStyle = edge[2] === '-->' ? 'dashed' : edge[2] === '--' ? 'plain' : 'arrow'
      ast.edges.push({ from, to, style, ...(label ? { label } : {}) })
      return
    }

    // node declaration: [Label] as id #accent
    const decl = /^(.+?)(?:\s+as\s+([A-Za-z_][\w-]*))?(?:\s+#([A-Za-z]+))?$/.exec(line)
    if (decl) {
      const body = decl[1].trim()
      const shape = SHAPE_OPEN.find(([re]) => re.test(body))
      if (shape) {
        const accent = decl[3]?.toLowerCase()
        if (accent && !ACCENTS.has(accent)) {
          ast.errors.push(`line ${lineNo}: "#${accent}" is not an accent; use blue, mint, violet, amber, rose or grey`)
        }
        declare(body.match(shape[0])![1].trim(), shape[1], decl[2], accent && ACCENTS.has(accent) ? accent : undefined)
        return
      }
    }

    ast.errors.push(
      `line ${lineNo}: "${line}" is not a statement — a node is [Label], (Label), <Label> or ((Label)); an edge is a -> b`
    )
  })

  if (ast.nodes.length === 0) ast.errors.push('the diagram declares no nodes')
  return ast
}

// ── Layout ──────────────────────────────────────────────────────────────────

/** Longest-path ranking over the acyclic part of the graph.
 *
 *  A cycle has no layering, so the edges that close one are found first (DFS
 *  back-edges) and left out of the ranking — they are still drawn, routed
 *  around the outside. This is what keeps a feedback loop, which is most of
 *  what a control diagram IS, from collapsing the layout. */
function rankNodes(nodes: DiagramNode[], edges: DiagramEdge[]): { rank: Map<string, number>; back: Set<DiagramEdge> } {
  const out = new Map<string, DiagramEdge[]>()
  for (const n of nodes) out.set(n.id, [])
  for (const e of edges) out.get(e.from)?.push(e)

  const back = new Set<DiagramEdge>()
  const state = new Map<string, 0 | 1 | 2>() // unseen / on-stack / done
  const visit = (id: string) => {
    state.set(id, 1)
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to) ?? 0
      if (s === 1) back.add(e)
      else if (s === 0) visit(e.to)
    }
    state.set(id, 2)
  }
  for (const n of nodes) if ((state.get(n.id) ?? 0) === 0) visit(n.id)

  const forward = edges.filter((e) => !back.has(e))
  const indeg = new Map<string, number>()
  for (const n of nodes) indeg.set(n.id, 0)
  for (const e of forward) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)

  const rank = new Map<string, number>()
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  for (const id of queue) rank.set(id, 0)
  while (queue.length) {
    const id = queue.shift()!
    for (const e of forward.filter((f) => f.from === id)) {
      rank.set(e.to, Math.max(rank.get(e.to) ?? 0, (rank.get(id) ?? 0) + 1))
      const left = (indeg.get(e.to) ?? 1) - 1
      indeg.set(e.to, left)
      if (left === 0) queue.push(e.to)
    }
  }
  // Anything still unranked sits in a cycle every member of which had an
  // incoming forward edge; put it after whatever points at it.
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0)
  return { rank, back }
}

export function layoutDiagram(ast: DiagramAst): DiagramLayout {
  const { direction } = ast
  const { rank, back } = rankNodes(ast.nodes, ast.edges)

  const placed: PlacedNode[] = ast.nodes.map((n) => {
    // A decision wraps later: it is widened below, so a label that would
    // stack in a box stays on one line inside the diamond.
    const lines = wrapLabel(n.label, n.shape === 'diamond' ? WRAP_AT + 4 : WRAP_AT)
    const { w, h } = sizeOf(n.shape, lines)
    return { ...n, lines, w, h, x: 0, y: 0 }
  })
  const byId = new Map(placed.map((n) => [n.id, n]))

  // Rank buckets, in declaration order within each.
  const maxRank = Math.max(0, ...placed.map((n) => rank.get(n.id) ?? 0))
  const buckets: PlacedNode[][] = Array.from({ length: maxRank + 1 }, () => [])
  for (const n of placed) buckets[rank.get(n.id) ?? 0].push(n)

  // One barycentre sweep: a node sits near the average position of whatever
  // points at it. Two passes of this removes most crossings in the layered
  // diagrams this language is for, and costs nothing.
  const indexIn = (b: PlacedNode[], id: string) => b.findIndex((n) => n.id === id)
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r < buckets.length; r++) {
      const prev = buckets[r - 1]
      const score = new Map<string, number>()
      buckets[r].forEach((n, i) => {
        const parents = ast.edges
          .filter((e) => e.to === n.id && !back.has(e))
          .map((e) => indexIn(prev, e.from))
          .filter((k) => k >= 0)
        score.set(n.id, parents.length ? parents.reduce((s, k) => s + k, 0) / parents.length : i)
      })
      buckets[r].sort((a, b2) => (score.get(a.id) ?? 0) - (score.get(b2.id) ?? 0))
    }
  }

  // Place: rank along the flow axis, siblings across it.
  //
  // A grouped diagram needs wider gaps everywhere: a container is drawn
  // padded out from its members and carries a title band above them, so the
  // spacing that reads well for bare nodes puts one group's title inside its
  // neighbour's box.
  const grouped = ast.groups.length > 0
  const gapSibling = GAP_SIBLING + (grouped ? GROUP_PAD * 2 + GROUP_TITLE_H : 0)
  const gapRank = GAP_RANK + (grouped ? GROUP_PAD * 2 + GROUP_TITLE_H : 0)
  const alongSize = (n: PlacedNode) => (direction === 'down' ? n.h : n.w)
  const crossSize = (n: PlacedNode) => (direction === 'down' ? n.w : n.h)

  let along = 0
  const crossExtent: number[] = []
  buckets.forEach((bucket) => {
    let cross = 0
    for (const n of bucket) {
      if (direction === 'down') {
        n.x = cross
        n.y = along
      } else {
        n.y = cross
        n.x = along
      }
      cross += crossSize(n) + gapSibling
    }
    crossExtent.push(Math.max(0, cross - gapSibling))
    along += Math.max(...bucket.map(alongSize), 0) + gapRank
  })

  // Centre every rank on the widest one, so the diagram reads as a column
  // (or a row) rather than being flush to one edge.
  const widest = Math.max(...crossExtent, 0)
  buckets.forEach((bucket, r) => {
    const shift = (widest - crossExtent[r]) / 2
    for (const n of bucket) {
      if (direction === 'down') n.x += shift
      else n.y += shift
    }
  })

  // Pull each node toward the middle of what it connects to, then re-pack the
  // rank so nothing collides. Greedy packing alone spaces a rank evenly, which
  // leaves a plain chain of differently-sized boxes slightly out of line with
  // itself — every edge in it then draws a small jog, and a column of jogs
  // reads as a mistake. Two passes down and two up settle it.
  const cross = (n: PlacedNode) => (direction === 'down' ? n.x : n.y)
  const setCross = (n: PlacedNode, v: number) => {
    if (direction === 'down') n.x = v
    else n.y = v
  }
  const neighbourMid = (n: PlacedNode, from: PlacedNode[]) => {
    const centres = from.map((p) => cross(p) + crossSize(p) / 2)
    return centres.reduce((a, b) => a + b, 0) / centres.length
  }
  const repack = (bucket: PlacedNode[], want: Map<string, number>) => {
    let cursor = -Infinity
    for (const n of bucket) {
      const desired = want.get(n.id)
      const pos = desired === undefined ? cross(n) : desired - crossSize(n) / 2
      const put = Math.max(cursor, pos)
      setCross(n, put)
      cursor = put + crossSize(n) + gapSibling
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r < buckets.length; r++) {
      const want = new Map<string, number>()
      for (const n of buckets[r]) {
        const parents = ast.edges
          .filter((e) => e.to === n.id && !back.has(e))
          .map((e) => byId.get(e.from))
          .filter((p): p is PlacedNode => !!p && (rank.get(p.id) ?? 0) === r - 1)
        if (parents.length) want.set(n.id, neighbourMid(n, parents))
      }
      repack(buckets[r], want)
    }
    for (let r = buckets.length - 2; r >= 0; r--) {
      const want = new Map<string, number>()
      for (const n of buckets[r]) {
        const kids = ast.edges
          .filter((e) => e.from === n.id && !back.has(e))
          .map((e) => byId.get(e.to))
          .filter((k): k is PlacedNode => !!k && (rank.get(k.id) ?? 0) === r + 1)
        if (kids.length) want.set(n.id, neighbourMid(n, kids))
      }
      repack(buckets[r], want)
    }
  }

  // Groups: a container around the bounding box of its members. Drawn, not
  // laid out — members keep the position the flow gave them, so a group whose
  // members are scattered across the diagram simply draws a large box, which
  // is the honest picture of a grouping that does not follow the flow.
  const groups: PlacedGroup[] = []
  for (const g of ast.groups) {
    const members = g.members.map((m) => byId.get(m)).filter((n): n is PlacedNode => !!n)
    if (!members.length) continue
    const x1 = Math.min(...members.map((n) => n.x)) - GROUP_PAD
    const y1 = Math.min(...members.map((n) => n.y)) - GROUP_PAD - GROUP_TITLE_H
    const x2 = Math.max(...members.map((n) => n.x + n.w)) + GROUP_PAD
    const y2 = Math.max(...members.map((n) => n.y + n.h)) + GROUP_PAD
    groups.push({ label: g.label, x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
  }

  // Normalise so the whole drawing starts at (0,0) — groups can push it
  // negative, and a figure is positioned by its caller.
  const minX = Math.min(...placed.map((n) => n.x), ...groups.map((g) => g.x), 0)
  const minY = Math.min(...placed.map((n) => n.y), ...groups.map((g) => g.y), 0)
  for (const n of placed) {
    n.x -= minX
    n.y -= minY
  }
  for (const g of groups) {
    g.x -= minX
    g.y -= minY
  }

  const width = Math.max(...placed.map((n) => n.x + n.w), ...groups.map((g) => g.x + g.w), 0)
  const height = Math.max(...placed.map((n) => n.y + n.h), ...groups.map((g) => g.y + g.h), 0)

  // Edges: orthogonal, leaving the flow-facing side and entering the opposite
  // one. A back edge leaves sideways and runs around the outside instead, so
  // it never crosses the body of the diagram it is returning through.
  // An edge between ADJACENT ranks runs straight down the gap between them.
  // Anything else — a back edge, or one that skips a rank — would otherwise
  // be drawn straight through the boxes in between, which is what a flowchart
  // with an early exit looks like when nobody thought about routing. Those
  // get their own lane outside the drawing, one lane each so two of them
  // never sit on top of one another.
  let lanes = 0
  const edges: PlacedEdge[] = []
  for (const e of ast.edges) {
    const s = byId.get(e.from)
    const t = byId.get(e.to)
    if (!s || !t) continue
    const span = (rank.get(e.to) ?? 0) - (rank.get(e.from) ?? 0)
    const isBack = back.has(e) || span <= 0
    const detour = isBack || span > 1

    let aSide: DiagramSide
    let bSide: DiagramSide
    if (!detour) {
      aSide = direction === 'down' ? 'bottom' : 'right'
      bSide = direction === 'down' ? 'top' : 'left'
    } else if (isBack) {
      // A return path leaves and re-enters on the same side, so it reads as
      // a loop rather than as another step forward.
      aSide = direction === 'down' ? 'right' : 'bottom'
      bSide = aSide
    } else {
      // A skipping edge still moves forward: out of the side, along the lane,
      // and into the flow-facing side of its target.
      aSide = direction === 'down' ? 'right' : 'bottom'
      bSide = direction === 'down' ? 'top' : 'left'
    }
    const a = sidePoint(s, aSide)
    const b = sidePoint(t, bSide)
    const bends: { x: number; y: number }[] = []
    let labelAt: { x: number; y: number } | undefined

    if (!detour) {
      if (direction === 'down') {
        const mid = (a.y + b.y) / 2
        if (Math.abs(a.x - b.x) > 1) bends.push({ x: a.x, y: mid }, { x: b.x, y: mid })
        labelAt = { x: (a.x + b.x) / 2, y: mid }
      } else {
        const mid = (a.x + b.x) / 2
        if (Math.abs(a.y - b.y) > 1) bends.push({ x: mid, y: a.y }, { x: mid, y: b.y })
        labelAt = { x: mid, y: (a.y + b.y) / 2 }
      }
    } else {
      const lane = lanes++
      if (direction === 'down') {
        const out = width + 40 + lane * 30
        bends.push({ x: out, y: a.y })
        if (isBack) bends.push({ x: out, y: b.y })
        else bends.push({ x: out, y: b.y - GAP_RANK / 2 }, { x: b.x, y: b.y - GAP_RANK / 2 })
        labelAt = { x: out, y: (a.y + b.y) / 2 }
      } else {
        const out = height + 40 + lane * 30
        bends.push({ x: a.x, y: out })
        if (isBack) bends.push({ x: b.x, y: out })
        else bends.push({ x: b.x - GAP_RANK / 2, y: out }, { x: b.x - GAP_RANK / 2, y: b.y })
        labelAt = { x: (a.x + b.x) / 2, y: out }
      }
    }

    edges.push({
      ...e,
      a,
      b,
      bends,
      aT: sideT(s.shape, s.w, s.h, aSide),
      bT: sideT(t.shape, t.w, t.h, bSide),
      ...(e.label ? { labelAt } : {}),
    })
  }

  // Lanes sit outside the nodes, so the drawing is bigger than they are.
  const laneRoom = lanes > 0 ? 40 + lanes * 30 + 30 : 0
  return {
    direction,
    nodes: placed,
    edges,
    groups,
    width: direction === 'down' ? width + laneRoom : width,
    height: direction === 'right' ? height + laneRoom : height,
    errors: ast.errors,
  }
}

/** Parse and lay out in one call — what both the runtime builtin and the
 *  lint gate use, so neither can drift from the other. */
export function buildDiagram(source: string): DiagramLayout {
  return layoutDiagram(parseDiagram(source))
}

// ── Appearance ──────────────────────────────────────────────────────────────
//
// Theme tokens, never literal colours: a diagram authored with #e0e7ff is
// unreadable the moment the reader switches to dark mode, and lessons are
// read in both.

export interface NodeStyle {
  fill: string
  stroke: string
  radius: number
}

export function styleFor(node: DiagramNode): NodeStyle {
  const accent = node.accent === 'gray' ? 'grey' : node.accent
  const token =
    accent === 'grey' ? 'var(--muted-foreground)'
      : accent ? `var(--accent-${accent})`
      : node.shape === 'diamond' ? 'var(--accent-amber)'
      : node.shape === 'round' ? 'var(--accent-mint)'
      : node.shape === 'circle' ? 'var(--accent-violet)'
      : 'var(--accent-blue)'
  return {
    fill: `color-mix(in oklch, ${token} 12%, var(--card))`,
    stroke: token,
    // A stadium is a rectangle with its ends fully rounded; the renderer
    // clamps an over-large radius to half the height, so one number does it.
    radius: node.shape === 'round' ? 999 : node.shape === 'box' ? 12 : 0,
  }
}
