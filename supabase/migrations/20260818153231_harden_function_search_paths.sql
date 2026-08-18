-- Trigger functions do not need to resolve unqualified user-controlled names.
alter function public.set_updated_at() set search_path = '';
alter function public.gcal_tokens_set_updated_at() set search_path = '';
