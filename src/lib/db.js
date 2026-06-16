/**
 * Data access layer — all Supabase queries live here.
 *
 * IMPORTANT — DB status constraint: 'not-started' | 'in-progress' | 'done'
 * (hyphenated, not space-separated)
 *
 * Field normalization:
 *   DB column  `progress`           ↔  app field `manual_progress`
 *   DB column  `timeframe_minutes`  ↔  app field `timeframeMinutes`
 *
 * Recurring columns:
 *   recurring                — boolean
 *   recurring_cadence        — 'daily' | 'weekday' | 'weekly' | 'every_N_days' |
 *                              'every_N_weeks' | 'every_N_months'
 *   recurring_type           — 'reset' | 'expand'
 *   recurring_last_reset_at  — timestamptz; anchor for next-due calculation
 *   recurring_until          — date string, end date for expand tasks
 *   recurring_instances      — integer, max occurrences for expand tasks
 *   is_recurring_template    — boolean, true on the master expand row
 *   recurring_template_id    — uuid FK back to the template row
 *   updated_at               — timestamptz, auto-set by trigger
 */
import { supabase } from './supabase.js';

// ── Status helpers ────────────────────────────────────────────────────────────
export function toDbStatus(s) {
  if (!s) return 'not-started';
  return s.replace(' ', '-');
}
export function toUiStatus(s) {
  if (!s) return 'not started';
  return s.replace('-', ' ');
}

// ── Cadence helpers ───────────────────────────────────────────────────────────
/**
 * Given a cadence string and an anchor Date, return the Date when the task
 * next becomes due for reset (i.e. anchor + one cadence period).
 *
 * Supported cadence values:
 *   'daily'           — every 1 day
 *   'weekday'         — next weekday on or after anchor + 1 day
 *   'weekly'          — every 7 days
 *   'every_N_days'    — every N days
 *   'every_N_weeks'   — every N*7 days
 *   'every_N_months'  — calendar months
 */
export function nextResetDate(cadence, anchor) {
  const d = new Date(anchor);
  if (!cadence || cadence === 'daily') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (cadence === 'weekday') {
    // advance to next weekday (Mon–Fri)
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
  }
  if (cadence === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d;
  }
  // 'every_N_days' / 'every_N_weeks' / 'every_N_months'
  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m) {
    const n    = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === 'day')   { d.setDate(d.getDate() + n); return d; }
    if (unit === 'week')  { d.setDate(d.getDate() + n * 7); return d; }
    if (unit === 'month') { d.setMonth(d.getMonth() + n); return d; }
  }
  // fallback: daily
  d.setDate(d.getDate() + 1);
  return d;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const signInWithMagicLink = (email) =>
  supabase.auth.signInWithOtp({ email });
export const signInWithPassword = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });
export const signUpWithPassword = (email, password) =>
  supabase.auth.signUp({ email, password });
export const signOut = () => supabase.auth.signOut();
export const getSession   = () => supabase.auth.getSession();
export const onAuthChange = (cb) =>
  supabase.auth.onAuthStateChange((_event, session) => cb(session));

