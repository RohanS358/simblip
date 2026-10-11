import { lesson } from '../kit.mjs'

export default ({ lab, dia, scr, q, pr, step, sec, term, run }) => {
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
  const pri = { procs: 'P1,0,10,3;P2,0,1,1;P3,0,2,4;P4,0,1,5;P5,0,5,2' }
  const prio = run('sched', { algo: 'priority', ...pri })
  const hrrn = run('sched', { algo: 'hrrn', procs: 'P1,0,3;P2,2,6;P3,4,4;P4,6,5;P5,8,2' })
  const sw = (s, qq) => `${((s / (qq + s)) * 100).toFixed(2)}%`
  const rm = (n) => (n * (2 ** (1 / n) - 1)).toFixed(3)
  const overhead = scr(`var t = create("table", { headers: "Quantum q;Switch cost s;Overhead s/(q+s)", data: ${JSON.stringify([['100 ms', '10 µs', sw(10, 100000)], ['10 ms', '10 µs', sw(10, 10000)], ['1 ms', '10 µs', sw(10, 1000)], ['100 µs', '10 µs', sw(10, 100)], ['20 µs', '10 µs', sw(10, 20)]])}, summary: "None" });`, 'A switch costs the same whatever the quantum, so the shorter the slice the larger the fraction of the CPU it eats.', { caption: 'context-switch overhead' })
  const rmTable = scr(`var t = create("table", { headers: "Tasks n;RM bound n(2^(1/n) − 1);EDF bound", data: ${JSON.stringify([1, 2, 3, 4, 10].map((n) => [String(n), rm(n), '1.000']).concat([['∞', '0.693 (ln 2)', '1.000']]))}, summary: "None" });`, 'Rate-monotonic can guarantee less than EDF, but it is simpler and predictable.', { caption: 'schedulability bounds' })

  return lesson({
    title: 'Processes and CPU scheduling',
    kicker: 'ENCT 254 · Operating System · Chapter 2',
    subtitle: 'A process is a program in motion. The scheduler decides whose turn it is — and every policy is a different answer to “fair to whom?”. This chapter builds the process, the thread and then ten ways to share the CPU, with the arithmetic to compare them.',
    sections: [
      sec('process', '2.1', 'A program that is running', {
        eyebrow: 'The idea',
        body: `<p>A program on disk is inert text: a file of instructions and initial data that does nothing by itself. A ${term('process')} is that program <b>in execution</b> — the file brought to life with its own memory, its own place in the code and its own set of resources. Ten people can run the same editor at once and the machine has ten processes from one program, because each one carries different state: different open files, different text in memory, a different program counter.</p><p>In memory a process is laid out in four regions. The <b>text</b> segment holds the machine code (read-only, so it can be shared). The <b>data</b> segment holds global and static variables. The <b>heap</b> grows upward as the program calls <code>malloc</code>/<code>new</code>. The <b>stack</b> grows downward as functions are called, holding return addresses, parameters and local variables. The processor adds the live state: the <b>program counter</b> (the next instruction), the stack pointer and the general registers. Together these are what the OS must preserve whenever it takes the CPU away from one process and gives it to another.</p><p>A process is always in one of a handful of ${term('states')}. It is <b>new</b> while being created, <b>ready</b> when it could run but the CPU is busy, <b>running</b> while it holds the CPU, <b>waiting</b> (blocked) when it needs something — a disk block, a key press, a child process — before it can continue, and <b>terminated</b> when finished. The operating system keeps the ready processes in a queue and the ${term('scheduler')} picks the next one. The figure animates one process through its life; note that a waiting process never goes straight back to running — it re-enters the ready queue and waits its turn like everyone else.</p>`,
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
        qs: [q('waiting', 'A process asks the disk for a block and has to wait. Which state does it move to?', ['Waiting (blocked) — it cannot use the CPU until the I/O completes.', 'It gives up the CPU voluntarily because it has nothing useful to run, and the scheduler must not pick it until the event it awaits has happened. Only then does it become ready again — never straight back to running.'], [['Ready — it is still eager to run.', 'Ready means “could run right now”. A process blocked on a disk read cannot, so putting it in the ready queue would waste a turn on the CPU.'], ['Terminated — the request ended it.', 'A blocked process is alive and will continue once its data arrives. Termination is only for a process that has finished or been killed.']]), q('stack', 'Which part of a process’s memory holds the return address of the function currently executing?', ['The stack.', 'Each call pushes a frame holding the return address, parameters and locals; a return pops it.'], [['The heap.', 'The heap holds dynamically allocated objects, not call frames.'], ['The text segment.', 'Text holds the machine code itself and is normally read-only.']])],
      }),

      sec('pcb', '2.2', 'The process control block and the context switch', {
        eyebrow: 'Bookkeeping',
        body: `<p>For each process the kernel keeps a record called the ${term('process control block')} (PCB; Linux calls it <code>task_struct</code>). It holds the process id, the state, the saved program counter and registers, scheduling information (priority, accumulated time), memory-management information (page tables or base/limit), the table of open files, accounting data and pointers linking it into the ready, waiting or device queues. The PCB is the process <em>as far as the kernel is concerned</em>: if you could copy the PCB and the memory it points to, you would have copied the process.</p><p>When the CPU changes from one process to another the kernel performs a ${term('context switch')}: it saves the registers and program counter of the outgoing process into its PCB, picks the incoming process, loads <em>its</em> saved state from <em>its</em> PCB, switches the memory map and resumes it exactly where it left off. The incoming process never notices the gap. A switch does no useful work for either program — it is pure overhead — and also hurts indirectly, because the new process finds the caches and TLB filled with the old process’s data. Typical direct costs are a few microseconds.</p><p>That overhead is the reason scheduling is a trade-off rather than a free lunch. The table shows the fraction of CPU time lost to switching when each switch costs 10 µs, as the time quantum shrinks. Slices of 10–100 ms waste almost nothing; slices of tens of microseconds waste nearly a third.</p>`,
        figs: [overhead],
        worked: [step('A context switch costs s = 10 µs. The quantum is q = 1 ms. What fraction of the CPU is lost to switching?', '\\text{overhead}=\\frac{s}{q+s}', { toc: 'Formula' }), step('Substitute (both in µs).', '\\frac{10}{1000+10}=0.0099', { toc: 'Substitute' }), step('About one percent — the other 99 % does useful work. At q = 100 µs it would be 10/110 = 9.1 %.', '\\approx 1\\%', { hero: true, toc: 'Result' })],
        qs: [q('ctx', 'Which of these is saved in the PCB during a context switch?', ['The program counter and the general registers of the outgoing process.', 'They are exactly the state needed to resume the process later at the same instruction with the same values.'], [['The contents of the whole heap.', 'The heap stays in memory where it is; only the registers and pointers to it are saved.'], ['The source code of the program.', 'Source code is irrelevant at run time; the kernel saves execution state, not text.']]), q('ctxcost', 'Why is a context switch considered pure overhead?', ['No user instruction executes during it; the CPU only saves and loads state (and refills caches).', 'The more often it happens, the less of the CPU’s time goes to real work.'], [['Because it uses the disk.', 'A switch happens in memory and registers; it does not need the disk.'], ['Because it deletes the old process.', 'The old process is only paused; its PCB keeps everything.']])],
        probs: [pr('p-ctx', '<p>A system uses a 5 ms quantum and each context switch costs 25 µs. What percentage of CPU time is spent switching?</p>', 'Overhead = s/(q + s) = 25 / (5000 + 25) = 0.00498 ≈ <b>0.5 %</b>.')],
      }),

      sec('create', '2.3', 'Creating and ending processes', {
        eyebrow: 'Life cycle',
        body: `<p>Processes form a tree. At boot the kernel creates one first process (<code>init</code> or <code>systemd</code>); every other process is created by an existing one, the <em>parent</em>, which makes a <em>child</em>. On Unix the whole mechanism is two calls. <code>fork()</code> creates an almost exact copy of the calling process: the child has the same code, the same open files, a copy of the memory and the same program counter, so both continue from the line after <code>fork()</code>. The only difference is the return value — the parent receives the child’s process id, the child receives 0 — and a program branches on that. To run a <em>different</em> program the child then calls <code>exec()</code>, which replaces its memory image with a new program loaded from disk. The parent usually calls <code>wait()</code> to sleep until the child finishes and to collect its exit status.</p><p>This is how a shell works: it reads a command line, forks, the child execs the program you named, and the shell waits for it. Copying the whole memory on each fork would be wasteful when an <code>exec</code> follows immediately, so modern kernels use <b>copy-on-write</b>: parent and child initially share the same physical pages marked read-only, and a page is copied only when one of them writes to it. Windows takes a different route, <code>CreateProcess</code>, which creates a child and loads a given program in one step.</p><p>A process ends when it calls <code>exit()</code> (voluntarily), is killed by a signal, or crashes. A finished child whose parent has not yet called <code>wait()</code> is a ${term('zombie')} — dead, but its PCB entry stays so the exit status can be reported. A child whose parent died first is an <b>orphan</b> and is adopted by <code>init</code>.</p>`,
        figs: [dia(`mode: sequence
[Shell (parent)] as p
[Kernel] as k
[Child process] as c
p -> k : fork()
k -> c : copy of the shell created (copy-on-write)
k -> p : returns child pid (e.g. 4021)
k -> c : returns 0
c -> k : exec("/bin/ls")
k -> c : memory replaced by ls
c -> c : runs ls, prints files
c -> k : exit(0)
p -> k : wait() returns status 0
@0 p -> k : fork()
@1 k -> c : copy created
@2 k -> p : returns child pid
@3 k -> c : returns 0
@4 c -> k : exec ls
@5 k -> c : image replaced
@6 c -> c : runs ls
@7 c -> k : exit(0)
@8 p -> k : wait() returns
loop 11`, 'A single fork gives two processes that differ only by the return value.', { caption: 'how a shell runs a command' })],
        worked: [step('A program calls fork() three times in a row, with no conditions. How many processes exist at the end (counting the original)?', '', { toc: 'Question' }), step('Each fork doubles the number of processes: every existing process executes the next fork and makes one more.', '1\\to2\\to4\\to8', { toc: 'Doubling' }), step('In general n forks give 2ⁿ processes, so 8 processes — 7 new children.', '2^{3}=8', { hero: true, toc: 'Result' })],
        qs: [q('fork', 'After fork(), how does the code tell the parent from the child?', ['fork() returns the child’s pid to the parent and 0 to the child.', 'That single difference in the return value is the only way the two copies know which one they are.'], [['The child has a smaller pid so it can compare.', 'The code never compares pids this way; it tests the return value of fork().'], ['The child starts at the beginning of main().', 'No — the child continues from the instruction after fork(), exactly like the parent.']]), q('zombie', 'What is a zombie process?', ['A finished process whose PCB remains because its parent has not yet called wait().', 'The entry persists so the parent can still read the exit status; once it waits, the entry disappears.'], [['A process stuck in an infinite loop.', 'That is a runaway process, still alive and running.'], ['A process whose parent was killed.', 'That is an orphan, adopted by init.']]), q('cow', 'Why does copy-on-write make fork() cheap?', ['Parent and child share the same pages until one writes, so most pages are never copied.', 'If the child immediately calls exec(), nothing is copied at all.'], [['Because fork() copies only the registers.', 'It also needs the memory image; copy-on-write defers copying it.'], ['Because the child runs in the kernel.', 'The child is an ordinary user process.']])],
        probs: [pr('p-fork', '<p>How many processes are created (not counting the original) by the sequence <code>fork(); fork(); fork();</code>? Draw the reasoning.</p>', '8 processes in total including the original, so <b>7 new</b> processes: after the 1st fork there are 2; each of those forks again → 4; each of those forks again → 8.'), pr('p-orphan', '<p>Distinguish a zombie from an orphan in one sentence each.</p>', '<b>Zombie:</b> the child has terminated but the parent has not waited, so its PCB entry lingers. <b>Orphan:</b> the parent has terminated first, so the still-running child is adopted by init.')],
      }),

      sec('threads', '2.4', 'Threads: several strands in one process', {
        eyebrow: 'Concurrency inside a process',
        body: `<p>A process bundles two ideas: a <em>resource owner</em> (address space, open files) and a <em>unit of execution</em> (program counter, registers, stack). A ${term('thread')} separates them. Threads of one process share the code, the global data, the heap and the open files, but each has its own stack, registers and program counter. Creating a thread is far cheaper than creating a process — nothing needs to be copied — and switching between threads of the same process does not change the memory map, so it is also cheaper. Sharing memory makes communication trivial (read the same variable) and dangerous (two threads updating the same variable need synchronisation, which is the next chapter).</p><p>Threads pay off whenever a program has independent work to do: a web server handles each request in its own thread; a word processor spell-checks while you type; a numeric program splits a loop across cores. There are two ways to provide them. <b>User-level threads</b> are managed by a library in user space — creation and switching need no kernel call, but the kernel sees only one process, so a blocking system call in one thread blocks them all and they cannot use several cores. <b>Kernel-level threads</b> are known to the kernel, which can schedule them on different cores and run another thread when one blocks, at the cost of a system call for each operation. The mapping between the two gives the classic models: <b>many-to-one</b> (many user threads on one kernel thread), <b>one-to-one</b> (each user thread has its own kernel thread — Linux and Windows) and <b>many-to-many</b> (a pool of kernel threads multiplexes many user threads).</p>`,
        figs: [dia(`direction: right
group "One process" { code, heap, files, t1, t2, t3 }
[Code + global data] as code #grey
[Heap] as heap #grey
[Open files] as files #grey
[Thread 1: own stack + registers] as t1 #blue
[Thread 2: own stack + registers] as t2 #blue
[Thread 3: own stack + registers] as t3 #blue
t1 -> code : shared
t2 -> heap : shared
t3 -> files : shared`, 'Threads share everything except their stack and registers.', { caption: 'threads inside one process' })],
        qs: [q('shared', 'Which of the following is NOT shared between threads of the same process?', ['The stack of each thread.', 'Each thread needs its own stack to hold its own call frames and local variables; heap, code and open files are shared.'], [['The heap.', 'All threads allocate from and see the same heap.'], ['The open file table.', 'Files opened by the process are visible to all its threads.']]), q('block', 'With many-to-one user-level threads, what happens when one thread makes a blocking system call?', ['The whole process blocks, because the kernel knows only one execution unit.', 'That is the main weakness of pure user-level threads — and why most systems use kernel threads.'], [['Only that thread blocks; the others keep running.', 'That is true for kernel-level threads, not for many-to-one.'], ['The library automatically creates a new process.', 'No such magic exists; the whole process is blocked.']])],
        probs: [pr('p-thr', '<p>Give two advantages and one disadvantage of using threads rather than separate processes.</p>', '<b>Advantages:</b> cheaper to create and switch; communication through shared memory is fast and needs no kernel call. Also responsiveness and use of several cores. <b>Disadvantage:</b> no protection between threads — one faulty thread can corrupt shared data or crash the whole process, and shared data needs careful synchronisation.')],
      }),

      sec('metrics', '2.5', 'What “good scheduling” means', {
        eyebrow: 'Measuring',
        body: `<p>“Fast” is not one number. A scheduler can aim at several goals and they pull in different directions. <b>CPU utilisation</b> keeps the processor busy. <b>Throughput</b> counts jobs finished per unit time. <b>Fairness</b> gives each process a reasonable share and avoids starvation. Per-process times are what you actually calculate in exercises, with <b>arrival</b> (AT) the moment a process joins the ready queue and <b>burst</b> (BT) the CPU time it needs:</p><ul><li>${term('Completion time')} (CT) — the clock reading when it finishes.</li><li>${term('Turnaround time')} (TAT) = CT − AT — everything the user waited, running included.</li><li>${term('Waiting time')} (WT) = TAT − BT — time spent in the ready queue doing nothing.</li><li>${term('Response time')} (RT) = first CPU − AT — how long before anything at all happens.</li></ul><p>Batch systems care about throughput and average turnaround; interactive systems care about response time and its variance; real-time systems care about meeting deadlines. Notice that waiting time is the cleanest measure of what a policy <em>costs</em> a process, because it removes the part (the burst) the policy cannot change.</p>`,
        worked: [
          step(`Three processes arrive together: P1 needs 24, P2 needs 3, P3 needs 3. Under first-come-first-served they run in arrival order, so P1 finishes at 24, P2 at 27 and P3 at 30.`, 'CT_1 = 24,\; CT_2 = 27,\; CT_3 = 30', { toc: 'Completion times' }),
          step('Turnaround is completion minus arrival. All arrive at 0, so it equals the completion time.', 'TAT = CT - AT = 24,\; 27,\; 30', { toc: 'Turnaround' }),
          step('Waiting is turnaround minus burst: 24−24, 27−3, 30−3.', 'WT = TAT - BT = 0,\; 24,\; 27', { toc: 'Waiting' }),
          step(`Average waiting time is the mean of those three: (0 + 24 + 27) / 3 = ${fcfs.avgWT}. Check this against the figure in the next section — the card reports the same number.`, `\\overline{WT} = \\frac{0+24+27}{3} = ${fcfs.avgWT}`, { hero: true, toc: 'Average' }),
        ],
        qs: [q('rtwt', 'A process arrives at time 5, first gets the CPU at time 9, and finishes at time 20 after running for 6 units in total. What are its response time and waiting time?', ['Response = 9 − 5 = 4; waiting = (20 − 5) − 6 = 9.', 'Response is time to the first CPU; waiting is turnaround (15) minus burst (6).'], [['Response = 4; waiting = 15.', 'Waiting excludes the 6 units the process spent running.'], ['Response = 15; waiting = 9.', '15 is the turnaround, not the response time.']])],
        probs: [pr('p-tat', `<p>A process arrives at 2, needs 5 units, and completes at 20. Give its turnaround and waiting time.</p>`, `TAT = CT − AT = 20 − 2 = <b>18</b>. WT = TAT − BT = 18 − 5 = <b>13</b>. The process spent 13 units in the ready queue and 5 running.`)],
      }),

      sec('fcfs', '2.6', 'First come, first served — and the convoy', {
        eyebrow: 'Policy 1',
        body: `<p>${term('FCFS')} is the simplest policy: run the process that arrived first, to completion. It is easy to implement (a plain queue) and fair in the sense of order — but its average waiting time depends violently on <em>who</em> arrives first. A long job at the head of the queue makes every short job wait behind it: the ${term('convoy effect')}, named after a line of cars stuck behind one slow truck. It is also non-pre-emptive, so it is hopeless for interactive use: one CPU-bound job holds everybody up.</p><p>Press ▶ and watch the Gantt chart fill. Then the same three jobs under ${term('SJF')} (shortest job first), which always picks the smallest burst among those waiting. Compare the average waiting times: the only thing that changed is the <em>order</em>.</p>`,
        figs: [
          lab('sched', { algo: 'fcfs', ...conv }, 'FCFS: P1 (24) runs first, so P2 and P3 wait 24 and 27 units.', ['avgWT', 'order'], { caption: 'FCFS on 24 / 3 / 3', name: 'fcfs' }),
          lab('sched', { algo: 'sjf', ...conv }, 'SJF: the two short jobs go first; average waiting collapses.', ['avgWT', 'order'], { caption: 'SJF on the same jobs', name: 'sjf' }),
        ],
        qs: [q('convoy', 'The same three jobs arrive in a different order: P2, P3, P1 (short ones first). What happens to FCFS’s average waiting time?', [`It drops sharply — to ${sjf.avgWT}, the same as SJF here.`, `FCFS has no idea how long jobs are; it only sees the order. Put the short jobs at the front and they finish almost at once, so only the long job waits (for 0, 3 and 6 units → an average of ${sjf.avgWT}). The policy did not get smarter — the input got kinder.`], [['It stays exactly the same, because the jobs are the same.', 'The set of jobs is the same but the waiting times are not: waiting is time spent behind others, and who is behind whom changed.'], ['It gets worse, because short jobs now run before the long one.', 'Running short jobs first is precisely what removes waiting: a long job delays everything after it, a short one barely delays anything.']], { verify: lab('sched', { algo: 'fcfs', procs: 'P2,0,3;P3,0,3;P1,0,24' }, 'Same jobs, kind order: run it and compare with the first figure.', ['avgWT'], { caption: 'FCFS with the short jobs first', name: 'kind' }) })],
      }),

      sec('sjf', '2.7', 'Shortest job first and its pre-emptive form', {
        eyebrow: 'Policy 2',
        body: `<p>SJF is <em>provably optimal</em> for average waiting time: swapping a long job ahead of a shorter one can only increase the total wait (each of the jobs between them waits longer). The catch is that it needs the future. Nobody knows a burst length in advance, so real systems predict it from history with an exponential average: τ<sub>n+1</sub> = α·t<sub>n</sub> + (1 − α)·τ<sub>n</sub>, where t<sub>n</sub> is the most recent actual burst and τ<sub>n</sub> the previous prediction. With α = ½ recent and older history count equally; with α = 1 only the last burst matters.</p><p>The pre-emptive version, ${term('SRT')} (shortest remaining time), re-decides every time a process arrives: if the newcomer needs less than what the running job has left, it takes the CPU. It never does worse than SJF on average waiting, but it causes more switches and it can starve long jobs when short ones keep arriving. Watch P1 being pre-empted when P2 arrives in the figure.</p>`,
        figs: [lab('sched', { algo: 'srt', ...srtP }, `SRT: watch P1 being pre-empted when P2 arrives. Average waiting ${srt.avgWT}, versus ${sjfNP.avgWT} for non-pre-emptive SJF.`, ['avgWT', 'order'], { caption: 'SRT on four arriving jobs', name: 'srt' })],
        worked: [step('Predict the next burst. Previous prediction τ₀ = 10, actual burst t₀ = 6, α = 0.5.', '\\tau_1=\\alpha t_0+(1-\\alpha)\\tau_0', { toc: 'Formula' }), step('Substitute.', '\\tau_1=0.5(6)+0.5(10)=8', { hero: true, toc: 'Prediction' }), step('If the next actual burst is 4, the following prediction is 0.5(4) + 0.5(8) = 6 — the estimate chases the observed behaviour.', '\\tau_2=6', { toc: 'Next' })],
        qs: [q('optimal', 'In what sense is SJF optimal?', ['It gives the minimum average waiting time among all non-pre-emptive schedules for the same set of jobs.', 'Moving a shorter job ahead of a longer one reduces the wait of the shorter by more than it increases the wait of the longer.'], [['It minimises the response time of every individual job.', 'Optimality is about the average; long jobs may wait very long (starvation).'], ['It maximises CPU utilisation.', 'Utilisation depends on keeping the CPU busy, not on the order of jobs.']]), q('srtq', 'Why can SRT cause more context switches than SJF?', ['It pre-empts the running job whenever a shorter one arrives.', 'Each pre-emption is a switch; non-pre-emptive SJF only switches when a job finishes.'], [['It uses a smaller quantum.', 'SRT has no quantum; it pre-empts on arrival.'], ['It runs jobs in random order.', 'Order is determined by remaining time, not random.']])],
        probs: [pr('p-srt', `<p>Processes P1(0,8), P2(1,4), P3(2,9), P4(3,5) — (arrival, burst). Find the average waiting time under SRT and under non-pre-emptive SJF.</p>`, `Run both in the cards above. SRT gives <b>${srt.avgWT}</b> and non-pre-emptive SJF gives <b>${sjfNP.avgWT}</b>. Pre-emption lets the short P2 (4) take over from P1 the moment it arrives, so the short jobs finish sooner and total waiting falls. The price is more context switches and needing to know the remaining time.`, { verify: lab('sched', { algo: 'srt', ...srtP }, 'The SRT schedule that produces the figure.', ['avgWT'], { caption: 'SRT answer', name: 'ans' }) }), pr('p-tau', '<p>With α = 0.5, τ₀ = 12 and observed bursts 8, 8, 16, predict τ₃ (the prediction after seeing all three).</p>', 'τ₁ = 0.5(8) + 0.5(12) = 10; τ₂ = 0.5(8) + 0.5(10) = 9; τ₃ = 0.5(16) + 0.5(9) = <b>12.5</b>.')],
      }),

      sec('rr', '2.8', 'Round Robin: everyone gets a turn', {
        eyebrow: 'Policy 3',
        body: `<p>Interactive systems cannot let one job hog the CPU. ${term('Round Robin')} gives each process a fixed ${term('time quantum')}; when the quantum expires the timer interrupt fires, the running process goes to the back of the ready queue and the next one runs. New arrivals join the queue behind the ones already waiting — but ahead of the process that has just been pre-empted. If there are n processes and the quantum is q, no process waits more than (n − 1)·q before its next turn, which is exactly the guarantee an interactive user wants.</p><p>The quantum is the one knob. Very large: Round Robin degenerates into FCFS. Very small: the CPU spends its time <em>switching</em> (see the overhead table) rather than working. A common rule of thumb is to choose q so that about 80 % of CPU bursts are shorter than one quantum — they then finish without being cut off. Compare the three cards below on the same jobs.</p>`,
        figs: [
          lab('sched', { algo: 'rr', quantum: 1, ...conv }, `q = 1: fair to the extreme, but ${q1.switches} context switches.`, ['switches', 'avgWT'], { caption: 'quantum 1', name: 'q1' }),
          lab('sched', { algo: 'rr', ...rrP }, 'q = 4: the textbook setting.', ['avgWT', 'order', 'switches'], { caption: 'quantum 4', name: 'q4' }),
          lab('sched', { algo: 'rr', quantum: 100, ...conv }, 'q = 100: longer than every burst, so it is FCFS again.', ['avgWT', 'switches'], { caption: 'quantum 100', name: 'q100' }),
        ],
        after: `<p>With quantum 4 the jobs above finish with an average waiting time of ${rr.avgWT} — worse than SJF's ${sjf.avgWT}, better than FCFS's ${fcfs.avgWT}, and every process got the CPU within a few units. That last property, not the average, is why time-sharing systems use it. Round Robin also has <em>no starvation</em>: every ready process is served within a bounded time.</p>`,
        qs: [q('quantum', 'A designer makes the quantum smaller and smaller. What is the cost?', ['More context switches — CPU time is burnt on switching instead of on the jobs.', `Every switch saves one process's registers and loads another's. With q = 1 the three jobs above cause ${q1.switches} switches; with q = 100 only ${q100.switches}. Each switch is pure overhead, so a tiny quantum buys responsiveness with throughput.`], [['Nothing — a smaller quantum is strictly fairer.', 'It is fairer, but fairness is not free: the switch overhead is the price, and past a point it dominates.'], ['The scheduler runs out of memory for the queue.', 'The ready queue holds the same number of processes at any quantum; what grows is the number of times the CPU changes hands.']]), q('rrbound', 'Five processes share the CPU under Round Robin with a 20 ms quantum (ignore switch cost). What is the longest a ready process can wait for its next turn?', ['(5 − 1) × 20 = 80 ms.', 'The other four each take a full quantum before it is chosen again.'], [['20 ms.', 'That is one quantum; four others go before it.'], ['100 ms.', 'It does not wait for its own quantum, only for the other n − 1.']])],
        probs: [pr('p-rr', `<p>Three processes all arrive at t = 0 with bursts 24, 3 and 3. Find the average waiting time under Round Robin with quantum 4.</p>`, `Order of service: P1 (4), P2 (3, done at 7), P3 (3, done at 10), then P1 runs the rest of its 24 alone. Waiting: P1 = 30 − 24 = 6, P2 = 4, P3 = 7 → average <b>${rr.avgWT}</b>. The two short jobs no longer wait behind the long one — that is the point of time-slicing.`)],
      }),

      sec('priority', '2.9', 'Priority scheduling, starvation and aging', {
        eyebrow: 'Policy 4',
        body: `<p>${term('Priority')} scheduling runs the most important job first; SJF is just the special case where priority is the inverse of the next burst. Priorities can be set internally (by the OS from measurable properties such as memory use or I/O ratio) or externally (by the administrator or the user’s <code>nice</code> value). It may be pre-emptive — a higher-priority arrival takes the CPU immediately — or not.</p><p>The danger is ${term('starvation')} (indefinite blocking): a low-priority job that never gets a turn while urgent jobs keep arriving. Legend has it that when the IBM 7094 at MIT was shut down in 1973 they found a low-priority job submitted in 1967 that had never run. The cure is ${term('aging')}: gradually raise a job’s priority the longer it waits, so eventually it overtakes everything. ${term('HRRN')} (highest response ratio next) builds the idea into a formula, response ratio = (W + B) / B, which grows with the waiting time W and favours short jobs B only mildly — a long job that has waited long enough will win.</p><p>Run the card below with priority numbers where <em>smaller means more important</em> (as in most textbooks): the order of service follows the priorities, not the arrival or the length.</p>`,
        figs: [lab('sched', { algo: 'priority', ...pri }, `Priority (lower number = higher priority). Order: ${prio.order}. Average waiting ${prio.avgWT}.`, ['avgWT', 'order'], { caption: 'priority scheduling, non-pre-emptive', name: 'prio' }), lab('sched', { algo: 'hrrn', procs: 'P1,0,3;P2,2,6;P3,4,4;P4,6,5;P5,8,2' }, 'HRRN: after each job finishes, the ratio (W+B)/B is recomputed for everyone waiting.', ['avgWT', 'order'], { caption: 'highest response ratio next', name: 'hrrn' })],
        worked: [step('Highest response ratio next: at time 9, P3 has waited W = 5 with B = 4, and P4 has waited W = 3 with B = 5. Which runs next?', '', { toc: 'Question' }), step('Compute (W + B)/B for each.', 'RR_{P3}=\\tfrac{5+4}{4}=2.25,\\quad RR_{P4}=\\tfrac{3+5}{5}=1.6', { toc: 'Ratios' }), step('P3 has the larger ratio, so it goes first.', 'P3', { hero: true, toc: 'Choice' })],
        qs: [q('starve', 'In a priority scheduler a low-priority process has waited for hours. Which mechanism prevents it waiting forever?', ['Aging — its priority rises the longer it waits.', 'Starvation is a property of the policy, not of the process: as long as higher-priority jobs keep arriving, the low one is never chosen. Slowly raising the priority of waiting jobs guarantees that eventually it is the best in the queue.'], [['A larger time quantum.', 'The quantum decides how long a job runs once chosen; starvation is about never being chosen at all.'], ['Running the job twice as long when it does get the CPU.', 'That would only make each rare turn longer — the job would still wait indefinitely for the first one.']]), q('hrrnq', 'What does the response ratio (W + B)/B do as a job waits longer?', ['It increases without bound, so even a long job eventually gets chosen.', 'W grows while B is fixed, so the ratio grows — this is aging built into a formula.'], [['It decreases, so waiting jobs are less likely to be chosen.', 'It is the opposite: more waiting means a higher ratio and higher chance.'], ['It stays at 1.', 'It equals 1 only at the moment of arrival (W = 0).']])],
        probs: [pr('p-pri', '<p>Five processes arrive together with (burst, priority): P1(10,3) P2(1,1) P3(2,4) P4(1,5) P5(5,2), smaller number = higher priority. Give the order of service and the average waiting time (non-pre-emptive).</p>', `Order by priority: P2, P5, P1, P3, P4. Waiting times: P2 0, P5 1, P1 6, P3 16, P4 18 → average <b>${prio.avgWT}</b>. Compare SJF, which would put the two 1-unit jobs first.`)],
      }),

      sec('mlfq', '2.10', 'Multilevel queues and feedback queues', {
        eyebrow: 'Policy 5',
        body: `<p>Real workloads mix interactive and batch jobs, and no single quantum suits both. A ${term('multilevel queue')} splits the ready queue into permanent classes — system processes, interactive, batch — each with its own policy (say Round Robin for interactive and FCFS for batch), and arbitrates between the queues by fixed priority or by time slices (80 % of the CPU to the foreground queue, 20 % to the background). A process belongs to one queue for life, which is simple but inflexible.</p><p>The ${term('multilevel feedback queue')} (MLFQ) lets processes <em>move</em>, and is the ancestor of the schedulers in Windows, macOS and old Linux. A new job enters the top queue with a short quantum. If it uses its whole quantum it was probably CPU-bound, so it is demoted to a lower queue with a longer quantum; if it blocks for I/O before the quantum ends it was interactive and stays high. Over time interactive jobs live at the top and receive quick responses, CPU hogs sink to the bottom and run in long, efficient slices. To stop starvation, a job that waits too long in a low queue is promoted. The scheduler learns the nature of each job without being told, which is why it is the design to remember.</p>`,
        figs: [dia(`direction: down
[Queue 0 — RR, q = 8] as q0 #mint
[Queue 1 — RR, q = 16] as q1 #blue
[Queue 2 — FCFS] as q2 #violet
(CPU) as cpu
q0 -> cpu : always first
q1 -> cpu : only if queue 0 empty
q2 -> cpu : only if 0 and 1 empty
q0 -> q1 : used full quantum (demote)
q1 -> q2 : used full quantum (demote)
q2 -> q0 : waited too long (age up)
@0 q0 -> cpu
@1.2 q0 -> q1
@2.4 q1 -> cpu
@3.6 q1 -> q2
@4.8 q2 -> q0
loop 7`, 'A job’s own behaviour decides which queue it settles in.', { caption: 'multilevel feedback queue' })],
        qs: [q('mlfqwhy', 'Why does MLFQ demote a job that uses its entire quantum?', ['Using the whole quantum suggests it is CPU-bound, so it belongs in a lower queue with longer slices and lower priority.', 'This keeps interactive jobs, which release the CPU early, responsive without being told which jobs are interactive.'], [['To punish long programs.', 'It is not a punishment but an inference about the job’s behaviour.'], ['Because the CPU is overheating.', 'Heat plays no part in the algorithm.']]), q('mlfqstarve', 'What is the purpose of promoting a job that has waited a long time in a low queue?', ['Aging: to prevent starvation of the low-priority jobs.', 'Without promotion, constant arrivals at the top could keep the lowest queue waiting forever.'], [['To make the queue lengths equal.', 'Equal lengths are not a goal.'], ['To reduce context switches.', 'It does not reduce switches; it prevents starvation.']])],
        probs: [pr('p-mlfq', '<p>A job needs 40 ms of CPU. Queues have quanta 8, 16 and FCFS (unbounded). Trace which queues it visits and how long it runs in each (no I/O).</p>', 'Queue 0: runs 8 ms (used the whole quantum) → demoted. Queue 1: runs 16 ms (total 24) → demoted. Queue 2: runs the remaining <b>16 ms</b> to completion. Total 8 + 16 + 16 = 40.')],
      }),

      sec('linux', '2.11', 'Multiprocessors and the Linux scheduler', {
        eyebrow: 'In practice',
        body: `<p>With several cores the scheduler gains new questions. In <b>asymmetric</b> multiprocessing one master core runs the kernel and hands work to the others; in <b>symmetric</b> multiprocessing (SMP, the norm) every core schedules itself, either from one common ready queue (simple, but a lock-contended hot spot) or from a per-core queue (scalable, but needing <b>load balancing</b> — push or pull tasks between cores). A task also prefers to stay on the core where it last ran because its data is still in that core’s cache: this <b>processor affinity</b> is soft (a preference) or hard (a rule).</p><p>Linux’s ${term('Completely Fair Scheduler')} (CFS) drops fixed quanta altogether. Each runnable task accumulates <b>virtual runtime</b> — CPU time scaled by its weight (derived from its nice value) — and the scheduler always runs the task with the <em>smallest</em> virtual runtime, kept in a red-black tree so the leftmost node is found in O(log n). A task that has had little CPU is behind, so it is chosen; the ideal is every task advancing at the same virtual rate, each getting exactly 1/n of the processor. A task’s time slice is its share of a target latency (for example 20 ms divided among the runnable tasks), with a minimum granularity so slices never become absurdly small.</p>`,
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
        worked: [step('Four runnable tasks of equal weight share a target latency of 20 ms. How long is each slice?', '\\tfrac{20}{4}', { toc: 'Equal weights' }), step('5 ms each. If a fifth task arrives the slice shrinks to 4 ms; with 100 tasks it would be 0.2 ms, so CFS enforces a minimum (say 1 ms).', '5\\ \\text{ms}', { hero: true, toc: 'Slice' })],
        qs: [q('cfs', 'In CFS, which task is picked to run next?', ['The one with the smallest virtual runtime.', 'It has received the least weighted CPU time so far, so it is the most “behind” and should catch up.'], [['The one with the highest priority number.', 'CFS has no strict priority order; weights change how fast vruntime grows.'], ['The one that arrived last.', 'Arrival order is not used.']]), q('affinity', 'Why does a scheduler prefer to keep a task on the same core?', ['Its working data is likely still in that core’s cache, so it runs faster than after migration.', 'This is processor affinity.'], [['Because other cores cannot run that program.', 'Any core can run it; the preference is purely about cache warmth.'], ['To balance the load.', 'Affinity works against perfect balance.']])],
      }),

      sec('realtime', '2.12', 'Real-time scheduling: meeting deadlines', {
        eyebrow: 'Guarantees',
        body: `<p>In a ${term('real-time')} system the correctness of a result depends on <em>when</em> it is produced. A <b>hard</b> real-time system (airbag controller, flight control) must never miss a deadline; a <b>soft</b> one (video playback) merely degrades. Tasks are usually <b>periodic</b>: task i needs C<sub>i</sub> units of CPU every T<sub>i</sub> time units, and must finish within its period. The CPU utilisation of the task set is U = Σ C<sub>i</sub>/T<sub>i</sub>, and U ≤ 1 is obviously necessary.</p><p><b>Rate-monotonic (RM)</b> scheduling gives static priorities by period — the shorter the period, the higher the priority — and pre-empts. Liu and Layland proved that a set of n periodic tasks is schedulable by RM if U ≤ n(2<sup>1/n</sup> − 1), a bound that falls from 1 for one task towards ln 2 ≈ 0.693 for many; it is sufficient, not necessary. <b>Earliest-deadline-first (EDF)</b> uses dynamic priorities — always run the task whose deadline is nearest — and is optimal for a single processor: the set is schedulable if and only if U ≤ 1. EDF squeezes out more of the CPU, but RM is simpler, its failure mode under overload is more predictable (low-priority tasks miss first), and fixed priorities are widely supported.</p>`,
        figs: [rmTable],
        worked: [step('Two periodic tasks: task A needs C = 1 every T = 4, task B needs C = 2 every T = 6. Is the set schedulable under RM? First the utilisation.', 'U=\\tfrac14+\\tfrac26', { toc: 'Utilisation' }), step('Add.', 'U=0.25+0.333=0.583', { toc: 'U' }), step('The RM bound for n = 2 is 2(√2 − 1) = 0.828. Since 0.583 ≤ 0.828, RM guarantees schedulability — and EDF too, since U ≤ 1.', '0.583\\le0.828', { hero: true, toc: 'Test' })],
        qs: [q('rmprio', 'Under rate-monotonic scheduling, which of two tasks has the higher priority?', ['The one with the shorter period.', 'RM assigns priority in order of rate (1/period): the more frequently a task must run, the higher its priority.'], [['The one with the longer execution time C.', 'Execution time is not used for the priority assignment.'], ['The one that arrived first.', 'Arrival order is irrelevant for periodic RM.']]), q('edf', 'What makes EDF able to schedule task sets that RM cannot?', ['Its priorities are dynamic: the closest deadline always wins, so it can use the CPU up to 100 %.', 'For a single processor EDF schedules any set with U ≤ 1.'], [['It runs tasks in parallel on several cores.', 'EDF here is a single-processor result.'], ['It ignores deadlines.', 'The opposite: deadlines are its only criterion.']])],
        probs: [pr('p-rm', '<p>Three tasks (C, T) = (1, 4), (1, 5), (2, 10). Compute U and compare it with the RM bound for n = 3.</p>', `U = 0.25 + 0.2 + 0.2 = <b>0.65</b>. The RM bound for n = 3 is 3(2^{1/3} − 1) = <b>${rm(3)}</b>. Since 0.65 ≤ ${rm(3)}, the set is schedulable under RM (and EDF).`), pr('p-edf', '<p>Tasks (C, T) = (3, 6) and (4, 8) have U = 1.0. Can EDF schedule them? Can RM be guaranteed to?</p>', 'U = 0.5 + 0.5 = 1, so EDF can schedule it (U ≤ 1 is exact for EDF). RM cannot: A (T = 6) has priority; B runs 3–6, is pre-empted when A re-releases at 6 and has 1 unit left; A runs 6–9, so B finishes at 10 &gt; its deadline 8 and misses. RM’s guaranteed bound for n = 2 is 0.828 &lt; 1, consistent with this failure.')],
      }),

      sec('numericals', '2.13', 'Practice set', {
        eyebrow: 'Practice',
        body: `<p>Work each problem before opening the answer, and use the Gantt-chart card to verify your schedule. For scheduling numericals the reliable method is: draw the timeline, mark each process’s completion time, then derive TAT = CT − AT and WT = TAT − BT.</p>`,
        probs: [
          pr('p-mix', `<p>Compare FCFS, SJF and RR (q = 4) on P1(0,24), P2(0,3), P3(0,3): which gives the lowest average waiting time and which gives the best worst-case response?</p>`, `Averages: FCFS <b>${fcfs.avgWT}</b>, SJF <b>${sjf.avgWT}</b>, RR(4) <b>${rr.avgWT}</b>. SJF has the lowest average waiting time (provably). RR gives every process the CPU within a bounded time, so its response time is best for the later arrivals — the right trade-off for interactive systems.`),
          pr('p-why', '<p>Why is Round Robin a poor choice for a batch of long, similar jobs?</p>', 'Each job takes the same total CPU time but is chopped into slices, so all finish late together (average turnaround is high) and the switching overhead is wasted. FCFS or SJF would finish jobs one after another with fewer switches.'),
          pr('p-dev', '<p>State the single most important difference between a process and a thread.</p>', 'A process owns an address space and resources; threads of one process share them and differ only in the stack, registers and program counter — which is why thread creation and switching are cheaper but threads are less isolated.'),
        ],
      }),
    ],
  })
}
