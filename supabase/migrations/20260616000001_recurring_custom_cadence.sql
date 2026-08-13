-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: custom cadence + last-reset anchor for recurring tasks
-- Run in Supabase SQL Editor.  Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop the old enum-style CHECK constraint on recurring_cadence so we can
--    store arbitrary cadence strings (e.g. 'every_3_days', 'every_2_weeks').
--    The column was added in the previous migration with no CHECK, so this
--    is a no-op guard in case a constraint was added manually.
alter table tasks
  drop constraint if exists tasks_recurring_cadence_check;

-- 2. recurring_last_reset_at — the moment we last reset this task to 'not-started'.
--    Used as the anchor for "reset after the recurrence period OR when completed,
--    whichever is later".
alter table tasks
  add column if not exists recurring_last_reset_at timestamptz;

-- 3. Backfill: for existing reset-mode tasks that are already 'done', set the
--    anchor to updated_at so the first pass of the new logic behaves correctly.
update tasks
  set recurring_last_reset_at = updated_at
  where recurring = true
    and recurring_type = 'reset'
    and status = 'done'
    and recurring_last_reset_at is null
    and updated_at is not null;
