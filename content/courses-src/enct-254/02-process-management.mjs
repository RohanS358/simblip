import { lesson } from '../kit.mjs'

export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const conv = { procs: 'P1,0,24;P2,0,3;P3,0,3' }
  const fcfs = run('sched', { algo: 'fcfs', ...conv })
  const sjf = run('sched', { algo: 'sjf', ...conv })
  const rrP = { procs: 'P1,0,24;P2,0,3;P3,0,3', quantum: 4 }
  const rr = run('sched', { algo: 'rr', ...rrP })
  const srtP = { procs: 'P1,0,8;P2,1,4;P3,2,9;P4,3,5' }
  const srt = run('sched', { algo: 'srt', ...srtP })
  const sjfNP = run('sched', { algo: 'sjf', ...srtP })
  const q1 = run('sched', { algo: 'rr', quantum: 1, ...conv })
  const q100 = run('sched', { algo: 'rr', quantum: 100, ...conv })

  return lesson({
    title: 'Processes and CPU scheduling',
    kicker: 'ENCT 254 · Operating System · Chapter 2',
    subtitle: 'A process is a program in motion. The scheduler decides whose turn it is — and every policy is a different answer to “fair to whom?”.',
    sections: [
      sec('process', '2.1', 'A program that is running', {
        eyebrow: 'The idea',
        body: `<p>A program on disk is inert text. A ${term('process')} is that program <b>in execution</b>: its code, the values in its registers, a stack, a heap and a program counter that says where it is. Ten processes can run the same program at once and still be ten different processes, because each carries its own state.</p><p>A process is always in one of a handful of ${term('states')}. It is <b>ready</b> when it could run but the CPU is busy, <b>running</b> while it holds the CPU, and <b>waiting</b> when it needs something — a disk block, a key press — before it can continue. The operating system keeps the ready processes in a queue and the ${term('scheduler')} picks the next one. Everything in this chapter is about that pick.</p>`,
        figs: [{ ...dia(`direction: right
(New) as n
[Ready] as r #blue
[Running] as x #mint
[Waiting] as w #amber
(Terminated) as t
n -> r : admitted
r -> x : scheduler dispatch
x -> r : time slice over
x -> w : waits for I/O
w -> r : I/O done
x -> t : exit
@0 n -> r : admit
@1.2 r -> x : dispatch
@2.4 x -> w : I/O
@3.6 w -> r : done
@4.8 r -> x : dispatch
@6 x -> t : exit
loop 8`, 'Press Simulate: the token is one process moving through its life. Each box glows while the process is in that state.'), caption: 'the five-state process model' }],
        qs: [q('waiting', 'A process asks the disk for a block and has to wait. Which state does it move to?', ['Waiting (blocked) — it cannot use the CPU until the I/O completes.', 'It gives up the CPU voluntarily because it has nothing useful to run, and the scheduler must not pick it until the event it awaits has happened. Only then does it become ready again — never straight back to running.'], [['Ready — it is still eager to run.', 'Ready means “could run right now”. A process blocked on a disk read cannot, so putting it in the ready queue would just waste a turn on the CPU.'], ['Terminated — the request ended it.', 'A blocked process is alive and will continue once its data arrives. Termination is only for a process that has finished or been killed.']])],
      }),

      sec('metrics', '2.2', 'What “good scheduling” means', {
        eyebrow: 'Measuring',
        body: `<p>“Fast” is not one number. Four times are computed for every process, with <b>arrival</b> (AT) the moment it joins the ready queue and <b>burst</b> (BT) the CPU time it needs:</p><ul><li>${term('Completion time')} (CT) — the clock reading when it finishes.</li><li>${term('Turnaround time')} (TAT) = CT − AT — everything the user waited, running included.</li><li>${term('Waiting time')} (WT) = TAT − BT — time spent in the ready queue doing nothing.</li><li>${term('Response time')} (RT) = first CPU − AT — how long before anything happens at all.</li></ul><p>Schedulers trade these against each other. Average waiting time is the usual yardstick for batch work; response time is what an interactive user feels.</p>`,
        worked: [
          step(`Three processes arrive together: P1 needs 24, P2 needs 3, P3 needs 3. Under first-come-first-served they run in arrival order, so P1 finishes at 24, P2 at 27 and P3 at 30.`, 'CT_1 = 24,\; CT_2 = 27,\; CT_3 = 30', { toc: 'Completion times' }),
          step('Turnaround is completion minus arrival. All arrive at 0, so it equals the completion time.', 'TAT = CT - AT = 24,\; 27,\; 30', { toc: 'Turnaround' }),
          step('Waiting is turnaround minus burst: 24−24, 27−3, 30−3.', 'WT = TAT - BT = 0,\; 24,\; 27', { toc: 'Waiting' }),
          step(`Average waiting time is the mean of those three: (0 + 24 + 27) / 3 = ${fcfs.avgWT}. Check this against Figure 2.3.1 — the card reports the same number.`, `\\overline{WT} = \\frac{0+24+27}{3} = ${fcfs.avgWT}`, { hero: true, toc: 'Average' }),
        ],
      }),

      sec('fcfs', '2.3', 'First come, first served — and the convoy', {
        eyebrow: 'Policy 1',
        body: `<p>${term('FCFS')} is the simplest policy: run the process that arrived first, to completion. It is easy to implement (a plain queue) and completely fair in the sense of order — but its average waiting time depends violently on <em>who</em> arrives first. A long job at the head of the queue makes every short job wait behind it: the ${term('convoy effect')}.</p><p>Press ▶ and watch the Gantt chart fill. Then the same three jobs under ${term('SJF')} (shortest job first), which always picks the smallest burst among those waiting.</p>`,
        figs: [
          lab('sched', { algo: 'fcfs', ...conv }, 'FCFS: P1 (24) runs first, so P2 and P3 wait 24 and 27 units.', ['avgWT', 'order'], { caption: 'FCFS on 24 / 3 / 3', name: 'fcfs' }),
          lab('sched', { algo: 'sjf', ...conv }, 'SJF: the two short jobs go first; average waiting collapses.', ['avgWT', 'order'], { caption: 'SJF on the same jobs', name: 'sjf' }),
        ],
        qs: [q('convoy', 'The same three jobs arrive in a different order: P2, P3, P1 (short ones first). What happens to FCFS’s average waiting time?', [`It drops sharply — to ${sjf.avgWT}, the same as SJF here.`, `FCFS has no idea how long jobs are; it only sees the order. Put the short jobs at the front and they finish almost at once, so only the long job waits (for 0, 3 and 6 units → an average of ${sjf.avgWT}). The policy did not get smarter — the input got kinder.`], [['It stays exactly the same, because the jobs are the same.', 'The set of jobs is the same but the waiting times are not: waiting is time spent behind others, and who is behind whom changed. Average waiting time under FCFS is a property of the arrival order.'], ['It gets worse, because short jobs now run before the long one.', 'Running short jobs first is precisely what removes waiting: a long job delays everything after it, a short one barely delays anything.']], { verify: lab('sched', { algo: 'fcfs', procs: 'P2,0,3;P3,0,3;P1,0,24' }, 'Same jobs, kind order: run it and compare with Figure 2.3.1.', ['avgWT'], { caption: 'FCFS with the short jobs first', name: 'kind' }) })],
      }),

      sec('rr', '2.4', 'Round Robin: everyone gets a turn', {
        eyebrow: 'Policy 2',
        body: `<p>Interactive systems cannot let one job hog the CPU. ${term('Round Robin')} gives each process a fixed ${term('time quantum')}; when the quantum expires the process goes to the back of the ready queue and the next one runs. New arrivals join the queue behind the ones already waiting — but ahead of the process that has just been pre-empted.</p><p>The quantum is the one knob. Very large: Round Robin degenerates into FCFS. Very small: the CPU spends its time <em>switching</em> (saving and restoring state) rather than working. Compare the three cards below on the same jobs.</p>`,
        figs: [
          lab('sched', { algo: 'rr', quantum: 1, ...conv }, `q = 1: fair to the extreme, but ${q1.switches} context switches.`, ['switches', 'avgWT'], { caption: 'quantum 1', name: 'q1' }),
          lab('sched', { algo: 'rr', ...rrP }, 'q = 4: the textbook setting.', ['avgWT', 'order', 'switches'], { caption: 'quantum 4', name: 'q4' }),
          lab('sched', { algo: 'rr', quantum: 100, ...conv }, 'q = 100: longer than every burst, so it is FCFS again.', ['avgWT', 'switches'], { caption: 'quantum 100', name: 'q100' }),
        ],
        qs: [q('quantum', 'A designer makes the quantum smaller and smaller. What is the cost?', ['More context switches — CPU time is burnt on switching instead of on the jobs.', `Every switch saves one process's registers and loads another's. With q = 1 the three jobs above cause ${q1.switches} switches; with q = 100 only ${q100.switches}. Each switch is pure overhead, so a tiny quantum buys responsiveness with throughput.`], [['Nothing — a smaller quantum is strictly fairer.', 'It is fairer, but fairness is not free: the switch overhead is the price, and past a point it dominates.'], ['The scheduler runs out of memory for the queue.', 'The ready queue holds the same number of processes at any quantum; what grows is the number of times the CPU changes hands.']])],
        after: `<p>With quantum 4 the jobs above finish with an average waiting time of ${rr.avgWT} — worse than SJF's ${sjf.avgWT}, better than FCFS's ${fcfs.avgWT}, and every process got the CPU within a few units. That last property, not the average, is why time-sharing systems use it.</p>`,
      }),

      sec('srt', '2.5', 'Shortest remaining time, priority and aging', {
        eyebrow: 'Policy 3',
        body: `<p>SJF is provably optimal for average waiting time, but it needs the future: nobody knows a burst length in advance (real systems estimate it from history). Its pre-emptive form, ${term('SRT')} (shortest remaining time), re-decides every time a process arrives: if the newcomer needs less than what the running job has left, it takes the CPU.</p><p>${term('Priority')} scheduling runs the most important job first; the trap is ${term('starvation')} — a low-priority job that never gets a turn while urgent ones keep arriving. The cure is ${term('aging')}: raise a job's priority the longer it waits. ${term('HRRN')} (highest response ratio next) builds that idea into a formula, (W + B) / B, which grows as a job waits.</p>`,
        figs: [lab('sched', { algo: 'srt', ...srtP }, `SRT: watch P1 being pre-empted when P2 arrives. Average waiting ${srt.avgWT}, versus ${sjfNP.avgWT} for non-pre-emptive SJF.`, ['avgWT', 'order'], { caption: 'SRT on four arriving jobs', name: 'srt' })],
        qs: [q('starve', 'In a priority scheduler a low-priority process has waited for hours. Which mechanism prevents it waiting forever?', ['Aging — its priority rises the longer it waits.', 'Starvation is a property of the policy, not of the process: as long as higher-priority jobs keep arriving, the low one is never chosen. Slowly raising the priority of waiting jobs guarantees that eventually it is the best in the queue.'], [['A larger time quantum.', 'The quantum decides how long a job runs once chosen; starvation is about never being chosen at all.'], ['Running the job twice as long when it does get the CPU.', 'That would only make each rare turn longer — the job would still wait indefinitely for the first one.']])],
      }),

      sec('cfs', '2.6', 'Threads and the Linux scheduler', {
        eyebrow: 'In practice',
        body: `<p>A ${term('thread')} is a strand of execution <em>inside</em> a process: threads share the code, heap and open files, but each has its own stack and registers. Creating and switching threads is cheaper than processes because far less state has to change. Modern kernels schedule threads, not whole processes.</p><p>Linux's ${term('Completely Fair Scheduler')} drops fixed quanta altogether. Each runnable task accumulates <b>virtual runtime</b> — CPU time scaled by its weight (nice value) — and the scheduler always runs the task with the <em>smallest</em> virtual runtime, kept in a red-black tree so the leftmost node is found in O(log n). A task that has had little CPU is behind, so it is chosen; the ideal is every task advancing at the same virtual rate.</p>`,
        figs: [{ ...dia(`direction: right
[Runnable tasks] as t #blue
[Red-black tree ordered by virtual runtime] as tree #violet
[Leftmost = smallest vruntime] as left #mint
(Run it for a slice) as run
t -> tree : insert
tree -> left : pick
left -> run
run -> t : vruntime grows, re-insert
@0 t -> tree : task
@1.2 tree -> left : min
@2.4 left -> run : chosen
@3.6 run -> t : re-queued
loop 5`, 'The loop CFS repeats. A task that ran a lot has a large vruntime and moves right; one that waited moves left.'), caption: 'the Completely Fair Scheduler as a loop' }],
      }),

      sec('numericals', '2.7', 'Numericals', {
        eyebrow: 'Practice',
        probs: [
          pr('p-srt', `<p>Processes P1(0,8), P2(1,4), P3(2,9), P4(3,5) — (arrival, burst). Find the average waiting time under SRT and under non-pre-emptive SJF.</p>`, `Run both in the cards above. SRT gives <b>${srt.avgWT}</b> and non-pre-emptive SJF gives <b>${sjfNP.avgWT}</b>. Pre-emption lets the short P2 (4) take over from P1 the moment it arrives, so the short jobs finish sooner and total waiting falls. The price is more context switches and needing to know the remaining time.`, { verify: lab('sched', { algo: 'srt', ...srtP }, 'The SRT schedule that produces the figure.', ['avgWT'], { caption: 'SRT answer', name: 'ans' }) }),
          pr('p-rr', `<p>Three processes all arrive at t = 0 with bursts 24, 3 and 3. Find the average waiting time under Round Robin with quantum 4.</p>`, `Order of service: P1 (4), P2 (3, done at 7), P3 (3, done at 10), then P1 runs the rest of its 24 alone. Waiting: P1 = 30 − 24 = 6, P2 = 4, P3 = 7 → average <b>${rr.avgWT}</b> (Figure 2.4.2). The two short jobs no longer wait behind the long one — that is the point of time-slicing.`),
          pr('p-tat', `<p>A process arrives at 2, needs 5 units, and completes at 20. Give its turnaround and waiting time.</p>`, `TAT = CT − AT = 20 − 2 = <b>18</b>. WT = TAT − BT = 18 − 5 = <b>13</b>. The process spent 13 units in the ready queue and 5 running.`),
        ],
      }),
    ],
  })
}
