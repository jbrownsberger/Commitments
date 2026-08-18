-- Google Calendar now uses Google's browser token client and does not read this
-- legacy refresh-token store from the Data API. Refresh tokens must never be
-- selectable by an authenticated browser session.
DROP POLICY IF EXISTS "Users can manage their own gcal tokens" ON public.gcal_tokens;
DROP POLICY IF EXISTS "Users can read own gcal token" ON public.gcal_tokens;
DROP POLICY IF EXISTS "Users can insert own gcal token" ON public.gcal_tokens;
DROP POLICY IF EXISTS "Users can update own gcal token" ON public.gcal_tokens;
DROP POLICY IF EXISTS "Users can delete own gcal token" ON public.gcal_tokens;

REVOKE ALL ON TABLE public.gcal_tokens FROM PUBLIC, anon, authenticated;
