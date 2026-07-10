-- ═══════════════════════════════════════════════════════════════════════════
-- SIMBLIP — bootstrap the platform operator (cloud mode)
--
-- Run this ONCE in the Supabase SQL editor, AFTER schema.sql. It creates:
--   1. a "SIMBLIP Platform" pseudo-tenant (the operator must belong to one),
--   2. the operator auth user  aalubhentakobhi@simblip.dev / loonivaislobhi,
--   3. its super_admin profile.
--
-- Then sign in at /login with those credentials → you land on /dev, where
-- institutions, admins, teachers, students, rooms and boards are provisioned
-- through the service-role API (requires SUPABASE_SERVICE_ROLE_KEY in
-- .env.local — never exposed to the browser).
--
-- ⚠ Change the password before any real deployment:
--   update auth.users set encrypted_password = crypt('new-password', gen_salt('bf'))
--   where email = 'aalubhentakobhi@simblip.dev';
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  operator_id uuid := gen_random_uuid();
  platform_id uuid;
begin
  -- Idempotent: skip if the operator already exists.
  if exists (select 1 from auth.users where email = 'aalubhentakobhi@simblip.dev') then
    raise notice 'Operator already exists — nothing to do.';
    return;
  end if;

  insert into public.simblip_institutions (name, slug, accent_color)
  values ('SIMBLIP Platform', 'simblip-platform', '#3b82f6')
  on conflict (slug) do update set name = excluded.name
  returning id into platform_id;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', operator_id, 'authenticated', 'authenticated',
    'aalubhentakobhi@simblip.dev', crypt('loonivaislobhi', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) values (
    gen_random_uuid(), operator_id, operator_id::text,
    jsonb_build_object('sub', operator_id::text, 'email', 'aalubhentakobhi@simblip.dev', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into public.simblip_profiles (id, institution_id, role, full_name, email)
  values (operator_id, platform_id, 'super_admin', 'SIMBLIP Operator', 'aalubhentakobhi@simblip.dev');

  raise notice 'Operator provisioned: aalubhentakobhi@simblip.dev';
end $$;
