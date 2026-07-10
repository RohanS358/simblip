-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Institution provisioning script (platform operator only)
--
-- SIMBLIP is enterprise-licensed: institutions cannot self-register. After a
-- contract is finalized, the platform operator runs this script in the
-- Supabase SQL editor (service role) to provision the tenant.
--
-- Workflow:
--   1. Institution contacts the operator → contract finalized.
--   2. Operator edits the values below and runs the script.
--   3. Operator creates auth users (Dashboard → Authentication → Add user,
--      or the Admin API) for the admin, each teacher/student, and one
--      dedicated account per room board.
--   4. Operator inserts the matching simblip_profiles rows (examples below).
--   5. The institution admin signs in and manages everything else in-app.
-- ═══════════════════════════════════════════════════════════════════════════

-- Demo tenant seed for tests / local verification
-- Use this as a reference shape for the one-click login accounts on the login page.
-- The auth users must already exist with these emails/passwords:
--   admin@demo.edu / admin
--   teacher@demo.edu / teacher
--   student@demo.edu / student
--   board-201@demo.edu / board201

-- insert into public.simblip_institutions (name, slug, accent_color, licensed_until)
-- values ('Demo Institution', 'demo', '#3b82f6', '2027-07-01')
-- returning id;

-- insert into public.simblip_profiles (id, institution_id, role, full_name, email)
-- values
--   ('<admin-auth-user-uuid>', '<institution-uuid>', 'admin', 'Demo Admin', 'admin@demo.edu'),
--   ('<teacher-auth-user-uuid>', '<institution-uuid>', 'teacher', 'Demo Teacher', 'teacher@demo.edu'),
--   ('<student-auth-user-uuid>', '<institution-uuid>', 'student', 'Demo Student', 'student@demo.edu'),
--   ('<board-auth-user-uuid>', '<institution-uuid>', 'board', 'Room 201 Board', 'board-201@demo.edu');

-- insert into public.simblip_rooms (institution_id, name)
-- values ('<institution-uuid>', 'Room 201')
-- returning id;

-- insert into public.simblip_boards (institution_id, room_id, profile_id, pairing_code)
-- values ('<institution-uuid>', '<room-uuid>', '<board-auth-user-uuid>', 'BOARD201');

-- 1 ── The tenant ────────────────────────────────────────────────────────────
insert into public.simblip_institutions (name, slug, accent_color, licensed_until)
values ('Aurora Institute of Technology', 'aurora-tech', '#3b82f6', '2027-07-01')
returning id;  -- keep this id for the steps below

-- 2 ── Profiles (after creating the auth users; use their auth.users ids) ────
-- Institution admin:
-- insert into public.simblip_profiles (id, institution_id, role, full_name, email)
-- values ('<auth-user-uuid>', '<institution-uuid>', 'admin', 'Prof. Ada Sharma', 'admin@aurora.edu');

-- Teacher / student examples:
-- insert into public.simblip_profiles (id, institution_id, role, full_name, email)
-- values ('<auth-user-uuid>', '<institution-uuid>', 'teacher', 'Dr. Elena Vasquez', 'e.vasquez@aurora.edu'),
--        ('<auth-user-uuid>', '<institution-uuid>', 'student', 'Alex Kumar', 'a.kumar@aurora.edu');

-- 3 ── A room with a virtual board ──────────────────────────────────────────
-- Each physical classroom gets a room row, a dedicated `board`-role auth user
-- (e.g. board-201@aurora.edu), and a boards row wiring them together:
--
-- insert into public.simblip_rooms (institution_id, name) values ('<institution-uuid>', 'Room 201') returning id;
-- insert into public.simblip_profiles (id, institution_id, role, full_name, email)
-- values ('<board-auth-uuid>', '<institution-uuid>', 'board', 'Room 201 Board', 'board-201@aurora.edu');
-- insert into public.simblip_boards (institution_id, room_id, profile_id, pairing_code)
-- values ('<institution-uuid>', '<room-uuid>', '<board-auth-uuid>', upper(substr(md5(random()::text), 1, 6)));

-- 4 ── Deactivating a tenant (license lapse) ────────────────────────────────
-- update public.simblip_institutions set active = false where slug = 'aurora-tech';
