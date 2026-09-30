export default {
  id: 'enct-254', code: 'ENCT 254', title: 'Operating System', subject: 'computing', semester: 4, program: 'computer',
  description: 'Processes, scheduling, synchronisation, memory, storage and file systems — every algorithm drawn and stepped in the Step Lab.',
  order: ['01-introduction', '02-process-management', '03-synchronization-deadlock', '04-memory-management', '05-io-disk', '06-fs-security-virtualization'],
  lessons: {
    '01-introduction': { path: '1 Introduction', title: 'What an operating system is' },
    '02-process-management': { path: '2 Process Management', title: 'Processes and CPU scheduling' },
    '03-synchronization-deadlock': { path: '3 Process Communication and Synchronization', title: 'Synchronisation and deadlock' },
    '04-memory-management': { path: '4 I/O and Memory Management', title: 'Memory management and virtual memory' },
    '05-io-disk': { path: '4 I/O and Memory Management', title: 'I/O software and disk scheduling' },
    '06-fs-security-virtualization': { path: '5–8 File Systems, Security, Virtualisation', title: 'File systems, protection, virtual machines' },
  },
}
