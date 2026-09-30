// Operating-system engines (ENCT 254): CPU scheduling, page replacement, disk
// scheduling, deadlock avoidance, memory allocation. Each is a pure function
// from params to a Trace; see ../types.ts.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, prows } from '../types'
import { arrow, box, dot, heading, line, toneAt, trace, txt } from '../draw'

// ── CPU scheduling ──────────────────────────────────────────────────────────

interface Proc { name: string; at: number; bt: number; pri: number; idx: number }
interface Slice { pid: number; from: number; to: number; ready: number[] }

export const SCHED_ALGOS = ['fcfs', 'sjf', 'srt', 'rr', 'priority', 'priority-p', 'hrrn']

function parseProcs(p: Params): Proc[] {
  const rows = prows(p, 'procs', [['P1', '0', '5'], ['P2', '1', '3'], ['P3', '2', '8'], ['P4', '3', '6']])
  if (rows.length === 0) throw new LabError('procs is empty — write rows like P1,0,5;P2,1,3 (name, arrival, burst)')
  return rows.map((r, idx) => {
    const [name, at, bt, pri] = r
    const a = Number(at), b = Number(bt), pr = pri === undefined ? 0 : Number(pri)
    if (!name || !Number.isInteger(a) || !Number.isInteger(b) || !Number.isFinite(pr) || a < 0 || b <= 0) {
      throw new LabError(`process row "${r.join(',')}" — need name, integer arrival ≥ 0, integer burst > 0`)
    }
    return { name, at: a, bt: b, pri: pr, idx }
  })
}

/** Run the algorithm tick by tick; return the Gantt as merged slices. */
export function scheduleSlices(procs: Proc[], algo: string, quantum: number): Slice[] {
  const rem = procs.map((q) => q.bt)
  const done = procs.map(() => false)
  const n = procs.length
  const slices: Slice[] = []
  let t = 0
  let finished = 0
  const arrived = (time: number) => procs.filter((q) => q.at <= time && !done[q.idx]).map((q) => q.idx)
  const push = (pid: number, from: number, to: number, ready: number[]) => {
    const last = slices[slices.length - 1]
    if (algo !== 'rr' && last && last.pid === pid && last.to === from) last.to = to
    else slices.push({ pid, from, to, ready })
  }

  // Round robin keeps an explicit queue: a process that arrives during a
  // quantum joins BEFORE the one that was just preempted (the textbook rule).
  if (algo === 'rr') {
    const queue: number[] = []
    const seen = new Set<number>()
    const admit = (upTo: number) => {
      for (const q of [...procs].sort((a, b) => a.at - b.at || a.idx - b.idx)) {
        if (q.at <= upTo && !seen.has(q.idx)) { seen.add(q.idx); queue.push(q.idx) }
      }
    }
    admit(0)
    while (finished < n) {
      if (queue.length === 0) {
        const next = Math.min(...procs.filter((q) => !seen.has(q.idx)).map((q) => q.at))
        push(-1, t, next, [])
        t = next
        admit(t)
        continue
      }
      const pid = queue.shift()!
      const run = Math.min(quantum, rem[pid])
      const ready = [...queue]
      push(pid, t, t + run, ready)
      t += run
      rem[pid] -= run
      admit(t)
      if (rem[pid] === 0) { done[pid] = true; finished++ } else queue.push(pid)
    }
    return slices
  }

  const preemptive = algo === 'srt' || algo === 'priority-p'
  while (finished < n) {
    const ready = arrived(t)
    if (ready.length === 0) {
      const next = Math.min(...procs.filter((q) => !done[q.idx]).map((q) => q.at))
      push(-1, t, next, [])
      t = next
      continue
    }
    const key = (i: number): number[] => {
      const q = procs[i]
      switch (algo) {
        case 'fcfs': return [q.at, q.idx]
        case 'sjf': return [q.bt, q.at, q.idx]
        case 'srt': return [rem[i], q.at, q.idx]
        case 'priority': case 'priority-p': return [q.pri, q.at, q.idx]
        case 'hrrn': return [-((t - q.at + q.bt) / q.bt), q.at, q.idx]
        default: throw new LabError(`unknown algorithm "${algo}" — use ${SCHED_ALGOS.join(', ')}`)
      }
    }
    const cmp = (a: number, b: number) => {
      const ka = key(a), kb = key(b)
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
      return 0
    }
    const pid = [...ready].sort(cmp)[0]
    const others = ready.filter((i) => i !== pid).sort(cmp)
    if (preemptive) {
      push(pid, t, t + 1, others)
      rem[pid] -= 1
      t += 1
    } else {
      push(pid, t, t + rem[pid], others)
      t += rem[pid]
      rem[pid] = 0
    }
    if (rem[pid] === 0) { done[pid] = true; finished++ }
  }
  return slices
}

