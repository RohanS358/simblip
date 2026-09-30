export default {
  id: 'enct-301', code: 'ENCT 301', title: 'Database Management System', subject: 'computing', semester: 5, program: 'computer',
  description: 'Data models, relational algebra and SQL, normalisation, indexing, transactions and recovery — with tables you can query and schedules you can test.',
  order: ['01-intro-models', '02-relational-sql', '03-normalization', '04-query-processing-indexing', '05-transactions', '06-recovery-advanced'],
  lessons: {
    '01-intro-models': { path: '1–2 Introduction and Data Models', title: 'Databases, abstraction and the ER model' },
    '02-relational-sql': { path: '3 Relational Query Languages', title: 'Relational algebra and SQL' },
    '03-normalization': { path: '4 Constraints and Normalization', title: 'Functional dependencies and normal forms' },
    '04-query-processing-indexing': { path: '5–6 Query Processing, File Structure and Hashing', title: 'Query processing, indexes and hashing' },
    '05-transactions': { path: '7 Transaction Processing and Concurrency Control', title: 'Transactions, serializability and locking' },
    '06-recovery-advanced': { path: '8–9 Crash Recovery and Advanced Concepts', title: 'Recovery, distributed databases and NoSQL' },
  },
}
