import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLIENT_ID     = Deno.env.get('VITE_GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

// Buffer: refresh if token expires within 5 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

Deno.serve(async (req: Request) => {
  // JWT is verified by Supabase automatically (verify_jwt: true)
  // Extract user from the Authorization header JWT
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Use service role to read/write tokens
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: row, error: fetchError } = await supabase
    .from('gcal_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', user.id)
    .single();

  if (fetchError || !row) {
    return new Response(JSON.stringify({ error: 'not_connected' }), { status: 404 });
  }

  const expiresAt = new Date(row.expires_at).getTime();
  const needsRefresh = Date.now() >= expiresAt - REFRESH_BUFFER_MS;

  if (!needsRefresh) {
    // Current token still valid
    return new Response(JSON.stringify({
      access_token: row.access_token,
      expires_at:   row.expires_at,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Refresh the access token
  const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  if (!refreshRes.ok) {
    const body = await refreshRes.text();
    console.error('Token refresh failed:', body);
    // Refresh token may be revoked — signal the frontend to re-auth
    return new Response(JSON.stringify({ error: 'refresh_failed' }), { status: 401 });
  }

  const refreshed = await refreshRes.json();
  const newExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();

  await supabase.from('gcal_tokens').update({
    access_token: refreshed.access_token,
    expires_at:   newExpiresAt,
    updated_at:   new Date().toISOString(),
  }).eq('user_id', user.id);

  return new Response(JSON.stringify({
    access_token: refreshed.access_token,
    expires_at:   newExpiresAt,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
