-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: switch recurring reset to due-date-anchored scheduling
-- recurring_last_reset_at is no longer used; drop it to keep schema clean.
-- due_date already exists and is now the scheduling anchor.
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Drop the anchor column from the previous approach (no longer needed)
alter table tasks
  drop column if exists recurring_last_reset_at;

-- 2. Ensure due_date exists (it should, but guard anyway)
alter table tasks
  add column if not exists due_date date;

-- 3. For existing weekly reset tasks with no due_date, seed to next
--    occurrence of today's weekday (i.e. today, since mod 7 = 0).
update tasks
  set due_date = current_date
  where recurring = true
    and recurring_type = 'reset'
    and due_date is null;
