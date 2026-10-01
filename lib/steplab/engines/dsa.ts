// Data structures and algorithms (ENCT 252): sorting, hashing, Huffman coding,
// BST / AVL, heaps, B-trees, graph algorithms, expression stacks, recursion.
// (The DSA Lab widget runs arbitrary C++; these are the fixed, fully narrated
// textbook algorithms a first course drills.)

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, plist } from '../types'
import { act, box, cells, dot, drawBinary, heading, line, toneAt, trace, txt, type BNode } from '../draw'

const G = 'Data structures & algorithms'

// ── Sorting ─────────────────────────────────────────────────────────────────

interface SortEv { arr: number[]; hi: number[]; swap: number[]; sorted: Set<number>; note: string }

export function sortTrace(algo: string, input: number[]): { events: SortEv[]; cmp: number; moves: number } {
  const a = [...input]
  const events: SortEv[] = []
  let cmp = 0, moves = 0
  const sorted = new Set<number>()
  const snap = (hi: number[], swap: number[], note: string) => events.push({ arr: [...a], hi, swap, sorted: new Set(sorted), note })
  const swap = (i: number, j: number) => { [a[i], a[j]] = [a[j], a[i]]; moves++ }
  const n = a.length
  snap([], [], `Unsorted: ${a.join(' ')}. ${algo} sort.`)
  if (algo === 'bubble') {
    for (let pass = 0; pass < n - 1; pass++) {
      let swapped = false
      for (let j = 0; j < n - 1 - pass; j++) {
        cmp++
        snap([j, j + 1], [], `Pass ${pass + 1}: compare ${a[j]} and ${a[j + 1]}.`)
        if (a[j] > a[j + 1]) { swap(j, j + 1); swapped = true; snap([], [j, j + 1], `${a[j + 1]} > ${a[j]}: swap.`) }
      }
      sorted.add(n - 1 - pass)
      if (!swapped) { for (let k = 0; k < n; k++) sorted.add(k); snap([], [], 'No swaps this pass — already sorted, stop early.'); break }
    }
  } else if (algo === 'insertion') {
    sorted.add(0)
    for (let i = 1; i < n; i++) {
      const key = a[i]; let j = i - 1
      snap([i], [], `Take ${key} and insert it into the sorted prefix.`)
      while (j >= 0) {
        cmp++
        if (a[j] > key) { a[j + 1] = a[j]; moves++; snap([j, j + 1], [j, j + 1], `${a[j]} > ${key}: shift ${a[j]} right.`); j-- } else break
      }
      a[j + 1] = key
      for (let k = 0; k <= i; k++) sorted.add(k)
      snap([], [], `${key} lands at position ${j + 1}.`)
    }
  } else if (algo === 'selection') {
    for (let i = 0; i < n - 1; i++) {
      let m = i
      for (let j = i + 1; j < n; j++) { cmp++; snap([m, j], [], `Looking for the minimum of positions ${i}…${n - 1}: compare ${a[m]} with ${a[j]}.`); if (a[j] < a[m]) m = j }
      if (m !== i) { swap(i, m); snap([], [i, m], `Swap the minimum ${a[i]} into position ${i}.`) }
      sorted.add(i)
    }
    sorted.add(n - 1)
  } else if (algo === 'shell') {
    for (let gap = Math.floor(n / 2); gap > 0; gap = Math.floor(gap / 2)) {
      snap([], [], `Gap ${gap}: insertion-sort elements ${gap} apart.`)
      for (let i = gap; i < n; i++) {
        const t = a[i]; let j = i
        while (j >= gap) { cmp++; if (a[j - gap] > t) { a[j] = a[j - gap]; moves++; snap([j, j - gap], [j, j - gap], `Gap ${gap}: ${a[j]} moves right.`); j -= gap } else break }
        a[j] = t
      }
    }
    for (let k = 0; k < n; k++) sorted.add(k)
    snap([], [], 'Gap 1 finished: sorted.')
  } else if (algo === 'quick') {
    const qs = (lo: number, hi: number) => {
      if (lo >= hi) { if (lo === hi) sorted.add(lo); return }
      const pivot = a[hi]; let i = lo
      snap([hi], [], `Partition ${lo}…${hi} around pivot ${pivot} (the last element).`)
      for (let j = lo; j < hi; j++) { cmp++; snap([j, hi], [], `${a[j]} ≤ pivot ${pivot}?`); if (a[j] <= pivot) { if (i !== j) { swap(i, j); snap([], [i, j], `Yes: swap into the left part.`) } i++ } }
      if (i !== hi) swap(i, hi)
      sorted.add(i)
      snap([], [i, hi], `Pivot ${pivot} settles at position ${i}; everything left is ≤ it, everything right is >.`)
      qs(lo, i - 1); qs(i + 1, hi)
    }
    qs(0, n - 1)
  } else if (algo === 'merge') {
    const ms = (lo: number, hi: number) => {
      if (lo >= hi) return
      const mid = (lo + hi) >> 1
      ms(lo, mid); ms(mid + 1, hi)
      const L = a.slice(lo, mid + 1), R = a.slice(mid + 1, hi + 1)
      let i = 0, j = 0, k = lo
      snap([...Array(hi - lo + 1).keys()].map((x) => x + lo), [], `Merge [${L.join(' ')}] and [${R.join(' ')}].`)
      while (i < L.length && j < R.length) { cmp++; a[k++] = L[i] <= R[j] ? L[i++] : R[j++]; moves++; snap([k - 1], [k - 1], `Take the smaller front element: ${a[k - 1]}.`) }
      while (i < L.length) { a[k++] = L[i++]; moves++ }
      while (j < R.length) { a[k++] = R[j++]; moves++ }
      snap([], [], `Merged: ${a.slice(lo, hi + 1).join(' ')}.`)
    }
    ms(0, n - 1)
    for (let k = 0; k < n; k++) sorted.add(k)
    snap([], [], 'Sorted.')
  } else if (algo === 'heap') {
    const sift = (size: number, i: number) => {
      for (;;) {
        let l = 2 * i + 1, r = l + 1, m = i
        if (l < size) { cmp++; if (a[l] > a[m]) m = l }
        if (r < size) { cmp++; if (a[r] > a[m]) m = r }
        if (m === i) return
        swap(i, m); snap([], [i, m], `Sift down: swap ${a[m]} with its larger child.`); i = m
      }
    }
    for (let i = (n >> 1) - 1; i >= 0; i--) { snap([i], [], `Build max-heap: sift down from index ${i}.`); sift(n, i) }
    for (let end = n - 1; end > 0; end--) { swap(0, end); sorted.add(end); snap([], [0, end], `Move the maximum ${a[end]} to its final place.`); sift(end, 0) }
    sorted.add(0)
  } else if (algo === 'radix') {
    const max = Math.max(...a)
    for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
      const out: number[] = []
      for (let d = 0; d < 10; d++) for (const v of a) if (Math.floor(v / exp) % 10 === d) { out.push(v); moves++ }
      snap([], [], `Stable-sort by the ${exp === 1 ? 'ones' : exp === 10 ? 'tens' : exp === 100 ? 'hundreds' : `10^${Math.log10(exp)}`} digit → ${out.join(' ')}.`)
      for (let k = 0; k < n; k++) a[k] = out[k]
      snap([], [], `After digit ${Math.log10(exp) + 1}: ${a.join(' ')}`)
    }
    for (let k = 0; k < n; k++) sorted.add(k)
  } else throw new LabError(`unknown algorithm "${algo}" — bubble, insertion, selection, shell, quick, merge, heap or radix`)
  for (let k = 0; k < n; k++) sorted.add(k)
  snap([], [], `Sorted: ${a.join(' ')}.`)
  return { events, cmp, moves }
}

