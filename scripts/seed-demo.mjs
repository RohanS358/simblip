#!/usr/bin/env node
// Provision the public demo ("Try it now"): the demo institution, plus a
// licence for every published school-level course so each throwaway student
// sees them with no grant.
//
//   node --env-file=.env.local scripts/seed-demo.mjs            # writes
//   node --env-file=.env.local scripts/seed-demo.mjs --dry-run  # shows the plan
//
// Run AFTER publishing the courses (publish-course.mjs): an allowance
// references the course row. Safe to run twice.

import pg from 'pg'

const dry = process.argv.includes('--dry-run')
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}

const db = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
})
await db.connect()

try {
  const op = await db.query(`select id from simblip_profiles where role = 'super_admin' order by created_at limit 1`)
  if (!op.rows[0]) throw new Error('No super_admin profile to record the licence against.')

  const school = await db.query(`select id, code, title from simblip_courses where subject = 'school' and published order by code`)
  if (!school.rows.length) throw new Error("No published course with subject 'school'. Run publish-course.mjs first.")

  console.log(`Demo institution: simblip-demo`)
  for (const c of school.rows) console.log(`  licence → ${c.code} ${c.title}`)
  if (dry) {
    console.log('\n--dry-run: nothing written.')
  } else {
    await db.query('begin')
    const inst = await db.query(
      `insert into simblip_institutions (name, slug) values ('SIMBLIP Demo', 'simblip-demo')
       on conflict (slug) do update set active = true returning id`
    )
    for (const c of school.rows) {
      await db.query(
        `insert into simblip_course_allowances (course_id, institution_id, all_members, allowed_by)
         values ($1, $2, true, $3)
         on conflict (course_id, institution_id) do update set all_members = true`,
        [c.id, inst.rows[0].id, op.rows[0].id]
      )
    }
    await db.query('commit')
    console.log('\nDone.')
  }
} catch (e) {
  await db.query('rollback').catch(() => {})
  console.error(e.message)
  process.exitCode = 1
} finally {
  await db.end()
}
