import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const refs = '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1'
  const fifo = run('paging', { algo: 'fifo', frames: 3, refs }), lru = run('paging', { algo: 'lru', frames: 3, refs }), opt = run('paging', { algo: 'opt', frames: 3, refs })
  const bel = '1 2 3 4 1 2 5 1 2 3 4 5'
  const b3 = run('paging', { algo: 'fifo', frames: 3, refs: bel }), b4 = run('paging', { algo: 'fifo', frames: 4, refs: bel })
  const first = run('memfit', { algo: 'first' }), best = run('memfit', { algo: 'best' }), worst = run('memfit', { algo: 'worst' })
  return lesson({
    title: 'Memory management and virtual memory',
    kicker: 'ENCT 254 · Operating System · Chapter 4 (memory)',
    subtitle: 'Programs think they own a huge private address space. The OS and the MMU make that true with pages, page tables, and a policy for what to throw out.',
    sections: [
      sec('alloc', '4.1', 'Contiguous allocation and fragmentation', { eyebrow: 'The old way',
        body: `<p>The simplest scheme gives each process one contiguous block. The OS keeps a list of free holes and, for each request, chooses one: ${term('first fit')} takes the first hole big enough, ${term('best fit')} the smallest that fits, ${term('worst fit')} the largest. Whatever is left over is too small to use — ${term('external fragmentation')}. Compaction can squeeze holes together but costs a great deal of copying.</p>`,
        figs: [lab('memfit', { algo: 'first' }, `First fit: ${first.placed}.`, ['placed'], { caption: 'first fit', name: 'ff' }), lab('memfit', { algo: 'best' }, `Best fit: ${best.placed}.`, ['placed'], { caption: 'best fit', name: 'bf' }), lab('memfit', { algo: 'worst' }, `Worst fit: ${worst.placed}.`, ['placed'], { caption: 'worst fit', name: 'wf' })],
        qs: [q('fit', 'Free holes are 100, 500, 200, 300, 600 KB. Which policy can place all four requests 212, 417, 112, 426?', ['Best fit — the others strand memory and leave 426 unplaced.', `First fit and worst fit carve big holes into pieces that no longer fit 426; best fit keeps the large holes whole (result: ${best.placed}).`], [['First fit.', `It leaves ${first.unplaced} request unplaced: 426 KB has no hole left once 212 and 112 have split the 500 KB block.`], ['Worst fit.', `It also fails on 426 KB (${worst.unplaced} unplaced) because it keeps shaving the largest hole.`]])] }),
      sec('paging', '4.2', 'Paging', { eyebrow: 'The modern way',
        body: `<p>${term('Paging')} cuts the virtual address space into fixed-size ${term('pages')} and physical memory into same-size ${term('frames')}. Any page can go in any frame, so external fragmentation disappears. A per-process ${term('page table')} maps page number → frame number; a virtual address splits into a page number and an offset, and the offset passes through unchanged.</p><p>With 4 KB pages, the address 0x3A7C has page number 3 and offset 0xA7C; if page 3 lives in frame 9, the physical address is 9·4096 + 0xA7C. A small cache of recent translations, the ${term('TLB')}, keeps this fast.</p>`,
        figs: [dia(`direction: right
[CPU: virtual address page p, offset d] as cpu #blue
[TLB] as tlb #amber
[Page table] as pt #violet
[Physical memory: frame f, offset d] as ram #mint
cpu -> tlb : p
tlb -> ram : hit → f
tlb -> pt : miss
pt -> ram : f
@0 cpu -> tlb : p
@1.2 tlb -> pt : miss
@2.4 pt -> ram : frame f
loop 5`, 'A TLB hit skips the page-table walk.', { caption: 'address translation' })],
        worked: [step('4 KB pages → 12 offset bits. Virtual address 0x3A7C: page number = 0x3A7C >> 12 = 3, offset = 0xA7C.', '\\text{page}=3,\\ \\text{offset}=\\mathtt{0xA7C}', { toc: 'Split' }), step('If page 3 is in frame 9, the physical address is frame × 4096 + offset = 36864 + 2684.', '9\\cdot4096 + 2684 = 39548', { hero: true, toc: 'Translate' })],
        qs: [q('offset', 'During translation, what happens to the offset bits?', ['They pass through unchanged — only the page number is replaced by a frame number.', 'Pages and frames are the same size, so a byte keeps its position inside the page.'], [['They are multiplied by the frame number.', 'Nothing is multiplied; the frame number is shifted into the high bits.'], ['They are looked up in the page table.', 'The page table is indexed by page number only.']])] }),
      sec('replace', '4.3', 'Page replacement', { eyebrow: 'When memory is full',
        body: `<p>Virtual memory keeps only some pages resident. A reference to a non-resident page is a ${term('page fault')}: the OS loads it from disk and, if no frame is free, must ${term('evict')} another. ${term('FIFO')} evicts the oldest resident page; ${term('LRU')} the least recently used; ${term('LFU')} the least frequently used; the unreachable ${term('optimal')} policy evicts the page needed furthest in the future and serves as the yardstick.</p><p>On the textbook reference string with 3 frames: FIFO = <b>${fifo.faults}</b> faults, LRU = <b>${lru.faults}</b>, optimal = <b>${opt.faults}</b> of 20 references.</p>`,
        figs: [lab('paging', { algo: 'fifo', frames: 3, refs }, 'FIFO: red = fault, green = hit.', ['faults', 'hitRatio'], { caption: 'FIFO', name: 'fifo' }), lab('paging', { algo: 'lru', frames: 3, refs }, 'LRU remembers recent use.', ['faults', 'hitRatio'], { caption: 'LRU', name: 'lru' }), lab('paging', { algo: 'opt', frames: 3, refs }, 'Optimal is the lower bound.', ['faults'], { caption: 'optimal', name: 'opt' })],
        qs: [q('lru', 'Why does LRU usually beat FIFO?', ['Programs show locality: a page used recently is likely to be used again soon, while an old page may still be hot.', 'FIFO only knows age of loading; LRU tracks use, which is what predicts the future.'], [['LRU is cheaper to implement.', 'The opposite: exact LRU needs bookkeeping on every reference.'], ['LRU never faults more than FIFO.', 'Not a theorem; it tends to win on real programs, not on every string.']])] }),
      sec('belady', '4.4', "Belady's anomaly and thrashing", { eyebrow: 'Surprises',
        body: `<p>More frames should mean fewer faults — but not for FIFO. On the string 1 2 3 4 1 2 5 1 2 3 4 5, three frames give <b>${b3.faults}</b> faults and four frames give <b>${b4.faults}</b>: ${term("Belady's anomaly")}. LRU and optimal are ${term('stack algorithms')} and cannot do this.</p><p>${term('Thrashing')} is the other failure: if the frames given to a process are fewer than its ${term('working set')}, it faults almost every reference and the CPU idles while the disk churns. The fixes are to give it enough frames, or to suspend some processes.</p>`,
        figs: [lab('paging', { algo: 'fifo', frames: 3, refs: bel }, 'Three frames.', ['faults'], { caption: 'FIFO, 3 frames', name: 'b3' }), lab('paging', { algo: 'fifo', frames: 4, refs: bel }, 'Four frames — more faults!', ['faults'], { caption: 'FIFO, 4 frames', name: 'b4' })],
        qs: [q('anomaly', 'FIFO with 4 frames faults more than with 3 on the same string. What does this show?', ["Adding memory does not always help FIFO — Belady's anomaly.", `FIFO's eviction order ignores use, so a larger memory can shift which pages are resident at the wrong moment (${b3.faults} → ${b4.faults} faults).`], [['The simulator has a bug.', 'It is a real, classic result reproduced exactly by the textbook string.'], ['Four frames is too many for this string.', 'More frames can never be “too many”; the policy is at fault.']])],
        probs: [pr('p-lru', '<p>Reference string 7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1 with 3 frames: count faults for FIFO, LRU and optimal.</p>', `FIFO <b>${fifo.faults}</b>, LRU <b>${lru.faults}</b>, optimal <b>${opt.faults}</b>. Hit ratios ${fifo.hitRatio}%, ${lru.hitRatio}%, ${opt.hitRatio}%.`, { verify: lab('paging', { algo: 'lru', frames: 3, refs }, 'LRU trace.', ['faults'], { caption: 'answer', name: 'ans' }) })] }),
      sec('seg', '4.5', 'Segmentation and allocating frames', { eyebrow: 'Another view',
        body: `<p>${term('Segmentation')} divides a program by meaning — code, data, stack — rather than by fixed size. An address is (segment, offset); a segment table holds each segment's base and limit, and an offset beyond the limit is a protection fault. Segments are visible to the programmer and variable-sized, so they bring back external fragmentation; real systems combine both ideas (paged segments).</p><p>Given a segment table, translate (2, 100): if segment 2 has base 4300 and limit 400, then 100 &lt; 400 is legal and the physical address is 4300 + 100 = 4400; offset 500 would trap.</p>`,
        worked: [step('Check the offset against the limit.', '100 < 400', { toc: 'Limit check' }), step('Add the base.', '4300 + 100 = 4400', { hero: true, toc: 'Physical address' })],
        qs: [q('seglimit', 'Segment 2 has base 4300 and limit 400. What happens for (2, 500)?', ['A protection fault — the offset exceeds the limit.', 'The limit register exists precisely to stop a program reaching beyond its own segment.'], [['Physical address 4800.', 'Adding base and offset without checking the limit is the bug segmentation prevents.'], ['It wraps around to offset 100.', 'There is no wrap-around; out-of-range is an error.']])] }),
      sec('summary', '4.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>Paging removes external fragmentation; the page table maps pages to frames, the offset is unchanged.</li><li>A page fault loads from disk; the replacement policy decides the victim.</li><li>Optimal ≤ LRU ≲ FIFO on real programs; FIFO can even get worse with more frames.</li><li>Thrashing = fewer frames than the working set.</li></ul>` }),
    ],
  })
}