function sortRun(p: Params) {
  const algo = pstr(p, 'algo', 'bubble')
  const arr = pnums(p, 'values', [5, 1, 4, 2, 8, 9, 3])
  if (arr.length < 2 || arr.length > 24) throw new LabError('give 2–24 values')
  if (algo === 'radix' && arr.some((v) => v < 0 || !Number.isInteger(v))) throw new LabError('radix sort needs non-negative integers')
  const { events, cmp, moves } = sortTrace(algo, arr)
  const n = arr.length, max = Math.max(...arr, 1), min = Math.min(...arr, 0)
  const bw = Math.min(46, Math.floor(540 / n)), W = 30 + n * bw + 30, H = 250
  const scale = 150 / (max - Math.min(0, min) || 1)
  const frames: Frame[] = events.map((e, k) => {
    const d: Prim[] = [act(heading(20, 14, `${algo} sort · ${n} elements ✎`), { do: 'edit', param: 'values', hint: 'Click to type your own numbers' })]
    e.arr.forEach((v, i) => {
      const h = Math.max(4, (v - Math.min(0, min)) * scale)
      const tone: Tone = e.swap.includes(i) ? 'rose' : e.hi.includes(i) ? 'amber' : e.sorted.has(i) ? 'mint' : 'blue'
      d.push({ k: 'rect', x: 30 + i * bw + 2, y: 200 - h, w: bw - 4, h, tone, r: 3 })
      d.push(act(txt(30 + i * bw + bw / 2, 216, String(v), { size: 11, mono: true, anchor: 'middle' }), { do: 'edit', param: 'values', hint: 'Click to type your own numbers' }))
    })
    d.push(txt(20, H - 8, `comparisons ${events.slice(0, k + 1).length >= 0 ? cmp : cmp}  ·  moves ${moves}`, { size: 11.5, mono: true, tone: 'amber' }))
    return { draw: d, note: e.note }
  })
  const sorted = events[events.length - 1].arr
  return trace(W, H, frames, { comparisons: String(cmp), moves: String(moves), sorted: sorted.join(' ') })
}

// ── Hashing ─────────────────────────────────────────────────────────────────

function hashRun(p: Params) {
  const m = pnum(p, 'size', 7), method = pstr(p, 'method', 'linear')
  const keys = pnums(p, 'keys', [50, 700, 76, 85, 92, 73, 101])
  if (m < 2 || m > 16) throw new LabError('size must be 2–16')
  const table: (number | null)[] = Array(m).fill(null)
  const chains: number[][] = Array.from({ length: m }, () => [])
  const log: { key: number; probes: number[]; slot: number | null; table: (number | null)[]; chains: number[][] }[] = []
  let totalProbes = 0
  const h2 = (k: number) => 1 + (k % (m - 1)) // double hashing second hash
  for (const k of keys) {
    const home = ((k % m) + m) % m
    const probes: number[] = []
    let slot: number | null = null
    if (method === 'chaining') { chains[home].push(k); probes.push(home); slot = home }
    else {
      for (let i = 0; i < m; i++) {
        const idx = method === 'linear' ? (home + i) % m : method === 'quadratic' ? (home + i * i) % m : (home + i * h2(k)) % m
        probes.push(idx)
        if (table[idx] === null) { table[idx] = k; slot = idx; break }
      }
    }
    totalProbes += probes.length
    log.push({ key: k, probes, slot, table: [...table], chains: chains.map((c) => [...c]) })
  }
  if (!['chaining', 'linear', 'quadratic', 'double'].includes(method)) throw new LabError('method is chaining, linear, quadratic or double')
  const W = 560, H = 60 + m * 32 + 60
  const frames: Frame[] = [{ draw: [act(heading(20, 14, `${method} · h(k) = k mod ${m} ✎`), { do: 'edit', param: 'keys', hint: 'Click to type the keys to insert' }), ...Array.from({ length: m }, (_, i) => box(70, 34 + i * 32, 90, 26, '', 'dim', undefined)), ...Array.from({ length: m }, (_, i) => txt(56, 52 + i * 32, String(i), { size: 11, mono: true, anchor: 'end', tone: 'dim' }))], note: `Insert ${keys.length} keys into a table of ${m} slots. h(k) = k mod ${m} picks the home slot.` }]
  log.forEach((e, k) => {
    const d: Prim[] = [act(heading(20, 14, `${method} · h(k) = k mod ${m} ✎`), { do: 'edit', param: 'keys', hint: 'Click to type the keys to insert' })]
    for (let i = 0; i < m; i++) {
      const isProbe = e.probes.includes(i), placed = e.slot === i
      const v = e.table[i]
      d.push(box(70, 34 + i * 32, 90, 26, method === 'chaining' ? '' : v === null ? '' : String(v), placed ? 'mint' : isProbe && method !== 'chaining' ? 'rose' : v === null ? 'dim' : 'idle'))
      d.push(txt(56, 52 + i * 32, String(i), { size: 11, mono: true, anchor: 'end', tone: 'dim' }))
      if (method === 'chaining') e.chains[i].forEach((c, ci) => d.push(box(170 + ci * 58, 34 + i * 32, 52, 26, String(c), placed && ci === e.chains[i].length - 1 ? 'mint' : 'idle')))
    }
    d.push(txt(300, 60, `inserting ${e.key}`, { size: 14, mono: true, bold: true, tone: 'blue' }))
    frames.push({ draw: d, note: method === 'chaining' ? `${e.key} mod ${m} = ${e.probes[0]}: append to the chain at slot ${e.probes[0]}.` : e.probes.length === 1 ? `${e.key} mod ${m} = ${e.probes[0]}: slot free — placed.` : `${e.key} → slot ${e.probes[0]} occupied; ${method} probing tries ${e.probes.slice(1).join(' → ')} and settles in ${e.slot}.` })
    void k
  })
  const load = keys.length / m
  return trace(W, H, frames, { table: method === 'chaining' ? chains.map((c) => c.join('|') || '-').join(' ') : table.map((v) => (v === null ? '-' : String(v))).join(' '), probes: String(totalProbes), loadFactor: fmt(load, 2) })
}