function schedRun(p: Params) {
  const algo = pstr(p, 'algo', 'rr')
  if (!SCHED_ALGOS.includes(algo)) throw new LabError(`unknown algorithm "${algo}" — use ${SCHED_ALGOS.join(', ')}`)
  const quantum = pnum(p, 'quantum', 2)
  if (quantum < 1) throw new LabError('quantum must be at least 1')
  const procs = parseProcs(p)
  const slices = scheduleSlices(procs, algo, quantum)
  const total = slices[slices.length - 1].to

  // Per-process metrics.
  const ct = procs.map(() => 0)
  const rt = procs.map(() => -1)
  for (const s of slices) {
    if (s.pid < 0) continue
    ct[s.pid] = s.to
    if (rt[s.pid] < 0) rt[s.pid] = s.from - procs[s.pid].at
  }
  const tat = procs.map((q, i) => ct[i] - q.at)
  const wt = procs.map((q, i) => tat[i] - q.bt)
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const switches = slices.filter((s, i) => s.pid >= 0 && i > 0 && slices[i - 1].pid !== s.pid).length

  const W = 560
  const x0 = 34
  const unit = Math.min(30, (W - 2 * x0) / total)
  const gy = 78, gh = 34
  const tableY = 158
  const H = tableY + 26 + procs.length * 20 + 40

  const frames: Frame[] = []
  for (let k = 0; k <= slices.length; k++) {
    const shown = slices.slice(0, k)
    const now = k === 0 ? 0 : shown[k - 1].to
    const draw: Prim[] = []
    draw.push(heading(x0, 16, `${algo.toUpperCase()}${algo === 'rr' ? ` · quantum ${quantum}` : ''} — ready queue`))
    // Ready queue as chips, for the slice about to run (or the last one shown).
    const at = k < slices.length ? slices[k] : undefined
    const queue = at ? at.ready : []
    queue.forEach((pid, i) => draw.push(box(x0 + i * 46, 24, 40, 24, procs[pid].name, toneAt(pid))))
    if (queue.length === 0) draw.push(txt(x0, 42, k < slices.length ? '(empty)' : '(all done)', { size: 11, tone: 'dim' }))
    draw.push(heading(x0, gy - 8, 'CPU timeline (Gantt)'))
    for (const s of shown) {
      const cur = s === shown[shown.length - 1]
      draw.push(box(x0 + s.from * unit, gy, (s.to - s.from) * unit, gh, s.pid < 0 ? 'idle' : procs[s.pid].name, s.pid < 0 ? 'dim' : toneAt(s.pid)))
      if (cur && s.pid >= 0) draw.push(line(x0 + s.to * unit, gy - 4, x0 + s.to * unit, gy + gh + 4, 'blue', { w: 2 }))
    }
    // Time axis
    const marks = new Set<number>([0, ...shown.flatMap((s) => [s.from, s.to])])
    for (const m of marks) draw.push(txt(x0 + m * unit, gy + gh + 14, String(m), { size: 10, anchor: 'middle', tone: 'dim', mono: true }))
    // Table
    const cols = ['P', 'AT', 'BT', 'CT', 'TAT', 'WT', 'RT']
    const cx = (i: number) => x0 + i * 62
    cols.forEach((c, i) => draw.push(txt(cx(i) + 26, tableY, c, { size: 10, tone: 'dim', bold: true, anchor: 'middle' })))
    procs.forEach((q, i) => {
      const finishedNow = shown.length > 0 && ct[i] <= now && shown.some((s) => s.pid === i && s.to === ct[i])
      const vals = [q.name, q.at, q.bt, finishedNow ? ct[i] : '·', finishedNow ? tat[i] : '·', finishedNow ? wt[i] : '·', rt[i] >= 0 && shown.some((s) => s.pid === i) ? rt[i] : '·']
      vals.forEach((v, j) => draw.push(txt(cx(j) + 26, tableY + 20 + i * 20, String(v), { size: 12, mono: true, anchor: 'middle', tone: j === 0 ? toneAt(i) : 'idle', bold: j === 0 })))
    })
    if (k === slices.length) {
      draw.push(txt(x0, H - 14, `avg WT ${fmt(avg(wt))}   avg TAT ${fmt(avg(tat))}   avg RT ${fmt(avg(rt))}   context switches ${switches}`, { size: 12, mono: true, tone: 'amber' }))
    }
    const note = k === 0
      ? `${algo.toUpperCase()} on ${procs.length} processes. Press ▶ to run the CPU one slice at a time.`
      : (() => {
          const s = shown[k - 1]
          if (s.pid < 0) return `t=${s.from}→${s.to}: no process has arrived yet — the CPU idles.`
          const why = algo === 'rr' ? `it takes the head of the queue for at most ${quantum}` : algo === 'fcfs' ? 'it arrived first' : algo === 'sjf' ? 'it has the shortest burst among those waiting' : algo === 'srt' ? 'it has the least time remaining' : algo.startsWith('priority') ? 'it has the best priority (lowest number)' : 'it has the highest response ratio (W+B)/B'
          return `t=${s.from}→${s.to}: ${procs[s.pid].name} runs — ${why}.`
        })()
    frames.push({ draw, note })
  }
  return trace(W, H, frames, {
    avgWT: fmt(avg(wt)), avgTAT: fmt(avg(tat)), avgRT: fmt(avg(rt)),
    makespan: String(total), switches: String(switches),
    order: slices.filter((s) => s.pid >= 0).map((s) => procs[s.pid].name).join(' '),
  })
}

