create table if not exists simblip_institutions (
  id            uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  name          text not null,
  slug          text not null unique,
  logo_url      text,
  accent_color  text,                       
  settings      jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  licensed_until date,
  created_at    timestamptz not null default now()
);
create table if not exists simblip_profiles (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  role           text not null default 'student'
                 check (role in ('super_admin', 'admin', 'teacher', 'student', 'board')),
  full_name      text not null,
  email          text not null unique,
  password_hash  text,
  avatar_url     text,
  department     text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists simblip_profiles_institution_idx
  on simblip_profiles (institution_id);
create table if not exists simblip_rooms (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  name           text not null,              
  department     text,
  created_at     timestamptz not null default now()
);
create table if not exists simblip_room_members (
  room_id    uuid not null references simblip_rooms (id) on delete cascade,
  profile_id uuid not null references simblip_profiles (id) on delete cascade,
  member_role text not null default 'student' check (member_role in ('teacher', 'student')),
  primary key (room_id, profile_id)
);
create unique index if not exists simblip_one_room_per_student
  on simblip_room_members (profile_id) where member_role = 'student';
create table if not exists simblip_boards (
  id               uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id   uuid not null references simblip_institutions (id) on delete cascade,
  room_id          uuid not null references simblip_rooms (id) on delete cascade unique,
  profile_id       uuid not null references simblip_profiles (id) on delete cascade,
  pairing_code     text not null,
  pairing_rotated_at timestamptz not null default now()
);
create table if not exists simblip_board_sessions (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  board_id       uuid not null references simblip_boards (id) on delete cascade,
  teacher_id     uuid not null references simblip_profiles (id) on delete cascade,
  page_id        text not null,              
  page_name      text not null,
  snapshot       jsonb not null,             
  edited         jsonb,                      
  status         text not null default 'live'
                 check (status in ('live', 'ended', 'merged', 'discarded')),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  remote         jsonb                       
);
create index if not exists simblip_board_sessions_board_idx
  on simblip_board_sessions (board_id, status);
create table if not exists simblip_workspaces (
  id             uuid primary key references simblip_profiles (id) on delete cascade,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  notebooks      jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);
create table if not exists simblip_pages (
  id             text primary key,
  workspace_id   uuid not null references simblip_workspaces (id) on delete cascade,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  content        jsonb not null,
  viewport       jsonb,
  updated_at     timestamptz not null default now()
);
create index if not exists simblip_pages_workspace_idx
  on simblip_pages (workspace_id);
create table if not exists simblip_shares (
  id                uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id    uuid not null references simblip_institutions (id) on delete cascade,
  sender_id         uuid not null references simblip_profiles (id) on delete cascade,
  sender_name       text not null,
  title             text not null,
  content           jsonb not null,           
  target_room_id    uuid references simblip_rooms (id) on delete cascade,
  target_profile_id uuid references simblip_profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  check (target_room_id is not null or target_profile_id is not null)
);
create index if not exists simblip_shares_room_idx on simblip_shares (target_room_id);
create index if not exists simblip_shares_profile_idx on simblip_shares (target_profile_id);
create table if not exists simblip_library_assets (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  uploader_id    uuid not null references simblip_profiles (id) on delete cascade,
  uploader_name  text not null,
  title          text not null,
  description    text,
  category       text not null default 'general',
  tags           text[] not null default '{}',
  kind           text not null default 'page' check (kind in ('page', 'objects')),
  content        jsonb not null,            
  approved       boolean not null default false, 
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists simblip_library_institution_idx
  on simblip_library_assets (institution_id, category);
create table if not exists simblip_library_favorites (
  asset_id   uuid not null references simblip_library_assets (id) on delete cascade,
  profile_id uuid not null references simblip_profiles (id) on delete cascade,
  primary key (asset_id, profile_id)
);
create table if not exists simblip_assignments (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  teacher_id     uuid not null references simblip_profiles (id) on delete cascade,
  teacher_name   text not null,
  title          text not null,
  description    text,
  instructions   text,
  content        jsonb not null,            
  room_ids       uuid[] not null default '{}',
  profile_ids    uuid[] not null default '{}', 
  due_at         timestamptz,
  created_at     timestamptz not null default now()
);
create table if not exists simblip_submissions (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  assignment_id  uuid not null references simblip_assignments (id) on delete cascade,
  student_id     uuid not null references simblip_profiles (id) on delete cascade,
  student_name   text not null,
  status         text not null default 'opened'
                 check (status in ('opened', 'in_progress', 'submitted', 'late', 'reviewed')),
  content        jsonb,                      
  feedback       text,
  submitted_at   timestamptz,
  reviewed_at    timestamptz,
  updated_at     timestamptz not null default now(),
  unique (assignment_id, student_id)
);
create table if not exists simblip_announcements (
  id             uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  room_id        uuid references simblip_rooms (id) on delete cascade,
  author_id      uuid not null references simblip_profiles (id) on delete cascade,
  author_name    text not null,
  body           text not null,
  created_at     timestamptz not null default now()
);
create table if not exists simblip_sketch_templates (
  id           uuid primary key default (md5(random()::text || clock_timestamp()::text))::uuid,
  name         text not null,
  component_id text not null,
  cloud        jsonb not null,              
  strokes      jsonb,                       
  contributor  text,
  created_at   timestamptz not null default now()
);
create table if not exists simblip_session_files (
  path       text primary key,              
  mime       text not null default 'application/octet-stream',
  data       bytea not null,
  created_at timestamptz not null default now()
);
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

insert into simblip_institutions (name, slug, accent_color)
select 'SIMBLIP Platform', 'simblip-platform', '#3b82f6'
where not exists (select 1 from simblip_institutions where slug = 'simblip-platform');
insert into simblip_profiles (institution_id, role, full_name, email, password_hash)
select id, 'super_admin', 'SIMBLIP Operator', 'aalubhentakobhi@simblip.dev',
       'scrypt:73696d626c69702d6f70657261746f72:694fdec7a1640752307b47c12f2993a56ea7b99cb974387e88ac343faac927ddaefd8ba4aebc5dbfac9a5360ff9f7bbcf53080fcf5d76421f39a38f09c946c7c'
from simblip_institutions where slug = 'simblip-platform'
on conflict (email) do update
  set role = 'super_admin', active = true,
      institution_id = excluded.institution_id,
      password_hash = coalesce(simblip_profiles.password_hash, excluded.password_hash);
select email, role, active, password_hash is not null as has_password
from simblip_profiles where email = 'aalubhentakobhi@simblip.dev';
