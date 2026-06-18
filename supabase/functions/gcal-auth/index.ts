import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLIENT_ID     = Deno.env.get('VITE_GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const REDIRECT_URI  = Deno.env.get('GCAL_REDIRECT_URI') ?? '';
const APP_URL       = Deno.env.get('APP_URL') ?? 'https://commitments.app';

Deno.serve(async (req: Request) => {
  const url    = new URL(req.url);
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');  // supabase user_id passed via state
  const error  = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${APP_URL}?gcal_error=${encodeURIComponent(error)}`, 302);
  }
  if (!code || !state) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Exchange auth code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error('Token exchange failed:', body);
    return Response.redirect(`${APP_URL}?gcal_error=token_exchange_failed`, 302);
  }

  const tokens = await tokenRes.json();
  const { access_token, refresh_token, expires_in } = tokens;

  if (!refresh_token) {
    // No refresh token means the user already granted access before without prompt=consent.
    // Redirect back asking user to reconnect with consent.
    return Response.redirect(`${APP_URL}?gcal_error=no_refresh_token`, 302);
  }

  const expiresAt = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

  // Use service role to write tokens — user is not authenticated to edge function directly
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error: dbError } = await supabase
    .from('gcal_tokens')
    .upsert({
      user_id:       state,
      access_token,
      refresh_token,
      expires_at:    expiresAt,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (dbError) {
    console.error('DB upsert failed:', dbError);
    return Response.redirect(`${APP_URL}?gcal_error=db_error`, 302);
  }

  return Response.redirect(`${APP_URL}?gcal_connected=1`, 302);
});