// ── Huffman ─────────────────────────────────────────────────────────────────

interface HNode { label: string; w: number; l?: HNode; r?: HNode; id: number }

function huffmanRun(p: Params) {
  const text = pstr(p, 'text', 'aaaabbc')
  const freq = new Map<string, number>()
  if (/^\s*([^:\s]+:\d+)(\s+[^:\s]+:\d+)*\s*$/.test(text)) for (const t of text.trim().split(/\s+/)) { const [c, f] = t.split(':'); freq.set(c, Number(f)) }
  else for (const ch of text) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  if (freq.size < 2) throw new LabError('need at least two distinct symbols')
  let id = 0
  let forest: HNode[] = [...freq.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([c, w]) => ({ label: c === ' ' ? '␠' : c, w, id: id++ }))
  const snaps: { forest: HNode[]; merged?: [HNode, HNode] }[] = [{ forest: [...forest] }]
  while (forest.length > 1) {
    forest.sort((a, b) => a.w - b.w || a.id - b.id)
    const [x, y] = forest
    const node: HNode = { label: '', w: x.w + y.w, l: x, r: y, id: id++ }
    forest = [...forest.slice(2), node]
    snaps.push({ forest: [...forest], merged: [x, y] })
  }
  const codes = new Map<string, string>()
  const walk = (n: HNode, c: string) => { if (!n.l) codes.set(n.label, c || '0'); else { walk(n.l, c + '0'); walk(n.r!, c + '1') } }
  walk(forest[0], '')
  const toB = (n: HNode): BNode => ({ label: n.l ? String(n.w) : `${n.label}`, sub: n.l ? undefined : `${n.w}`, tone: n.l ? 'idle' : 'mint', left: n.l ? toB(n.l) : null, right: n.r ? toB(n.r) : null, edgeL: n.l ? '0' : undefined, edgeR: n.r ? '1' : undefined })
  const total = [...freq.entries()].reduce((a, [c, f]) => a + f * codes.get(c === ' ' ? '␠' : c)!.length, 0)
  const symbols = [...freq.values()].reduce((a, b) => a + b, 0)
  const W = 620, H = 340
  const frames: Frame[] = snaps.map((s, k) => {
    const d: Prim[] = [act(heading(20, 14, 'Huffman coding — repeatedly merge the two lightest trees ✎'), { do: 'edit', param: 'text', hint: 'Click to type the text to encode' })]
    let x = 20
    s.forest.forEach((t) => {
      const { prims, width, height } = drawBinary(toB(t), 34, 46, x + 17, 60, 15)
      d.push(...prims); x += Math.max(width, 40) + 12; void height
    })
    return { draw: d, note: k === 0 ? `Start with one leaf per symbol, weighted by frequency: ${[...freq].map(([c, f]) => `${c}:${f}`).join('  ')}.` : `Merge the two lightest trees (${s.merged![0].w} and ${s.merged![1].w}) under a new node of weight ${s.merged![0].w + s.merged![1].w}.` }
  })
  const table: Prim[] = [heading(20, 200, 'Codes (left edge 0, right edge 1)')]
  ;[...codes.entries()].sort((a, b) => a[1].length - b[1].length).forEach(([c, code], i) => table.push(txt(20 + (i % 3) * 190, 222 + Math.floor(i / 3) * 20, `${c} → ${code}`, { size: 12, mono: true, tone: toneAt(i) })))
  table.push(txt(20, 300, `${total} bits vs ${symbols * 8} bits in ASCII  (${fmt((total / (symbols * 8)) * 100, 1)}%)`, { size: 12, mono: true, bold: true, tone: 'mint' }))
  frames[frames.length - 1].draw.push(...table)
  return trace(W, H, frames, { totalBits: String(total), asciiBits: String(symbols * 8), codes: [...codes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([c, v]) => `${c}=${v}`).join(' ') })
}

// ── BST / AVL ───────────────────────────────────────────────────────────────

interface TNode { k: number; l: TNode | null; r: TNode | null; h: number }
const ht = (n: TNode | null) => (n ? n.h : 0)
const upd = (n: TNode) => { n.h = 1 + Math.max(ht(n.l), ht(n.r)) }
const bf = (n: TNode | null) => (n ? ht(n.l) - ht(n.r) : 0)
function rotR(y: TNode): TNode { const x = y.l!; y.l = x.r; x.r = y; upd(y); upd(x); return x }
function rotL(x: TNode): TNode { const y = x.r!; x.r = y.l; y.l = x; upd(x); upd(y); return y }

