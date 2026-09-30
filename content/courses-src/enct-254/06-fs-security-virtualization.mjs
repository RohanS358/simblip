import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term }) => lesson({
  title: 'File systems, protection, virtual machines and contemporary systems',
  kicker: 'ENCT 254 · Operating System · Chapters 5–8',
  subtitle: 'How bytes become named files, how access is controlled, and how one machine pretends to be many.',
  sections: [
    sec('files', '5.1', 'Files, directories and inodes', { eyebrow: 'Naming', body: `<p>A ${term('file')} is a named sequence of bytes with attributes (size, owner, permissions, times). Directories map names to files, forming a tree. On Unix-style systems the name points to an ${term('inode')}: a small record holding the attributes and the locations of the data blocks; the name itself is just an entry in a directory — which is why two names can reach one inode (a hard link).</p>`,
      figs: [dia(`direction: right
[/home/ram/notes.txt] as path #blue
[Directory entry: name → inode 117] as dir #amber
[Inode 117: size, owner, permissions, block pointers] as ino #violet
[Data blocks] as blk #mint
path -> dir : resolve each component
dir -> ino
ino -> blk : direct, indirect pointers
@0 path -> dir
@1.2 dir -> ino
@2.4 ino -> blk
loop 4.5`, 'Path lookup walks directories until it reaches the inode.', { caption: 'from a path to data' })],
      qs: [q('hard', 'What does deleting one of two hard links to a file do?', ['Removes one directory entry; the data stays until the link count reaches zero.', 'The inode counts its names; only at zero are blocks freed.'], [['Deletes the data immediately.', 'The other name still needs it.'], ['Turns the other link into a dangling pointer.', 'That is a symbolic link; hard links are equal peers.']])] }),
    sec('alloc', '5.2', 'Allocating disk blocks', { eyebrow: 'Layout', body: `<p>${term('Contiguous')} allocation is fast for sequential reads but fragments. ${term('Linked')} allocation chains blocks (FAT keeps the chain in a table) — no fragmentation, slow random access. ${term('Indexed')} allocation gives the file an index block (ext4/NTFS style, with extents) — fast random access at the cost of the index.</p>`,
      worked: [step('An inode holds 12 direct pointers and one single-indirect block of 1024 pointers; blocks are 4 KB.', '', { toc: 'Setup' }), step('Direct data: 12 × 4 KB = 48 KB. Indirect: 1024 × 4 KB = 4 MB. Maximum without further levels:', '48\\,\\text{KB} + 4096\\,\\text{KB} = 4144\\,\\text{KB}', { hero: true, toc: 'Maximum file size' })],
      qs: [q('idx', 'Which allocation method is best for random access?', ['Indexed (or contiguous).', 'Block k is found by one index lookup; linked allocation must follow k pointers.'], [['Linked.', 'Random access means walking the chain.'], ['None can do random access.', 'Indexed can.']])] }),
    sec('security', '6.1', 'Protection and security', { eyebrow: 'Who may do what', body: `<p>${term('Authentication')} proves who you are (passwords, keys, multi-factor). ${term('Authorisation')} decides what you may do: an ${term('access-control list')} is stored with each object (who may touch me), a ${term('capability')} is held by each subject (what I may touch). Secure boot verifies each boot stage's signature; ${term('sandboxing')} confines a program to a restricted environment so a compromise stays small.</p>`,
      figs: [dia(`mode: sequence
[User] as u
[Login service] as l
[Kernel] as k
u -> l : username + password + code
l -> l : verify hash, check 2nd factor
l --> u : session token
u -> k : open(file) with token
k -> k : check access-control list
k --> u : granted / denied`, 'Authentication first, then a check on every access.', { caption: 'login then access' })],
      qs: [q('acl', 'An access-control list is attached to…', ['The object (file/resource): it lists who may do what.', 'A capability list is attached to the subject instead.'], [['The user.', 'That is a capability.'], ['The CPU.', 'Hardware only enforces privilege levels.']])] }),
    sec('virt', '7.1', 'Hypervisors, VMs and containers', { eyebrow: 'Sharing a machine', body: `<p>A ${term('hypervisor')} lets several operating systems share one machine. Type 1 runs directly on hardware (Xen, ESXi, KVM); Type 2 runs as an application on a host OS (VirtualBox). A ${term('container')} (Docker) virtualises the <em>operating system</em> instead: containers share one kernel but see separate process, file and network namespaces — lighter and faster to start than a full VM, but with weaker isolation. Kubernetes schedules containers across many machines.</p>`,
      figs: [dia(`direction: right
group "Virtual machines" { vm1, vm2, hyp }
group "Containers" { c1, c2, rt }
[Guest OS 1 + app] as vm1 #blue
[Guest OS 2 + app] as vm2 #blue
[Hypervisor] as hyp #violet
[Container A] as c1 #mint
[Container B] as c2 #mint
[Shared host kernel] as rt #violet
vm1 -> hyp
vm2 -> hyp
c1 -> rt
c2 -> rt`, 'A VM carries a whole OS; a container shares the host kernel.', { caption: 'VM vs container' })],
      qs: [q('cont', 'Why does a container start faster than a VM?', ['It has no guest kernel to boot — it shares the host’s.', 'It is just isolated processes.'], [['Containers run on special hardware.', 'They run on ordinary hardware.'], ['Containers are not isolated at all.', 'They are isolated by namespaces and cgroups, though less strongly than VMs.']])] }),
    sec('contemp', '8.1', 'Windows, Linux, mobile, embedded, real-time', { eyebrow: 'Contemporary systems', body: `<p>Linux (monolithic, modular), Windows NT (hybrid kernel), Android (Linux kernel plus a managed runtime), iOS/macOS (XNU, a Mach–BSD hybrid). Embedded and IoT systems favour small real-time kernels (FreeRTOS, Zephyr); robots add middleware such as ROS; smart-cards run tiny, tightly secured systems. The same five concerns — processes, memory, files, I/O, protection — recur everywhere with different trade-offs.</p>`, qs: [q('android', 'Android’s kernel is…', ['Linux.', 'Android applications run on a managed runtime above a Linux kernel.'], [['Windows NT.', 'No.'], ['A microkernel.', 'Linux is monolithic/modular.']])] }),
    sec('practice', '8.2', 'Exercises', { eyebrow: 'Practice', probs: [pr('p1', '<p>A 4 KB-block file system uses 12 direct and 1 single-indirect pointer (4-byte pointers). What is the largest file?</p>', 'An indirect block holds 4096/4 = 1024 pointers. Total = (12 + 1024) × 4 KB = <b>4144 KB</b>.'), pr('p2', '<p>Give one advantage and one risk of containers over VMs.</p>', 'Advantage: start in milliseconds and use far less memory because they share the kernel. Risk: a kernel vulnerability affects every container on the host.')] }),
  ],
})
