/**
 * Declarative Web Push client helpers.
 *
 * Prefers window.pushManager (Safari Declarative Web Push) and falls back to
 * ServiceWorkerRegistration.pushManager. Always registers a thin SW so
 * non-declarative browsers can still display the same payload.
 */
import { supabase } from './supabase.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const SW_URL = '/sw.js';

// ── Low-level helpers ────────────────────────────────────────────────────────

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported() {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  // Declarative path (Safari 18.4+) or classic SW push
  if (window.pushManager) return true;
  if ('serviceWorker' in navigator && 'PushManager' in window) return true;
  return false;
}

export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: '/' });
}

async function getPushManager() {
  // Prefer window-level PushManager (Declarative Web Push — no SW required)
  if (window.pushManager) return window.pushManager;

  if (!('serviceWorker' in navigator)) return null;
  const reg = await ensureServiceWorker();
  await navigator.serviceWorker.ready;
  return reg?.pushManager ?? null;
}

async function getExistingSubscription() {
  const pm = await getPushManager();
  if (!pm) return null;
  try {
    return await pm.getSubscription();
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{
 *   supported: boolean,
 *   permission: NotificationPermission | 'unsupported',
 *   subscribed: boolean,
 *   endpoint: string | null,
 * }>}
 */
export async function getPushStatus() {
  if (!isPushSupported()) {
    return {
      supported: false,
      permission: 'unsupported',
      subscribed: false,
      endpoint: null,
    };
  }
  const permission = Notification.permission;
  const sub = await getExistingSubscription();
  return {
    supported: true,
    permission,
    subscribed: !!sub,
    endpoint: sub?.endpoint ?? null,
  };
}

/**
 * Request permission, subscribe, and persist the subscription for this user.
 * @param {string} userId
 */
export async function subscribePush(userId) {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser');
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('VITE_VAPID_PUBLIC_KEY is not configured');
  }

  // Register SW early so classic push path is ready
  try {
    await ensureServiceWorker();
  } catch (err) {
    console.warn('Service worker registration failed (may still work via window.pushManager):', err);
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notification permission denied. Enable it in System Settings.'
        : 'Notification permission was not granted.',
    );
  }

  const pm = await getPushManager();
  if (!pm) throw new Error('PushManager is not available');

  let subscription = await pm.getSubscription();
  if (!subscription) {
    subscription = await pm.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Incomplete push subscription from browser');
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;

  return subscription;
}

/**
 * Unsubscribe this browser and remove the DB row for the endpoint.
 * @param {string} [_userId]
 */
export async function unsubscribePush(_userId) {
  const sub = await getExistingSubscription();
  if (!sub) {
    return { unsubscribed: false };
  }
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch (err) {
    console.warn('Browser unsubscribe failed:', err);
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) throw error;

  return { unsubscribed: true, endpoint };
}

/**
 * Ask the send-push edge function to deliver a test notification.
 */
export async function sendTestPush({
  title = 'TaskTriage is connected',
  body = 'Notifications are working on this Mac. You will get daily digests for due and overdue tasks.',
} = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      title,
      body,
      navigate: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || `send-push failed (${res.status})`);
  }
  return payload;
}

/** Browser IANA timezone, e.g. "America/New_York". */
export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