export function treeOps(mode: string, ops: string[]) {
  let root: TNode | null = null
  const steps: { root: TNode | null; note: string; hot?: number }[] = []
  const clone = (n: TNode | null): TNode | null => (n ? { k: n.k, h: n.h, l: clone(n.l), r: clone(n.r) } : null)
  const avl = mode === 'avl'
  const notes: string[] = []
  const insert = (n: TNode | null, k: number): TNode => {
    if (!n) return { k, l: null, r: null, h: 1 }
    if (k < n.k) n.l = insert(n.l, k); else if (k > n.k) n.r = insert(n.r, k); else return n
    upd(n)
    if (!avl) return n
    const b = bf(n)
    if (b > 1 && k < n.l!.k) { notes.push(`imbalance at ${n.k} (left-left) → right rotation`); return rotR(n) }
    if (b < -1 && k > n.r!.k) { notes.push(`imbalance at ${n.k} (right-right) → left rotation`); return rotL(n) }
    if (b > 1 && k > n.l!.k) { notes.push(`imbalance at ${n.k} (left-right) → left rotation on ${n.l!.k}, then right rotation`); n.l = rotL(n.l!); return rotR(n) }
    if (b < -1 && k < n.r!.k) { notes.push(`imbalance at ${n.k} (right-left) → right rotation on ${n.r!.k}, then left rotation`); n.r = rotR(n.r!); return rotL(n) }
    return n
  }
  const minNode = (n: TNode): TNode => (n.l ? minNode(n.l) : n)
  const remove = (n: TNode | null, k: number): TNode | null => {
    if (!n) return null
    if (k < n.k) n.l = remove(n.l, k); else if (k > n.k) n.r = remove(n.r, k)
    else {
      if (!n.l || !n.r) return n.l ?? n.r
      const s = minNode(n.r); n.k = s.k; n.r = remove(n.r, s.k)
    }
    upd(n)
    if (!avl) return n
    const b = bf(n)
    if (b > 1 && bf(n.l) >= 0) { notes.push(`imbalance at ${n.k} → right rotation`); return rotR(n) }
    if (b > 1) { notes.push(`imbalance at ${n.k} → left-right double rotation`); n.l = rotL(n.l!); return rotR(n) }
    if (b < -1 && bf(n.r) <= 0) { notes.push(`imbalance at ${n.k} → left rotation`); return rotL(n) }
    if (b < -1) { notes.push(`imbalance at ${n.k} → right-left double rotation`); n.r = rotR(n.r!); return rotL(n) }
    return n
  }
  steps.push({ root: null, note: `Empty ${avl ? 'AVL' : 'binary search'} tree.` })
  for (const op of ops) {
    const m = /^(insert|delete|i|d)?\s*(-?\d+)$/i.exec(op.trim())
    if (!m) throw new LabError(`operation "${op}" — write 25 (insert) or delete 25`)
    const k = Number(m[2]); const del = /^d/i.test(m[1] ?? '')
    notes.length = 0
    root = del ? remove(root, k) : insert(root, k)
    steps.push({ root: clone(root), note: `${del ? 'Delete' : 'Insert'} ${k}${notes.length ? ': ' + notes.join('; ') : ''}${avl && !notes.length ? ' — still balanced, no rotation.' : ''}.`, hot: k })
  }
  return { steps, root }
}

const toBNode = (n: TNode | null, hot?: number, showBf = false): BNode | null => n ? { label: String(n.k), tone: n.k === hot ? 'blue' : 'idle', sub: showBf ? `bf ${bf(n)}` : undefined, left: toBNode(n.l, hot, showBf), right: toBNode(n.r, hot, showBf) } : null
const inorder = (n: TNode | null): number[] => (n ? [...inorder(n.l), n.k, ...inorder(n.r)] : [])
const preorder = (n: TNode | null): number[] => (n ? [n.k, ...preorder(n.l), ...preorder(n.r)] : [])
const postorder = (n: TNode | null): number[] => (n ? [...postorder(n.l), ...postorder(n.r), n.k] : [])

function bstRun(p: Params) {
  const mode = pstr(p, 'mode', 'avl')
  const ops = plist(p, 'ops', ['10', '20', '30', '40', '50', '25'], /[;,\n]/)
  const { steps, root } = treeOps(mode, ops)
  const W = 620, H = 340
  const frames: Frame[] = steps.map((s) => {
    const d: Prim[] = [act(heading(20, 14, (mode === 'avl' ? 'AVL tree — balance factor under each node' : 'Binary search tree') + ' ✎'), { do: 'edit', param: 'ops', hint: 'Click to edit the keys to insert / delete' })]
    const { prims } = drawBinary(toBNode(s.root, s.hot, mode === 'avl'), 44, 58, 40, 60, 16)
    d.push(...prims)
    d.push(txt(20, H - 12, `inorder ${inorder(s.root).join(' ')}`, { size: 11, mono: true, tone: 'amber' }))
    return { draw: d, note: s.note }
  })
  return trace(W, H, frames, { inorder: inorder(root).join(' '), preorder: preorder(root).join(' '), postorder: postorder(root).join(' '), height: String(ht(root)), root: root ? String(root.k) : '' })
}

// ── Heap ────────────────────────────────────────────────────────────────────

function heapRun(p: Params) {
  const kind = pstr(p, 'kind', 'min')
  const ops = plist(p, 'ops', ['5', '3', '8', '1', '9', 'extract', 'extract'], /[;,\s]+/)
  const less = (a: number, b: number) => (kind === 'min' ? a < b : a > b)
  const h: number[] = []
  const snaps: { arr: number[]; hi: number[]; note: string }[] = [{ arr: [], hi: [], note: `Empty ${kind}-heap: a complete binary tree in an array, parent = ⌊(i−1)/2⌋.` }]
  for (const op of ops) {
    if (/^extract|^pop/i.test(op)) {
      if (!h.length) throw new LabError('extract on an empty heap')
      const top = h[0]
      h[0] = h[h.length - 1]; h.pop()
      snaps.push({ arr: [...h], hi: [0], note: `Extract ${top}: move the last element to the root, then sift down.` })
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < h.length && less(h[l], h[m])) m = l
        if (r < h.length && less(h[r], h[m])) m = r
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]]
        snaps.push({ arr: [...h], hi: [i, m], note: `Sift down: swap with the ${kind === 'min' ? 'smaller' : 'larger'} child ${h[i]}.` })
        i = m
      }
      snaps.push({ arr: [...h], hi: [], note: `Extracted ${top}. Heap: ${h.join(' ') || '(empty)'}.` })
    } else {
      const v = Number(op)
      if (!Number.isFinite(v)) throw new LabError(`"${op}" is not a number or "extract"`)
      h.push(v)
      snaps.push({ arr: [...h], hi: [h.length - 1], note: `Insert ${v} at the end, then sift up.` })
      let i = h.length - 1
      while (i > 0 && less(h[i], h[(i - 1) >> 1])) {
        const par = (i - 1) >> 1;
        [h[i], h[par]] = [h[par], h[i]]
        snaps.push({ arr: [...h], hi: [i, par], note: `${h[par]} beats its parent ${h[i]}: swap up.` })
        i = par
      }
    }
  }
  const toTree = (arr: number[], i: number, hi: number[]): BNode | null => (i < arr.length ? { label: String(arr[i]), tone: hi.includes(i) ? 'amber' : 'idle', left: toTree(arr, 2 * i + 1, hi), right: toTree(arr, 2 * i + 2, hi) } : null)
  const W = 620, H = 330
  const frames: Frame[] = snaps.map((s) => {
    const d: Prim[] = [act(heading(20, 14, `${kind}-heap ✎`), { do: 'edit', param: 'ops', hint: 'Click to edit the operations (numbers insert; extract removes the root)' })]
    d.push(...drawBinary(toTree(s.arr, 0, s.hi), 46, 58, 60, 84, 16).prims)
    d.push(...cells(20, 30, s.arr, 34, 26, s.arr.map((_, i) => (s.hi.includes(i) ? 'amber' : undefined))))
    return { draw: d, note: s.note }
  })
  return trace(W, H, frames, { array: h.join(' ') })
}

