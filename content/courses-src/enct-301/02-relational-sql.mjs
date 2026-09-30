import { lesson } from '../kit.mjs'
export default ({ lab, dia, q, pr, step, sec, term, run }) => {
  const j = run('relalg', { op: 'join' }), lj = run('relalg', { op: 'leftjoin' }), se = run('relalg', { op: 'select', arg: 'salary > 45' }), pj = run('relalg', { op: 'project', arg: 'dept' }), gr = run('relalg', { op: 'group', arg: 'dept:sum(salary)' }), pd = run('relalg', { op: 'product' })
  return lesson({
    title: 'Relational algebra and SQL',
    kicker: 'ENCT 301 · Database Management System · Chapter 3',
    subtitle: 'Tables as sets, operators that build new sets — and SQL as the language that writes them down.',
    sections: [
      sec('rel', '3.1', 'Relations', { eyebrow: 'Data as tables',
        body: `<p>A ${term('relation')} is a table: columns are attributes, rows are tuples, and as a mathematical set it has no duplicate rows and no order. The running example has R(name, dept, salary) — four employees — and S(dept, building) — three departments. Every operator below takes relations and returns a relation.</p>`,
        qs: [q('set', 'Why can a relation not contain two identical rows?', ['Because it is a set of tuples.', 'SQL tables allow duplicates unless DISTINCT or a key forbids them — a difference between theory and practice.'], [['Memory limits.', 'Not the reason.'], ['Rows must be sorted.', 'Sets have no order.']])] }),
      sec('sel', '3.2', 'Select and project', { eyebrow: 'Rows and columns',
        body: `<p>${term('Selection')} σ keeps rows satisfying a condition: σ<sub>salary&gt;45</sub>(R). ${term('Projection')} π keeps chosen columns and drops duplicate rows: π<sub>dept</sub>(R). In SQL: <code>SELECT * FROM R WHERE salary &gt; 45</code> and <code>SELECT DISTINCT dept FROM R</code>. Selection gives <b>${se.rows}</b> rows here; projecting dept gives <b>${pj.rows}</b> (CS appears twice but only once in the set).</p>`,
        figs: [lab('relalg', { op: 'select', arg: 'salary > 45' }, 'Rows that fail the condition are dropped.', ['rows', 'result'], { caption: 'σ salary > 45', name: 'sel' }), lab('relalg', { op: 'project', arg: 'dept' }, 'Duplicates vanish.', ['rows', 'result'], { caption: 'π dept', name: 'proj' })],
        qs: [q('dup', 'Why does π<sub>dept</sub>(R) return 3 rows although R has 4?', ['Duplicate values (CS twice) collapse, because a relation is a set.', 'SQL needs DISTINCT to do the same.'], [['One row failed a condition.', 'No condition in projection.'], ['Projection deletes a department.', 'It only removes duplicates of the projected value.']])] }),
      sec('join', '3.3', 'Joins', { eyebrow: 'Combining tables',
        body: `<p>The ${term('Cartesian product')} R × S pairs every row with every row (${pd.rows} rows here). A ${term('natural join')} R ⋈ S keeps only pairs that agree on the common attribute (dept) and merges the columns: <b>${j.rows}</b> rows (Di’s department ME has no match, so she disappears). A ${term('left outer join')} keeps unmatched left rows, padding with NULL: <b>${lj.rows}</b> rows. SQL: <code>SELECT * FROM R JOIN S ON R.dept = S.dept</code>.</p>`,
        figs: [lab('relalg', { op: 'join' }, 'Green rows in S match the highlighted row of R.', ['rows', 'result'], { caption: 'R ⋈ S', name: 'join' }), lab('relalg', { op: 'leftjoin' }, 'NULL fills the missing building.', ['rows'], { caption: 'left outer join', name: 'lj' })],
        qs: [q('lj', 'Di works in ME, which is not in S. What does the natural join do with her?', ['Drops her row; a left outer join would keep it with NULL.', 'An inner join keeps only matches.'], [['Keeps her with NULLs.', 'That is the left outer join.'], ['Raises an error.', 'Missing matches are normal.']])],
        probs: [pr('p-join', '<p>How many rows does R × S have if R has 4 rows and S has 3?</p>', '4 × 3 = <b>12</b>, matching the product card. The join keeps only those with equal dept: 3.', { verify: lab('relalg', { op: 'product' }, 'All 12 pairs.', ['rows'], { caption: 'answer', name: 'ans' }) })] }),
      sec('set', '3.4', 'Set operations and aggregation', { eyebrow: 'Union, difference, group',
        body: `<p>Union, intersection and difference need union-compatible tables (same columns). ${term('Aggregation')} collapses groups: <code>SELECT dept, SUM(salary) FROM R GROUP BY dept</code> gives <b>${gr.result}</b>. <code>HAVING</code> filters groups after aggregation, <code>WHERE</code> before it. Functions: COUNT, SUM, AVG, MIN, MAX.</p>`,
        figs: [lab('relalg', { op: 'group', arg: 'dept:sum(salary)' }, 'Each group becomes one row.', ['result'], { caption: 'GROUP BY dept', name: 'grp' })],
        qs: [q('having', 'WHERE versus HAVING?', ['WHERE filters rows before grouping; HAVING filters groups after aggregation.', 'You cannot use SUM in WHERE.'], [['They are identical.', 'Different stages.'], ['HAVING filters columns.', 'It filters groups.']])] }),
      sec('sql', '3.5', 'SQL: DDL, DML, views, triggers', { eyebrow: 'The language',
        body: `<p>${term('DDL')} defines structure (CREATE, ALTER, DROP); ${term('DML')} manipulates data (SELECT, INSERT, UPDATE, DELETE); ${term('DCL')} controls access (GRANT, REVOKE). A ${term('view')} is a stored query that behaves like a table; a ${term('trigger')} runs automatically on an event; a stored procedure packages logic on the server. Nested subqueries: <code>SELECT name FROM R WHERE salary &gt; (SELECT AVG(salary) FROM R)</code>.</p>`,
        worked: [step('Average salary in R is (50 + 40 + 60 + 45) / 4.', '\\tfrac{195}{4}=48.75', { toc: 'Average' }), step('Employees above it: Ann (50) and Cy (60).', '', { hero: true, toc: 'Result of the subquery' })],
        qs: [q('ddl', 'CREATE TABLE is part of…', ['DDL.', 'It defines structure, not data.'], [['DML.', 'That is SELECT/INSERT.'], ['DCL.', 'That is GRANT/REVOKE.']])] }),
      sec('summary', '3.6', 'Summary', { eyebrow: 'Recap', body: `<ul><li>σ rows, π columns, × all pairs, ⋈ matching pairs.</li><li>Outer joins keep unmatched rows with NULL.</li><li>GROUP BY aggregates; HAVING filters the groups.</li></ul>` }),
    ],
  })
}
