-- 004 · indexes behind the /api/pg per-role policy (lib/server/pg-policy.ts).
--
-- HYPOTHESIS, NOT A MEASUREMENT: no Postgres server was available when this was
-- written, so no EXPLAIN was run. These columns are the predicates the new
-- read/write scopes add to requests that the classroom polls every ~4 s, plus
-- foreign keys with ON DELETE CASCADE and no supporting index. Tables are small
-- per tenant, so run EXPLAIN (ANALYZE, BUFFERS) on a production-sized copy and
-- drop any index the planner never picks (004-policy-indexes.down.sql).
--
-- Additive and idempotent. CREATE INDEX (non-concurrent) takes a brief write
-- lock; at this table size that is milliseconds. For a large deployment run
-- each statement separately with CONCURRENTLY.

-- shares / board_sessions read scopes look up "rooms this profile belongs to";
-- the primary key is (room_id, profile_id), which cannot answer profile_id alone
-- (the existing partial unique index only covers students).
create index if not exists simblip_room_members_profile_idx
  on simblip_room_members (profile_id);

-- submissions: student read scope, teacher review scope, cascade from assignments.
create index if not exists simblip_submissions_student_idx
  on simblip_submissions (student_id);
create index if not exists simblip_submissions_assignment_idx
  on simblip_submissions (assignment_id);

-- ownership scopes on write (teacher_id / sender_id) and cascades from profiles.
create index if not exists simblip_assignments_teacher_idx
  on simblip_assignments (teacher_id);
create index if not exists simblip_board_sessions_teacher_idx
  on simblip_board_sessions (teacher_id);
create index if not exists simblip_shares_sender_idx
  on simblip_shares (sender_id);
