// Step Lab engines: every engine runs on its defaults, draws only finite
// shapes, and the textbook numbers come out right.
// Run: node --test lib/steplab/steplab.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'steplab-test-'))
const bundle = join(dir, 'registry.mjs')
execFileSync('npx', ['esbuild', join(root, 'lib/steplab/registry.ts'), '--bundle', '--format=esm',
  `--outfile=${bundle}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { ENGINES, runEngine } = await import(bundle)
const bundleExpr = join(dir, 'expr.mjs')
execFileSync('npx', ['esbuild', join(root, 'lib/steplab/expr.ts'), '--bundle', '--format=esm', `--outfile=${bundleExpr}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const run = (engine, params = {}) => {
  const r = runEngine({ engine, ...params })
  assert.ok(r.ok, `${engine}: ${r.error}`)
  return r.trace
}

test('every engine runs on its defaults and draws finite shapes', () => {
  for (const e of ENGINES) {
    const t = run(e.id)
    assert.ok(t.frames.length > 0, `${e.id}: no frames`)
    assert.ok(t.w > 0 && t.h > 0, `${e.id}: no size`)
    for (const [i, f] of t.frames.entries()) {
      assert.equal(typeof f.note, 'string')
      for (const p of f.draw) {
        const nums = p.k === 'poly' ? p.pts.flat() : [p.x, p.y, p.w, p.h, p.x1, p.y1, p.x2, p.y2, p.r].filter((v) => v !== undefined)
        for (const v of nums) assert.ok(Number.isFinite(v), `${e.id} frame ${i}: non-finite in ${JSON.stringify(p)}`)
      }
    }
  }
})

test('bad input becomes a sentence, never a throw', () => {
  const r = runEngine({ engine: 'sched', procs: 'oops' })
  assert.equal(r.ok, false)
  assert.match(r.error, /process row/)
  assert.equal(runEngine({ engine: 'nope' }).ok, false)
})

// ── OS ──
test('scheduling: textbook averages', () => {
  const procs = 'P1,0,24;P2,0,3;P3,0,3'
  assert.equal(run('sched', { algo: 'fcfs', procs }).summary.avgWT, '17')
  assert.equal(run('sched', { algo: 'sjf', procs }).summary.avgWT, '3')
  // Silberschatz RR example, q=4
  const rr = run('sched', { algo: 'rr', quantum: '4', procs })
  assert.equal(rr.summary.avgWT, '5.67')
  assert.equal(rr.summary.order, 'P1 P2 P3 P1 P1 P1 P1 P1')
  // SRT: P1,0,8 P2,1,4 P3,2,9 P4,3,5 -> avg WT 6.5
  assert.equal(run('sched', { algo: 'srt', procs: 'P1,0,8;P2,1,4;P3,2,9;P4,3,5' }).summary.avgWT, '6.5')
  // idle gap
  assert.equal(run('sched', { algo: 'fcfs', procs: 'A,2,3' }).summary.makespan, '5')
})

test('page replacement: textbook fault counts', () => {
  const refs = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1'
  assert.equal(run('paging', { algo: 'fifo', frames: '3', refs }).summary.faults, '15')
  assert.equal(run('paging', { algo: 'lru', frames: '3', refs }).summary.faults, '12')
  assert.equal(run('paging', { algo: 'opt', frames: '3', refs }).summary.faults, '9')
  const belady = '1 2 3 4 1 2 5 1 2 3 4 5'
  assert.equal(run('paging', { algo: 'fifo', frames: '3', refs: belady }).summary.faults, '9')
  assert.equal(run('paging', { algo: 'fifo', frames: '4', refs: belady }).summary.faults, '10') // Belady's anomaly
})

test('disk scheduling: textbook totals', () => {
  const q = { head: '53', queue: '98 183 37 122 14 124 65 67' }
  assert.equal(run('disk', { algo: 'fcfs', ...q }).summary.total, '640')
  assert.equal(run('disk', { algo: 'sstf', ...q }).summary.total, '236')
  assert.equal(run('disk', { algo: 'scan', sweep: 'down', ...q }).summary.total, '236')
  assert.equal(run('disk', { algo: 'look', sweep: 'up', ...q }).summary.total, '299')
  assert.equal(run('disk', { algo: 'clook', sweep: 'up', ...q }).summary.total, '322')
})

test("banker's algorithm: the classic safe sequence", () => {
  const t = run('banker')
  assert.equal(t.summary.safe, 'yes')
  assert.equal(t.summary.sequence, 'P1 P3 P0 P2 P4') // lowest-index-first; the textbook's P1 P3 P4 P0 P2 is another valid order
})

test('memory allocation: first / best / worst', () => {
  assert.equal(run('memfit', { algo: 'first' }).summary.placed, '212→B2 417→B5 112→B2 426→wait')
  assert.equal(run('memfit', { algo: 'best' }).summary.placed, '212→B4 417→B2 112→B3 426→B5')
  assert.equal(run('memfit', { algo: 'worst' }).summary.placed, '212→B5 417→B2 112→B5 426→wait')
})

// ── COA / digital ──
test('cache: direct vs 2-way vs fully associative on 0 8 0 6 8', () => {
  const base = { lines: '4', block: '1', addrs: '0 8 0 6 8' }
  assert.equal(run('cache', { ...base, mapping: 'direct' }).summary.misses, '5')
  assert.equal(run('cache', { ...base, mapping: 'set', ways: '2' }).summary.misses, '4')
  assert.equal(run('cache', { ...base, mapping: 'full' }).summary.misses, '3')
  // AMAT = hit time + miss rate × penalty
  assert.equal(run('cache', { ...base, mapping: 'full', hitTime: '1', missPenalty: '100' }).summary.amat, '61')
})

test('number codes', () => {
  const t = run('numconv', { n: '25', bits: '8' }).summary
  assert.deepEqual([t.binary, t.octal, t.hex, t.bcd, t.excess3, t.gray], ['11001', '31', '19', '0010 0101', '0101 1000', '10101'])
  assert.equal(run('numconv', { n: '-5', bits: '8' }).summary.twos, '11111011')
  assert.equal(run('numconv', { n: '-5', bits: '8' }).summary.ones, '11111010')
})

test('IEEE 754', () => {
  assert.equal(run('ieee754', { value: '5.75' }).summary.hex, '40B80000')
  assert.equal(run('ieee754', { value: '-0.15625' }).summary.hex, 'BE200000')
  assert.equal(run('ieee754', { value: '1', format: 'double' }).summary.hex, '3FF0000000000000')
})

test("Booth's multiplication is signed multiplication", () => {
  for (const [m, q] of [[7, -3], [7, -8], [5, 5], [-4, -4], [0, 3], [-1, -1]])
    assert.equal(run('booth', { bits: '4', m: String(m), q: String(q) }).summary.product, String(m * q), `${m}×${q}`)
})

test('pipeline hazards', () => {
  const dep = 'lw r1, 0(r2)\nadd r3, r1, r4'
  assert.equal(run('pipeline', { prog: dep, forwarding: 'on' }).summary.stalls, '1')     // load-use
  assert.equal(run('pipeline', { prog: dep, forwarding: 'off' }).summary.stalls, '2')
  const alu = 'add r1, r2, r3\nsub r4, r1, r5'
  assert.equal(run('pipeline', { prog: alu, forwarding: 'on' }).summary.stalls, '0')
  assert.equal(run('pipeline', { prog: alu, forwarding: 'off' }).summary.stalls, '2')
  assert.equal(run('pipeline', { prog: 'add r1, r2, r3\nadd r4, r5, r6\nadd r7, r8, r9', forwarding: 'off' }).summary.cycles, '7')
})

test('K-map minimisation agrees with the truth table', () => {
  const cases = [
    { vars: '3', minterms: '1 3 5 7', want: 'C' },
    { vars: '2', minterms: '1 2', want: "A'B + AB'" },
    { vars: '4', minterms: '0 1 2 5 6 7 8 9 10 14' },
    { vars: '4', minterms: '1 3 5 7 9', dontcares: '11 13 15' },
  ]
  for (const c of cases) {
    const t = run('kmap', c)
    if (c.want) assert.equal(t.summary.sop.split(' + ').sort().join(' + '), c.want.split(' + ').sort().join(' + '))
    const vars = Number(c.vars), ones = c.minterms.split(' ').map(Number), dcs = (c.dontcares ?? '').split(' ').filter(Boolean).map(Number)
    for (let m = 0; m < 1 << vars; m++) {
      const val = t.summary.sop.split(' + ').some((term) => {
        if (term === '0') return false
        const lits = term.match(/[A-D]'?/g) ?? []
        return lits.every((l) => { const bit = (m >> (vars - 1 - 'ABCD'.indexOf(l[0]))) & 1; return l.endsWith("'") ? !bit : !!bit })
      })
      if (ones.includes(m)) assert.ok(val, `minterm ${m} lost in ${t.summary.sop}`)
      else if (!dcs.includes(m)) assert.ok(!val, `${m} wrongly covered by ${t.summary.sop}`)
    }
  }
})

test('8085: add two bytes from memory', () => {
  const t = run('cpu8085').summary
  assert.equal(t.m2052, '3C')
  assert.equal(t.A, '3C')
  assert.equal(t.CY, '0')
  // LXI 10 + MOV A,M 7 + INX 6 + ADD M 7 + INX 6 + MOV M,A 7 + HLT 5
  assert.equal(t.tstates, '48')
})

test('8085: a countdown loop sums 1..5, and DAA gives BCD', () => {
  const sum = run('cpu8085', { program: 'MVI B,5\nMVI A,0\nLOOP: ADD B\nDCR B\nJNZ LOOP\nHLT', memory: '', watch: '' }).summary
  assert.equal(sum.A, '0F')
  assert.equal(sum.Z, '1')
  const bcd = run('cpu8085', { program: 'MVI A,38H\nADI 45H\nDAA\nHLT', memory: '', watch: '' }).summary
  assert.equal(bcd.A, '83')
  const carry = run('cpu8085', { program: 'MVI A,99H\nADI 01H\nDAA\nHLT', memory: '', watch: '' }).summary
  assert.equal(carry.A, '00'); assert.equal(carry.CY, '1')
})

test('8085: CALL / RET, stack and compare', () => {
  const t = run('cpu8085', { program: 'LXI SP,3000H\nMVI A,7\nCALL DBL\nHLT\nDBL: ADD A\nRET', memory: '', watch: '' }).summary
  assert.equal(t.A, '0E')
  const cmp = run('cpu8085', { program: 'MVI A,5\nCPI 5\nHLT', memory: '', watch: '' }).summary
  assert.equal(cmp.Z, '1')
  assert.equal(runEngine({ engine: 'cpu8085', program: 'FOO A' }).ok, false)
  assert.equal(runEngine({ engine: 'cpu8085', program: 'L: JMP L' }).ok, false) // never halts
})

// ── networks / data communication ──
test('CRC: Tanenbaum example', () => {
  const t = run('crc', { data: '1101011011', generator: '10011' }).summary
  assert.equal(t.crc, '1110')
  assert.equal(t.codeword, '11010110111110')
  assert.equal(t.receiverRemainder, '0000')
  assert.equal(run('crc', { data: '1101011011', generator: '10011', flip: '3' }).summary.detected, 'yes')
})

test('Hamming(7,4): encode, locate, fix', () => {
  const t = run('hamming', { data: '1011', error: '5' }).summary
  assert.equal(t.codeword, '0110011')
  assert.equal(t.syndrome, '5')
  assert.equal(t.corrected, 'yes')
  assert.equal(run('hamming', { data: '1011', error: '0' }).summary.syndrome, '0')
})

test('ARQ: selective repeat retransmits only the lost frame', () => {
  const sr = run('arq', { protocol: 'sr', frames: '8', window: '4', prop: '2', lose: '2' }).summary
  const gbn = run('arq', { protocol: 'gbn', frames: '8', window: '4', prop: '2', lose: '2' }).summary
  assert.equal(sr.retransmissions, '1')
  assert.ok(Number(gbn.retransmissions) > 1, 'go-back-n resends the window')
  assert.equal(run('arq', { protocol: 'gbn', lose: '' }).summary.retransmissions, '0')
  // stop-and-wait: one frame per round trip
  assert.ok(Number(run('arq', { protocol: 'stopwait', frames: '4', lose: '' }).summary.totalTime) >= 4 * 4)
})

test('subnetting and VLSM', () => {
  const t = run('subnet', { address: '192.168.10.77/26' }).summary
  assert.deepEqual([t.network, t.broadcast, t.hosts, t.mask], ['192.168.10.64', '192.168.10.127', '62', '255.255.255.192'])
  assert.equal(run('subnet', { address: '10.0.0.0/8' }).summary.hosts, '16777214')
  assert.equal(run('subnet', { address: '192.168.1.0/24', hosts: '100 50 20 10' }).summary.vlsm, '192.168.1.0/25 192.168.1.128/26 192.168.1.192/27 192.168.1.224/28')
  assert.equal(runEngine({ engine: 'subnet', address: '300.1.1.1/8' }).ok, false)
})

test('line codes', () => {
  const s = run('linecode', { bits: '10110', codes: 'ami manchester nrzi' }).summary
  assert.equal(s.ami, '+0-+0')
  assert.equal(s.manchester, '-+--+')   // first half of each bit: 1 = low→high, 0 = high→low
  assert.equal(run('linecode', { bits: '100000000', codes: 'b8zs' }).summary.b8zs, '+000+-0-+')
  // HDB3: two 1s then 0000 -> even pulses so far → B00V
  const h = run('linecode', { bits: '1100001', codes: 'hdb3' }).summary.hdb3
  assert.equal(h.length, 7)
  assert.equal(h, '+-+00+-')   // B00V: B = + (opposite of the last −), V = + (violation); the next 1 alternates from V
})

test('routing: Kurose Dijkstra and DV agree', () => {
  const d = run('routing', { algo: 'dijkstra', source: 'u' }).summary
  assert.deepEqual([d.d_v, d.d_x, d.d_w, d.d_y, d.d_z], ['2', '1', '3', '2', '4'])
  const dv = run('routing', { algo: 'dv' }).summary
  assert.equal(dv.row_u.split(' ').join(','), ['0', '2', '1', '3', '2', '4'].join(',').replace(/,/g, ',')) // u,v,x,w,y,z column order = first appearance
})

test('TCP: slow start doubles, congestion avoidance adds one, reno halves', () => {
  const t = run('tcp', { variant: 'reno', rounds: '12', ssthresh: '8', dupacks: '9' }).summary.cwnd.split(' ').map(Number)
  assert.deepEqual(t.slice(0, 8), [1, 2, 4, 8, 9, 10, 11, 12])
  assert.equal(t[8], 13)   // RTT 9 still reports the pre-loss window …
  assert.equal(t[9], 6)    // … then reno resumes at ssthresh = 6
  const tahoe = run('tcp', { variant: 'tahoe', rounds: '12', ssthresh: '8', dupacks: '9' }).summary.cwnd.split(' ').map(Number)
  assert.equal(tahoe[9], 1)
})

test('modulation, PCM and Fourier draw', () => {
  for (const s of ['ask', 'fsk', 'psk', 'am', 'fm']) assert.ok(run('modulation', { scheme: s }).frames.length > 1)
  const pcm = run('pcm', { fm: '1', fs: '8', bits: '3' }).summary
  assert.equal(pcm.bitRate, '24')
  assert.equal(pcm.snrDb, '19.82')
  assert.equal(run('pcm', { fm: '5', fs: '8' }).summary.nyquistOk, 'no')
  assert.ok(Number(run('fourier', { harmonics: '49' }).summary.rmsError) < Number(run('fourier', { harmonics: '3' }).summary.rmsError))
})

// ── data structures ──
test('sorting: every algorithm sorts, bubble counts match', () => {
  const vals = '5 1 4 2 8 9 3 7 6 0 12 11'
  const want = [...vals.split(' ').map(Number)].sort((a, b) => a - b).join(' ')
  for (const a of ['bubble', 'insertion', 'selection', 'shell', 'quick', 'merge', 'heap', 'radix']) assert.equal(run('sorting', { algo: a, values: vals }).summary.sorted, want, a)
  const b = run('sorting', { algo: 'bubble', values: '5 1 4 2 8' }).summary
  assert.deepEqual([b.comparisons, b.moves], ['9', '4'])
  assert.equal(runEngine({ engine: 'sorting', algo: 'radix', values: '3 -1' }).ok, false)
})

test('hashing: linear probing example, chaining', () => {
  assert.equal(run('hashing', { method: 'linear', size: '7', keys: '50 700 76 85 92 73 101' }).summary.table, '700 50 85 92 73 101 76')
  assert.equal(run('hashing', { method: 'chaining', size: '5', keys: '5 10 3 8' }).summary.table, '5|10 - - 3|8 -')
  assert.equal(run('hashing', { method: 'linear', size: '7', keys: '50 700 76 85 92 73 101' }).summary.loadFactor, '1')
})

test('Huffman: optimal code length', () => {
  const t = run('huffman', { text: 'aaaabbc' }).summary
  assert.equal(t.totalBits, '10')
  assert.equal(t.asciiBits, '56')
  // classic CLRS frequencies: f:5 e:9 c:12 b:13 d:16 a:45 -> 224 bits total over 100 chars
  assert.equal(run('huffman', { text: 'f:5 e:9 c:12 b:13 d:16 a:45' }).summary.totalBits, '224')
})

test('AVL rotations keep the tree balanced', () => {
  const t = run('bst', { mode: 'avl', ops: '10;20;30;40;50;25' }).summary
  assert.equal(t.root, '30')
  assert.equal(t.height, '3')
  assert.equal(t.inorder, '10 20 25 30 40 50')
  const plain = run('bst', { mode: 'bst', ops: '10;20;30;40;50' }).summary
  assert.equal(plain.height, '5')
  assert.equal(run('bst', { mode: 'avl', ops: '20;10;30;delete 10;delete 30' }).summary.inorder, '20')
})

test('heap and B-tree', () => {
  assert.equal(run('heap', { kind: 'min', ops: '5 3 8 1' }).summary.array, '1 3 8 5')
  assert.equal(run('heap', { kind: 'min', ops: '5 3 8 1 extract' }).summary.array, '3 5 8')
  const b = run('btree', { variant: 'btree', order: '3', keys: '1 2 3 4 5 6 7' }).summary
  assert.equal(b.rootKeys, '4'); assert.equal(b.height, '3'); assert.equal(b.leafKeys, '1 3 5 7')   // 2, 4, 6 live in internal nodes
  const bp = run('btree', { variant: 'bplus', order: '3', keys: '1 2 3 4 5 6 7' }).summary
  assert.equal(bp.leafKeys, '1 2 3 4 5 6 7') // a B+ tree keeps every key in the leaves
})

test('graph algorithms', () => {
  assert.equal(run('graphalgo', { algo: 'kruskal' }).summary.weight, '37')
  assert.equal(run('graphalgo', { algo: 'prim' }).summary.weight, '37')
  assert.equal(run('graphalgo', { algo: 'bfs', graph: 'A-B;A-C;B-D;C-D;D-E', start: 'A' }).summary.order, 'A B C D E')
  assert.equal(run('graphalgo', { algo: 'topo', graph: 'a>b;a>c;b>d;c>d' }).summary.order, 'a b c d')
  assert.equal(runEngine({ engine: 'graphalgo', algo: 'topo', graph: 'a>b;b>a' }).ok, false)
})

test('postfix and Hanoi', () => {
  assert.equal(run('infix', { expr: 'A+B*C-(D/E)' }).summary.postfix, 'A B C * + D E / -')
  assert.equal(run('infix', { expr: '(2+3)*4-6/2' }).summary.value, '17')
  assert.equal(run('infix', { expr: '2^3^2' }).summary.postfix, '2 3 2 ^ ^')
  assert.equal(run('hanoi', { disks: '4' }).summary.moves, '15')
})

// ── theory of computation ──
test('DFA: strings ending in 01', () => {
  for (const [w, want] of [['1101', 'yes'], ['0', 'no'], ['01', 'yes'], ['0110', 'no'], ['', 'no']]) assert.equal(run('dfa', { input: w }).summary.accepted, want, w)
  assert.equal(runEngine({ engine: 'dfa', spec: 'start: a\naccept: b\na,0 -> b\na,0 -> a', input: '0' }).ok, false)
})

test('NFA with ε moves', () => {
  const spec = 'start: q0\naccept: q2\nq0,a -> q0\nq0,e -> q1\nq1,b -> q2'
  assert.equal(run('nfa', { spec, input: 'aab' }).summary.accepted, 'yes')
  assert.equal(run('nfa', { spec, input: 'aa' }).summary.accepted, 'no')
  assert.equal(run('nfa').summary.accepted, 'yes') // default machine: second-to-last symbol is 1 (input 0110)
})

test('PDA: a^n b^n', () => {
  assert.equal(run('pda', { input: 'aaabbb' }).summary.accepted, 'yes')
  assert.equal(run('pda', { input: 'aabbb' }).summary.accepted, 'no')
  assert.equal(run('pda', { input: '' }).summary.accepted, 'yes')
})

test('Turing machine: binary increment', () => {
  assert.equal(run('tm', { input: '1011' }).summary.tape, '1100')
  assert.equal(run('tm', { input: '111' }).summary.tape, '1000')
  assert.equal(runEngine({ engine: 'tm', spec: 'start: a\nblank: _\na,_ -> a,_,R', input: '' }).ok, false) // never halts
})

test('CFG derivation and parse tree', () => {
  const t = run('cfg', { grammar: 'S -> aSb | ab', string: 'aaabbb' }).summary
  assert.equal(t.steps, '3')
  assert.equal(t.derivation, 'S => aSb => aaSbb => aaabbb')
  assert.equal(runEngine({ engine: 'cfg', grammar: 'S -> aSb | ab', string: 'aab' }).ok, false)
  assert.ok(run('cfg', { grammar: 'E -> E+T | T\nT -> T*F | F\nF -> (E) | a', string: 'a+a*a' }).summary.derivable)
})

// ── numerical methods & statistics ──
test('expression evaluator', async () => {
  const { compile } = await import(bundleExpr)
  assert.equal(compile('2+3*4')({}), 14)
  assert.equal(compile('-2^2')({}), -4)
  assert.equal(compile('2x^2')({ x: 3 }), 18)
  assert.ok(Math.abs(compile('sin(pi/2)')({}) - 1) < 1e-12)
  assert.throws(() => compile('2+')({}))
})

test('root finding converges to the known roots', () => {
  for (const m of ['bisection', 'falsi', 'newton', 'secant']) {
    const r = run('rootfind', { method: m, f: 'x^3 - x - 2', a: '1', b: '2', x0: '1.5', tol: '1e-6' }).summary
    assert.ok(Math.abs(Number(r.root) - 1.5214) < 1e-3, `${m}: ${r.root}`)
  }
  assert.equal(runEngine({ engine: 'rootfind', method: 'bisection', f: 'x^2+1', a: '0', b: '1' }).ok, false)
  assert.ok(Number(run('rootfind', { method: 'newton', f: 'x^2-2', x0: '1', tol: '1e-9' }).summary.iterations) <= 6)
})

test('integration and ODEs', () => {
  assert.equal(run('integrate', { rule: 'simpson', f: 'sin(x)', a: '0', b: '3.14159265358979', n: '8' }).summary.exact, '2')
  assert.ok(Number(run('integrate', { rule: 'trapezoid', n: '4' }).summary.error) > Number(run('integrate', { rule: 'simpson', n: '4' }).summary.error))
  const o = run('ode', { f: 'x + y', x0: '0', y0: '1', h: '0.1', xEnd: '1', methods: 'euler rk4', exact: '2*exp(x) - x - 1' }).summary
  assert.equal(o.exact, '3.43656')
  assert.ok(Math.abs(Number(o.rk4) - 3.43656) < 1e-4)
  assert.ok(Math.abs(Number(o.euler) - 3.43656) > 0.1)
})

test('linear systems', () => {
  assert.equal(run('gauss').summary.solution, '2 3 -1')
  assert.equal(run('iterative', { iterations: '12' }).summary.dominant, 'yes')
  const x = run('iterative', { iterations: '12', method: 'seidel' }).summary.x.split(' ').map(Number)
  assert.ok(Math.abs(x[0] - 1.04327) < 1e-3 && Math.abs(x[1] - 2.26923) < 1e-3 && Math.abs(x[2] + 1.08173) < 1e-3, x.join())
  assert.equal(runEngine({ engine: 'gauss', matrix: '1,1,2;2,2,4' }).ok, false)
  assert.equal(run('interp', { points: '0,1;1,3;2,2;3,5', at: '1.5' }).summary.value, run('interp', { points: '0,1;1,3;2,2;3,5', at: '1.5' }).summary.newtonValue)
})

test('heat equation: stable and unstable', () => {
  assert.ok(Math.abs(Number(run('heat1d', { steps: '400' }).summary.mid) - 50) < 1)
  assert.equal(runEngine({ engine: 'heat1d', r: '0.6' }).ok, false)
})

test('statistics engines', () => {
  const g = run('regression', { points: '1,2;2,3;3,5;4,4;5,6' }).summary
  assert.deepEqual([g.slope, g.intercept], ['0.9', '1.3'])
  assert.equal(g.r2, '0.81')
  assert.ok(Math.abs(Number(run('dist', { kind: 'binomial', n: '10', p: '0.5', from: '4', to: '6' }).summary.prob) - 0.65625) < 1e-4)
  assert.ok(Math.abs(Number(run('dist', { kind: 'normal', from: '-1.96', to: '1.96' }).summary.prob) - 0.95) < 1e-3)
  assert.equal(run('bayes', { prior: '0.01', sensitivity: '0.9', specificity: '0.91' }).summary.posterior, '0.0917')
  const c = run('clt', { population: 'exponential', n: '30', samples: '600' }).summary
  assert.ok(Math.abs(Number(c.sdOfMeans) - Number(c.theorySd)) < 0.05, `${c.sdOfMeans} vs ${c.theorySd}`)
  const ci = Number(run('confint', { intervals: '200' }).summary.coverage)
  assert.ok(ci > 88 && ci < 99, `coverage ${ci}`)
  assert.equal(run('gd', { f: 'x^2 - 4*x + 5', lr: '0.2', steps: '60' }).summary.x, '2')
  assert.equal(run('gd', { f: 'x^2', lr: '1.1', x0: '1', steps: '80' }).summary.diverged, 'yes')
})

// ── simulation & AI ──
test('LCG: full-period example, tests', () => {
  const t = run('lcg', { a: '5', c: '3', m: '16', seed: '7' }).summary
  assert.equal(t.sequence, '7 6 1 8 11 10 5 12 15 14 9 0 3 2 13 4 7')
  assert.equal(t.period, '16'); assert.equal(t.fullPeriod, 'yes')
  assert.equal(run('lcg', { a: '4', c: '0', m: '16', seed: '1' }).summary.fullPeriod, 'no')
})

test('Monte Carlo, queue, Markov', () => {
  assert.ok(Math.abs(Number(run('montecarlo', { points: '5000' }).summary.estimate) - Math.PI) < 0.1)
  const q = run('mm1', { lambda: '0.5', mu: '1', customers: '4000', seed: '9' }).summary
  assert.ok(Math.abs(Number(q.utilisation) - 0.5) < 0.05, q.utilisation)
  assert.ok(Math.abs(Number(q.avgInSystem) - 1) < 0.25, q.avgInSystem)
  assert.equal(runEngine({ engine: 'mm1', lambda: '1', mu: '1' }).ok, false)
  const m = run('markov').summary
  assert.equal(m.steady_Sunny, '0.8333'); assert.equal(m.steady_Rainy, '0.1667')
  assert.equal(runEngine({ engine: 'markov', matrix: '0.5,0.4;0.5,0.5' }).ok, false)
})

test('search: A* is optimal, BFS is optimal, greedy explores less', () => {
  const grid = 'S...;.##.;...G'
  assert.equal(run('search', { algo: 'astar', grid }).summary.cost, '5')
  assert.equal(run('search', { algo: 'bfs', grid }).summary.cost, '5')
  const open = 'S.......;........;........;.......G'
  assert.ok(Number(run('search', { algo: 'astar', grid: open }).summary.expanded) < Number(run('search', { algo: 'bfs', grid: open }).summary.expanded))
  assert.equal(runEngine({ engine: 'search', grid: 'S#G' }).ok, false)
})

test('minimax: value and pruning', () => {
  const on = run('minimax', { pruning: 'on' }).summary
  assert.equal(on.value, '5'); assert.equal(on.leavesEvaluated, '5')   // 9 is pruned too, and the whole (0,-1) subtree
  const off = run('minimax', { pruning: 'off' }).summary
  assert.equal(off.value, '5'); assert.equal(off.leavesEvaluated, '8')
  assert.equal(runEngine({ engine: 'minimax', leaves: '1 2 3' }).ok, false)
})

test('learning: perceptron, k-means, GA, XOR network, fuzzy', () => {
  assert.equal(run('perceptron', { data: '0,0,0;0,1,0;1,0,0;1,1,1' }).summary.converged, 'yes')
  assert.equal(run('perceptron', { data: '0,0,0;0,1,1;1,0,1;1,1,0', epochs: '20' }).summary.converged, 'no')   // XOR is not linearly separable
  const k = run('kmeans').summary
  assert.equal(k.centroids, '(1.25,1.5) (3.9,5.1)')
  assert.ok(Number(run('ga', { generations: '30', population: '10' }).summary.best) >= 625)
  const n = run('mlp').summary
  assert.equal(n.solved, 'yes')
  assert.ok(Number(n.loss) < 0.01)
  const f = run('fuzzy', { temp: '28' }).summary
  assert.equal(f.muWarm, '0.7'); assert.equal(f.muHot, '0.2')
})

// ── graphics & databases ──
test('rasterisation', () => {
  assert.equal(run('raster', { algo: 'bresenham', x1: '0', y1: '0', x2: '5', y2: '2' }).summary.pixels, '0,0 1,0 2,1 3,1 4,2 5,2')
  assert.equal(run('raster', { algo: 'dda', x1: '0', y1: '0', x2: '4', y2: '2' }).summary.pixels, '0,0 1,1 2,1 3,2 4,2'.replace('1,1 2,1', '1,1 2,1'))
  assert.equal(run('raster', { algo: 'circle', r: '5', cx: '8', cy: '8' }).summary.octant, '0,5 1,5 2,5 3,4')
  assert.ok(Number(run('raster', { algo: 'floodfill' }).summary.filled) > 30)
  assert.equal(runEngine({ engine: 'raster', algo: 'floodfill', polygon: '3,3;12,3;12,10' }).ok, true)
})

test('clipping: both algorithms agree', () => {
  const a = run('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 20 60 40' }).summary.result
  const b = run('clip', { algo: 'liang', window: '10 10 50 50', line: '0 20 60 40' }).summary.result
  assert.equal(a, '10,23.33 50,36.67'); assert.equal(b, a)
  assert.equal(run('clip', { algo: 'cohen', window: '10 10 50 50', line: '0 0 5 60' }).summary.result, 'rejected')
  assert.equal(run('clip', { algo: 'liang', window: '10 10 50 50', line: '0 0 5 60' }).summary.result, 'rejected')
  assert.equal(run('clip', { algo: 'cohen', window: '10 10 50 50', line: '20 20 40 40' }).summary.result, '20,20 40,40')
})

test('transformations compose right to left, curves, projection', () => {
  assert.equal(run('transform2d', { shape: '1,0', ops: 'translate 2 3; rotate 90' }).summary.vertices, '(-3,3)')
  assert.equal(run('transform2d', { shape: '1,0', ops: 'rotate 90; translate 2 3' }).summary.vertices, '(2,4)')
  assert.equal(run('transform2d', { shape: '2,1', ops: 'rotate 90 about 1 1' }).summary.vertices, '(1,2)')
  const b = run('bezier').summary
  assert.equal(b.mid, b.formulaMid)
  const pr = run('project3d', { rx: '0', ry: '0', distance: '4' }).summary
  assert.equal(pr.v0parallel, '-1,-1'); assert.equal(pr.v0perspective, '-0.8,-0.8') // z = −1 → w = 4/5
  assert.equal(run('phong', { ka: '0.1', kd: '0.5', ks: '0.4', shininess: '10' }).summary.totalAt0, '1')
})

test('functional dependencies and normal forms', () => {
  const t = run('fd', { attrs: 'ABC', fds: 'A->B;B->C', closureOf: 'A' }).summary
  assert.deepEqual([t.closure, t.keys, t.normalForm], ['ABC', 'A', '2NF'])
  assert.equal(run('fd', { attrs: 'ABCD', fds: 'AB->C;C->D', closureOf: 'AB' }).summary.normalForm, '2NF')
  assert.equal(run('fd', { attrs: 'ABC', fds: 'A->B;A->C', closureOf: 'A' }).summary.normalForm, 'BCNF')
  assert.equal(run('fd', { attrs: 'ABCD', fds: 'AB->C;B->D', closureOf: 'B' }).summary.normalForm, '1NF')   // partial dependency
  assert.equal(run('fd', { attrs: 'ABC', fds: 'AB->C;C->B', closureOf: 'AB' }).summary.normalForm, '3NF')   // classic 3NF-not-BCNF
})

test('schedules and relational algebra', () => {
  assert.equal(run('serializability', { schedule: 'r1(x) w2(x) w1(x)' }).summary.serializable, 'no')
  const ok = run('serializability', { schedule: 'r1(x) w1(x) r2(x) w2(x)' }).summary
  assert.deepEqual([ok.serializable, ok.order], ['yes', 'T1 T2'])
  assert.equal(run('serializability', { schedule: 'r1(x) r2(x) r3(y)' }).summary.serializable, 'yes')
  assert.equal(run('relalg', { op: 'join' }).summary.rows, '3')
  assert.equal(run('relalg', { op: 'leftjoin' }).summary.rows, '4')
  assert.equal(run('relalg', { op: 'select', arg: 'salary > 45' }).summary.result, 'Ann:CS:50 Cy:CS:60')
  assert.equal(run('relalg', { op: 'project', arg: 'dept' }).summary.result, 'CS EE ME')
  assert.equal(run('relalg', { op: 'group', arg: 'dept:sum(salary)' }).summary.result, 'CS:110 EE:40 ME:45')
  assert.equal(run('relalg', { op: 'product' }).summary.rows, '12')
  assert.equal(runEngine({ engine: 'relalg', op: 'select', arg: 'nope > 1' }).ok, false)
})

// ── block-diagram simulation ──
test('blocks: unity feedback around 1/(s+1) with gain 2 settles at 2/3', () => {
  const s = run('blocks').summary
  assert.equal(s.final, '0.6667')
  assert.equal(s.y_final, '0.6667')
  assert.ok(Number(s.overshoot) < 0.5, 'a first-order loop does not overshoot')
})

test('blocks: an underdamped second-order plant overshoots by exp(-πζ/√(1-ζ²))', () => {
  const zeta = 0.2
  const want = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)) * 100
  const blocks = 'r: step(1)\ng: tf(1 ; 1 0.4 1)\ny: scope\nr -> g -> y'
  const s = run('blocks', { blocks, time: '40', dt: '0.01' }).summary
  assert.ok(Math.abs(Number(s.overshoot) - want) < 1, `${s.overshoot} vs ${want.toFixed(1)}`)
  assert.ok(Math.abs(Number(s.final) - 1) < 1e-3)
})