// ── Page replacement ────────────────────────────────────────────────────────

export function replaceRun(refs: number[], nframes: number, algo: string) {
  const frames: (number | null)[] = Array(nframes).fill(null)
  const loadedAt: number[] = Array(nframes).fill(-1)
  const lastUse: number[] = Array(nframes).fill(-1)
  const freq: number[] = Array(nframes).fill(0)
  const steps: { ref: number; fault: boolean; state: (number | null)[]; victim: number | null; slot: number }[] = []
  let faults = 0
  refs.forEach((r, t) => {
    let slot = frames.indexOf(r)
    let fault = false
    let victim: number | null = null
    if (slot >= 0) {
      lastUse[slot] = t
      freq[slot]++
    } else {
      fault = true
      faults++
      slot = frames.indexOf(null)
      if (slot < 0) {
        const idxs = frames.map((_, i) => i)
        let pick: number
        switch (algo) {
          case 'fifo': pick = idxs.sort((a, b) => loadedAt[a] - loadedAt[b])[0]; break
          case 'lru': pick = idxs.sort((a, b) => lastUse[a] - lastUse[b])[0]; break
          case 'lfu': pick = idxs.sort((a, b) => freq[a] - freq[b] || loadedAt[a] - loadedAt[b])[0]; break
          case 'opt': {
            const nextUse = (i: number) => {
              const at = refs.indexOf(frames[i] as number, t + 1)
              return at < 0 ? Infinity : at
            }
            pick = idxs.sort((a, b) => nextUse(b) - nextUse(a) || loadedAt[a] - loadedAt[b])[0]
            break
          }
          default: throw new LabError(`unknown algorithm "${algo}" — use fifo, lru, lfu or opt`)
        }
        slot = pick
        victim = frames[slot]
      }
      frames[slot] = r
      loadedAt[slot] = t
      lastUse[slot] = t
      freq[slot] = 1
    }
    steps.push({ ref: r, fault, state: [...frames], victim, slot })
  })
  return { steps, faults }
}

