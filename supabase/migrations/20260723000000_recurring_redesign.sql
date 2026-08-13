-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: recurring tasks redesign
-- Safe / idempotent. Adds columns used by the new recurrence engine.
-- Existing reset/expand columns are kept for compatibility.
-- ─────────────────────────────────────────────────────────────────────────────

-- Day of month for monthly pattern (1–31)
alter table tasks
  add column if not exists recurring_dom integer
    check (recurring_dom is null or (recurring_dom between 1 and 31));

-- Explicit first occurrence / series start date
alter table tasks
  add column if not exists recurring_start date;

-- True last-completed timestamp for rolling tasks (not updated_at)
alter table tasks
  add column if not exists recurring_last_completed_at timestamptz;

-- Backfill day-of-month from due_date for monthly / every_N_months rows
update tasks
  set recurring_dom = extract(day from due_date)::integer
  where recurring = true
    and recurring_dom is null
    and due_date is not null
    and (
      recurring_cadence = 'monthly'
      or recurring_cadence ~ '^every_[0-9]+_months?$'
    );

-- Backfill recurring_start from due_date when missing
update tasks
  set recurring_start = due_date
  where recurring = true
    and recurring_start is null
    and due_date is not null;
