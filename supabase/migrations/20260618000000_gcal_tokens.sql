-- gcal_tokens
-- Stores per-user Google OAuth tokens server-side so the app never needs to
-- re-authenticate with Google more than once.  The gcal-token edge function
-- reads this table, transparently refreshes an expiring access token via the
-- stored refresh token, and returns a fresh access token to the client.
--
-- This migration documents the table that was created manually in the
-- Supabase dashboard.  Running it on a fresh database will produce the
-- exact same schema and RLS policies as the live project.

CREATE TABLE IF NOT EXISTS public.gcal_tokens (
  user_id       uuid        PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  access_token  text        NOT NULL,
  refresh_token text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at current automatically.
CREATE OR REPLACE FUNCTION public.gcal_tokens_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gcal_tokens_updated_at ON public.gcal_tokens;
CREATE TRIGGER trg_gcal_tokens_updated_at
  BEFORE UPDATE ON public.gcal_tokens
  FOR EACH ROW EXECUTE FUNCTION public.gcal_tokens_set_updated_at();

-- Row-Level Security: each user can only see and modify their own token row.
ALTER TABLE public.gcal_tokens ENABLE ROW LEVEL SECURITY;

-- Catch-all policy (covers SELECT / INSERT / UPDATE / DELETE)
DROP POLICY IF EXISTS "Users can manage their own gcal tokens" ON public.gcal_tokens;
CREATE POLICY "Users can manage their own gcal tokens"
  ON public.gcal_tokens FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Granular read policy
DROP POLICY IF EXISTS "Users can read own gcal token" ON public.gcal_tokens;
CREATE POLICY "Users can read own gcal token"
  ON public.gcal_tokens FOR SELECT
  USING (auth.uid() = user_id);

-- Granular insert policy
DROP POLICY IF EXISTS "Users can insert own gcal token" ON public.gcal_tokens;
CREATE POLICY "Users can insert own gcal token"
  ON public.gcal_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Granular update policy
DROP POLICY IF EXISTS "Users can update own gcal token" ON public.gcal_tokens;
CREATE POLICY "Users can update own gcal token"
  ON public.gcal_tokens FOR UPDATE
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Granular delete policy
DROP POLICY IF EXISTS "Users can delete own gcal token" ON public.gcal_tokens;
CREATE POLICY "Users can delete own gcal token"
  ON public.gcal_tokens FOR DELETE
  USING (auth.uid() = user_id);
