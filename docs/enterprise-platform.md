# SIMBLIP — Enterprise Multi-Tenant Education Platform

SIMBLIP is no longer an individual notebook app. It is an **enterprise
engineering education platform** licensed to universities, colleges and
schools. The **Institution is the top-level tenant**: every user, room,
board, notebook, share, library asset, assignment and announcement belongs to
exactly one institution, and no data crosses tenant boundaries.

The simulation workspace remains the heart of the product; notebooks are the
medium through which engineering ideas are created, shared, taught and
explored.

## Enterprise-first provisioning

There is **no public sign-up**. The onboarding flow is operator-controlled:

1. Institution contacts the SIMBLIP operator (see the landing page licensing CTA).
2. Contract finalized.
3. Operator provisions the tenant (`supabase/provision.sql`, service role).
4. The institution admin account is created; branding is configured.
5. The admin invites teachers/students and creates rooms + boards in-app.

## Two backends, one code path

| | cloud | local (demo/dev) |
|---|---|---|
| Trigger | `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY` set | keys absent |
| Auth | Supabase GoTrue (password grant over fetch, refresh tokens) | seeded demo accounts (`lib/auth/demo.ts`) |
| Data | PostgREST over fetch, RLS-enforced (`supabase/schema.sql`) | localStorage tables + BroadcastChannel live events |
| Live updates | 4 s polling while subscribed | instant cross-tab broadcast |

Everything goes through `lib/data/db.ts` (list/insert/update/remove/subscribe),
so the entire feature set works **end-to-end in one browser with zero infra**
— sign in as admin, teacher, student and a room board in different tabs.

Demo accounts: `admin@demo.edu`/`admin`, `teacher@demo.edu`/`teacher`,
`student@demo.edu`/`student`, `board-201@demo.edu`/`board201`.

## Roles (RBAC — `lib/auth/types.ts`)

- **Platform super admin** (reserved): provisions tenants; never appears in tenant UI.
- **Institution admin**: people, rooms, boards, library approval, announcements, branding.
- **Teacher**: notebooks, simulations, AI, library publishing, sharing, assignments, board presenting.
- **Student**: personal notebooks, manual simulation, assignments, approved library — **no AI,
  no library publishing, no sharing**. Students build systems themselves.
- **Board**: a dedicated account per classroom display; presentation surface only.

Authentication is mandatory — every surface sits behind `RequireAuth`, and each
account on a device gets isolated notebook storage (`lib/store/scoped-storage.ts`).
Note: in local demo mode the `/api/ai` route is only gated client-side.

## The flagship flows

**Virtual classroom boards** (`/board`, `/present`): the board stays signed in
and always shows a rotating pairing QR bottom-left. Teacher scans → picks
notebook/section/page → Present. The board loads a **temporary copy**; its
edits stream into `board_sessions.edited`. On end, the teacher chooses
**Merge** (changes flow back into their page) or **Discard** — the original
teaching material is never edited live. Pairing codes rotate after every
session.

**Clone-on-share** (`lib/data/shares.ts`): sharing never exposes the original.
Recipients (a person or everyone in a room) automatically receive an owned
copy in their "Shared with me" notebook — Google-Classroom-materials
semantics, not collaborative docs.

**Assignments** (`/assignments`): teacher freezes a page as the starter and
targets rooms; students pull a working copy into their notebook and submit
from the dashboard, which tracks assigned → opened → in progress → submitted
→ late → reviewed live, with feedback.

**Institution library** (workspace right panel): teachers/admins publish pages
or object selections with categories/tags/favorites; admins approve assets
for student visibility; insertion always clones.

## Shell

Desktop-grade workspace: top bar (institution branding, breadcrumb, global
search), command palette (Ctrl/⌘ K), notification center (shares, assignments,
submissions, announcements), profile menu, settings dialog, status bar, and
right-click context menus across the notebook tree (rename / duplicate /
share / assign / present / add-to-library / export / delete).
