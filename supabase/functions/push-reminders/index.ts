/**
 * push-reminders — hourly cron job that sends daily digests of
 * overdue / due-today / due-soon tasks via Declarative Web Push.
 *
 * Auth: service role key or CRON_SECRET header.
 * Schedule: every hour (Dashboard → Edge Functions → Schedules).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  jsonResponse,
  sendToSubscription,
  type DeclarativeNotification,
} from '../_shared/webPush.ts';

type Prefs = {
  user_id: string;
  notify_digest: boolean | null;
  notify_overdue: boolean | null;
  notify_due_today: boolean | null;
  notify_lead_days: number | null;
  notify_digest_hour: number | null;
  timezone: string | null;
  last_push_digest_on: string | null;
};

type TaskRow = {
  id: string;
  name: string;
  due_date: string | null;
  status: string | null;
  is_recurring_template: boolean | null;
};

function localParts(timeZone: string, date = new Date()): { dateStr: string; hour: number } {
  // en-CA yields YYYY-MM-DD; hour as 0–23 in the given zone
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  // Some engines emit "24" for midnight — normalize
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0;

  return { dateStr, hour };
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatTaskList(tasks: TaskRow[], limit = 3): string {
  const names = tasks.map(t => t.name || 'Untitled').filter(Boolean);
  if (!names.length) return '';
  const shown = names.slice(0, limit);
  const extra = names.length - shown.length;
  return extra > 0
    ? `${shown.join(' · ')} · +${extra} more`
    : shown.join(' · ');
}

function buildDigest(
  overdue: TaskRow[],
  dueToday: TaskRow[],
  dueSoon: TaskRow[],
  prefs: Prefs,
): DeclarativeNotification | null {
  const parts: string[] = [];
  if (prefs.notify_overdue !== false && overdue.length) {
    parts.push(`${overdue.length} overdue`);
  }
  if (prefs.notify_due_today !== false && dueToday.length) {
    parts.push(`${dueToday.length} due today`);
  }
  const lead = prefs.notify_lead_days ?? 1;
  if (lead > 0 && dueSoon.length) {
    parts.push(
      dueSoon.length === 1 && lead === 1
        ? `1 due soon`
        : `${dueSoon.length} due soon`,
    );
  }

  if (!parts.length) return null;

  const title = parts.join(' · ');
  const allForBody = [
    ...(prefs.notify_overdue !== false ? overdue : []),
    ...(prefs.notify_due_today !== false ? dueToday : []),
    ...(lead > 0 ? dueSoon : []),
  ];
  const body = formatTaskList(allForBody) || 'Open TaskTriage to review your tasks.';
  const badge = overdue.length + dueToday.length;

  return {
    title,
    body,
    app_badge: badge > 0 ? badge : undefined,
    silent: false,
  };
}

function isAuthorized(req: Request): boolean {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const headerSecret = req.headers.get('x-cron-secret');
  if (cronSecret && headerSecret && headerSecret === cronSecret) return true;

  const auth = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceKey && auth === `Bearer ${serviceKey}`) return true;

  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return jsonResponse({ ok: true });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!isAuthorized(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Users who have at least one push subscription
  const { data: subRows, error: subErr } = await supabase
    .from('push_subscriptions')
    .select('user_id');
  if (subErr) {
    console.error(subErr);
    return jsonResponse({ error: 'Failed to load subscriptions' }, 500);
  }

  const userIds = [...new Set((subRows || []).map(r => r.user_id).filter(Boolean))];
  if (!userIds.length) {
    return jsonResponse({ ok: true, processed: 0, sent: 0 });
  }

  const { data: prefsRows, error: prefsErr } = await supabase
    .from('user_preferences')
    .select(
      'user_id, notify_digest, notify_overdue, notify_due_today, notify_lead_days, notify_digest_hour, timezone, last_push_digest_on',
    )
    .in('user_id', userIds);

  if (prefsErr) {
    console.error(prefsErr);
    return jsonResponse({ error: 'Failed to load preferences' }, 500);
  }

  const prefsByUser = new Map<string, Prefs>(
    (prefsRows || []).map(p => [p.user_id, p as Prefs]),
  );

  let processed = 0;
  let sent = 0;
  const details: unknown[] = [];

  for (const userId of userIds) {
    const prefs: Prefs = prefsByUser.get(userId) ?? {
      user_id: userId,
      notify_digest: true,
      notify_overdue: true,
      notify_due_today: true,
      notify_lead_days: 1,
      notify_digest_hour: 9,
      timezone: 'UTC',
      last_push_digest_on: null,
    };

    if (prefs.notify_digest === false) continue;

    const tz = prefs.timezone || 'UTC';
    const digestHour = prefs.notify_digest_hour ?? 9;
    const { dateStr: today, hour } = localParts(tz);

    // Only fire during the user's preferred local hour
    if (hour !== digestHour) continue;
    if (prefs.last_push_digest_on === today) continue;

    processed += 1;

    const leadDays = Math.max(0, Math.min(14, prefs.notify_lead_days ?? 1));
    const soonEnd = addDays(today, leadDays);

    const { data: tasks, error: taskErr } = await supabase
      .from('tasks')
      .select('id, name, due_date, status, is_recurring_template')
      .eq('user_id', userId)
      .neq('status', 'done')
      .not('due_date', 'is', null);

    if (taskErr) {
      console.error('tasks query failed for', userId, taskErr);
      details.push({ userId, error: taskErr.message });
      continue;
    }

    const open = ((tasks || []) as TaskRow[]).filter(
      t => !t.is_recurring_template && t.due_date,
    );

    const overdue = open.filter(t => t.due_date! < today);
    const dueToday = open.filter(t => t.due_date === today);
    const dueSoon = leadDays > 0
      ? open.filter(t => t.due_date! > today && t.due_date! <= soonEnd)
      : [];

    const notification = buildDigest(overdue, dueToday, dueSoon, prefs);

    // Always stamp last_push_digest_on for this local day so we don't
    // re-check every hour after an empty digest window.
    const { data: updatedPrefs } = await supabase
      .from('user_preferences')
      .update({ last_push_digest_on: today })
      .eq('user_id', userId)
      .select('user_id');

    if (!updatedPrefs?.length) {
      await supabase.from('user_preferences').insert({
        user_id: userId,
        last_push_digest_on: today,
        timezone: prefs.timezone ?? tz,
      });
    }

    if (!notification) {
      details.push({ userId, skipped: 'nothing due' });
      continue;
    }

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId);

    if (!subs?.length) {
      details.push({ userId, skipped: 'no subscriptions' });
      continue;
    }

    let userSent = 0;
    for (const sub of subs) {
      const result = await sendToSubscription(sub, notification);
      if (result.ok) userSent += 1;
      if (result.gone && sub.id) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }

    if (userSent > 0) sent += 1;
    details.push({
      userId,
      title: notification.title,
      devices: userSent,
      overdue: overdue.length,
      dueToday: dueToday.length,
      dueSoon: dueSoon.length,
    });
  }

  return jsonResponse({ ok: true, processed, sent, details });
});
