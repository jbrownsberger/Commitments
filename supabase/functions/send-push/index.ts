/**
 * send-push — authenticated endpoint to send a Declarative Web Push
 * notification to the calling user's stored subscriptions.
 *
 * Body: { title, body?, navigate?, app_badge? }
 * Auth: user JWT (Authorization: Bearer …)
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  corsHeaders,
  jsonResponse,
  sendToSubscription,
  type DeclarativeNotification,
} from '../_shared/webPush.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
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

  let body: DeclarativeNotification;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body?.title || typeof body.title !== 'string') {
    return jsonResponse({ error: 'title is required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: subs, error: subError } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user.id);

  if (subError) {
    console.error('Failed to load subscriptions:', subError);
    return jsonResponse({ error: 'Failed to load subscriptions' }, 500);
  }
  if (!subs?.length) {
    return jsonResponse({ error: 'No push subscriptions for this user' }, 404);
  }

  const notification: DeclarativeNotification = {
    title: body.title,
    body: body.body,
    navigate: body.navigate,
    app_badge: body.app_badge,
    silent: false,
  };

  const results = [];
  for (const sub of subs) {
    const result = await sendToSubscription(sub, notification);
    results.push(result);
    if (result.gone && sub.id) {
      await supabase.from('push_subscriptions').delete().eq('id', sub.id);
    }
  }

  const sent = results.filter(r => r.ok).length;
  return jsonResponse({
    ok: sent > 0,
    sent,
    total: results.length,
    results,
  });
});