// ── B-tree / B+ tree ────────────────────────────────────────────────────────

interface BT { keys: number[]; kids: BT[]; leaf: boolean }

export function btreeInsert(root: BT, k: number, order: number, plus: boolean): { root: BT; split: string[] } {
  const split: string[] = []
  const maxKeys = order - 1
  const mid = Math.floor((order - 1) / 2)
  const ins = (n: BT): { key: number; right: BT } | null => {
    if (n.leaf) {
      if (n.keys.includes(k)) return null
      n.keys.push(k); n.keys.sort((a, b) => a - b)
    } else {
      let i = 0
      while (i < n.keys.length && k >= n.keys[i] + (plus ? 0 : 1) && (plus ? k >= n.keys[i] : k > n.keys[i])) i++
      const up = ins(n.kids[i])
      if (up) { n.keys.splice(i, 0, up.key); n.kids.splice(i + 1, 0, up.right) }
    }
    if (n.keys.length <= maxKeys) return null
    if (n.leaf && plus) {
      const right: BT = { keys: n.keys.splice(mid + 1 - 0), kids: [], leaf: true }
      // B+ : the separator is COPIED up and stays in the right leaf
      split.push(`leaf splits: ${n.keys.join(',')} | ${right.keys.join(',')} — ${right.keys[0]} is copied up`)
      return { key: right.keys[0], right }
    }
    const key = n.keys[mid]
    const right: BT = { keys: n.keys.splice(mid + 1), kids: n.leaf ? [] : n.kids.splice(mid + 1), leaf: n.leaf }
    n.keys.pop()
    split.push(`node splits around ${key}: ${n.keys.join(',')} | ${key} | ${right.keys.join(',')} — ${key} moves up`)
    return { key, right }
  }
  const up = ins(root)
  if (up) return { root: { keys: [up.key], kids: [root, up.right], leaf: false }, split }
  return { root, split }
}

function btreeRun(p: Params) {
  const order = pnum(p, 'order', 3), plus = pstr(p, 'variant', 'btree') === 'bplus'
  if (order < 3 || order > 6) throw new LabError('order must be 3–6')
  const keys = pnums(p, 'keys', [1, 2, 3, 4, 5, 6, 7])
  let root: BT = { keys: [], kids: [], leaf: true }
  const snaps: { root: BT; k: number | null; note: string }[] = [{ root: JSON.parse(JSON.stringify(root)), k: null, note: `${plus ? 'B+' : 'B'}-tree of order ${order}: at most ${order - 1} keys per node, all leaves on one level.` }]
  for (const k of keys) {
    const r = btreeInsert(root, k, order, plus); root = r.root
    snaps.push({ root: JSON.parse(JSON.stringify(root)), k, note: `Insert ${k}${r.split.length ? ' — ' + r.split.join('; ') : ' — fits in its leaf, no split'}.` })
  }
  const W = 640, H = 300
  interface LaidOut { x: number; w: number; node: BT; y: number; kids: LaidOut[] }
  const layout = (n: BT, depth: number, xs: { x: number }): LaidOut => {
    const w = Math.max(1, n.keys.length) * 26 + 10
    const kids = n.kids.map((c) => layout(c, depth + 1, xs))
    let x: number
    if (kids.length) x = (kids[0].x + kids[kids.length - 1].x + kids[kids.length - 1].w - w) / 2 + 0
    else { x = xs.x; xs.x += w + 12 }
    return { x, w, node: n, y: 40 + depth * 70, kids }
  }
  const frames: Frame[] = snaps.map((s) => {
    const d: Prim[] = [act(heading(20, 14, `${plus ? 'B+' : 'B'}-tree · order ${order} ✎`), { do: 'edit', param: 'keys', hint: 'Click to type the keys to insert' })]
    const L = layout(s.root, 0, { x: 20 })
    const draw = (n: ReturnType<typeof layout>) => {
      n.kids.forEach((c) => { d.push(line(n.x + n.w / 2, n.y + 26, c.x + c.w / 2, c.y, 'dim', { w: 1.2 })); draw(c) })
      n.node.keys.forEach((k, i) => d.push(box(n.x + 5 + i * 26, n.y, 24, 26, String(k), k === s.k ? 'blue' : 'idle')))
      if (!n.node.keys.length) d.push(box(n.x, n.y, 36, 26, '', 'dim'))
    }
    draw(L)
    if (plus) { /* leaves are chained in a B+ tree */ const leaves: ReturnType<typeof layout>[] = []; const collect = (n: ReturnType<typeof layout>) => (n.kids.length ? n.kids.forEach(collect) : leaves.push(n)); collect(L); for (let i = 0; i < leaves.length - 1; i++) d.push({ k: 'line', x1: leaves[i].x + leaves[i].w, y1: leaves[i].y + 13, x2: leaves[i + 1].x, y2: leaves[i + 1].y + 13, tone: 'mint', arrow: true, w: 1.2 }) }
    return { draw: d, note: s.note }
  })
  const height = (n: BT): number => (n.leaf ? 1 : 1 + height(n.kids[0]))
  const flat = (n: BT): number[] => (n.leaf ? n.keys : n.kids.flatMap(flat))
  return trace(W, H, frames, { height: String(height(root)), rootKeys: root.keys.join(','), leafKeys: flat(root).join(' ') })
}

// ── Graph algorithms ────────────────────────────────────────────────────────

