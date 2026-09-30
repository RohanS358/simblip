import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const bad = run('serializability', { schedule: 'r1(x) w2(x) w1(x)' }), ok = run('serializability', { schedule: 'r1(x) w1(x) r2(x) w2(x)' })
  return lesson({
    title: 'Transactions, serializability and locking',
    kicker: 'ENCT 301 · Database Management System · Chapter 7',
    subtitle: 'Many users, one database: how to interleave their work so the result is as if they had taken turns.',
    sections: [
      sec('acid', '7.1', 'Transactions and ACID', { eyebrow: 'A unit of work',
        body: `<p>A ${term('transaction')} is a sequence of operations that must be treated as one: transfer Rs 500 from A to B = read A, subtract, write A, read B, add, write B. The ACID properties: ${term('Atomicity')} (all or nothing), ${term('Consistency')} (integrity rules hold before and after), ${term('Isolation')} (concurrent transactions do not see each other’s partial work), ${term('Durability')} (committed changes survive a crash).</p>`,
        figs: [dia(`direction: right
(Begin) as b
[Active] as a #blue
[Partially committed] as p #amber
[Committed] as c #mint
[Failed] as f #rose
[Aborted: rolled back] as x #rose
b -> a
a -> p : last operation done
p -> c : changes made durable
a -> f : error
p -> f : crash
f -> x : undo
@0 b -> a : start
@1 a -> p : finish
@2 p -> c : commit
loop 4`, 'Every transaction ends as committed or aborted.', { caption: 'transaction states' })],
        qs: [q('atom', 'Money is debited from A but the system crashes before crediting B. Which property ensures the debit is undone?', ['Atomicity.', 'All operations take effect or none do.'], [['Durability.', 'That is about surviving a crash after commit.'], ['Isolation.', 'That is about concurrency.']])] }),
      sec('anom', '7.2', 'Problems with interleaving', { eyebrow: 'What can go wrong',
        body: `<p>Without control, interleaved transactions cause: the ${term('lost update')} (two writes, one overwritten), the ${term('dirty read')} (reading another’s uncommitted value that is later rolled back), the ${term('unrepeatable read')} (two reads of one item differ) and the ${term('phantom')} (a repeated query finds new rows).</p>`,
        figs: [dia(`mode: sequence
[T1] as a
[Database item x] as x
[T2] as b
a -> x : read x (x = 100)
b -> x : write x = 50
a -> x : write x = 100 + 10
b -> b : T2’s update is lost`, 'The second write overwrote the first.', { caption: 'a lost update' })],
        qs: [q('dirty', 'A dirty read is…', ['Reading data written by a transaction that has not yet committed.', 'If it rolls back, you acted on data that never existed.'], [['Reading a corrupted disk block.', 'Different problem.'], ['Reading twice.', 'That is the unrepeatable read.']])] }),
      sec('ser', '7.3', 'Conflict serializability', { eyebrow: 'The correctness test',
        body: `<p>A ${term('serial')} schedule runs transactions one after another. An interleaved schedule is ${term('serializable')} if it is equivalent to a serial one. Two operations ${term('conflict')} if they are from different transactions, touch the same item and at least one is a write. Draw a precedence graph (edge Ti → Tj if a conflicting operation of Ti comes before Tj’s): the schedule is conflict-serializable exactly when the graph has no cycle, and a topological order gives the equivalent serial order.</p><p>r1(x) w2(x) w1(x): serializable <b>${bad.serializable}</b> (edges ${bad.edges}); r1(x) w1(x) r2(x) w2(x): <b>${ok.serializable}</b> — equivalent serial order ${ok.order}.</p>`,
        figs: [lab('serializability', { schedule: 'r1(x) w2(x) w1(x)' }, 'T1→T2 and T2→T1: a cycle.', ['serializable', 'edges'], { caption: 'not serializable', name: 'bad' }), lab('serializability', { schedule: 'r1(x) w1(x) r2(x) w2(x)' }, 'Acyclic: equivalent to T1 then T2.', ['serializable', 'order'], { caption: 'serializable', name: 'ok' })],
        qs: [q('cycle', 'A cycle in the precedence graph means…', ['The schedule is not conflict-serializable.', 'Each transaction must precede the other — impossible in any serial order.'], [['The schedule is serial.', 'A serial schedule has no interleaving.'], ['A deadlock has occurred.', 'Different concept (waits-for graph).']])],
        probs: [pr('p-ser', '<p>Is the schedule r1(x) w2(x) w1(x) conflict-serializable?</p>', `No. r1(x) before w2(x) gives T1→T2; w2(x) before w1(x) gives T2→T1 — a cycle. Checker: serializable = <b>${bad.serializable}</b>.`, { verify: lab('serializability', { schedule: 'r1(x) w2(x) w1(x)' }, 'The graph.', ['serializable'], { caption: 'answer', name: 'ans' }) })] }),
      sec('lock', '7.4', 'Locking and two-phase locking', { eyebrow: 'Enforcing it',
        body: `<p>Transactions take ${term('shared')} (S, for reading) and ${term('exclusive')} (X, for writing) locks; S is compatible with S, X with nothing. ${term('Two-phase locking')} (2PL) guarantees serializability: a growing phase (only acquire locks) then a shrinking phase (only release). Strict 2PL holds exclusive locks to commit, which also prevents dirty reads and cascading aborts. Multiple granularity locks (database, table, page, row) with intention locks let a transaction lock coarsely or finely.</p>`,
        figs: [dia(`mode: sequence
[T1] as a
[Lock manager] as l
[T2] as b
a -> l : lock-X(x)
l --> a : granted
b -> l : lock-S(x)
l --> b : wait (x is locked)
a -> l : unlock(x) at commit
l --> b : granted`, 'T2 waits until T1 releases x.', { caption: 'exclusive lock blocks a reader' })],
        qs: [q('twopl', 'Two-phase locking means…', ['No lock is acquired after the first lock is released.', 'That single rule ensures serializability.'], [['Every lock is held twice.', 'No.'], ['Only two transactions at a time.', 'No.']])] }),
      sec('dead', '7.5', 'Deadlock', { eyebrow: 'Waiting in a circle',
        body: `<p>T1 holds x and wants y; T2 holds y and wants x: deadlock. Detect it with a ${term('wait-for graph')} (a cycle means deadlock) and abort a victim. Prevention: impose a lock order, or use timestamps — <em>wait–die</em> (older waits, younger dies) and <em>wound–wait</em> (older wounds younger).</p>`,
        worked: [step('T1 (timestamp 5) requests a lock held by T2 (timestamp 9). Wait–die: older may wait for younger.', '5<9', { toc: 'Wait–die' }), step('Reverse: T2 (9) requests a lock held by T1 (5): the younger requester dies (aborts) and restarts with its old timestamp.', '', { hero: true, toc: 'Rule' })],
        qs: [q('waitfor', 'A cycle in the wait-for graph indicates…', ['Deadlock.', 'Each transaction waits for another in the cycle.'], [['Serializability.', 'That is the precedence graph.'], ['Commit.', 'No.']])] }),
      sec('iso', '7.6', 'Isolation levels', { eyebrow: 'Trading safety for speed',
        body: `<p>SQL defines four levels: READ UNCOMMITTED (dirty reads possible), READ COMMITTED (no dirty reads), REPEATABLE READ (no unrepeatable reads), SERIALIZABLE (no phantoms either). Stronger isolation means more waiting.</p>`,
        qs: [q('rc', 'Which level prevents dirty reads but allows unrepeatable reads?', ['READ COMMITTED.', 'You see only committed data, but it can change between your reads.'], [['SERIALIZABLE.', 'That prevents both.'], ['READ UNCOMMITTED.', 'Allows dirty reads.']])] }),
    ],
  })
}
