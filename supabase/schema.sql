-- SIMBLIP cloud sync schema — per-user, Supabase email auth.
--
-- Setup (no external OAuth provider needed):
--   1. Run this file in the Supabase SQL editor (re-runnable).
--   2. Email auth is enabled by default. Optional: Dashboard →
--      Authentication → Sign In / Up → disable "Confirm email" so accounts
--      work instantly without a confirmation mail.
--   3. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
--
-- Model: the workspace row id IS the auth user id, so RLS reduces to
-- "you can only touch rows whose id is yours".

create table if not exists public.simblip_workspaces (
  id text primary key,
  notebooks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.simblip_pages (
  id text primary key,
  workspace_id text not null references public.simblip_workspaces (id) on delete cascade,
  content jsonb not null,
  viewport jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists simblip_pages_workspace_idx
  on public.simblip_pages (workspace_id);

alter table public.simblip_workspaces enable row level security;
alter table public.simblip_pages enable row level security;

-- Drop the pre-auth permissive policies if they exist.
drop policy if exists "simblip anon workspaces" on public.simblip_workspaces;
drop policy if exists "simblip anon pages" on public.simblip_pages;
drop policy if exists "simblip own workspace" on public.simblip_workspaces;
drop policy if exists "simblip own pages" on public.simblip_pages;

create policy "simblip own workspace" on public.simblip_workspaces
  for all to authenticated
  using (id = (select auth.uid())::text)
  with check (id = (select auth.uid())::text);

create policy "simblip own pages" on public.simblip_pages
  for all to authenticated
  using (workspace_id = (select auth.uid())::text)
  with check (workspace_id = (select auth.uid())::text);
