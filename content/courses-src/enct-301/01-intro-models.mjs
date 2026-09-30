import { lesson } from '../kit.mjs'
export default ({ dia, q, pr, step, sec, term }) => lesson({
  title: 'Databases, abstraction and the ER model',
  kicker: 'ENCT 301 · Database Management System · Chapters 1–2',
  subtitle: 'Why files were not enough, how a database hides storage details, and how to draw the world before building tables.',
  sections: [
    sec('why', '1.1', 'Why a DBMS', { eyebrow: 'The problem with files',
      body: `<p>Storing data in separate files per application leads to ${term('redundancy')}, ${term('inconsistency')} (two copies disagree), no sharing or concurrent safety, and code tied to file formats. A ${term('DBMS')} keeps data in one place and provides a query language, integrity rules, concurrent access, security and recovery after failure. Applications: banking, airline reservation, universities, web sites.</p>`,
      qs: [q('dbms', 'Which problem of file-based storage does a DBMS mainly solve?', ['Redundant, inconsistent data scattered over application-specific files.', 'One shared, controlled copy replaces many.'], [['Slow CPUs.', 'Unrelated.'], ['Small screens.', 'Unrelated.']])] }),
    sec('abs', '1.2', 'Three levels of abstraction', { eyebrow: 'Hiding complexity',
      body: `<p>The ${term('physical')} level describes how records are stored (files, indexes); the ${term('logical')} level describes what data exists and their relationships (tables); the ${term('view')} level shows each user only the part they need. ${term('Physical data independence')}: change the storage layout without changing the logical schema. ${term('Logical data independence')}: change the schema without rewriting every view or application. A ${term('schema')} is the design; an ${term('instance')} is the data at this moment.</p>`,
      figs: [dia(`direction: down
[View level: what each user sees] as v #blue
[Logical level: tables and relationships] as l #mint
[Physical level: files, indexes, blocks] as p #amber
v -> l : mapped by the DBMS
l -> p : mapped by the DBMS`, 'Each level hides the one below.', { caption: 'three-level architecture' })],
      qs: [q('indep', 'Adding an index without changing any query is an example of…', ['Physical data independence.', 'Only the physical level changed.'], [['Logical data independence.', 'The logical schema is unchanged.'], ['Normalisation.', 'Different topic.']])] }),
    sec('er', '2.1', 'The entity–relationship model', { eyebrow: 'Drawing the world',
      body: `<p>An ${term('entity')} is a distinguishable thing (Student, Course); an entity set is a collection of them. ${term('Attributes')} describe entities; a ${term('key')} attribute uniquely identifies one (studentID); composite, multivalued and derived attributes exist. A ${term('relationship')} associates entities (Student <em>enrols in</em> Course) with a ${term('cardinality')}: one-to-one, one-to-many or many-to-many. A ${term('weak entity')} has no key of its own and depends on an owner (Dependent of Employee).</p>`,
      figs: [dia(`direction: right
{Student | + id : key ; + name} as s
{Course | + code : key ; + title} as c
{Enrolment | + grade} as e
s -> e : 1 .. many
e -> c : many .. 1`, 'A many-to-many relationship becomes a third box with two one-to-many links.', { caption: 'Student – Enrolment – Course' })],
      qs: [q('mn', 'Students enrol in many courses; each course has many students. This relationship is…', ['Many-to-many.', 'Both sides can have many partners.'], [['One-to-many.', 'Only one side has many.'], ['One-to-one.', 'Each side has exactly one.']])] }),
    sec('gen', '2.2', 'Specialisation, generalisation, aggregation', { eyebrow: 'Extended ER',
      body: `<p>${term('Specialisation')} splits an entity set into subclasses (Employee → Teacher, Clerk) which inherit attributes; ${term('generalisation')} is the same idea seen bottom-up. ${term('Aggregation')} treats a relationship as an entity so it can take part in another relationship. Constraints: disjoint vs overlapping, total vs partial participation.</p>`,
      figs: [dia(`direction: down
{Person | + id ; + name} as p
{Student | + roll} as s
{Teacher | + salary} as t
s -> p : is a
t -> p : is a`, 'Subclasses inherit from the superclass.', { caption: 'specialisation' })],
      qs: [q('isa', 'Student “is a” Person. Student inherits…', ['Person’s attributes (id, name).', 'The subclass adds its own (roll).'], [['Nothing.', 'That is what inheritance means.'], ['Only the key.', 'All attributes.']])] }),
    sec('map', '2.3', 'From ER to tables', { eyebrow: 'Mapping rules',
      body: `<p>Each strong entity becomes a table (key = primary key). A one-to-many relationship puts the “one” side’s key into the “many” table as a ${term('foreign key')}. A many-to-many relationship becomes its own table whose primary key is the pair of foreign keys, plus the relationship’s attributes. A weak entity’s table includes the owner’s key in its key.</p>`,
      worked: [step('Student(id, name), Course(code, title) with a many-to-many “enrols with grade”.', '', { toc: 'ER' }), step('Tables: Student(id, name), Course(code, title), Enrolment(id → Student, code → Course, grade), primary key (id, code).', '\\text{Enrolment}(\\underline{id},\\underline{code},grade)', { hero: true, toc: 'Relational schema' })],
      probs: [pr('p1', '<p>A Department has many Employees; each Employee works in exactly one Department. Give the tables.</p>', 'Department(deptNo, name); Employee(empNo, name, <b>deptNo</b> FK → Department). The foreign key sits on the “many” side.')],
      qs: [q('fk', 'In a one-to-many relationship the foreign key goes in the table on the…', ['“Many” side.', 'Each employee row stores which department it belongs to.'], [['“One” side.', 'That would need a list in one cell.'], ['Neither; use a new table always.', 'Only for many-to-many.']])] }),
    sec('keys', '2.4', 'Keys', { eyebrow: 'Identifying rows',
      body: `<p>A ${term('superkey')} is any set of attributes that identifies a row; a ${term('candidate key')} is a minimal superkey; the ${term('primary key')} is the candidate chosen; a ${term('foreign key')} references another table’s key. Entity integrity: a primary key is never null. Referential integrity: a foreign key matches an existing key or is null.</p>`,
      qs: [q('cand', 'A candidate key is…', ['A minimal set of attributes that uniquely identifies rows.', 'No attribute can be removed.'], [['Any unique column.', 'Must also be minimal.'], ['A foreign key.', 'That references another table.']])] }),
  ],
})
