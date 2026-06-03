/**
 * Data access layer — all Supabase queries live here.
 *
 * IMPORTANT — DB status constraint: 'not-started' | 'in-progress' | 'done'
 * (hyphenated, not space-separated)
 *
 * Field normalization:
 *   DB column  `progress`           ↔  app field `manual_progress`
 *   DB column  `timeframe_minutes`  ↔  app field `timeframeMinutes`
 */
import { supabase } from './supabase.js';

// ── Status helpers ───────────────────────────────────────────────────────────────
// DB uses hyphens; UI may use spaces. Normalise before writing, humanise after reading.
export function toDbStatus(s) {
  if (!s) return 'not-started';
  return s.replace(' ', '-');  // 'not started' → 'not-started', 'in progress' → 'in-progress'
}
export function toUiStatus(s) {
  if (!s) return 'not started';
  return s.replace('-', ' ');  // 'not-started' → 'not started'
}

// ── Auth ─────────────────────────────────────────────────────────────────────

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
  // Strip 'weight' — not a DB column
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

// ── Scheduled Days ────────────────────────────────────────────────────────

export async function setScheduledDays(taskId, userId, dates) {
  const { error: delErr } = await supabase
    .from('scheduled_days')
    .delete()
    .eq('task_id', taskId);
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
