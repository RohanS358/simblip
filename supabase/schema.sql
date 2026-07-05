-- SIMBLIP cloud sync schema.
-- Run this once in the Supabase SQL editor, then set
-- NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.

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

-- v1 has no auth: each browser mints an unguessable workspace id and all
-- access goes through the anon key. RLS is enabled with permissive policies
-- so flipping to per-user auth later is only a policy change:
--   using (auth.uid()::text = workspace_id)
alter table public.simblip_workspaces enable row level security;
alter table public.simblip_pages enable row level security;

drop policy if exists "simblip anon workspaces" on public.simblip_workspaces;
create policy "simblip anon workspaces" on public.simblip_workspaces
  for all using (true) with check (true);

drop policy if exists "simblip anon pages" on public.simblip_pages;
create policy "simblip anon pages" on public.simblip_pages
  for all using (true) with check (true);
