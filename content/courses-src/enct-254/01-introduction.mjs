import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'What an operating system is',
  kicker: 'ENCT 254 · Operating System · Chapter 1',
  subtitle: 'One program that manages every other: it shares the hardware, hides its ugliness, and draws the line between trusted and untrusted code.',
  sections: [
    sec('roles', '1.1', 'Two jobs in one', { eyebrow: 'The idea',
      body: `<p>An ${term('operating system')} does two things. It is an <b>extended machine</b>: it hides the raw hardware behind clean abstractions — files instead of disk sectors, processes instead of a shared CPU, sockets instead of network cards. And it is a <b>resource manager</b>: it decides who gets the CPU, memory and devices, and stops programs from trampling each other.</p><p>The ${term('kernel')} is the part that always runs in privileged mode. Around it sit the ${term('shell')} (the command interpreter), utilities and applications, which run in user mode and reach the kernel only through ${term('system calls')}.</p>`,
      figs: [dia(`direction: down
[Applications] as app #blue
[Shell and utilities] as sh #blue
[System-call interface] as sc #amber
[Kernel: scheduler, memory, file system, drivers] as k #violet
[Hardware: CPU, RAM, disk, network] as hw #grey
app -> sc : open(), read(), fork()
sh -> sc
sc -> k
k -> hw
@0 app -> sc : read()
@1.2 sc -> k : trap
@2.4 k -> hw : disk I/O
loop 4`, 'A request travels down through the system-call boundary; the answer comes back up.', { caption: 'layers of a system' })],
      qs: [q('syscall', 'Why can a user program not simply call a kernel function directly?', ['User code runs unprivileged; a system call is the controlled doorway that switches the CPU into kernel mode.', 'The trap instruction changes the privilege level and jumps to a fixed, checked entry point. Without it any program could read another’s memory or rewrite the disk.'], [['Because kernel functions are written in a different language.', 'Language is irrelevant. The barrier is hardware-enforced privilege, not syntax.'], ['Because it would be too slow.', 'Speed is not the reason — protection is.']])] }),
    sec('kinds', '1.2', 'Kinds of kernel', { eyebrow: 'Structure',
      body: `<p>A ${term('monolithic')} kernel (classic Unix, Linux) runs everything — scheduler, file systems, drivers — in one address space: fast, but a buggy driver can crash the machine. A ${term('microkernel')} keeps only the essentials (scheduling, IPC, basic memory) in the kernel and runs the rest as user-mode servers: safer and easier to extend, but every service call costs a message. ${term('Layered')} kernels stack strict layers; ${term('hybrid')} kernels (Windows NT, macOS) mix the two; ${term('exokernels')} expose raw hardware and leave abstraction to libraries.</p>`,
      figs: [dia(`direction: right
group "Monolithic" { m1, m2 }
group "Microkernel" { u1, u2, mk }
[Everything in one kernel] as m1 #violet
[Hardware] as m2 #grey
[File server] as u1 #blue
[Driver] as u2 #blue
[Tiny kernel: IPC, scheduling, memory] as mk #violet
m1 -> m2
u1 -> mk : message
u2 -> mk : message`, 'Where the boundary sits decides speed versus isolation.', { caption: 'two kernel designs' })],
      qs: [q('micro', 'What is the main price of a microkernel?', ['More message passing between user-mode servers, so each service call is slower.', 'Isolation is bought with context switches and copies: a file read becomes a message to the file server and a reply.'], [['It cannot run on modern hardware.', 'Microkernels (QNX, seL4, Mach-based systems) run well on modern hardware.'], ['It has no memory protection.', 'Quite the opposite: protection between services is its selling point.']])] }),
    sec('boot', '1.3', 'From power button to login', { eyebrow: 'Booting',
      body: `<p>At power-on the CPU runs firmware from a fixed address. Legacy ${term('BIOS')} loads the first 512-byte sector — the ${term('MBR')} — which chain-loads a bootloader; modern ${term('UEFI')} reads a bootloader from an EFI system partition on a ${term('GPT')} disk directly, and can verify its signature (secure boot). The bootloader loads the kernel into memory and jumps to it; the kernel initialises devices, mounts the root file system and starts the first user process (<code>init</code>/<code>systemd</code>), which starts everything else.</p>`,
      figs: [dia(`direction: right
(Power on) as a
[Firmware: BIOS / UEFI] as b #amber
[Bootloader: GRUB] as c #blue
[Kernel loads] as d #violet
[init / systemd] as e #mint
(Login) as f
a -> b
b -> c : POST, find boot device
c -> d : load kernel + initrd
d -> e : mount root, start drivers
e -> f : start services
@0 a -> b
@1 b -> c
@2 c -> d
@3 d -> e
@4 e -> f
loop 6`, 'Each stage is small and loads the next, bigger one.', { caption: 'the boot chain' })],
      qs: [q('mbr', 'Why is the MBR bootloader so small?', ['It must fit in one 512-byte sector the firmware can read before any file system exists.', 'The firmware knows nothing about files; it can only read sector 0. That tiny code loads a bigger loader that does understand file systems.'], [['To save disk space.', 'One sector is nothing on a modern disk; the limit comes from what firmware loads, not from capacity.'], ['Because the kernel is tiny.', 'Kernels are megabytes; the MBR code only starts the chain.']])],
      worked: [step('Firmware finds the boot device and reads sector 0 (512 bytes).', '', { toc: 'Sector 0' }), step('The 446-byte boot code plus the 64-byte partition table plus the 2-byte signature fill the sector: 446 + 64 + 2 = 512.', '446 + 64 + 2 = 512', { hero: true, toc: 'Layout' })] }),
    sec('types', '1.4', 'A zoo of operating systems', { eyebrow: 'Kinds', body: `<p>Mainframe and server systems maximise throughput and uptime; personal systems favour responsiveness; smartphone and embedded systems live with tight power and memory; ${term('real-time')} systems guarantee that a task finishes <em>by its deadline</em> (hard) or usually does (soft). The same ideas — processes, memory, files — appear in all of them with different priorities.</p>`,
      figs: [dia(`direction: right
[Batch / mainframe] as a #grey
[Server] as b #blue
[Desktop] as c #mint
[Mobile / embedded] as d #amber
[Real-time] as e #rose
a -> b : interactive, networked
b -> c : GUI, single user
c -> d : power, size limits
d -> e : deadlines`, 'One family tree of requirements.', { caption: 'system types' })],
      qs: [q('hard', 'What defines a hard real-time system?', ['Missing a deadline is a failure, not merely a slowdown.', 'Anti-lock brakes or a pacemaker must respond within a bound; predictability matters more than average speed.'], [['It is very fast.', 'Speed helps, but the requirement is a guaranteed bound, not raw speed.'], ['It cannot multitask.', 'Real-time systems multitask routinely; they schedule to meet deadlines.']])] }),
    sec('practice', '1.5', 'Quick checks', { eyebrow: 'Practice', probs: [pr('p1', '<p>Name three system calls and what each asks the kernel to do.</p>', '<code>open()</code> — the file system finds a file and returns a handle; <code>fork()</code> — the process manager duplicates the calling process; <code>read()</code> — a driver fetches bytes from a file or device into the caller’s buffer.'), pr('p2', '<p>Compare a monolithic kernel and a microkernel in one sentence each.</p>', 'Monolithic: all services in one privileged address space — fast, less isolated. Microkernel: minimal privileged core plus user-mode services — isolated, slower because of message passing.')] }),
    sec('summary', '1.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>OS = extended machine + resource manager.</li><li>User mode ↔ kernel mode only through system calls.</li><li>Kernel designs trade speed against isolation.</li><li>Boot is a chain of ever-larger loaders.</li></ul>` }),
  ],
})