function pagingRun(p: Params) {
  const algo = pstr(p, 'algo', 'lru')
  const nframes = pnum(p, 'frames', 3)
  if (nframes < 1 || nframes > 8) throw new LabError('frames must be between 1 and 8')
  const refs = pnums(p, 'refs', [7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2, 1, 2, 0, 1, 7, 0, 1])
  if (refs.length === 0) throw new LabError('refs is empty')
  const { steps, faults } = replaceRun(refs, nframes, algo)
  const cw = Math.min(28, Math.floor(520 / refs.length))
  const W = 30 + refs.length * cw + 10
  const cellH = 26
  const H = 60 + nframes * cellH + 60
  const frames: Frame[] = []
  for (let k = 0; k <= steps.length; k++) {
    const draw: Prim[] = []
    draw.push(heading(10, 14, `${algo.toUpperCase()} · ${nframes} frames — reference string`))
    refs.forEach((r, i) => {
      const st = steps[i]
      const shown = i < k
      draw.push(box(30 + i * cw, 22, cw - 2, 22, String(r), shown ? (st.fault ? 'rose' : 'mint') : i === k ? 'blue' : 'idle'))
    })
    for (let f = 0; f < nframes; f++) draw.push(txt(22, 60 + f * cellH + 17, `F${f + 1}`, { size: 10, tone: 'dim', anchor: 'end', mono: true }))
    for (let i = 0; i < k; i++) {
      const st = steps[i]
      for (let f = 0; f < nframes; f++) {
        const v = st.state[f]
        const tone: Tone = st.slot === f ? (st.fault ? 'rose' : 'mint') : 'idle'
        draw.push(box(30 + i * cw, 50 + f * cellH, cw - 2, cellH - 3, v === null ? '' : String(v), v === null ? 'dim' : tone))
      }
    }
    const done = steps.slice(0, k)
    const f = done.filter((s) => s.fault).length
    draw.push(txt(10, H - 26, `faults ${f}   hits ${k - f}   ${k > 0 ? `hit ratio ${fmt(((k - f) / k) * 100, 1)}%` : ''}`, { size: 12, mono: true, tone: 'amber' }))
    const note = k === 0
      ? 'Frames start empty; every first reference is a page fault. Press ▶.'
      : (() => {
          const s = steps[k - 1]
          if (!s.fault) return `Page ${s.ref} is already in a frame — a hit; nothing is evicted.`
          if (s.victim === null) return `Page ${s.ref} is not in memory — fault, loaded into a free frame.`
          return `Page ${s.ref} is not in memory — fault. ${algo.toUpperCase()} evicts page ${s.victim} (${algo === 'fifo' ? 'the oldest resident' : algo === 'lru' ? 'least recently used' : algo === 'lfu' ? 'least frequently used' : 'the one needed furthest in the future'}).`
        })()
    frames.push({ draw, note })
  }
  return trace(W, H, frames, {
    faults: String(faults), hits: String(refs.length - faults),
    hitRatio: fmt(((refs.length - faults) / refs.length) * 100, 1),
  })
}

// ── Disk scheduling ─────────────────────────────────────────────────────────

export function diskOrder(head: number, reqs: number[], algo: string, size: number, dirUp: boolean): number[] {
  const left = [...reqs]
  const path: number[] = [head]
  const push = (v: number) => path.push(v)
  if (algo === 'fcfs') { for (const r of reqs) push(r); return path }
  if (algo === 'sstf') {
    let cur = head
    while (left.length) {
      left.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur))
      cur = left.shift()!
      push(cur)
    }
    return path
  }
  const lower = left.filter((r) => r < head).sort((a, b) => b - a)
  const upper = left.filter((r) => r >= head).sort((a, b) => a - b)
  const edge = algo === 'scan' || algo === 'cscan'
  if (algo === 'scan' || algo === 'look') {
    if (dirUp) { for (const r of upper) push(r); if (edge && lower.length) push(size - 1); for (const r of lower) push(r) }
    else { for (const r of lower) push(r); if (edge && upper.length) push(0); for (const r of upper) push(r) }
    return path
  }
  if (algo === 'cscan' || algo === 'clook') {
    if (dirUp) {
      for (const r of upper) push(r)
      if (lower.length) { if (edge) { push(size - 1); push(0) } for (const r of [...lower].reverse()) push(r) }
    } else {
      for (const r of lower) push(r)
      if (upper.length) { if (edge) { push(0); push(size - 1) } for (const r of [...upper].reverse()) push(r) }
    }
    return path
  }
  throw new LabError(`unknown algorithm "${algo}" — use fcfs, sstf, scan, cscan, look or clook`)
}