function parseWGraph(s: string, directed: boolean) {
  const edges = s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((e) => {
    const m = /^(\w+)\s*[->]+\s*(\w+)(?:\s*:\s*(-?\d+(?:\.\d+)?))?$/.exec(e)
    if (!m) throw new LabError(`edge "${e}" — write A-B:4 (or A>B for directed)`)
    return { a: m[1], b: m[2], w: m[3] === undefined ? 1 : Number(m[3]) }
  })
  return { nodes: [...new Set(edges.flatMap((e) => [e.a, e.b]))], edges, directed }
}

function graphRun(p: Params) {
  const algo = pstr(p, 'algo', 'bfs')
  const directed = algo === 'topo'
  const { nodes, edges } = parseWGraph(pstr(p, 'graph', 'A-B:4;A-H:8;B-C:8;B-H:11;C-D:7;C-I:2;C-F:4;D-E:9;D-F:14;E-F:10;F-G:2;G-H:1;G-I:6;H-I:7'), directed)
  // The parameter's default ("A") is only a placeholder for a graph the student has since replaced.
  const startRaw = pstr(p, 'start', nodes[0])
  const src = nodes.includes(startRaw) ? startRaw : startRaw === 'A' ? nodes[0] : (() => { throw new LabError(`start "${startRaw}" is not a node (${nodes.join(', ')})`) })()
  const n = nodes.length, cx = 190, cy = 150, R = 110
  const pos = new Map(nodes.map((v, i) => [v, [cx + R * Math.cos((2 * Math.PI * i) / n - Math.PI / 2), cy + R * Math.sin((2 * Math.PI * i) / n - Math.PI / 2)]]))
  const adj = (v: string) => edges.filter((e) => e.a === v || (!directed && e.b === v)).map((e) => ({ to: e.a === v ? e.b : e.a, w: e.w }))
  const W = 640, H = 340
  const frames: Frame[] = []
  const paint = (title: string, st: Map<string, Tone>, treeEdges: Set<string>, side: string[], sideTitle: string): Prim[] => {
    const d: Prim[] = [act(heading(20, 14, title + ' ✎'), { do: 'edit', param: 'graph', hint: 'Click to edit the graph (A-B:4;B-C:2…)' })]
    for (const e of edges) {
      const [x1, y1] = pos.get(e.a)!, [x2, y2] = pos.get(e.b)!
      const t = treeEdges.has(`${e.a}-${e.b}`) || treeEdges.has(`${e.b}-${e.a}`)
      d.push(line(x1, y1, x2, y2, t ? 'mint' : 'dim', { w: t ? 3.2 : 1.1, arrow: directed }))
      if (algo === 'prim' || algo === 'kruskal') d.push(txt((x1 + x2) / 2, (y1 + y2) / 2 - 3, String(e.w), { size: 10.5, mono: true, anchor: 'middle', tone: 'amber' }))
    }
    for (const v of nodes) { const [x, y] = pos.get(v)!; d.push(dot(x, y, 16, v, st.get(v) ?? 'idle')) }
    d.push(heading(390, 40, sideTitle))
    side.slice(0, 14).forEach((s, i) => d.push(txt(390, 62 + i * 18, s, { size: 11.5, mono: true })))
    return d
  }
  const summary: Record<string, string> = {}
  if (algo === 'bfs' || algo === 'dfs') {
    const seen = new Set<string>([src]), order: string[] = [], tree = new Set<string>()
    const frontier = [src]
    frames.push({ draw: paint(algo.toUpperCase(), new Map([[src, 'amber' as Tone]]), tree, [`${algo === 'bfs' ? 'queue' : 'stack'}: ${src}`], 'Visit order'), note: `Start at ${src}. ${algo === 'bfs' ? 'BFS uses a queue: explore level by level.' : 'DFS uses a stack: dive as deep as possible, then backtrack.'}` })
    const vis = new Set<string>()
    while (frontier.length) {
      const v = algo === 'bfs' ? frontier.shift()! : frontier.pop()!
      if (vis.has(v)) continue
      vis.add(v); order.push(v)
      const st = new Map<string, Tone>()
      vis.forEach((x) => st.set(x, 'mint')); frontier.forEach((x) => st.set(x, 'amber')); st.set(v, 'blue')
      const nb = adj(v).map((x) => x.to).filter((x) => !vis.has(x)).sort()
      for (const x of (algo === 'dfs' ? [...nb].reverse() : nb)) { if (algo === 'bfs') { if (!seen.has(x)) { seen.add(x); frontier.push(x); tree.add(`${v}-${x}`) } } else { if (!frontier.includes(x)) { frontier.push(x) } if (!seen.has(x)) { seen.add(x); tree.add(`${v}-${x}`) } } }
      frontier.forEach((x) => { if (!vis.has(x)) st.set(x, 'amber') })
      frames.push({ draw: paint(algo.toUpperCase(), st, tree, [`${algo === 'bfs' ? 'queue' : 'stack'}: ${frontier.join(' ') || '∅'}`, ...order.map((o, i) => `${i + 1}. ${o}`)], 'Visit order'), note: `Visit ${v}${nb.length ? `; discover ${nb.join(', ')}` : ' — no new neighbours'}.` })
    }
    summary.order = order.join(' ')
  } else if (algo === 'prim') {
    const inT = new Set([src]), tree = new Set<string>(); let total = 0
    frames.push({ draw: paint('Prim', new Map([[src, 'mint' as Tone]]), tree, [], 'Tree edges'), note: `Grow one tree from ${src}: always add the cheapest edge leaving it.` })
    const picked: string[] = []
    while (inT.size < n) {
      const cand = edges.filter((e) => inT.has(e.a) !== inT.has(e.b)).sort((a, b) => a.w - b.w)
      if (!cand.length) break
      const e = cand[0]; inT.add(e.a); inT.add(e.b); tree.add(`${e.a}-${e.b}`); total += e.w; picked.push(`${e.a}-${e.b} (${e.w})`)
      frames.push({ draw: paint('Prim', new Map([...inT].map((x) => [x, 'mint' as Tone])), tree, [...picked, `total ${total}`], 'Tree edges'), note: `Cheapest edge crossing the cut: ${e.a}–${e.b}, weight ${e.w}.` })
    }
    summary.weight = String(total); summary.edges = picked.length ? String(picked.length) : '0'
  } else if (algo === 'kruskal') {
    const parent = new Map(nodes.map((v) => [v, v])); const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!))
    const sorted = [...edges].sort((a, b) => a.w - b.w); const tree = new Set<string>(); let total = 0; const log: string[] = []
    frames.push({ draw: paint('Kruskal', new Map(), tree, sorted.map((e) => `${e.a}-${e.b}:${e.w}`), 'Edges by weight'), note: 'Sort all edges by weight; take each one unless it would close a cycle (both ends already connected).' })
    for (const e of sorted) {
      const ra = find(e.a), rb = find(e.b)
      if (ra !== rb) { parent.set(ra, rb); tree.add(`${e.a}-${e.b}`); total += e.w; log.push(`+ ${e.a}-${e.b}:${e.w}`) } else log.push(`✗ ${e.a}-${e.b}:${e.w} (cycle)`)
      frames.push({ draw: paint('Kruskal', new Map(), tree, [...log, `total ${total}`], 'Decisions'), note: ra !== rb ? `Add ${e.a}–${e.b} (${e.w}): it joins two different components.` : `Skip ${e.a}–${e.b} (${e.w}): ${e.a} and ${e.b} are already connected — it would form a cycle.` })
    }
    summary.weight = String(total)
  } else if (algo === 'topo') {
    const indeg = new Map(nodes.map((v) => [v, 0])); for (const e of edges) indeg.set(e.b, indeg.get(e.b)! + 1)
    const q = nodes.filter((v) => indeg.get(v) === 0), order: string[] = []
    frames.push({ draw: paint('Topological sort (Kahn)', new Map(q.map((x) => [x, 'amber' as Tone])), new Set(), [`in-degree 0: ${q.join(' ')}`], 'Order'), note: 'Repeatedly remove a node with no incoming edges; it can come next in the order.' })
    while (q.length) {
      const v = q.shift()!; order.push(v)
      for (const e of edges.filter((x) => x.a === v)) { indeg.set(e.b, indeg.get(e.b)! - 1); if (indeg.get(e.b) === 0) q.push(e.b) }
      frames.push({ draw: paint('Topological sort (Kahn)', new Map([...order.map((x) => [x, 'mint' as Tone] as [string, Tone]), ...q.map((x) => [x, 'amber' as Tone] as [string, Tone])]), new Set(), order.map((o, i) => `${i + 1}. ${o}`), 'Order'), note: `Remove ${v}; its successors lose one incoming edge.` })
    }
    if (order.length < n) throw new LabError('the graph has a cycle — no topological order exists')
    summary.order = order.join(' ')
  } else throw new LabError('algo is bfs, dfs, prim, kruskal or topo')
  return trace(W, H, frames, summary)
}

