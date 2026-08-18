-- The legacy token store is only used by authenticated Edge Functions, which
-- run as service_role. Browser roles have no table grants or policies.
create policy "Service role manages gcal tokens"
  on public.gcal_tokens
  for all
  to service_role
  using (true)
  with check (true);
