-- pg_net already exists in production. Keep its installation in source control
-- so a fresh environment matches the live database.
create extension if not exists pg_net with schema extensions;

-- pg_cron is provisioned by Supabase in pg_catalog and cannot be created by a
-- project migration. Enable it in the Supabase Dashboard for new projects.
