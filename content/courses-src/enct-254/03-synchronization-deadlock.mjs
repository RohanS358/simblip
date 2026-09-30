import { lesson } from '../kit.mjs'

export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const safe = run('banker', {})
  const unsafe = run('banker', { available: '0 0 0', request: '' })
  return lesson({
    title: 'Synchronisation and deadlock',
    kicker: 'ENCT 254 · Operating System · Chapter 3',
    subtitle: 'Two processes sharing one variable can corrupt it without either being wrong. Locks fix that — and create a new way to get stuck.',
    sections: [
      sec('race', '3.1', 'The race condition', {
        eyebrow: 'The problem',
        body: `<p>Suppose two processes both run <code>counter++</code>. That single line is really three machine steps: load the counter, add one, store it back. If the scheduler switches between the load and the store, both processes read the <em>same</em> old value and one increment is lost. The result depends on the exact interleaving — a ${term('race condition')}.</p><p>The stretch of code that touches shared data is the ${term('critical section')}. A correct solution needs ${term('mutual exclusion')} (one process inside at a time), ${term('progress')} (someone gets in if nobody is) and ${term('bounded waiting')} (nobody waits forever).</p>`,
        figs: [dia(`mode: sequence
[Process A] as a
[counter in memory] as m
[Process B] as b
a -> m : load (reads 5)
b -> m : load (reads 5)
a -> a : add 1 → 6
b -> b : add 1 → 6
a -> m : store 6
b -> m : store 6
@0 a -> m : load (reads 5)
@1.2 b -> m : load (reads 5)
@2.4 a -> m : store 6
@3.6 b -> m : store 6
loop 6`.replace(/^@.*\n/gm, ''), 'Two increments, final value 6 instead of 7: the second store overwrote the first.', { caption: 'a lost update' })],
        qs: [q('lost', 'Two processes each execute counter++ once, starting from 5. Which final values are possible without synchronisation?', ['6 or 7 — it depends on the interleaving.', 'If one process finishes its load-add-store before the other starts, the result is 7. If both load before either stores, both write 6. The program is not wrong in either run; it is non-deterministic, which is what makes races so hard to debug.'], [['Always 7, because each process adds 1.', 'Adding 1 twice is 7 only if the two updates cannot overlap. Without a lock they can, and then one of them is silently lost.'], ['Only 6, because the scheduler always switches at the worst moment.', 'The bad interleaving is possible, not guaranteed. A test may pass a million times and still fail in production.']])],
      }),
      sec('locks', '3.2', 'Mutex, semaphore, monitor', {
        eyebrow: 'The tools',
        body: `<p>A ${term('mutex')} is a lock with one owner: acquire before the critical section, release after. A ${term('semaphore')} is an integer with two atomic operations — <b>wait (P)</b> decrements and blocks if the result would be negative, <b>signal (V)</b> increments and wakes a waiter. Initialised to 1 it is a mutex; initialised to <i>n</i> it lets <i>n</i> processes in (a pool of identical resources). A ${term('monitor')} packages the data, the operations and the lock together so a caller cannot forget to lock.</p><p>Three classic exercises use them. <b>Producer–consumer</b>: a bounded buffer with semaphores <i>empty</i> = N, <i>full</i> = 0 and a mutex. <b>Readers–writers</b>: many readers or one writer. <b>Dining philosophers</b>: five forks on a table — if everyone grabs the left fork first, all wait forever.</p>`,
        figs: [dia(`direction: right
[Producer] as p #mint
[Buffer of N slots] as b #blue
[Consumer] as c #violet
p -> b : wait(empty), wait(mutex), put, signal(mutex), signal(full)
b -> c : wait(full), wait(mutex), get, signal(mutex), signal(empty)
@0 p -> b : item
@1.4 b -> c : item
loop 3.5`, 'Two counting semaphores track free and used slots; the mutex protects the buffer itself.', { caption: 'bounded buffer' })],
        qs: [q('semzero', 'A semaphore is initialised to 0 and a process executes wait() on it. What happens?', ['It blocks until some other process calls signal().', 'With value 0 there is nothing to take, so wait cannot decrement and the process sleeps on the semaphore’s queue. Initialising to 0 is how one process waits for an event another will announce.'], [['It continues immediately and the value becomes −1.', 'A negative value is only bookkeeping for the number of sleepers; the calling process is still put to sleep.'], ['It raises an error, because a semaphore must start at 1.', 'Any non-negative start is legal: 1 for a mutex, 0 for signalling, n for a resource pool.']])],
      }),
      sec('deadlock', '3.3', 'Deadlock and its four conditions', {
        eyebrow: 'The catch',
        body: `<p>A ${term('deadlock')} is a set of processes each waiting for something only another member of the set can release. It needs <b>all four</b> of these at once: <b>mutual exclusion</b> (resources are not shareable), <b>hold and wait</b> (keep what you have while asking for more), <b>no pre-emption</b> (resources cannot be taken away) and <b>circular wait</b> (a cycle of who-waits-for-whom). Break any one and deadlock is impossible — that is ${term('prevention')}. ${term('Avoidance')} allows all four but refuses any request that could lead to a stuck state; ${term('detection and recovery')} lets it happen and then kills or rolls back a victim; ${term('ignoring')} it (the ostrich approach) is what most general-purpose systems actually do.</p>`,
        figs: [dia(`direction: right
[P1 holds R1] as p1 #blue
[P2 holds R2] as p2 #violet
[R1] as r1 #amber
[R2] as r2 #amber
p1 -> r2 : wants
p2 -> r1 : wants
r1 --> p1 : held by
r2 --> p2 : held by
@0 p1 -> r2 : request
@1.2 p2 -> r1 : request
loop 4`, 'A cycle P1 → R2 → P2 → R1 → P1: circular wait. Neither can proceed.', { caption: 'resource-allocation cycle' })],
        qs: [q('four', 'Which single condition does “lock the resources in a fixed global order” break?', ['Circular wait.', 'If every process acquires resources in increasing order, a cycle would need some process to ask for a lower-numbered resource while holding a higher one — which the rule forbids. The other three conditions still hold.'], [['Hold and wait.', 'Processes still hold some resources while asking for others; only the order of asking is constrained.'], ['Mutual exclusion.', 'The resources are still exclusive. Breaking mutual exclusion needs shareable resources, which a printer or a lock is not.']])],
      }),
      sec('banker', '3.4', "The banker's algorithm", {
        eyebrow: 'Avoidance',
        body: `<p>The banker treats each process's maximum claim like a credit line. A state is ${term('safe')} if there is <em>some order</em> in which every process can be given its remaining need and finish. The algorithm keeps a vector <b>Work</b> (initially Available) and repeatedly looks for a process whose <b>Need = Max − Allocation</b> fits inside Work; it runs that process to completion and adds its allocation back. If all processes can be retired, the state is safe and the order found is a ${term('safe sequence')}. An unsafe state is <em>not</em> a deadlock — it is a state from which deadlock can no longer be ruled out.</p><p>Run the classic example: 5 processes, 3 resource types, Available = (3 3 2).</p>`,
        figs: [lab('banker', {}, `The algorithm retires processes in the order ${safe.sequence}; any safe sequence proves the state safe.`, ['safe', 'sequence'], { caption: "banker's algorithm", name: 'bank' }),
               lab('banker', { request: 'P1:1 0 2' }, 'P1 asks for (1 0 2). The banker pretends to grant it and re-runs the safety check.', ['safe', 'sequence'], { caption: 'a request', name: 'req' })],
        qs: [q('unsafe', 'A state is unsafe. What does that tell you?', ['Deadlock is now possible — the banker refuses to enter it.', 'Unsafe means no order is guaranteed to let everyone finish; whether deadlock actually occurs depends on what the processes do next. Avoidance is conservative: it denies requests that lead to unsafe states even though some would have turned out fine.'], [['The system is already deadlocked.', 'A deadlocked state is unsafe, but an unsafe state need not be deadlocked yet.'], ['At least one process has exceeded its maximum claim.', 'Exceeding the claim is an error the algorithm rejects outright; unsafe is about feasibility of finishing, not about cheating.']])],
        worked: [
          step('Need = Max − Allocation. For P1: Max (3 2 2) − Allocation (2 0 0) = (1 2 2). With Work = Available = (3 3 2), (1 2 2) ≤ (3 3 2), so P1 can finish.', 'Need_1 = (3,2,2)-(2,0,0) = (1,2,2) \\le (3,3,2)', { toc: 'P1 fits' }),
          step('P1 finishes and returns its allocation: Work = (3 3 2) + (2 0 0) = (5 3 2). Now P3 (Need (0 1 1)) fits.', 'Work = (5,3,2)', { toc: 'After P1' }),
          step(`Continuing this way retires the remaining processes one by one: the card gives ${safe.sequence}. Every process could be finished, so the state is safe.`, '', { hero: true, toc: 'Safe sequence' }),
        ],
      }),
      sec('practice', '3.5', 'Numericals', {
        eyebrow: 'Practice',
        probs: [
          pr('p-safe', '<p>Five processes and three resource types with Available = (3 3 2); Max and Allocation as in Figure 3.4.1. Is the system in a safe state? Give a safe sequence.</p>', `Yes. The algorithm repeatedly picks the lowest-numbered unfinished process whose Need fits in Work. It finds <b>${safe.sequence}</b>. Other orders such as P1, P3, P4, P0, P2 are also safe — a safe state may have many safe sequences.`, { verify: lab('banker', {}, 'The same algorithm.', ['sequence'], { caption: 'answer', name: 'ans' }) }),
          pr('p-cond', '<p>Name the four Coffman conditions and say which one a spooling printer queue removes.</p>', 'Mutual exclusion, hold and wait, no pre-emption, circular wait. Spooling removes <b>mutual exclusion</b> (for the printer): processes write to a queue on disk instead of holding the device, so they never wait on each other for it.'),
          pr('p-phil', '<p>Five philosophers each pick up their left fork first. Why can the table deadlock, and give one fix.</p>', 'If all five pick up their left fork simultaneously, each holds one fork and waits for the right one held by a neighbour: circular wait. Fixes: allow at most four to sit at once, pick up both forks atomically (or neither), or number the forks and always take the lower one first.'),
        ],
      }),
      sec('summary', '3.6', 'What to remember', {
        eyebrow: 'Summary',
        body: `<ul><li>A race condition is a bug in the <em>interleaving</em>, not in any one process; a critical section guarded by a lock removes it.</li><li>Mutex = semaphore with value 1; semaphore 0 = signalling; semaphore n = pool.</li><li>Deadlock needs all four conditions; breaking one prevents it.</li><li>Safe ⇒ no deadlock guaranteed; unsafe ⇒ deadlock possible. The banker only ever grants requests that keep the state safe.</li></ul>`,
        qs: [q('recap', 'Which statement about unsafe states is true?', ['Every deadlocked state is unsafe, but not every unsafe state is deadlocked.', 'Safe ⊂ not-deadlocked: no safe state leads to deadlock, but an unsafe state merely lacks the guarantee.'], [['Unsafe and deadlocked mean the same thing.', 'Unsafe is a prediction about what might happen; deadlocked is a fact about what has.'], ['A safe state can still deadlock if a process is unlucky.', 'By definition a safe sequence exists, and following it finishes everyone.']])],
      }),
    ],
  })
}