// ── Infix → postfix, evaluation ─────────────────────────────────────────────

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
export function toPostfix(expr: string): { out: string[]; steps: { tok: string; stack: string[]; out: string[]; note: string }[] } {
  const toks = expr.match(/\d+(?:\.\d+)?|[A-Za-z]\w*|[-+*/^()]/g) ?? []
  const out: string[] = [], st: string[] = []
  const steps: { tok: string; stack: string[]; out: string[]; note: string }[] = []
  for (const t of toks) {
    let note = ''
    if (/^[A-Za-z\d]/.test(t)) { out.push(t); note = `Operand ${t} goes straight to the output.` }
    else if (t === '(') { st.push(t); note = 'Push "(".' }
    else if (t === ')') { while (st.length && st[st.length - 1] !== '(') out.push(st.pop()!); if (!st.length) throw new LabError('unbalanced parentheses'); st.pop(); note = 'Pop operators to the output until "(", discard it.' }
    else {
      while (st.length && st[st.length - 1] !== '(' && (PREC[st[st.length - 1]] > PREC[t] || (PREC[st[st.length - 1]] === PREC[t] && t !== '^'))) out.push(st.pop()!)
      st.push(t); note = `Operator ${t}: first pop operators of higher (or equal, left-assoc) precedence, then push.`
    }
    steps.push({ tok: t, stack: [...st], out: [...out], note })
  }
  while (st.length) { const o = st.pop()!; if (o === '(') throw new LabError('unbalanced parentheses'); out.push(o); steps.push({ tok: '', stack: [...st], out: [...out], note: `End of input: pop ${o}.` }) }
  return { out, steps }
}

function infixRun(p: Params) {
  const expr = pstr(p, 'expr', 'A+B*C-(D/E)')
  const { out, steps } = toPostfix(expr)
  const toks = expr.match(/\d+(?:\.\d+)?|[A-Za-z]\w*|[-+*/^()]/g) ?? []
  const W = 560, H = 230
  const frames: Frame[] = [{ draw: [act(heading(20, 14, 'Infix → postfix (shunting-yard) ✎'), { do: 'edit', param: 'expr', hint: 'Click to type another expression' }), ...toks.map((t, i) => act(box(20 + i * 30, 30, 26, 26, t, 'idle'), { do: 'edit', param: 'expr', hint: 'Click to type another expression' }))], note: 'Scan left to right. Operands go to the output; operators wait on a stack until something of lower precedence arrives.' }]
  steps.forEach((s, k) => {
    const d: Prim[] = [act(heading(20, 14, 'Infix → postfix (shunting-yard) ✎'), { do: 'edit', param: 'expr', hint: 'Click to type another expression' }), ...toks.map((t, i) => act(box(20 + i * 30, 30, 26, 26, t, i === k && s.tok ? 'blue' : i < k ? 'mint' : 'idle'), { do: 'edit', param: 'expr', hint: 'Click to type another expression' }))]
    d.push(heading(20, 84, 'output'), ...s.out.map((t, i) => box(20 + i * 30, 92, 26, 26, t, 'mint')))
    d.push(heading(20, 140, 'operator stack (top on the right)'), ...s.stack.map((t, i) => box(20 + i * 30, 148, 26, 26, t, 'amber')))
    frames.push({ draw: d, note: s.note })
  })
  // evaluation with numeric operands
  let value: string | null = null
  if (out.every((t) => /^\d/.test(t) || PREC[t])) {
    const st: number[] = []
    for (const t of out) { if (PREC[t]) { const b = st.pop()!, a = st.pop()!; st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : a ** b) } else st.push(Number(t)) }
    value = fmt(st[0], 4)
  }
  return trace(W, H, frames, { postfix: out.join(' '), ...(value !== null ? { value } : {}) })
}

