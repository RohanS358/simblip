import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Recovery, distributed databases and NoSQL',
  kicker: 'ENCT 301 · Database Management System · Chapters 8–9',
  subtitle: 'What to do when the power fails mid-transaction — and what changes when data lives on many machines.',
  sections: [
    sec('fail', '8.1', 'Failures', { eyebrow: 'What can break',
      body: `<p>Transaction failure (a logical error, or deadlock-abort), system crash (memory lost, disk intact) and disk failure (data lost). Recovery must restore atomicity and durability: undo the partial work of uncommitted transactions and redo committed work that had not reached disk.</p>`,
      qs: [q('crash', 'After a crash, committed changes that were only in memory must be…', ['Redone from the log.', 'The log on stable storage records them.'], [['Discarded.', 'That would violate durability.'], ['Ignored.', 'They would be lost.']])] }),
    sec('log', '8.2', 'Log-based recovery', { eyebrow: 'Write-ahead logging',
      body: `<p>The ${term('log')} records every change as <code>&lt;T, item, old value, new value&gt;</code> plus <code>&lt;T start&gt;</code>, <code>&lt;T commit&gt;</code>. The ${term('write-ahead rule')}: the log record reaches stable storage <em>before</em> the changed data page. After a crash: <b>redo</b> every transaction with a commit record; <b>undo</b> every transaction that started but did not commit, using old values. A ${term('checkpoint')} limits how far back the log must be scanned.</p>`,
      figs: [dia(`mode: sequence
[Transaction] as t
[Log on disk] as l
[Data page in buffer] as d
t -> l : <T1, A, 1000, 950>
t -> d : write A = 950 (in memory)
t -> l : <T1 commit>
l --> t : commit acknowledged
d -> d : page flushed to disk later`, 'The log goes first; the page can wait.', { caption: 'write-ahead logging' })],
      worked: [step('Log after a crash: <T1 start>, <T1, A, 50, 70>, <T1 commit>, <T2 start>, <T2, B, 10, 99>. No T2 commit.', '', { toc: 'Log' }), step('T1 committed → redo: A = 70. T2 did not commit → undo: B = 10.', 'A=70,\\ B=10', { hero: true, toc: 'Recovery' })],
      probs: [pr('p1', '<p>Why must the log record be written before the data page?</p>', 'If the page reached disk first and the system crashed, the database would contain a change with no record of its old value, making it impossible to undo for an uncommitted transaction.')],
      qs: [q('wal', 'Write-ahead logging means…', ['The log record is on stable storage before the data it describes.', 'Otherwise recovery could not undo the change.'], [['Data is written before the log.', 'The opposite.'], ['Logs are never written.', 'They are essential.']])] }),
    sec('shadow', '8.3', 'Shadow paging and remote backup', { eyebrow: 'Alternatives',
      body: `<p>${term('Shadow paging')} keeps two page tables: the current one (modified) and the shadow (untouched). Commit atomically switches the pointer to the current table; a crash simply keeps the old one, so no log is needed — but copying pages fragments storage. For disasters, ${term('remote backup')} ships the log to a standby site for high availability.</p>`,
      qs: [q('shadow', 'What makes shadow paging atomic?', ['A single atomic switch of the page-table pointer at commit.', 'Before it the old state is fully intact.'], [['Writing the log twice.', 'That is logging.'], ['Locking pages.', 'Unrelated.']])] }),
    sec('oo', '9.1', 'Object-oriented and distributed databases', { eyebrow: 'Beyond tables',
      body: `<p>Object databases store objects with identity, inheritance and methods directly. A ${term('distributed database')} spreads data over sites: ${term('fragmentation')} splits a table by rows or columns, ${term('replication')} keeps copies for speed and availability. Transactions across sites use ${term('two-phase commit')}: the coordinator asks all participants to prepare (vote), and only if every one says yes does it tell them to commit.</p>`,
      figs: [dia(`mode: sequence
[Coordinator] as c
[Site 1] as a
[Site 2] as b
c -> a : PREPARE
c -> b : PREPARE
a --> c : VOTE YES
b --> c : VOTE YES
c -> a : COMMIT
c -> b : COMMIT
a --> c : ACK
b --> c : ACK`, 'Phase 1: vote. Phase 2: decide.', { caption: 'two-phase commit' })],
      qs: [q('2pc', 'In two-phase commit, when does the coordinator decide to commit?', ['Only when every participant voted YES.', 'One NO (or timeout) means global abort.'], [['When a majority vote yes.', 'Unanimity is required.'], ['Immediately.', 'It must collect votes first.']])] }),
    sec('dw', '9.2', 'Data warehousing and OLAP', { eyebrow: 'Analysis',
      body: `<p>OLTP systems handle many small transactions; a ${term('data warehouse')} collects historical data from many sources (via ETL: extract, transform, load) for analysis. ${term('OLAP')} views data as a cube of dimensions (time, product, region) and measures (sales), with operations like roll-up, drill-down, slice and dice.</p>`,
      qs: [q('olap', 'Roll-up in OLAP means…', ['Aggregating to a coarser level, e.g. from months to years.', 'Drill-down is the reverse.'], [['Adding a new column.', 'Not the meaning.'], ['Deleting data.', 'No.']])] }),
    sec('nosql', '9.3', 'NoSQL and big data', { eyebrow: 'Scale',
      body: `<p>NoSQL systems trade some relational guarantees for scale and flexibility: key–value stores (Redis), document stores (MongoDB), column-family stores (Cassandra), graph databases (Neo4j). They favour horizontal scaling and flexible schemas. The CAP theorem says a distributed store cannot have Consistency, Availability and Partition tolerance all at once; many choose eventual consistency. Big data: volume, velocity, variety.</p>`,
      probs: [pr('p2', '<p>When would you choose a document store over a relational database?</p>', 'When records are naturally nested and their shape varies (product catalogues, user profiles), schemas change often, and horizontal scaling matters more than multi-table joins and strict transactions.')],
      qs: [q('cap', 'CAP theorem: during a network partition a distributed system must choose between…', ['Consistency and availability.', 'You cannot give up partition tolerance in practice.'], [['Speed and price.', 'Not CAP.'], ['Reads and writes.', 'Not CAP.']])] }),
  ],
})
