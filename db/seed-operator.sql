-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — bootstrap the platform operator (cloud mode)
--
-- Run AFTER schema.sql:  psql simblip -f db/seed-operator.sql
-- Safe to re-run: each piece (tenant, profile) is created only if missing,
-- so it also REPAIRS a half-provisioned operator.
--
--   login: aalubhentakobhi@simblip.dev / loonivaislobhi  →  /dev
--
-- ⚠ Change the password before any real deployment — sign in and use the
--   admin console's password reset, or compute a new scrypt hash with:
--   node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');
--            console.log('scrypt:'+s+':'+c.scryptSync('NEW-PASSWORD',s,64).toString('hex'))"
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 ── Platform pseudo-tenant (the operator profile must belong to one).
insert into simblip_institutions (name, slug, accent_color)
select 'SIMBLIP Platform', 'simblip-platform', '#3b82f6'
where not exists (select 1 from simblip_institutions where slug = 'simblip-platform');

-- 2 ── Profile: create or repair (login resolves role + password from it).
-- password_hash is the scrypt hash of 'loonivaislobhi' (format scrypt:<salt>:<hash>).
insert into simblip_profiles (institution_id, role, full_name, email, password_hash)
select id, 'super_admin', 'SIMBLIP Operator', 'aalubhentakobhi@simblip.dev',
       'scrypt:73696d626c69702d6f70657261746f72:694fdec7a1640752307b47c12f2993a56ea7b99cb974387e88ac343faac927ddaefd8ba4aebc5dbfac9a5360ff9f7bbcf53080fcf5d76421f39a38f09c946c7c'
from simblip_institutions where slug = 'simblip-platform'
on conflict (email) do update
  set role = 'super_admin', active = true,
      institution_id = excluded.institution_id,
      password_hash = coalesce(simblip_profiles.password_hash, excluded.password_hash);

-- Verify — one row, role = super_admin, has_password = true:
select email, role, active, password_hash is not null as has_password
from simblip_profiles where email = 'aalubhentakobhi@simblip.dev';
