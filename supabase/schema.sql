-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Enterprise Multi-Tenant Education Platform schema (v2)
--
-- The Institution is the top-level tenant. Every row belongs to exactly one
-- institution and RLS enforces that no data crosses tenant boundaries.
--
-- Provisioning is NOT self-service: institutions and their admin accounts are
-- created by the SIMBLIP platform operator with the service role key (see
-- supabase/provision.sql). There is no public sign-up path.
--
-- Run this once in the Supabase SQL editor, then set
-- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
-- Without those keys the app runs in local demo mode (one seeded institution
-- in the browser) — the cloud is additive, never required for development.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tenants ─────────────────────────────────────────────────────────────────

create table if not exists public.simblip_institutions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  logo_url      text,
  accent_color  text,                       -- CSS color used to brand the shell
  settings      jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  licensed_until date,
  created_at    timestamptz not null default now()
);

-- ── People ──────────────────────────────────────────────────────────────────
-- One profile per auth user. `board` is a special role: a dedicated account
-- for one physical classroom display, never a person.

do $$ begin
  create type simblip_role as enum ('super_admin', 'admin', 'teacher', 'student', 'board');
exception when duplicate_object then null; end $$;

create table if not exists public.simblip_profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  role           simblip_role not null default 'student',
  full_name      text not null,
  email          text not null,
  avatar_url     text,
  department     text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists simblip_profiles_institution_idx
  on public.simblip_profiles (institution_id);

-- ── Rooms (physical classrooms) ─────────────────────────────────────────────

create table if not exists public.simblip_rooms (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  name           text not null,              -- "Room 201"
  department     text,
  created_at     timestamptz not null default now()
);

create table if not exists public.simblip_room_members (
  room_id    uuid not null references public.simblip_rooms (id) on delete cascade,
  profile_id uuid not null references public.simblip_profiles (id) on delete cascade,
  member_role text not null default 'student' check (member_role in ('teacher', 'student')),
  primary key (room_id, profile_id)
);

-- One virtual board per room. The board signs in with its own credentials
-- (a `board`-role profile) and shows a rotating pairing code as a QR.

create table if not exists public.simblip_boards (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid not null references public.simblip_institutions (id) on delete cascade,
  room_id          uuid not null references public.simblip_rooms (id) on delete cascade unique,
  profile_id       uuid not null references public.simblip_profiles (id) on delete cascade,
  pairing_code     text not null,
  pairing_rotated_at timestamptz not null default now()
);

-- A presentation session: teacher scans the QR, picks a page, presses
-- Present. The board edits a TEMPORARY snapshot; the original notebook is
-- only touched if the teacher explicitly merges afterwards.

create table if not exists public.simblip_board_sessions (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  board_id       uuid not null references public.simblip_boards (id) on delete cascade,
  teacher_id     uuid not null references public.simblip_profiles (id) on delete cascade,
  page_id        text not null,              -- teacher's page the snapshot came from
  page_name      text not null,
  snapshot       jsonb not null,             -- content at present-time (frozen)
  edited         jsonb,                      -- board's live working copy
  status         text not null default 'live'
                 check (status in ('live', 'ended', 'merged', 'discarded')),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz
);

create index if not exists simblip_board_sessions_board_idx
  on public.simblip_board_sessions (board_id, status);

-- ── Notebooks (per-user workspaces) ─────────────────────────────────────────
-- The offline-first stores sync here. One workspace row per profile.