function diskRun(p: Params) {
  const algo = pstr(p, 'algo', 'sstf')
  const size = pnum(p, 'size', 200)
  const head = pnum(p, 'head', 53)
  const reqs = pnums(p, 'queue', [98, 183, 37, 122, 14, 124, 65, 67])
  const dirUp = pstr(p, 'sweep', 'up') !== 'down'
  if (reqs.some((r) => r < 0 || r >= size) || head < 0 || head >= size) throw new LabError(`every cylinder must be in 0…${size - 1}`)
  const path = diskOrder(head, reqs, algo, size, dirUp)
  // C-SCAN / C-LOOK count the return seek too: it is a real head movement.
  let total = 0
  for (let i = 1; i < path.length; i++) total += Math.abs(path[i] - path[i - 1])
  const W = 560, H = 60 + path.length * 22 + 30
  const sx = (c: number) => 30 + (c / (size - 1)) * (W - 60)
  const frames: Frame[] = []
  for (let k = 1; k <= path.length; k++) {
    const draw: Prim[] = []
    draw.push(heading(30, 14, `${algo.toUpperCase()} · head starts at ${head}`))
    draw.push(line(30, 32, W - 30, 32, 'dim'))
    for (const c of [0, Math.round(size / 4), Math.round(size / 2), Math.round((3 * size) / 4), size - 1]) draw.push(txt(sx(c), 26, String(c), { size: 10, anchor: 'middle', tone: 'dim', mono: true }))
    for (const r of reqs) draw.push(dot(sx(r), 32, 3.5, undefined, path.slice(0, k).includes(r) ? 'mint' : 'amber', { solid: true }))
    let moved = 0
    for (let i = 1; i < k; i++) {
      const y0 = 50 + (i - 1) * 22, y1 = 50 + i * 22
      draw.push(arrow(sx(path[i - 1]), y0, sx(path[i]), y1, 'blue'))
      moved += Math.abs(path[i] - path[i - 1])
    }
    for (let i = 0; i < k; i++) draw.push(txt(sx(path[i]), 50 + i * 22 - 4, String(path[i]), { size: 10, anchor: 'middle', mono: true, tone: i === k - 1 ? 'blue' : 'idle' }))
    draw.push(txt(30, H - 12, `total head movement ${moved}${k === path.length ? ' cylinders' : ' so far'}`, { size: 12, mono: true, tone: 'amber' }))
    frames.push({
      draw,
      note: k === 1 ? 'The head sits at its start cylinder. Amber dots are pending requests.'
        : `Seek ${path[k - 2]} → ${path[k - 1]} (${Math.abs(path[k - 1] - path[k - 2])} cylinders).`,
    })
  }
  return trace(W, H, frames, { total: String(total), order: path.slice(1).join(' ') })
}

// ── Banker's algorithm ──────────────────────────────────────────────────────

