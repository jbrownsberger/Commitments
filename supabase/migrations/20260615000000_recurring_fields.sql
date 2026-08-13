-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: recurring task fields
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- Safe to run multiple times; all changes are additive / idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. recurring_type: 'reset' (auto-resets each cycle) or 'expand' (spawns instances)
alter table tasks
  add column if not exists recurring_type text
    check (recurring_type in ('reset', 'expand'));

-- 2. recurring_until: end date for 'expand' tasks (inclusive)
alter table tasks
  add column if not exists recurring_until date;

-- 3. recurring_instances: max occurrences for 'expand' tasks
alter table tasks
  add column if not exists recurring_instances integer check (recurring_instances > 0);

-- 4. is_recurring_template: true on the master row for 'expand' tasks
alter table tasks
  add column if not exists is_recurring_template boolean not null default false;

-- 5. recurring_template_id: on spawned instance rows, points back to the template
alter table tasks
  add column if not exists recurring_template_id uuid references tasks(id) on delete cascade;

-- 6. updated_at: needed by the auto-reset logic to know when a task was last completed
--    (tasks may already have this column; the IF NOT EXISTS guard makes it safe)
alter table tasks
  add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at current automatically
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row execute procedure set_updated_at();

-- 7. Backfill: existing recurring rows with no type become 'reset' (the simpler default)
update tasks
  set recurring_type = 'reset'
  where recurring = true and recurring_type is null;
