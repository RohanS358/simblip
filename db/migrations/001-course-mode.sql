-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Course Mode migration
--
-- Adds the three tables Course Mode needs (docs/course-mode.md). Safe to run
-- against an existing database and safe to run twice: every statement is
-- `if not exists`, and nothing here touches or migrates existing data.
--
--   psql "$DATABASE_URL" -f db/migrations/001-course-mode.sql
--
-- Already included in db/schema.sql (fresh installs) and db/execute.sql — this
-- file exists so a LIVE deployment can be upgraded without replaying either.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Course Mode (docs/course-mode.md) ───────────────────────────────────────
create table if not exists simblip_courses (
  id          text primary key,
  code        text not null,
  title       text not null,
  subject     text not null default 'general',
  semester    integer,
  description text,
  version     integer not null default 1,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists simblip_courses_semester_idx on simblip_courses (semester, code);

create table if not exists simblip_course_lessons (
  id         text primary key,
  course_id  text not null references simblip_courses (id) on delete cascade,
  path       text not null default '',
  title      text not null,
  ord        integer not null default 0,
  doc        jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists simblip_course_lessons_course_idx
  on simblip_course_lessons (course_id, path, ord);

create table if not exists simblip_course_grants (
  id                uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  course_id         text not null references simblip_courses (id) on delete cascade,
  institution_id    uuid not null references simblip_institutions (id) on delete cascade,
  target_room_id    uuid references simblip_rooms (id) on delete cascade,
  target_profile_id uuid references simblip_profiles (id) on delete cascade,
  granted_by        uuid not null references simblip_profiles (id) on delete cascade,
  granted_at        timestamptz not null default now(),
  check (target_room_id is not null or target_profile_id is not null)
);
create index if not exists simblip_course_grants_room_idx on simblip_course_grants (target_room_id);
create index if not exists simblip_course_grants_profile_idx on simblip_course_grants (target_profile_id);
create index if not exists simblip_course_grants_inst_idx on simblip_course_grants (institution_id, course_id);
create unique index if not exists simblip_course_grants_room_uniq
  on simblip_course_grants (course_id, target_room_id) where target_room_id is not null;
create unique index if not exists simblip_course_grants_profile_uniq
  on simblip_course_grants (course_id, target_profile_id) where target_profile_id is not null;

-- Verify:
--   select table_name from information_schema.tables
--    where table_name like 'simblip_course%' order by 1;
-- Expect: simblip_course_grants, simblip_course_lessons, simblip_courses
