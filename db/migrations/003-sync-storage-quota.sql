-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Unified sync revisions + 150 MB per-project cloud quota
--
-- A "project" is one account's cloud workspace: its notebook tree
-- (simblip_workspaces), page content (simblip_pages), account-level small
-- data such as the calendar (simblip_user_kv) and opted-in file bytes
-- (simblip_file_blobs). Everything counted against the quota carries a
-- server-computed `size_bytes`, so usage is one indexed SUM per table and
-- never trusts a client-reported size. See lib/server/quota.ts.
--
-- `rev` is a per-row revision the server bumps on every write. Clients send
-- the rev their edit was based on; a stale base is a conflict the client
-- resolves without losing either side (app/api/sync/route.ts).
--
--   psql "$DATABASE_URL" -f db/migrations/003-sync-storage-quota.sql
--   rollback: psql "$DATABASE_URL" -f db/migrations/003-sync-storage-quota.down.sql
--
-- Safe to run twice. Backfills sizes for existing rows.
-- ═══════════════════════════════════════════════════════════════════════════

alter table simblip_workspaces add column if not exists rev bigint not null default 0;
alter table simblip_workspaces add column if not exists size_bytes bigint not null default 0;

alter table simblip_pages add column if not exists rev bigint not null default 0;
alter table simblip_pages add column if not exists size_bytes bigint not null default 0;

alter table simblip_file_blobs add column if not exists size_bytes bigint not null default 0;

-- Account-level small data that isn't a page: calendar events, to-dos,
-- sticky notes. One row per (owner, key); `value` is small JSON.
create table if not exists simblip_user_kv (
  owner_id       uuid not null references simblip_profiles (id) on delete cascade,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  key            text not null check (length(key) between 1 and 100),
  value          jsonb not null,
  rev            bigint not null default 0,
  size_bytes     bigint not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (owner_id, key)
);

-- Incremental pulls filter on (workspace, updated_at); dedup looks up
-- (owner, sha256).
create index if not exists simblip_pages_workspace_updated_idx
  on simblip_pages (workspace_id, updated_at);
create index if not exists simblip_file_manifest_owner_sha_idx
  on simblip_file_manifest (owner_id, sha256);

-- Backfill. octet_length(jsonb::text) matches what the server measures for
-- new writes (UTF-8 bytes of the JSON text) closely enough for accounting.
update simblip_workspaces set size_bytes = octet_length(notebooks::text) where size_bytes = 0;
update simblip_pages      set size_bytes = octet_length(content::text) + coalesce(octet_length(viewport::text), 0)
 where size_bytes = 0;
update simblip_file_blobs set size_bytes = octet_length(data) where size_bytes = 0;