test('blocks: integrator, PID and errors', () => {
  const ramp = run('blocks', { blocks: 'r: const(2)\ni: integrator\ny: scope\nr -> i -> y', time: '3' }).summary
  assert.equal(ramp.final, '6')
  const pid = run('blocks', { blocks: 'r: step(1)\ne: sum(+-)\nc: pid(2, 1, 0)\np: tf(1 ; 1 1)\ny: scope\nr -> e -> c -> p -> y\np -> e', time: '20' }).summary
  assert.ok(Math.abs(Number(pid.final) - 1) < 1e-3, pid.final)   // integral action removes the steady-state error
  const e1 = runEngine({ engine: 'blocks', blocks: 'e: sum(+-)\nk: gain(2)\ny: scope\ne -> k -> y\nk -> e' })
  assert.equal(e1.ok, false); assert.match(e1.error, /algebraic loop/)
  assert.equal(runEngine({ engine: 'blocks', blocks: 'a: nope' }).ok, false)
  assert.equal(runEngine({ engine: 'blocks', blocks: 'r: step(1)\nr -> q' }).ok, false)
  const sat = run('blocks', { blocks: 'r: sine(3, 0.5)\ns: sat(-1, 1)\ny: scope\nr -> s -> y', time: '4' }).summary
  assert.ok(Number(sat.y_final) <= 1)
})
