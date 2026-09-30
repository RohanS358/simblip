import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const bt = run('btree', { variant: 'btree', order: 3, keys: '1 2 3 4 5 6 7' }), bp = run('btree', { variant: 'bplus', order: 3, keys: '1 2 3 4 5 6 7' }), hs = run('hashing', { method: 'chaining', size: 5, keys: '5 10 3 8' })
  return lesson({
    title: 'Query processing, indexes and hashing',
    kicker: 'ENCT 301 · Database Management System · Chapters 5–6',
    subtitle: 'The same query can be answered a thousand ways; the optimiser picks one. Indexes are why it can be fast.',
    sections: [
      sec('steps', '5.1', 'From SQL to an answer', { eyebrow: 'Pipeline',
        body: `<p>A query is parsed, checked and translated into relational algebra; the optimiser rewrites it into cheaper equivalents and picks an execution plan using statistics; the evaluator runs the plan. Key rewrites: push selections down before joins (fewer rows to join), push projections down, choose the join order and the join algorithm.</p>`,
        figs: [dia(`direction: right
[SQL text] as s #blue
[Parser + checker] as p #violet
[Relational algebra tree] as a #mint
[Optimiser: cost estimate] as o #amber
[Execution plan] as e #rose
(Result rows) as r
s -> p
p -> a
a -> o : equivalent trees
o -> e : cheapest
e -> r
@0 s -> p : query
@1 p -> a : tree
@2 a -> o : alternatives
@3 o -> e : plan
@4 e -> r : rows
loop 6`, 'The optimiser sits between the algebra and the plan.', { caption: 'query processing' })],
        worked: [step('R has 10 000 rows, S has 10 000 rows; a selection keeps 1% of R. Join on a key.', '', { toc: 'Given' }), step('Selecting first: 100 rows of R joined with S. Joining first: 10⁴×10⁴ pairs compared before filtering.', '100\\ \\text{rows vs}\\ 10^8\\ \\text{pairs}', { hero: true, toc: 'Why push σ down' })],
        qs: [q('push', 'Why push selections below joins?', ['They shrink the inputs, so the join handles far fewer rows.', 'The result is the same but cheaper.'], [['It changes the answer.', 'Equivalent plans give the same answer.'], ['Joins need sorted data.', 'Not the reason.']])] }),
      sec('ind', '6.1', 'Indexes', { eyebrow: 'Finding without scanning',
        body: `<p>Without an index a lookup scans every block. An ${term('index')} is a separate structure mapping a key to record locations. ${term('Dense')} indexes have an entry per record; ${term('sparse')} ones one per block. A ${term('clustered')} (primary) index orders the file itself; a ${term('secondary')} index is on a non-ordering attribute. Indexes speed reads and slow writes (each insert updates them) and cost space.</p>`,
        worked: [step('A file has 1 000 000 records, 100 per block: 10 000 blocks. Sequential scan reads 10 000 blocks on average 5 000.', '', { toc: 'Scan' }), step('A sparse index with one entry per block has 10 000 entries; binary search over them needs about log₂10 000 ≈ 14 reads, plus 1 data block.', '\\lceil\\log_2 10000\\rceil+1=15', { hero: true, toc: 'Indexed' })],
        qs: [q('idx', 'The price of an index is…', ['Extra space and slower inserts/updates.', 'Every change must also update the index.'], [['Slower reads.', 'It speeds reads.'], ['Lost data.', 'Not at all.']])] }),
      sec('bplus', '6.2', 'B+ trees', { eyebrow: 'The standard index',
        body: `<p>Databases index with a ${term('B+ tree')}: a wide, shallow balanced tree whose internal nodes hold only separator keys and whose leaves hold all the keys, linked in order for fast range queries. Inserting 1…7 into an order-3 tree: a B-tree ends with root key <b>${bt.rootKeys}</b> and height <b>${bt.height}</b>, but the B+ tree keeps every key in its leaves (<b>${bp.leafKeys}</b>). With hundreds of keys per node, three or four levels index billions of rows.</p>`,
        figs: [lab('btree', { variant: 'bplus', order: 3, keys: '1 2 3 4 5 6 7' }, 'Green arrows chain the leaves for range scans.', ['leafKeys', 'height'], { caption: 'B+ tree insertion', name: 'bp' }), lab('btree', { variant: 'btree', order: 3, keys: '1 2 3 4 5 6 7' }, 'A B-tree stores keys in internal nodes too.', ['rootKeys', 'height'], { caption: 'B-tree for comparison', name: 'bt' })],
        qs: [q('range', 'Why are B+ tree leaves linked together?', ['So a range query can scan forward through consecutive leaves without returning to the root.', 'Finding the first key costs one descent; the rest is sequential.'], [['To save memory.', 'Extra pointers use memory.'], ['To allow duplicates.', 'Unrelated.']])],
        probs: [pr('p-h', '<p>A B+ tree node holds up to 99 keys (100 pointers). Roughly how many records can a tree of height 3 (root, one internal level, leaves) index?</p>', '≈ 100 × 100 × 99 ≈ <b>10⁶</b> keys. One more level multiplies by about 100.')] }),
      sec('hash', '6.3', 'Hashing', { eyebrow: 'Direct access',
        body: `<p>${term('Static hashing')} maps a key through h(k) to a bucket (a block or chain); equality lookups cost about one block access, but range queries are impossible, and a fixed number of buckets degrades as the file grows. ${term('Dynamic (extendible) hashing')} adds buckets on demand by using more bits of the hash. Hash tables chain colliding keys (keys 5, 10, 3, 8 into 5 buckets: <b>${hs.table}</b>).</p>`,
        figs: [lab('hashing', { method: 'chaining', size: 5, keys: '5 10 3 8' }, 'Colliding keys share a bucket.', ['table'], { caption: 'bucket chaining', name: 'hc' })],
        qs: [q('hq', 'When is a hash index better than a B+ tree?', ['For exact-match lookups only.', 'Hashing scatters neighbouring keys, so it cannot do ranges.'], [['For range scans.', 'That is the B+ tree.'], ['For sorted output.', 'Hashing gives no order.']])] }),
      sec('store', '6.4', 'Disks and record organisation', { eyebrow: 'Underneath',
        body: `<p>Data is stored in fixed-size blocks on disk; reading a block costs milliseconds while CPU work is nanoseconds, so DBMS cost is counted in block accesses. Records are organised as a heap (unordered), sequential (sorted), or hashed. Variable-length records use slotted pages. Buffer management keeps hot blocks in memory.</p>`,
        qs: [q('blocks', 'DBMS cost models count mainly…', ['Disk block accesses.', 'They dominate the CPU time.'], [['CPU instructions.', 'Negligible in comparison.'], ['Lines of SQL.', 'Irrelevant.']])] }),
      sec('mat', '5.2', 'Materialised views and tuning', { eyebrow: 'Performance',
        body: `<p>A ${term('materialised view')} stores a query’s result so repeated queries are instant, at the cost of keeping it fresh. Tuning: add the right indexes, denormalise hot joins, rewrite slow queries, use EXPLAIN to see the plan.</p>`,
        probs: [pr('p1', '<p>Give one benefit and one cost of a materialised view.</p>', 'Benefit: complex aggregates are pre-computed, so reads are fast. Cost: extra storage and the work of refreshing it when the base tables change.')],
        qs: [q('mv', 'A materialised view differs from an ordinary view because it…', ['Stores its result physically.', 'An ordinary view re-runs its query each time.'], [['Is always up to date.', 'It can be stale.'], ['Cannot be queried.', 'It can.']])] }),
    ],
  })
}
