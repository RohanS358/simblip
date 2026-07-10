-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — bootstrap the platform operator (cloud mode)
--
-- Run in the Supabase SQL editor AFTER schema.sql. Safe to re-run: each
-- piece (tenant, auth user, profile) is created only if missing, so it also
-- REPAIRS a half-provisioned operator (e.g. auth user exists but the
-- profile is missing → "No profile found for this account" at login).
--
--   login: aalubhentakobhi@simblip.dev / loonivaislobhi  →  /dev
--
-- ⚠ Change the password before any real deployment:
--   update auth.users set encrypted_password = crypt('new-password', gen_salt('bf'))
--   where email = 'aalubhentakobhi@simblip.dev';
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  operator_email text := 'aalubhentakobhi@simblip.dev';
  operator_id uuid;
  platform_id uuid;
begin
  -- 1 ── Platform pseudo-tenant (the operator profile must belong to one).
  select id into platform_id from public.simblip_institutions where slug = 'simblip-platform';
  if platform_id is null then
    insert into public.simblip_institutions (name, slug, accent_color)
    values ('SIMBLIP Platform', 'simblip-platform', '#3b82f6')
    returning id into platform_id;
    raise notice 'Created platform tenant %', platform_id;
  end if;

  -- 2 ── Auth user (kept as-is if it already exists — password untouched).
  select id into operator_id from auth.users where email = operator_email;
  if operator_id is null then
    operator_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', operator_id, 'authenticated', 'authenticated',
      operator_email, crypt('loonivaislobhi', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
    ) values (
      gen_random_uuid(), operator_id, operator_id::text,
      jsonb_build_object('sub', operator_id::text, 'email', operator_email, 'email_verified', true),
      'email', now(), now(), now()
    );
    raise notice 'Created auth user %', operator_id;
  end if;

  -- 3 ── Profile: create or repair (this is what login resolves the role from).
  insert into public.simblip_profiles (id, institution_id, role, full_name, email)
  values (operator_id, platform_id, 'super_admin', 'SIMBLIP Operator', operator_email)
  on conflict (id) do update
    set role = 'super_admin', active = true, institution_id = excluded.institution_id;

  raise notice 'Operator ready: % (profile role super_admin)', operator_email;
end $$;

-- Verify — one row, has_profile = true, role = super_admin:
select u.email, p.id is not null as has_profile, p.role, p.active
from auth.users u
left join public.simblip_profiles p on p.id = u.id
where u.email = 'aalubhentakobhi@simblip.dev';
