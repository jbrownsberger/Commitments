-- Structured, actionable references attached to a task.
-- Each entry is a small JSON object: { type, label, value }.
alter table public.tasks
  add column if not exists links jsonb not null default '[]'::jsonb;

alter table public.tasks
  drop constraint if exists tasks_links_is_array;

alter table public.tasks
  add constraint tasks_links_is_array check (jsonb_typeof(links) = 'array');
