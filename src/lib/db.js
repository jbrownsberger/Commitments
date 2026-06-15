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
 * Recurring columns (all nullable, added in 20260615_recurring_fields.sql):
 *   recurring                — boolean, already existed
 *   recurring_cadence        — 'daily' | 'weekday' | 'weekly', already existed
 *   recurring_type           — 'reset' | 'expand'  (NEW)
 *   recurring_until          — date string, end date for expand tasks  (NEW)
 *   recurring_instances      — integer, max occurrences for expand tasks  (NEW)
 *   is_recurring_template    — boolean, true on the master expand row  (NEW)
 *   recurring_template_id    — uuid FK back to the template row  (NEW)
 *   updated_at               — timestamptz, auto-set by trigger  (NEW)
 */
import { supabase } from './supabase.js';

// ── Status helpers ────────────────────────────────────────────────────────────
// DB uses hyphens; UI may use spaces. Normalise before writing, humanise after reading.
export function toDbStatus(s) {
  if (!s) return 'not-started';
  return s.replace(' ', '-');   // 'not started' → 'not-started'
}
export function toUiStatus(s) {
  if (!s) return 'not started';
  return s.replace('-', ' ');   // 'not-started' → 'not started'
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

/**
 * Columns to strip/rename when converting a DB row to the app shape.
 * Any field in this list is handled explicitly below rather than spread through.
 */
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
    // Recurring fields — pass through as-is (null is fine for non-recurring tasks)
    recurring:               rest.recurring               ?? false,
    recurring_type:          rest.recurring_type          ?? null,
    recurring_cadence:       rest.recurring_cadence       ?? null,
    recurring_until:         rest.recurring_until         ?? null,
    recurring_instances:     rest.recurring_instances     ?? null,
    is_recurring_template:   rest.is_recurring_template   ?? false,
    recurring_template_id:   rest.recurring_template_id   ?? null,
    updated_at:              rest.updated_at              ?? null,
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

/**
 * Persist one task (insert or update).
 *
 * Strips UI-only / computed fields before writing so Supabase never sees
 * a column that doesn't exist in the schema.
 */
export async function saveTask(task) {
  const {
    // UI-only / join fields — never written to DB
    substeps, scheduled_days,
    catName, catColor, catId,
    // field aliases — normalised below
    manual_progress, manualProgress,
    dueDate, estimatedHours,
    // pass everything else straight through
    ...rest
  } = task;

  const row = {
    ...rest,
    status:   toDbStatus(rest.status),
    progress: manual_progress ?? manualProgress ?? rest.progress ?? 0,
    // Coerce nullish recurring fields to explicit null so Supabase
    // doesn't try to write undefined (which it ignores, leaving stale values).
    recurring:             rest.recurring             ?? false,
    recurring_type:        rest.recurring_type        ?? null,
    recurring_cadence:     rest.recurring_cadence     ?? null,
    recurring_until:       rest.recurring_until       ?? null,
    recurring_instances:   rest.recurring_instances   ?? null,
    is_recurring_template: rest.is_recurring_template ?? false,
    recurring_template_id: rest.recurring_template_id ?? null,
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
 * Called once on app load (in useAppData).  Scans all 'reset'-mode recurring
 * tasks whose status is 'done' and checks whether the cadence window has rolled
 * over since they were last completed.  If so, resets them to 'not-started'.
 *
 * Returns the updated task objects so the caller can merge them into state.
 *
 * Cadence logic:
 *   daily   — resets if updated_at is before today (local date)
 *   weekday — resets if updated_at is before today AND today is Mon–Fri
 *   weekly  — resets if updated_at is more than 7 calendar days ago
 */
export async function resetStaleRecurringTasks(tasks, userId) {
  const today      = new Date();
  const todayStr   = today.toISOString().slice(0, 10);   // 'YYYY-MM-DD'
  const dayOfWeek  = today.getDay();                     // 0=Sun … 6=Sat
  const isWeekday  = dayOfWeek >= 1 && dayOfWeek <= 5;

  const toReset = tasks.filter(t => {
    if (!t.recurring || t.recurring_type !== 'reset') return false;
    if (t.status !== 'done') return false;
    if (!t.updated_at) return true; // no timestamp → safe to reset

    const lastDone    = t.updated_at.slice(0, 10);       // 'YYYY-MM-DD'
    const lastDoneDay = new Date(lastDone);
    const daysDiff    = Math.floor((today - lastDoneDay) / 86_400_000);

    switch (t.recurring_cadence) {
      case 'daily':   return lastDone < todayStr;
      case 'weekday': return lastDone < todayStr && isWeekday;
      case 'weekly':  return daysDiff >= 7;
      default:        return lastDone < todayStr;
    }
  });

  if (toReset.length === 0) return [];

  // Batch update in Supabase — one round-trip per task (small N in practice)
  const updated = await Promise.all(
    toReset.map(t =>
      saveTask({ ...t, status: 'not-started', manual_progress: 0 })
    )
  );

  return updated;
}

// ── Recurring: expand (spawn instances) ──────────────────────────────────────
/**
 * expandRecurringTemplate(template, userId)
 *
 * For 'expand'-mode recurring tasks.  Given a saved template row, generates
 * individual task instances through recurring_until or recurring_instances,
 * inserts them all, and returns the new rows.
 *
 * Each instance:
 *   - is a full copy of the template minus the recurring fields
 *   - has recurring_template_id pointing at the template
 *   - gets a due_date set to its occurrence date
 *   - is_recurring_template = false
 *   - recurring = false (instances are plain tasks)
 */
export async function expandRecurringTemplate(template, userId) {
  const cadence  = template.recurring_cadence || 'daily';
  const until    = template.recurring_until    ? new Date(template.recurring_until) : null;
  const maxCount = template.recurring_instances ?? 10;

  const dates = [];
  const cursor = new Date();           // start from today
  cursor.setHours(0, 0, 0, 0);

  while (true) {
    const dow = cursor.getDay();
    const eligible =
      cadence === 'daily'   ? true :
      cadence === 'weekday' ? (dow >= 1 && dow <= 5) :
      cadence === 'weekly'  ? (dow === (new Date().getDay())) :
      true;

    if (eligible) {
      dates.push(cursor.toISOString().slice(0, 10));
    }

    if (until  && cursor >= until)              break;
    if (!until && dates.length >= maxCount)     break;
    if (dates.length >= 365)                    break;  // hard safety cap

    cursor.setDate(cursor.getDate() + 1);
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
    recurring_until:       null,
    recurring_instances:   null,
    is_recurring_template: false,
    recurring_template_id: template.id,
  }));

  const { data, error } = await supabase
    .from('tasks')
    .insert(rows)
    .select();
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

// ── Scheduled Days ────────────────────────────────────────────────────────────

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
