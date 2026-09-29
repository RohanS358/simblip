-- Reverses 003-sync-storage-quota.sql. Drops only what 003 added; no user
-- content is lost except calendar/to-do rows in simblip_user_kv (each device
-- still holds its own local copy).
drop index if exists simblip_file_manifest_owner_sha_idx;
drop index if exists simblip_pages_workspace_updated_idx;
drop table if exists simblip_user_kv;
alter table simblip_file_blobs drop column if exists size_bytes;
alter table simblip_pages drop column if exists size_bytes;
alter table simblip_pages drop column if exists rev;
alter table simblip_workspaces drop column if exists size_bytes;
alter table simblip_workspaces drop column if exists rev;