function bankerRun(p: Params) {
  const avail = pnums(p, 'available', [3, 3, 2])
  const max = prows(p, 'max', [['7', '5', '3'], ['3', '2', '2'], ['9', '0', '2'], ['2', '2', '2'], ['4', '3', '3']]).map((r) => r.map(Number))
  const alloc = prows(p, 'alloc', [['0', '1', '0'], ['2', '0', '0'], ['3', '0', '2'], ['2', '1', '1'], ['0', '0', '2']]).map((r) => r.map(Number))
  const m = avail.length, n = max.length
  if (alloc.length !== n || max.some((r) => r.length !== m) || alloc.some((r) => r.length !== m)) throw new LabError('max and alloc need one row per process and one column per resource type')
  const need = max.map((r, i) => r.map((v, j) => v - alloc[i][j]))
  if (need.some((r) => r.some((v) => v < 0))) throw new LabError('a process holds more than its declared maximum')
  let work = [...avail]
  const req = pstr(p, 'request', '')
  let granted: string | null = null
  if (req) {
    const [who, vec] = req.split(':')
    const pi = Number(who.replace(/\D/g, ''))
    const rv = vec.trim().split(/\s+/).map(Number)
    if (!(pi >= 0 && pi < n) || rv.length !== m) throw new LabError('request looks like "P1:1 0 2" — process index then one number per resource')
    if (rv.some((v, j) => v > need[pi][j])) granted = `P${pi} asks for more than its declared need — denied`
    else if (rv.some((v, j) => v > work[j])) granted = `P${pi} must wait: not enough available now`
    else { work = work.map((v, j) => v - rv[j]); alloc[pi] = alloc[pi].map((v, j) => v + rv[j]); need[pi] = need[pi].map((v, j) => v - rv[j]) }
  }
  const finish = Array(n).fill(false)
  const seq: number[] = []
  const snaps: { work: number[]; pick: number | null; seq: number[]; finish: boolean[] }[] = [{ work: [...work], pick: null, seq: [], finish: [...finish] }]
  for (;;) {
    const i = finish.findIndex((f, k) => !f && need[k].every((v, j) => v <= work[j]))
    if (i < 0) break
    work = work.map((v, j) => v + alloc[i][j])
    finish[i] = true
    seq.push(i)
    snaps.push({ work: [...work], pick: i, seq: [...seq], finish: [...finish] })
  }
  const safe = finish.every(Boolean)
  const W = 560, rowH = 24, H = 96 + n * rowH + 40
  const frames: Frame[] = snaps.map((s, k) => {
    const draw: Prim[] = []
    draw.push(heading(20, 14, "Banker's algorithm — Allocation · Max · Need"))
    const colsX = (c: number) => 50 + c * 30
    for (let b = 0; b < 3; b++) for (let j = 0; j < m; j++) draw.push(txt(colsX(b * (m + 1) + j) + 8, 40, String.fromCharCode(65 + j), { size: 10, tone: 'dim', anchor: 'middle', bold: true }))
    const label = ['Alloc', 'Max', 'Need']
    label.forEach((l, b) => draw.push(txt(colsX(b * (m + 1)) - 4, 28, l, { size: 10, tone: 'dim', bold: true })))
    for (let i = 0; i < n; i++) {
      const y = 44 + i * rowH
      draw.push(txt(20, y + 16, `P${i}`, { size: 12, mono: true, bold: true, tone: s.finish[i] ? 'mint' : s.pick === i ? 'blue' : 'idle' }))
      ;[alloc[i], max[i], need[i]].forEach((vec, b) => vec.forEach((v, j) => draw.push(txt(colsX(b * (m + 1) + j) + 8, y + 16, String(v), { size: 12, mono: true, anchor: 'middle', tone: s.finish[i] ? 'dim' : 'idle' }))))
    }
    draw.push(txt(20, 56 + n * rowH, `Work = [ ${s.work.join(' ')} ]`, { size: 12, mono: true, tone: 'amber' }))
    draw.push(txt(20, 76 + n * rowH, `Safe sequence so far: ${s.seq.map((i) => `P${i}`).join(' → ') || '—'}`, { size: 12, mono: true, tone: safe && k === snaps.length - 1 ? 'mint' : 'idle' }))
    if (k === snaps.length - 1) draw.push(txt(20, 96 + n * rowH, safe ? 'SAFE — every process can finish' : 'UNSAFE — the remaining processes could deadlock', { size: 12, bold: true, tone: safe ? 'mint' : 'rose' }))
    const note = k === 0
      ? `Need = Max − Allocation. Work starts as Available = [${avail.join(' ')}]${granted ? `. Request: ${granted}` : req ? '. The request was tentatively granted; checking safety.' : '.'}`
      : `P${s.pick} has Need ≤ Work, so it can run to completion and release its allocation: Work grows to [${s.work.join(' ')}].`
    return { draw, note }
  })
  return trace(W, H, frames, { safe: safe ? 'yes' : 'no', sequence: seq.map((i) => `P${i}`).join(' '), ...(granted ? { request: granted } : {}) })
}

