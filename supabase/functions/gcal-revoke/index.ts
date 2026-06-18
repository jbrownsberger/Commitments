import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

Deno.serve(async (req: Request) => {
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fetch token to revoke with Google before deleting
  const { data: row } = await supabase
    .from('gcal_tokens')
    .select('access_token, refresh_token')
    .eq('user_id', user.id)
    .single();

  if (row?.refresh_token) {
    // Best-effort revoke with Google (don't fail if this errors)
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(row.refresh_token)}`).catch(() => {});
  }

  await supabase.from('gcal_tokens').delete().eq('user_id', user.id);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
