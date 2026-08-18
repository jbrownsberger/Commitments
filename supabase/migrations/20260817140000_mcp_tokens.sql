-- Personal MCP tokens for AI assistant connectors (Perplexity, Claude, etc.)
-- Plaintext tokens are shown once at creation; only SHA-256 hashes are stored.

CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  label        text,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_tokens_user_id_idx
  ON public.mcp_tokens (user_id);

CREATE INDEX IF NOT EXISTS mcp_tokens_token_hash_idx
  ON public.mcp_tokens (token_hash);

ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own mcp tokens" ON public.mcp_tokens;
CREATE POLICY "Users can manage their own mcp tokens"
  ON public.mcp_tokens FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own mcp tokens" ON public.mcp_tokens;
CREATE POLICY "Users can read own mcp tokens"
  ON public.mcp_tokens FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own mcp tokens" ON public.mcp_tokens;
CREATE POLICY "Users can insert own mcp tokens"
  ON public.mcp_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own mcp tokens" ON public.mcp_tokens;
CREATE POLICY "Users can delete own mcp tokens"
  ON public.mcp_tokens FOR DELETE
  USING (auth.uid() = user_id);
