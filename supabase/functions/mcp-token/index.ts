/**
 * mcp-token — authenticated CRUD for personal MCP connector tokens.
 *
 * GET    → [{ id, label, created_at, last_used_at }]
 * POST   { label? } → { token }  (plaintext shown once)
 * DELETE ?id=uuid → { ok: true }
 *
 * Auth: Supabase user JWT (Authorization: Bearer …)
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders, generateToken, hashToken, jsonResponse } from '../_shared/mcpAuth.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('mcp_tokens')
      .select('id, label, created_at, last_used_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('list mcp tokens failed:', error);
      return jsonResponse({ error: 'Failed to load tokens' }, 500);
    }
    return jsonResponse(data ?? []);
  }

  if (req.method === 'POST') {
    let label: string | null = null;
    try {
      const body = await req.json();
      if (body?.label && typeof body.label === 'string') {
        label = body.label.trim() || null;
      }
    } catch {
      // empty body is fine
    }

    const plaintext = generateToken();
    const tokenHash = await hashToken(plaintext);

    const { error } = await supabase.from('mcp_tokens').insert({
      user_id: user.id,
      label,
      token_hash: tokenHash,
    });

    if (error) {
      console.error('create mcp token failed:', error);
      return jsonResponse({ error: 'Failed to create token' }, 500);
    }

    return jsonResponse({ token: plaintext }, 201);
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) {
      return jsonResponse({ error: 'id query parameter is required' }, 400);
    }

    const { error, count } = await supabase
      .from('mcp_tokens')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      console.error('revoke mcp token failed:', error);
      return jsonResponse({ error: 'Failed to revoke token' }, 500);
    }
    if (!count) {
      return jsonResponse({ error: 'Token not found' }, 404);
    }

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
});
