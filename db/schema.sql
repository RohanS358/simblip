-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Enterprise Multi-Tenant Education Platform schema (v3, plain
-- Postgres)
--
-- Runs on ANY hosted or self-hosted PostgreSQL 14+. No Supabase, no RLS, no
-- auth schema: authentication is the app's own /api/auth (scrypt password
-- hashes on simblip_profiles + HS256 JWTs), and tenant isolation is enforced
-- by the /api/pg gateway, which hard-scopes every request to the caller's
-- institution and (for notebooks) to the owning profile.
--
-- Setup:
--   1. createdb simblip && psql simblip -f db/schema.sql
--   2. psql simblip -f db/seed-operator.sql        (platform operator login)
--   3. .env.local:  DATABASE_URL=postgres://…  AUTH_SECRET=<long random>
--                   NEXT_PUBLIC_CLOUD=1
-- Without these the app runs in local demo mode (one seeded institution in
-- the browser) — the cloud is additive, never required for development.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tenants ─────────────────────────────────────────────────────────────────

create table if not exists simblip_institutions (
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
-- One profile per account — the profile IS the auth user (password_hash is
-- scrypt, written only by the provisioning routes; the gateway never lets it
-- cross to a client). `board` is a special role: a dedicated account for one
-- physical classroom display, never a person.

create table if not exists simblip_profiles (
  id             uuid primary key default gen_random_uuid(),
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

-- ── Rooms (physical classrooms) ─────────────────────────────────────────────

create table if not exists simblip_rooms (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  name           text not null,              -- "Room 201"
  department     text,
  created_at     timestamptz not null default now()
);

create table if not exists simblip_room_members (
  room_id    uuid not null references simblip_rooms (id) on delete cascade,
  profile_id uuid not null references simblip_profiles (id) on delete cascade,
  member_role text not null default 'student' check (member_role in ('teacher', 'student')),
  primary key (room_id, profile_id)
);

-- A student belongs to exactly ONE room (teachers are independent and may
-- appear in several).
create unique index if not exists simblip_one_room_per_student
  on simblip_room_members (profile_id) where member_role = 'student';

-- One virtual board per room. The board signs in with its own credentials
-- (a `board`-role profile) and shows a rotating pairing code as a QR.

create table if not exists simblip_boards (
  id               uuid primary key default gen_random_uuid(),
  institution_id   uuid not null references simblip_institutions (id) on delete cascade,
  room_id          uuid not null references simblip_rooms (id) on delete cascade unique,
  profile_id       uuid not null references simblip_profiles (id) on delete cascade,
  pairing_code     text not null,
  pairing_rotated_at timestamptz not null default now()
);

-- A presentation session: teacher scans the QR, picks a page, presses
-- Present. The board edits a TEMPORARY snapshot; the original notebook is
-- only touched if the teacher explicitly merges afterwards.

create table if not exists simblip_board_sessions (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  board_id       uuid not null references simblip_boards (id) on delete cascade,
  teacher_id     uuid not null references simblip_profiles (id) on delete cascade,
  page_id        text not null,              -- teacher's page the snapshot came from
  page_name      text not null,
  snapshot       jsonb not null,             -- content at present-time (frozen)
  edited         jsonb,                      -- board's live working copy
  status         text not null default 'live'
                 check (status in ('live', 'ended', 'merged', 'discarded')),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  remote         jsonb                       -- last remote-control command from the teacher's phone
);

create index if not exists simblip_board_sessions_board_idx
  on simblip_board_sessions (board_id, status);

-- ── Notebooks (per-user workspaces) ─────────────────────────────────────────
-- The offline-first stores sync here. One workspace row per profile; the
-- gateway pins workspace access to its owner.

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

-- ── Sharing (clone-on-share, Google-Classroom-style) ────────────────────────
-- A share is a frozen copy of a page. Recipients import it into their own
-- notebook and own the copy; the sender's original is never exposed.

create table if not exists simblip_shares (
  id                uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references simblip_institutions (id) on delete cascade,
  sender_id         uuid not null references simblip_profiles (id) on delete cascade,
  sender_name       text not null,
  title             text not null,
  content           jsonb not null,           -- PageDoc snapshot
  target_room_id    uuid references simblip_rooms (id) on delete cascade,
  target_profile_id uuid references simblip_profiles (id) on delete cascade,
  created_at        timestamptz not null default now(),
  check (target_room_id is not null or target_profile_id is not null)
);

create index if not exists simblip_shares_room_idx on simblip_shares (target_room_id);
create index if not exists simblip_shares_profile_idx on simblip_shares (target_profile_id);

-- ── Institution Library ─────────────────────────────────────────────────────
-- Reusable teaching assets: simulations, circuit templates, lesson pages…
-- Teachers and admins publish; students browse approved assets read-only.

create table if not exists simblip_library_assets (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  uploader_id    uuid not null references simblip_profiles (id) on delete cascade,
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
  on simblip_library_assets (institution_id, category);

create table if not exists simblip_library_favorites (
  asset_id   uuid not null references simblip_library_assets (id) on delete cascade,
  profile_id uuid not null references simblip_profiles (id) on delete cascade,
  primary key (asset_id, profile_id)
);

-- ── Assignments ─────────────────────────────────────────────────────────────

create table if not exists simblip_assignments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  teacher_id     uuid not null references simblip_profiles (id) on delete cascade,
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

create table if not exists simblip_submissions (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  assignment_id  uuid not null references simblip_assignments (id) on delete cascade,
  student_id     uuid not null references simblip_profiles (id) on delete cascade,
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

create table if not exists simblip_announcements (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  room_id        uuid references simblip_rooms (id) on delete cascade,
  author_id      uuid not null references simblip_profiles (id) on delete cascade,
  author_name    text not null,
  body           text not null,
  created_at     timestamptz not null default now()
);

-- ── Sketch training templates (crowd-sourced) ───────────────────────────────
-- /train examples: normalized point clouds that teach sketch recognition.
-- Deliberately GLOBAL and cross-tenant — anyone's training improves
-- recognition for every user, and no tenant data is exposed (rows are just
-- anonymous symbol shapes + a component id).

create table if not exists simblip_sketch_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  component_id text not null,
  cloud        jsonb not null,              -- 32-point normalized cloud
  strokes      jsonb,                       -- normalized raw strokes
  contributor  text,
  created_at   timestamptz not null default now()
);

-- ── Presentation session files ──────────────────────────────────────────────
-- Documents attached to a presented page, served by /api/files so the board
-- and class followers can render them. Ephemeral by design: the teacher's
-- device deletes them when the presentation resolves, and every upload
-- sweeps rows older than 3 hours.

create table if not exists simblip_session_files (
  path       text primary key,              -- <sessionId>/<objectId>
  mime       text not null default 'application/octet-stream',
  data       bytea not null,
  created_at timestamptz not null default now()
);

-- ── File manifest (Vercel Blob metadata) ────────────────────────────────────
-- Durable storage moved off Postgres bytea (see simblip_session_files above,
-- and docs/deployment-cost-plan.md) to Vercel Blob. This table is the
-- server-side mirror of each device's local manifest (lib/storage/manifest.ts)
-- — "cloud stores metadata first, files second": a second device can list a
-- user's files here and pull bytes from blob_url on demand, without ever
-- routing file bytes through Postgres. NOT a sync queue and NOT a device
-- registry (phase 2+) — just enough server-side truth for cross-device file
-- discovery in sync-by-default mode.

create table if not exists simblip_file_manifest (
  id             text primary key,           -- = client manifest id (lib/storage/manifest-types.ts)
  owner_id       uuid not null references simblip_profiles (id) on delete cascade,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  name           text not null,
  mime           text not null,
  size           bigint not null,
  sha256         text not null,
  blob_url       text,                       -- legacy Vercel Blob URL; unused since the Postgres-backed storage below replaced it
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Existing installs still have blob_url as not-null from before the move
-- off Vercel Blob; harmless no-op on a fresh database.
alter table simblip_file_manifest alter column blob_url drop not null;

create index if not exists simblip_file_manifest_owner_idx
  on simblip_file_manifest (owner_id);

-- File bytes, self-hosted. Moved off Vercel Blob after a concurrency bug
-- (fixed in lib/storage/manager.ts/device-file-sync.ts) let simultaneous
-- device-sync pushes re-upload the same file repeatedly, each creating a
-- new Blob object and blowing a single account's quota. Kept as its own
-- table — NOT in the /api/pg gateway's TABLES map and NOT in
-- CACHEABLE_TABLES — so raw file bytes never transit the generic REST
-- gateway or land in the Redis row cache; only app/api/storage/[id]/route.ts
-- touches this table, via lib/server/pg.ts's q() directly.
create table if not exists simblip_file_blobs (
  id   text primary key references simblip_file_manifest (id) on delete cascade,
  data bytea not null
);

-- Device presence — lets the cloud icon show a user's OTHER currently-open
-- browsers to sync files with (lib/sync/devices.ts). Each device upserts its
-- own row roughly every 60s while the app is open; a row older than a few
-- minutes reads as "offline" and is filtered out client-side (the /api/pg
-- gateway only supports eq./is. filters, not gt., so freshness is judged by
-- the caller, not the query). Not a sync queue — only presence.

create table if not exists simblip_devices (
  id             text primary key,           -- random id, minted once per browser (localStorage)
  owner_id       uuid not null references simblip_profiles (id) on delete cascade,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  label          text not null,              -- "Chrome on Mac", etc — see lib/sync/devices.ts
  last_seen_at   timestamptz not null default now(),
  -- File ids another device has uploaded to Blob (via simblip_file_manifest)
  -- for THIS device to pull, set by the sender right after upload and
  -- cleared by this device once every listed file is confirmed pulled and
  -- deleted from Blob. See lib/sync/device-file-sync.ts.
  pending_pull   jsonb not null default '[]'::jsonb
);

create index if not exists simblip_devices_owner_idx
  on simblip_devices (owner_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Migrating FROM a Supabase deployment (schema v2)?
--   • RLS policies and the auth schema are gone — the /api/pg gateway
--     replaces them; just copy table data across (same shapes).
--   • simblip_profiles.id no longer references auth.users: reuse the same
--     uuids, then set password_hash per account (GoTrue bcrypt hashes are
--     not portable — reset passwords via the admin console).
--   • The `simblip-session` storage bucket becomes simblip_session_files
--     (ephemeral; safe to start empty).
-- ═══════════════════════════════════════════════════════════════════════════