// ── Memory allocation (contiguous) ──────────────────────────────────────────

function memRun(p: Params) {
  const algo = pstr(p, 'algo', 'first')
  const blocks = pnums(p, 'blocks', [100, 500, 200, 300, 600])
  const reqs = pnums(p, 'requests', [212, 417, 112, 426])
  const free = [...blocks]
  const placed: (number | null)[] = []
  let cursor = 0
  const states: { free: number[]; req: number; at: number | null }[] = []
  for (const r of reqs) {
    let at: number | null = null
    const fit = free.map((f, i) => ({ f, i })).filter((x) => x.f >= r)
    if (algo === 'first') at = fit.length ? fit[0].i : null
    else if (algo === 'best') at = fit.length ? fit.sort((a, b) => a.f - b.f || a.i - b.i)[0].i : null
    else if (algo === 'worst') at = fit.length ? fit.sort((a, b) => b.f - a.f || a.i - b.i)[0].i : null
    else if (algo === 'next') {
      for (let k = 0; k < free.length; k++) { const i = (cursor + k) % free.length; if (free[i] >= r) { at = i; break } }
      if (at !== null) cursor = at
    } else throw new LabError(`unknown algorithm "${algo}" — use first, best, worst or next`)
    if (at !== null) free[at] -= r
    placed.push(at)
    states.push({ free: [...free], req: r, at })
  }
  const W = 560, max = Math.max(...blocks), rowH = 34, H = 70 + blocks.length * rowH + 40
  const render = (upto: number): Prim[] => {
    const draw: Prim[] = [heading(20, 14, `${algo}-fit — block sizes (KB)`)]
    const st = upto === 0 ? { free: blocks, req: 0, at: null as number | null } : states[upto - 1]
    blocks.forEach((b, i) => {
      const y = 30 + i * rowH, wfull = (b / max) * 420
      draw.push(box(70, y, wfull, 24, '', 'dim'))
      const used = b - st.free[i]
      if (used > 0) draw.push(box(70, y, (used / max) * 420, 24, String(used), st.at === i ? 'blue' : 'mint'))
      draw.push(txt(56, y + 17, `B${i + 1}`, { size: 11, mono: true, anchor: 'end', tone: 'dim' }))
      draw.push(txt(70 + wfull + 8, y + 17, `${st.free[i]} free`, { size: 11, mono: true, tone: 'amber' }))
    })
    const y = 46 + blocks.length * rowH
    reqs.forEach((r, i) => draw.push(box(20 + i * 74, y, 68, 24, String(r), i < upto ? (placed[i] === null ? 'rose' : 'mint') : i === upto ? 'blue' : 'idle')))
    return draw
  }
  const out: Frame[] = []
  for (let k = 0; k <= reqs.length; k++) {
    out.push({
      draw: render(k),
      note: k === 0 ? `${blocks.length} free blocks, ${reqs.length} requests in order. Press ▶.`
        : states[k - 1].at === null ? `${reqs[k - 1]} KB fits no block — the request waits (external fragmentation).`
          : `${reqs[k - 1]} KB → block B${(states[k - 1].at as number) + 1}${algo === 'best' ? ' (the tightest fit)' : algo === 'worst' ? ' (the largest hole)' : algo === 'first' ? ' (first hole that is big enough)' : ' (search resumed after the last placement)'}.`,
    })
  }
  return trace(W, H, out, {
    placed: placed.map((b, i) => `${reqs[i]}→${b === null ? 'wait' : `B${b + 1}`}`).join(' '),
    unplaced: String(placed.filter((b) => b === null).length),
    leftover: String(states[states.length - 1].free.reduce((a, b) => a + b, 0)),
  })
}

// ── Registry rows ───────────────────────────────────────────────────────────

