-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — Institution provisioning (platform operator only)
--
-- SIMBLIP is enterprise-licensed: institutions cannot self-register. The
-- RECOMMENDED path is the in-app /dev console (sign in as the operator —
-- see seed-operator.sql), which provisions tenants, admins, rooms, and
-- boards through /api/dev/provision with proper password hashing.
--
-- This script is the raw-SQL fallback for the same workflow. Password
-- hashes are scrypt strings; compute one with:
--   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');
--            console.log('scrypt:'+s+':'+c.scryptSync('PASSWORD',s,64).toString('hex'))"
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 ── The tenant ────────────────────────────────────────────────────────────
insert into simblip_institutions (name, slug, accent_color, licensed_until)
values ('Aurora Institute of Technology', 'aurora-tech', '#3b82f6', '2027-07-01')
returning id;  -- keep this id for the steps below

-- 2 ── Profiles (password_hash from the node one-liner above) ────────────────
-- Institution admin:
-- insert into simblip_profiles (institution_id, role, full_name, email, password_hash)
-- values ('<institution-uuid>', 'admin', 'Prof. Ada Sharma', 'admin@aurora.edu', 'scrypt:…');

-- Teacher / student examples:
-- insert into simblip_profiles (institution_id, role, full_name, email, password_hash)
-- values ('<institution-uuid>', 'teacher', 'Dr. Elena Vasquez', 'e.vasquez@aurora.edu', 'scrypt:…'),
--        ('<institution-uuid>', 'student', 'Alex Kumar', 'a.kumar@aurora.edu', 'scrypt:…');

-- 3 ── A room with a virtual board ──────────────────────────────────────────
-- Each physical classroom gets a room row, a dedicated `board`-role profile
-- (e.g. board-201@aurora.edu), and a boards row wiring them together:
--
-- insert into simblip_rooms (institution_id, name) values ('<institution-uuid>', 'Room 201') returning id;
-- insert into simblip_profiles (institution_id, role, full_name, email, password_hash)
-- values ('<institution-uuid>', 'board', 'Room 201 Board', 'board-201@aurora.edu', 'scrypt:…')
-- returning id;
-- insert into simblip_boards (institution_id, room_id, profile_id, pairing_code)
-- values ('<institution-uuid>', '<room-uuid>', '<board-profile-uuid>', upper(substr(md5(random()::text), 1, 6)));

-- 4 ── Deactivating a tenant (license lapse) ────────────────────────────────
-- update simblip_institutions set active = false where slug = 'aurora-tech';
