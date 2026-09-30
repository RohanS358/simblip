import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const base = { lines: 4, block: 1, addrs: '0 8 0 6 8' }
  const d = run('cache', { ...base, mapping: 'direct' }), s2 = run('cache', { ...base, mapping: 'set', ways: 2 }), f = run('cache', { ...base, mapping: 'full' })
  return lesson({
    title: 'Memory hierarchy and caches',
    kicker: 'ENCT 303 · Computer Organization and Architecture · Chapter 4',
    subtitle: 'Fast memory is small, big memory is slow — a cache makes the big slow one look fast by remembering what you just used.',
    sections: [
      sec('hier', '4.1', 'The hierarchy', { eyebrow: 'Speed vs size',
        body: `<p>No memory is fast, large and cheap at once, so computers stack them: registers (sub-ns, bytes), cache (ns, KB–MB), main memory (≈100 ns, GB), disk/SSD (µs–ms, TB). It works because of ${term('locality')}: ${term('temporal')} (what you used you will use again) and ${term('spatial')} (what is near what you used will be used). The hierarchy moves data in blocks so neighbours come along.</p>`,
        figs: [dia(`direction: down
[Registers: ~0.3 ns, bytes] as a #rose
[L1/L2/L3 cache: 1–20 ns, KB–MB] as b #amber
[Main memory (DRAM): ~100 ns, GB] as c #mint
[SSD / disk: 0.1–10 ms, TB] as d #blue
a -> b : miss
b -> c : miss
c -> d : page fault`, 'Each level is a cache for the one below.', { caption: 'memory hierarchy' })],
        qs: [q('spatial', 'Looping over an array element by element is fast on a cache mainly because of…', ['Spatial locality — one block fetch brings in the next few elements too.', 'Each miss loads a whole block, so the following accesses hit.'], [['Temporal locality of each element.', 'Each element is used once in the pass.'], ['The CPU clock.', 'Unrelated.']])] }),
      sec('mapping', '4.2', 'Mapping: where may a block go?', { eyebrow: 'Design',
        body: `<p>A block of memory can be placed in: exactly one line (${term('direct-mapped')}: cheap, but blocks that map to the same line keep evicting each other — ${term('conflict misses')}); any line (${term('fully associative')}: flexible, expensive to search); or any line within one set (${term('set-associative')}, e.g. 2-way: the usual compromise). An address splits into <b>tag | index | offset</b>; the index picks the set, the tag is compared with each line in it, the offset picks the byte.</p><p>Same 5 addresses <code>0 8 0 6 8</code> into a 4-line cache: direct-mapped gets <b>${d.misses}</b> misses, 2-way <b>${s2.misses}</b>, fully associative <b>${f.misses}</b>.</p>`,
        figs: [lab('cache', { ...base, mapping: 'direct' }, 'Addresses 0 and 8 both map to line 0 and keep evicting each other.', ['misses'], { caption: 'direct-mapped', name: 'dm' }), lab('cache', { ...base, mapping: 'set', ways: 2 }, '2-way: 0 and 8 can coexist in the set.', ['misses'], { caption: '2-way set associative', name: 'sa' }), lab('cache', { ...base, mapping: 'full' }, 'Fully associative: only compulsory misses.', ['misses'], { caption: 'fully associative', name: 'fa' })],
        qs: [q('conflict', 'Why does the direct-mapped cache miss on the second reference to address 0?', ['Address 8 mapped to the same line and evicted it (a conflict miss).', 'With one allowed place, two hot blocks that share an index thrash.'], [['The cache is too small for any data.', 'It has four lines and only three distinct blocks.'], ['Address 0 was never loaded.', 'It was loaded by the first reference.']])],
        worked: [step('A 32-bit address, 4 KB direct-mapped cache with 16-byte blocks. Offset bits = log₂16 = 4.', '4', { toc: 'Offset' }), step('Lines = 4096/16 = 256 → index bits = 8. Tag = 32 − 8 − 4 = 20 bits.', '\\text{tag}=32-8-4=20', { hero: true, toc: 'Tag' })] }),
      sec('policy', '4.3', 'Replacement and write policies', { eyebrow: 'Decisions',
        body: `<p>When a set is full, replacement picks a victim: ${term('LRU')} (least recently used), ${term('FIFO')}, or random. On a write: ${term('write-through')} updates memory every time (simple, slow; often with a write buffer); ${term('write-back')} marks the line dirty and writes memory only on eviction (fast; complicated). On a write miss: ${term('write-allocate')} loads the block first, ${term('no-write-allocate')} writes straight to memory.</p>`,
        qs: [q('wb', 'What does a write-back cache save compared with write-through?', ['Memory traffic: repeated writes to one line cost one write at eviction.', 'The dirty bit remembers that memory is stale.'], [['It saves the tag bits.', 'Write-back adds a dirty bit.'], ['It never needs memory.', 'Memory is updated on eviction.']])] }),
      sec('amat', '4.4', 'Average memory access time', { eyebrow: 'The payoff',
        body: `<p>AMAT = hit time + miss rate × miss penalty. With a 1-cycle hit, 100-cycle penalty and the fully associative run above (${f.hitRate}% hits) AMAT is <b>${f.amat}</b> cycles — a cache with a 90% hit rate would give 1 + 0.1 × 100 = <b>11</b>. Multi-level caches nest the formula: the L1 miss penalty is the L2 access time.</p>`,
        figs: [lab('cache', { ...base, mapping: 'full', hitTime: 1, missPenalty: 100 }, 'The AMAT appears in the results.', ['hitRate', 'amat'], { caption: 'AMAT of the fully associative run', name: 'am' })],
        qs: [q('amat', 'Hit time 2 ns, miss rate 5%, miss penalty 80 ns. AMAT?', ['6 ns.', '2 + 0.05 × 80 = 6.'], [['2 ns.', 'That ignores misses.'], ['4 ns.', 'Forgets the hit time.']])],
        probs: [pr('p-tag', '<p>Direct-mapped, 64 KB cache, 32-byte blocks, 32-bit addresses. Give the tag, index and offset widths.</p>', 'Offset = 5 bits (32 B). Lines = 64K/32 = 2048 → index = 11. Tag = 32 − 11 − 5 = <b>16 bits</b>.')] }),
      sec('ext', '4.5', 'Semiconductor and external memory', { eyebrow: 'Technologies',
        body: `<p>SRAM (flip-flops) is fast and used for caches; DRAM (a capacitor plus transistor, refreshed constantly) is denser and used for main memory, in DDR DIMM/SODIMM modules. ROM/flash hold firmware. Externally: magnetic disk, SSD, optical and tape; RAID levels 1–5 add redundancy (see the OS course for a worked RAID 5 parity example).</p>`,
        qs: [q('dram', 'Why does DRAM need refreshing?', ['The charge on each capacitor leaks away.', 'Each row is periodically read and rewritten.'], [['It is volatile by design.', 'True, but refresh is about leakage.'], ['SRAM cells are slower.', 'They are faster and need no refresh.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Locality makes a small fast memory effective.</li><li>Direct, set-associative and fully associative trade cost against conflict misses.</li><li>AMAT = hit + miss rate × penalty.</li></ul>` }),
    ],
  })
}
