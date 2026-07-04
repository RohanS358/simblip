# SIMBLIP — Persistence & Database

## Today: local-first

All state persists to `localStorage` through Zustand `persist` middleware. Why first:
- the entire document model gets exercised and stabilized before a schema migration matters,
- zero-latency autosave (every mutation is persisted),
- the app works offline from day one.

## The adapter seam

Stores never call `localStorage` directly; they use a storage adapter with the Supabase-shaped
interface. Swapping to Supabase = implementing the same adapter with server actions + optimistic
updates. Document shape is already normalized for it.

## Supabase schema (target)

```sql
users        (id uuid pk, email, display_name, created_at)
notebooks    (id uuid pk, user_id fk, name, emoji, position, created_at, updated_at)
sections     (id uuid pk, notebook_id fk, name, color, position)
pages        (id uuid pk, section_id fk, name, position, created_at, updated_at)
objects      (id uuid pk, page_id fk, type text, x, y, w, h, rotation, z,
              parameters jsonb, connections jsonb, metadata jsonb, updated_at)
variables    (id uuid pk, page_id fk, name, expr, position)
graphs       -- graphs are objects (type='graph'); no separate table. WHY: one scene-graph shape.
history      (id uuid pk, page_id fk, snapshot jsonb, created_at)  -- coarse checkpoints
ai_chats     (id uuid pk, page_id fk, role, content, payload jsonb, created_at)
```

- `parameters/metadata` are `jsonb`: object schemas evolve per module; columns would ossify them.
- RLS: every table row is reachable only through `user_id` (notebooks) and cascading FKs.
- Autosave: debounced per-object upserts (300 ms) + page-level `updated_at` touch.
- Realtime (later): Supabase channel per page for multiplayer cursors — the normalized object
  table makes row-level broadcast natural.

## Migration plan

1. Auth (Supabase Auth, email + OAuth).
2. `lib/persistence/supabase.ts` implementing the adapter.
3. One-time import: local document → user's first notebook.