export const OS_ENGINES: EngineDef[] = [
  {
    id: 'sched', label: 'CPU scheduling', group: 'Operating systems',
    blurb: 'FCFS, SJF, SRT, Round Robin, priority and HRRN — Gantt chart, waiting and turnaround times.',
    params: [
      { name: 'algo', label: 'Algorithm', hint: SCHED_ALGOS.join(' | '), def: 'rr', options: SCHED_ALGOS },
      { name: 'quantum', label: 'Quantum', hint: 'Round Robin time slice', def: '2' },
      { name: 'procs', label: 'Processes', hint: 'name,arrival,burst[,priority] ; …', def: 'P1,0,5;P2,1,3;P3,2,8;P4,3,6', long: true },
    ],
    run: schedRun,
  },
  {
    id: 'paging', label: 'Page replacement', group: 'Operating systems',
    blurb: 'FIFO, LRU, LFU and optimal replacement over a reference string — faults, hits, hit ratio.',
    params: [
      { name: 'algo', label: 'Algorithm', hint: 'fifo | lru | lfu | opt', def: 'lru', options: ['fifo', 'lru', 'lfu', 'opt'] },
      { name: 'frames', label: 'Frames', hint: 'number of physical frames (1–8)', def: '3' },
      { name: 'refs', label: 'Reference string', hint: 'space-separated page numbers', def: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', long: true },
    ],
    run: pagingRun,
  },
  {
    id: 'disk', label: 'Disk scheduling', group: 'Operating systems',
    blurb: 'FCFS, SSTF, SCAN, C-SCAN, LOOK and C-LOOK — head path and total seek distance.',
    params: [
      { name: 'algo', label: 'Algorithm', hint: 'fcfs | sstf | scan | cscan | look | clook', def: 'sstf', options: ['fcfs', 'sstf', 'scan', 'cscan', 'look', 'clook'] },
      { name: 'head', label: 'Head', hint: 'starting cylinder', def: '53' },
      { name: 'sweep', label: 'Direction', hint: 'up | down (SCAN family)', def: 'up', options: ['up', 'down'] },
      { name: 'size', label: 'Cylinders', hint: 'disk has cylinders 0…size-1', def: '200' },
      { name: 'queue', label: 'Requests', hint: 'space-separated cylinders', def: '98 183 37 122 14 124 65 67', long: true },
    ],
    run: diskRun,
  },
  {
    id: 'banker', label: "Banker's algorithm", group: 'Operating systems',
    blurb: 'Deadlock avoidance: find a safe sequence, or test whether a request may be granted.',
    params: [
      { name: 'available', label: 'Available', hint: 'one number per resource type', def: '3 3 2' },
      { name: 'max', label: 'Max', hint: 'rows = processes ; columns = resources', def: '7 5 3;3 2 2;9 0 2;2 2 2;4 3 3', long: true },
      { name: 'alloc', label: 'Allocation', hint: 'same shape as Max', def: '0 1 0;2 0 0;3 0 2;2 1 1;0 0 2', long: true },
      { name: 'request', label: 'Request', hint: 'optional, e.g. P1:1 0 2', def: '', optional: true },
    ],
    run: (p) => bankerRun(normaliseRows(p, ['max', 'alloc'])),
  },
  {
    id: 'memfit', label: 'Memory allocation', group: 'Operating systems',
    blurb: 'First, best, worst and next fit into free blocks — see where the holes go.',
    params: [
      { name: 'algo', label: 'Algorithm', hint: 'first | best | worst | next', def: 'best', options: ['first', 'best', 'worst', 'next'] },
      { name: 'blocks', label: 'Free blocks', hint: 'sizes, space-separated', def: '100 500 200 300 600' },
      { name: 'requests', label: 'Requests', hint: 'sizes in arrival order', def: '212 417 112 426' },
    ],
    run: memRun,
  },
]

/** Banker's matrices are written "7 5 3;3 2 2" — commas are the row parser's
 *  field separator, so spaces inside a row are rewritten to commas first. */
function normaliseRows(p: Params, keys: string[]): Params {
  const out = { ...p }
  for (const k of keys) if (out[k]) out[k] = out[k].split(/[;\n]/).map((r) => r.trim().split(/[\s,]+/).join(',')).join(';')
  return out
}