// ── Tower of Hanoi ──────────────────────────────────────────────────────────

function hanoiRun(p: Params) {
  const n = pnum(p, 'disks', 3)
  if (n < 1 || n > 5) throw new LabError('disks must be 1–5')
  const pegs: number[][] = [Array.from({ length: n }, (_, i) => n - i), [], []]
  const snaps: { pegs: number[][]; note: string; moved?: number }[] = [{ pegs: pegs.map((x) => [...x]), note: `Move ${n} disks from A to C using B, one at a time, never a larger on a smaller. Needs 2ⁿ − 1 = ${2 ** n - 1} moves.` }]
  let count = 0
  const move = (k: number, a: number, c: number, b: number) => {
    if (k === 0) return
    move(k - 1, a, b, c)
    const d = pegs[a].pop()!; pegs[c].push(d); count++
    snaps.push({ pegs: pegs.map((x) => [...x]), note: `Move ${count}: disk ${d} from ${'ABC'[a]} to ${'ABC'[c]}.`, moved: d })
    move(k - 1, b, c, a)
  }
  move(n, 0, 2, 1)
  const W = 560, H = 220
  const frames: Frame[] = snaps.map((s) => {
    const d: Prim[] = [act(heading(20, 14, `Tower of Hanoi · ${n} disks (click to add one)`), { do: 'cycle', param: 'disks', values: ['1', '2', '3', '4', '5', '6'] })]
    s.pegs.forEach((peg, i) => {
      const cx = 100 + i * 180
      d.push(line(cx, 180, cx, 50, 'dim', { w: 3 }), line(cx - 70, 180, cx + 70, 180, 'dim', { w: 3 }), txt(cx, 200, 'ABC'[i], { size: 12, mono: true, anchor: 'middle', tone: 'dim' }))
      peg.forEach((disk, j) => d.push({ k: 'rect', x: cx - 12 - disk * 12, y: 162 - j * 20, w: 24 + disk * 24, h: 18, tone: s.moved === disk ? 'blue' : toneAt(disk), r: 4, text: String(disk) }))
    })
    return { draw: d, note: s.note }
  })
  return trace(W, H, frames, { moves: String(count) })
}

export const DSA_ENGINES: EngineDef[] = [
  { id: 'sorting', label: 'Sorting algorithms', group: G, blurb: 'Bubble, insertion, selection, shell, quick, merge, heap and radix sort, with comparison and move counts.',
    params: [{ name: 'algo', label: 'Algorithm', hint: 'bubble insertion selection shell quick merge heap radix', def: 'bubble', options: ['bubble', 'insertion', 'selection', 'shell', 'quick', 'merge', 'heap', 'radix'] }, { name: 'values', label: 'Values', hint: '2–24 numbers', def: '5 1 4 2 8 9 3' }], run: sortRun },
  { id: 'hashing', label: 'Hash tables', group: G, blurb: 'Chaining, linear, quadratic and double hashing: collisions and probe sequences.',
    params: [{ name: 'method', label: 'Method', hint: 'chaining linear quadratic double', def: 'linear', options: ['chaining', 'linear', 'quadratic', 'double'] }, { name: 'size', label: 'Table size', hint: '2–16', def: '7' }, { name: 'keys', label: 'Keys', hint: 'inserted in order', def: '50 700 76 85 92 73 101' }], run: hashRun },
  { id: 'huffman', label: 'Huffman coding', group: G, blurb: 'Build the optimal prefix code from symbol frequencies.',
    params: [{ name: 'text', label: 'Text or freqs', hint: 'a string, or a:5 b:2 c:1', def: 'aaaabbc' }], run: huffmanRun },
  { id: 'bst', label: 'BST & AVL tree', group: G, blurb: 'Insert and delete in a binary search tree, with or without AVL rotations.',
    params: [{ name: 'mode', label: 'Tree', hint: 'bst | avl', def: 'avl', options: ['bst', 'avl'] }, { name: 'ops', label: 'Operations', hint: '10;20;30;delete 20 …', def: '10;20;30;40;50;25', long: true }], run: bstRun },
  { id: 'heap', label: 'Binary heap', group: G, blurb: 'Insert and extract with sift-up and sift-down; array and tree views.',
    params: [{ name: 'kind', label: 'Kind', hint: 'min | max', def: 'min', options: ['min', 'max'] }, { name: 'ops', label: 'Operations', hint: 'numbers to insert, or "extract"', def: '5 3 8 1 9 extract extract' }], run: heapRun },
  { id: 'btree', label: 'B-tree & B+ tree', group: G, blurb: 'Insertion with node splits; B+ leaves chained for range scans.',
    params: [{ name: 'variant', label: 'Variant', hint: 'btree | bplus', def: 'btree', options: ['btree', 'bplus'] }, { name: 'order', label: 'Order', hint: 'max children per node (3–6)', def: '3' }, { name: 'keys', label: 'Keys', hint: 'inserted in order', def: '1 2 3 4 5 6 7' }], run: btreeRun },
  { id: 'graphalgo', label: 'Graph algorithms', group: G, blurb: 'BFS, DFS, Prim, Kruskal and topological sort on a drawn graph.',
    params: [{ name: 'algo', label: 'Algorithm', hint: 'bfs dfs prim kruskal topo', def: 'kruskal', options: ['bfs', 'dfs', 'prim', 'kruskal', 'topo'] }, { name: 'graph', label: 'Edges', hint: 'A-B:4 ; … (A>B for topo)', def: 'A-B:4;A-H:8;B-C:8;B-H:11;C-D:7;C-I:2;C-F:4;D-E:9;D-F:14;E-F:10;F-G:2;G-H:1;G-I:6;H-I:7', long: true }, { name: 'start', label: 'Start', hint: 'node', def: 'A' }], run: graphRun },
  { id: 'infix', label: 'Expression stacks', group: G, blurb: 'Infix → postfix with an operator stack, then evaluation.',
    params: [{ name: 'expr', label: 'Expression', hint: 'e.g. (A+B)*C or 3+4*2', def: 'A+B*C-(D/E)' }], run: infixRun },
  { id: 'hanoi', label: 'Tower of Hanoi', group: G, blurb: 'Recursion made visible: 2ⁿ − 1 moves.',
    params: [{ name: 'disks', label: 'Disks', hint: '1–5', def: '3' }], run: hanoiRun },
]

void cells
