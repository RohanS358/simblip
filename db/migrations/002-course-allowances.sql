-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Course allowances (which institutions a course is licensed to)
--
-- Course Mode shipped with two tiers: dev publishes a course, an institution's
-- admin grants it to a room or a profile. There was no tier above that — so a
-- course published once was grantable by EVERY institution's admin, and
-- nothing central decided which institutions may use which course.
--
-- This adds that tier. An allowance is a course × institution licence, set by
-- the platform operator at /dev:
--
--   allowance only        → the institution's admins may grant it internally
--   allowance + all_members → everyone in the institution gets it, no grant needed
--
--   psql "$DATABASE_URL" -f db/migrations/002-course-allowances.sql
--
-- Safe to run twice. Nothing here touches existing grants.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists simblip_course_allowances (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  course_id      text not null references simblip_courses (id) on delete cascade,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  -- The whole institution, rather than a licence its admins hand out. Set for
  -- a course everyone there should simply have (a first-year core subject);
  -- left false for one an admin should aim at particular classes.
  all_members    boolean not null default false,
  allowed_by     uuid not null references simblip_profiles (id) on delete cascade,
  allowed_at     timestamptz not null default now()
);

create unique index if not exists simblip_course_allowances_uniq
  on simblip_course_allowances (course_id, institution_id);
create index if not exists simblip_course_allowances_inst_idx
  on simblip_course_allowances (institution_id);

-- Verify:
--   select c.code, i.name, a.all_members
--     from simblip_course_allowances a
--     join simblip_courses c on c.id = a.course_id
--     join simblip_institutions i on i.id = a.institution_id
--    order by c.code;