create table if not exists public.simblip_workspaces (
  id             uuid primary key references public.simblip_profiles (id) on delete cascade,
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  notebooks      jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

create table if not exists public.simblip_pages (
  id             text primary key,
  workspace_id   uuid not null references public.simblip_workspaces (id) on delete cascade,
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  content        jsonb not null,
  viewport       jsonb,
  updated_at     timestamptz not null default now()
);

create index if not exists simblip_pages_workspace_idx
  on public.simblip_pages (workspace_id);

alter table if exists public.simblip_workspaces
  alter column id type uuid using id::uuid;

alter table if exists public.simblip_pages
  alter column workspace_id type uuid using workspace_id::uuid;

-- ── Sharing (clone-on-share, Google-Classroom-style) ────────────────────────
-- A share is a frozen copy of a page. Recipients import it into their own
-- notebook and own the copy; the sender's original is never exposed.

create table if not exists public.simblip_shares (
  id                uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references public.simblip_institutions (id) on delete cascade,
  sender_id         uuid not null references public.simblip_profiles (id) on delete cascade,
  sender_name       text not null,
  title             text not null,
  content           jsonb not null,           -- PageDoc snapshot
  target_room_id    uuid references public.simblip_rooms (id) on delete cascade,
  target_profile_id uuid references public.simblip_profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  check (target_room_id is not null or target_profile_id is not null)
);

create index if not exists simblip_shares_room_idx on public.simblip_shares (target_room_id);
create index if not exists simblip_shares_profile_idx on public.simblip_shares (target_profile_id);

-- ── Institution Library ─────────────────────────────────────────────────────
-- Reusable teaching assets: simulations, circuit templates, lesson pages…
-- Teachers and admins publish; students browse approved assets read-only.

create table if not exists public.simblip_library_assets (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  uploader_id    uuid not null references public.simblip_profiles (id) on delete cascade,
  uploader_name  text not null,
  title          text not null,
  description    text,
  category       text not null default 'general',
  tags           text[] not null default '{}',
  kind           text not null default 'page' check (kind in ('page', 'objects')),
  content        jsonb not null,            -- PageDoc (kind=page) or SceneObject[] (kind=objects)
  approved       boolean not null default false, -- admin gate for student visibility
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists simblip_library_institution_idx
  on public.simblip_library_assets (institution_id, category);

create table if not exists public.simblip_library_favorites (
  asset_id   uuid not null references public.simblip_library_assets (id) on delete cascade,
  profile_id uuid not null references public.simblip_profiles (id) on delete cascade,
  primary key (asset_id, profile_id)
);

-- ── Assignments ─────────────────────────────────────────────────────────────

create table if not exists public.simblip_assignments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  teacher_id     uuid not null references public.simblip_profiles (id) on delete cascade,
  teacher_name   text not null,
  title          text not null,
  description    text,
  instructions   text,
  content        jsonb not null,            -- starter PageDoc cloned to each student
  room_ids       uuid[] not null default '{}',
  profile_ids    uuid[] not null default '{}', -- individual targets
  due_at         timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.simblip_submissions (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  assignment_id  uuid not null references public.simblip_assignments (id) on delete cascade,
  student_id     uuid not null references public.simblip_profiles (id) on delete cascade,
  student_name   text not null,
  status         text not null default 'opened'
                 check (status in ('opened', 'in_progress', 'submitted', 'late', 'reviewed')),
  content        jsonb,                      -- student's PageDoc at submission
  feedback       text,
  submitted_at   timestamptz,
  reviewed_at    timestamptz,
  updated_at     timestamptz not null default now(),
  unique (assignment_id, student_id)
);

-- ── Announcements ───────────────────────────────────────────────────────────

create table if not exists public.simblip_announcements (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.simblip_institutions (id) on delete cascade,
  room_id        uuid references public.simblip_rooms (id) on delete cascade,
  author_id      uuid not null references public.simblip_profiles (id) on delete cascade,
  author_name    text not null,
  body           text not null,
  created_at     timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security — institution isolation + role checks
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.simblip_current_institution()
returns uuid language sql stable security definer set search_path = public as $$
  select institution_id from public.simblip_profiles where id = auth.uid()
$$;

create or replace function public.simblip_current_role()
returns simblip_role language sql stable security definer set search_path = public as $$
  select role from public.simblip_profiles where id = auth.uid()
$$;

alter table public.simblip_institutions      enable row level security;
alter table public.simblip_profiles          enable row level security;
alter table public.simblip_rooms             enable row level security;
alter table public.simblip_room_members      enable row level security;
alter table public.simblip_boards            enable row level security;
alter table public.simblip_board_sessions    enable row level security;
alter table public.simblip_workspaces        enable row level security;
alter table public.simblip_pages             enable row level security;
alter table public.simblip_shares            enable row level security;
alter table public.simblip_library_assets    enable row level security;
alter table public.simblip_library_favorites enable row level security;
alter table public.simblip_assignments       enable row level security;
alter table public.simblip_submissions       enable row level security;
alter table public.simblip_announcements     enable row level security;

-- Members can read their own institution row; only the service role writes it.
drop policy if exists "institution read" on public.simblip_institutions;
create policy "institution read" on public.simblip_institutions
  for select using (id = public.simblip_current_institution());

-- Profiles: visible within the institution; admins manage them.
drop policy if exists "profiles read" on public.simblip_profiles;
create policy "profiles read" on public.simblip_profiles
  for select using (institution_id = public.simblip_current_institution());
drop policy if exists "profiles admin write" on public.simblip_profiles;
create policy "profiles admin write" on public.simblip_profiles
  for update using (
    institution_id = public.simblip_current_institution()
    and (public.simblip_current_role() = 'admin' or id = auth.uid())
  );

-- Rooms & membership: read for everyone in the institution, write for admins.
drop policy if exists "rooms read" on public.simblip_rooms;
create policy "rooms read" on public.simblip_rooms
  for select using (institution_id = public.simblip_current_institution());
drop policy if exists "rooms admin all" on public.simblip_rooms;
create policy "rooms admin all" on public.simblip_rooms
  for all using (
    institution_id = public.simblip_current_institution()
    and public.simblip_current_role() = 'admin'
  );

drop policy if exists "room members read" on public.simblip_room_members;
create policy "room members read" on public.simblip_room_members
  for select using (
    room_id in (select id from public.simblip_rooms
                where institution_id = public.simblip_current_institution())
  );
drop policy if exists "room members admin all" on public.simblip_room_members;
create policy "room members admin all" on public.simblip_room_members
  for all using (
    public.simblip_current_role() = 'admin'
    and room_id in (select id from public.simblip_rooms
                    where institution_id = public.simblip_current_institution())
  );

-- Boards: institution read (the pairing page must resolve codes); admin write;
-- the board itself may rotate its pairing code.
drop policy if exists "boards read" on public.simblip_boards;
create policy "boards read" on public.simblip_boards
  for select using (institution_id = public.simblip_current_institution());
drop policy if exists "boards admin all" on public.simblip_boards;
create policy "boards admin all" on public.simblip_boards
  for all using (
    institution_id = public.simblip_current_institution()
    and public.simblip_current_role() = 'admin'
  );
drop policy if exists "boards self rotate" on public.simblip_boards;
create policy "boards self rotate" on public.simblip_boards
  for update using (profile_id = auth.uid());

-- Board sessions: teacher creates; the board account and the owning teacher
-- read and update (board writes `edited`, teacher decides merge/discard).
drop policy if exists "board sessions rw" on public.simblip_board_sessions;
create policy "board sessions rw" on public.simblip_board_sessions
  for all using (
    institution_id = public.simblip_current_institution()
    and (
      teacher_id = auth.uid()
      or board_id in (select id from public.simblip_boards where profile_id = auth.uid())
    )
  )
  with check (institution_id = public.simblip_current_institution());

-- Workspaces & pages: strictly private to their owner.
drop policy if exists "workspace owner" on public.simblip_workspaces;
create policy "workspace owner" on public.simblip_workspaces
  for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "pages owner" on public.simblip_pages;
create policy "pages owner" on public.simblip_pages
  for all using (workspace_id = auth.uid()) with check (workspace_id = auth.uid());

-- Shares: teachers/admins create; recipients (direct or via room) read.
drop policy if exists "shares create" on public.simblip_shares;
create policy "shares create" on public.simblip_shares
  for insert with check (
    institution_id = public.simblip_current_institution()
    and sender_id = auth.uid()
    and public.simblip_current_role() in ('admin', 'teacher')
  );
drop policy if exists "shares read" on public.simblip_shares;
create policy "shares read" on public.simblip_shares
  for select using (
    institution_id = public.simblip_current_institution()
    and (
      sender_id = auth.uid()
      or target_profile_id = auth.uid()
      or target_room_id in (select room_id from public.simblip_room_members
                            where profile_id = auth.uid())
    )
  );
drop policy if exists "shares delete own" on public.simblip_shares;
create policy "shares delete own" on public.simblip_shares
  for delete using (sender_id = auth.uid());

-- Library: teachers/admins publish and edit their own; students see approved.
drop policy if exists "library read" on public.simblip_library_assets;
create policy "library read" on public.simblip_library_assets
  for select using (
    institution_id = public.simblip_current_institution()
    and (approved or public.simblip_current_role() in ('admin', 'teacher', 'board'))
  );
drop policy if exists "library publish" on public.simblip_library_assets;
create policy "library publish" on public.simblip_library_assets
  for insert with check (
    institution_id = public.simblip_current_institution()
    and uploader_id = auth.uid()
    and public.simblip_current_role() in ('admin', 'teacher')
  );
drop policy if exists "library manage" on public.simblip_library_assets;
create policy "library manage" on public.simblip_library_assets
  for update using (
    institution_id = public.simblip_current_institution()
    and (uploader_id = auth.uid() or public.simblip_current_role() = 'admin')
  );
drop policy if exists "library remove" on public.simblip_library_assets;
create policy "library remove" on public.simblip_library_assets
  for delete using (
    institution_id = public.simblip_current_institution()
    and (uploader_id = auth.uid() or public.simblip_current_role() = 'admin')
  );

drop policy if exists "favorites own" on public.simblip_library_favorites;
create policy "favorites own" on public.simblip_library_favorites
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Assignments: teachers create/manage their own; targeted students read.
drop policy if exists "assignments teacher" on public.simblip_assignments;
create policy "assignments teacher" on public.simblip_assignments
  for all using (teacher_id = auth.uid())
  with check (
    institution_id = public.simblip_current_institution()
    and public.simblip_current_role() in ('admin', 'teacher')
  );
drop policy if exists "assignments student read" on public.simblip_assignments;
create policy "assignments student read" on public.simblip_assignments
  for select using (
    institution_id = public.simblip_current_institution()
    and (
      auth.uid() = any (profile_ids)
      or exists (select 1 from public.simblip_room_members m
                 where m.profile_id = auth.uid() and m.room_id = any (room_ids))
    )
  );

-- Submissions: the student owns theirs; the assignment's teacher reviews.
drop policy if exists "submissions student" on public.simblip_submissions;
create policy "submissions student" on public.simblip_submissions
  for all using (student_id = auth.uid())
  with check (student_id = auth.uid()
              and institution_id = public.simblip_current_institution());
drop policy if exists "submissions teacher" on public.simblip_submissions;
create policy "submissions teacher" on public.simblip_submissions
  for all using (
    assignment_id in (select id from public.simblip_assignments where teacher_id = auth.uid())
  );

-- Announcements: staff post; room members (or everyone, when room is null) read.
drop policy if exists "announcements write" on public.simblip_announcements;
create policy "announcements write" on public.simblip_announcements
  for all using (author_id = auth.uid())
  with check (
    institution_id = public.simblip_current_institution()
    and public.simblip_current_role() in ('admin', 'teacher')
  );
drop policy if exists "announcements read" on public.simblip_announcements;
create policy "announcements read" on public.simblip_announcements
  for select using (
    institution_id = public.simblip_current_institution()
    and (
      room_id is null
      or room_id in (select room_id from public.simblip_room_members
                     where profile_id = auth.uid())
    )
  );
