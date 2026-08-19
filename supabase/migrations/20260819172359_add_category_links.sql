-- Links which are automatically available from every task in a category.
alter table public.categories
  add column if not exists links jsonb not null default '[]'::jsonb;

alter table public.categories
  drop constraint if exists categories_links_is_array;

alter table public.categories
  add constraint categories_links_is_array check (jsonb_typeof(links) = 'array');
