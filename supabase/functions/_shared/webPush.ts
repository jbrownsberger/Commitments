/**
 * Declarative Web Push helpers for Supabase Edge Functions.
 * Payload format: https://webkit.org/blog/16535/meet-declarative-web-push/
 */
import webpush from 'npm:web-push@3.6.7';

export type PushSubscriptionRow = {
  id?: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type DeclarativeNotification = {
  title: string;
  body?: string;
  navigate?: string;
  silent?: boolean;
  lang?: string;
  dir?: string;
  app_badge?: string | number;
};

let vapidConfigured = false;

export function ensureVapid(): void {
  if (vapidConfigured) return;
  const publicKey  = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const subject    = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@tasktriage.app';
  if (!publicKey || !privateKey) {
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/** Build the Declarative Web Push JSON body (web_push: 8030). */
export function buildDeclarativePayload(n: DeclarativeNotification): string {
  const appUrl = (Deno.env.get('APP_URL') ?? 'https://tasktriage.app').replace(/\/$/, '');
  const notification: Record<string, unknown> = {
    title: n.title,
    lang: n.lang ?? 'en-US',
    dir: n.dir ?? 'ltr',
    body: n.body ?? '',
    icon: `${appUrl}/logo.png`,
    badge: `${appUrl}/logo.png`,
    navigate: n.navigate ?? `${appUrl}/`,
    silent: n.silent ?? false,
  };
  if (n.app_badge !== undefined && n.app_badge !== null && n.app_badge !== '') {
    notification.app_badge = String(n.app_badge);
  }
  return JSON.stringify({
    web_push: 8030,
    notification,
  });
}

export type SendResult = {
  endpoint: string;
  ok: boolean;
  statusCode?: number;
  error?: string;
  gone?: boolean;
};

/** Send one declarative notification to a stored subscription row. */
export async function sendToSubscription(
  sub: PushSubscriptionRow,
  notification: DeclarativeNotification,
): Promise<SendResult> {
  ensureVapid();
  const payload = buildDeclarativePayload(notification);
  const subscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  };

  try {
    const result = await webpush.sendNotification(subscription, payload, {
      TTL: 60 * 60 * 24,
      urgency: 'normal',
      // Content-Type helps declarative parsers; web-push sets application/octet-stream by default.
      // The web_push: 8030 magic value in the JSON body is the primary opt-in.
    });
    return {
      endpoint: sub.endpoint,
      ok: true,
      statusCode: result.statusCode,
    };
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode: number }).statusCode)
        : undefined;
    const message = err instanceof Error ? err.message : String(err);
    const gone = statusCode === 404 || statusCode === 410;
    return {
      endpoint: sub.endpoint,
      ok: false,
      statusCode,
      error: message,
      gone,
    };
  }
}

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