// ── Preferences ───────────────────────────────────────────────────────────────
export async function fetchPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}
export async function savePreferences(prefs) {
  const { user_id, ...rest } = prefs;
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({ user_id, ...rest })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Categories ────────────────────────────────────────────────────────────────
export async function fetchCategories(userId) {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  return data || [];
}
export async function saveCategory(cat) {
  const isNew = !cat.id;
  let data, error;
  if (isNew) {
    ({ data, error } = await supabase.from('categories').insert(cat).select().single());
  } else {
    const { id, ...fields } = cat;
    ({ data, error } = await supabase.from('categories').update(fields).eq('id', id).select().single());
  }
  if (error) throw error;
  return data;
}
export async function removeCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────
function dbTaskToApp(t) {
  const { progress, scheduled_days, ...rest } = t;
  return {
    ...rest,
    status:              toUiStatus(rest.status),
    manual_progress:     progress ?? 0,
    scheduled_days:      (scheduled_days || []).map(r =>
      typeof r === 'string' ? r : r.day_date
    ).sort(),
    scheduled_day_hours: t.scheduled_day_hours || {},
    substeps:            (t.substeps || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    recurring:                 rest.recurring                 ?? false,
    recurring_type:            rest.recurring_type            ?? null,
    recurring_cadence:         rest.recurring_cadence         ?? null,
    recurring_last_reset_at:   rest.recurring_last_reset_at   ?? null,
    recurring_until:           rest.recurring_until           ?? null,
    recurring_instances:       rest.recurring_instances       ?? null,
    is_recurring_template:     rest.is_recurring_template     ?? false,
    recurring_template_id:     rest.recurring_template_id     ?? null,
    updated_at:                rest.updated_at                ?? null,
  };
}

export async function fetchTasks(userId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, scheduled_days(day_date)')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  return (data || []).map(t => ({ ...dbTaskToApp(t), substeps: [] }));
}

export async function saveTask(task) {
  const {
    substeps, scheduled_days,
    catName, catColor, catId,
    manual_progress, manualProgress,
    dueDate, estimatedHours,
    ...rest
  } = task;

  const row = {
    ...rest,
    status:   toDbStatus(rest.status),
    progress: manual_progress ?? manualProgress ?? rest.progress ?? 0,
    recurring:                rest.recurring                ?? false,
    recurring_type:           rest.recurring_type           ?? null,
    recurring_cadence:        rest.recurring_cadence        ?? null,
    recurring_last_reset_at:  rest.recurring_last_reset_at  ?? null,
    recurring_until:          rest.recurring_until          ?? null,
    recurring_instances:      rest.recurring_instances      ?? null,
    is_recurring_template:    rest.is_recurring_template    ?? false,
    recurring_template_id:    rest.recurring_template_id    ?? null,
  };

  const isNew = !row.id;
  let data, error;
  if (isNew) {
    ({ data, error } = await supabase.from('tasks').insert(row).select().single());
  } else {
    const { id, ...fields } = row;
    ({ data, error } = await supabase.from('tasks').update(fields).eq('id', id).select().single());
  }
  if (error) throw error;
  return dbTaskToApp({ ...data, scheduled_days: [] });
}

export async function removeTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ── Recurring: auto-reset ─────────────────────────────────────────────────────
/**
 * resetStaleRecurringTasks(tasks, userId)
 *
 * Called on app load.  For each 'reset'-mode recurring task with status 'done',
 * computes the next-due date from the anchor (recurring_last_reset_at, falling
 * back to updated_at) and resets the task if now >= nextDue.
 *
 * "Whichever is later" semantics: the anchor is set to the moment of completion,
 * so a task completed late in the day won't reset until one full cadence period
 * has elapsed from that moment — not merely from midnight.
 */
export async function resetStaleRecurringTasks(tasks, userId) {
  const now = new Date();

  const toReset = tasks.filter(t => {
    if (!t.recurring || t.recurring_type !== 'reset') return false;
    if (t.status !== 'done') return false;

    // Use recurring_last_reset_at if available; fall back to updated_at;
    // if neither exists, reset immediately.
    const anchorStr = t.recurring_last_reset_at || t.updated_at;
    if (!anchorStr) return true;

    const anchor  = new Date(anchorStr);
    const nextDue = nextResetDate(t.recurring_cadence, anchor);
    return now >= nextDue;
  });

  if (toReset.length === 0) return [];

  const updated = await Promise.all(
    toReset.map(t =>
      saveTask({
        ...t,
        status:                  'not-started',
        manual_progress:         0,
        recurring_last_reset_at: new Date().toISOString(),
      })
    )
  );

  return updated;
}

// ── Recurring: expand (spawn instances) ──────────────────────────────────────
/**
 * expandRecurringTemplate(template, userId)
 *
 * For 'expand'-mode tasks.  Generates individual instances through
 * recurring_until or recurring_instances and inserts them all.
 */
export async function expandRecurringTemplate(template, userId) {
  const cadence  = template.recurring_cadence || 'daily';
  const until    = template.recurring_until    ? new Date(template.recurring_until) : null;
  const maxCount = template.recurring_instances ?? 10;

  const dates = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (true) {
    const dow      = cursor.getDay();
    let eligible   = true;

    if (cadence === 'weekday') {
      eligible = dow >= 1 && dow <= 5;
    } else if (cadence === 'weekly') {
      eligible = dow === new Date().getDay();
    } else {
      // custom cadence: push every occurrence by one full period
      eligible = true;
    }

    if (eligible) {
      dates.push(cursor.toISOString().slice(0, 10));
    }

    if (until  && cursor >= until)           break;
    if (!until && dates.length >= maxCount)  break;
    if (dates.length >= 365)                 break;

    // Advance by the cadence period
    const next = nextResetDate(cadence, cursor);
    // For daily/weekday/weekly nextResetDate gives the right +1-step;
    // but for weekday we already handle eligibility above so just +1 day.
    if (cadence === 'daily' || cadence === 'weekday') {
      cursor.setDate(cursor.getDate() + 1);
    } else {
      cursor.setTime(next.getTime());
    }
  }

  if (dates.length === 0) return [];

  const rows = dates.map((due_date, i) => ({
    user_id:               userId,
    category_id:           template.category_id,
    name:                  template.name,
    status:                'not-started',
    priority:              template.priority  || 'med',
    estimated_hours:       template.estimated_hours || 1,
    notes:                 template.notes || null,
    progress:              0,
    position:              (template.position ?? 0) + i + 1,
    due_date,
    recurring:             false,
    recurring_type:        null,
    recurring_cadence:     null,
    recurring_last_reset_at: null,
    recurring_until:       null,
    recurring_instances:   null,
    is_recurring_template: false,
    recurring_template_id: template.id,
  }));

  const { data, error } = await supabase.from('tasks').insert(rows).select();
  if (error) throw error;
  return (data || []).map(t => dbTaskToApp({ ...t, scheduled_days: [] }));
}

// ── Substeps ──────────────────────────────────────────────────────────────────
export async function fetchSubsteps(userId) {
  const { data, error } = await supabase
    .from('substeps')
    .select('*')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  return data || [];
}
export async function saveSubstep(substep) {
  const { weight, ...rest } = substep;
  const isNew = !rest.id;
  let data, error;
  if (isNew) {
    ({ data, error } = await supabase.from('substeps').insert(rest).select().single());
  } else {
    const { id, ...fields } = rest;
    ({ data, error } = await supabase.from('substeps').update(fields).eq('id', id).select().single());
  }
  if (error) throw error;
  return data;
}
export async function removeSubstep(id) {
  const { error } = await supabase.from('substeps').delete().eq('id', id);
  if (error) throw error;
}

// ── Quick Tasks ───────────────────────────────────────────────────────────────
function dbQtToApp(qt) {
  const { timeframe_minutes, ...rest } = qt;
  return { ...rest, timeframeMinutes: timeframe_minutes ?? 15 };
}
export async function fetchQuickTasks(userId) {
  const { data, error } = await supabase
    .from('quick_tasks')
    .select('*')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  return (data || []).map(dbQtToApp);
}
export async function saveQuickTask(qt) {
  const { timeframeMinutes, ...rest } = qt;
  const row = { ...rest, timeframe_minutes: timeframeMinutes ?? 15 };
  const isNew = !row.id;
  let data, error;
  if (isNew) {
    ({ data, error } = await supabase.from('quick_tasks').insert(row).select().single());
  } else {
    const { id, ...fields } = row;
    ({ data, error } = await supabase.from('quick_tasks').update(fields).eq('id', id).select().single());
  }
  if (error) throw error;
  return dbQtToApp(data);
}
export async function removeQuickTask(id) {
  const { error } = await supabase.from('quick_tasks').delete().eq('id', id);
  if (error) throw error;
}

// ── Scheduled Days ────────────────────────────────────────────────────────────
export async function setScheduledDays(taskId, userId, dates) {
  const { error: delErr } = await supabase
    .from('scheduled_days').delete().eq('task_id', taskId);
  if (delErr) throw delErr;
  if (!dates || dates.length === 0) return;
  const rows = dates.map(day_date => ({ task_id: taskId, user_id: userId, day_date }));
  const { error: insErr } = await supabase.from('scheduled_days').insert(rows);
  if (insErr) throw insErr;
}
export async function getScheduledDaysForRange(userId, from, to) {
  const { data, error } = await supabase
    .from('scheduled_days')
    .select('task_id, day_date')
    .eq('user_id', userId)
    .gte('day_date', from)
    .lte('day_date', to);
  if (error) throw error;
  return data;
}

// ── ICS Export ────────────────────────────────────────────────────────────────
export function generateICS(tasks, categories) {
  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Commitments//EN', 'CALSCALE:GREGORIAN',
  ];
  for (const task of tasks) {
    if (!task.due_date) continue;
    const cat = catMap[task.category_id];
    const due = task.due_date.replace(/-/g, '');
    const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    lines.push(
      'BEGIN:VEVENT',
      `UID:due-${task.id}@commitments`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${due}`,
      `DTEND;VALUE=DATE:${due}`,
      `SUMMARY:\u23f0 ${task.name}`,
      `CATEGORIES:${cat ? cat.name : 'Uncategorized'}`,
      `DESCRIPTION:${(task.notes || '').replace(/\n/g, '\\n')}`,
      'END:VEVENT'
    );
    for (const day of (task.scheduled_days || [])) {
      const d = day.replace(/-/g, '');
      lines.push(
        'BEGIN:VEVENT',
        `UID:session-${task.id}-${d}@commitments`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${d}`,
        `DTEND;VALUE=DATE:${d}`,
        `SUMMARY:\ud83d\uddc2 ${task.name}`,
        `CATEGORIES:${cat ? cat.name : 'Uncategorized'}`,
        'END:VEVENT'
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
export function downloadICS(tasks, categories) {
  const ics  = generateICS(tasks, categories);
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'commitments.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}
