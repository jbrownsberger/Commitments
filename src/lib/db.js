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
 *   recurring_cadence        — 'daily' | 'weekday' | 'weekly' |
 *                              'every_N_days' | 'every_N_weeks' | 'every_N_months'
 *   recurring_type           — 'reset' | 'expand'
 *   recurring_dow            — 0–6 (Sun=0…Sat=6), set ONLY for weekly tasks.
 *                              This is the source of truth for which day the
 *                              task recurs on.  due_date is always the NEXT
 *                              upcoming occurrence of that weekday and is
 *                              re-derived from recurring_dow on every save.
 *   recurring_until          — date string, end date for expand tasks
 *   recurring_instances      — integer, max occurrences for expand tasks
 *   is_recurring_template    — boolean, true on the master expand row
 *   recurring_template_id    — uuid FK back to the template row
 *   updated_at               — timestamptz, auto-set by trigger
 *
 * Date handling:
 *   ALL date strings are 'YYYY-MM-DD'.  We NEVER pass a bare ISO date string
 *   to `new Date()` because that is interpreted as UTC midnight, which shifts
 *   the local date by the UTC offset.  Instead use parseLocalDate() which
 *   builds a local-midnight Date from the numeric parts.
 *
 * Reset scheduling:
 *   due_date is the anchor for reset-mode tasks.  On each reset, due_date
 *   advances to the next occurrence of recurring_dow (for weekly tasks) or
 *   by one cadence period (all others) from its *previous* value, so the
 *   schedule never drifts even when tasks are completed late.
 *
 *   Behaviour:
 *     - status becomes 'done' + now >= due_date  → reset & advance due_date
 *     - status becomes 'done' + now < due_date   → stay done until due_date arrives
 *     - status NOT done       + now >= due_date  → show as overdue, do NOT reset
 */
import { supabase } from './supabase.js';

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a 'YYYY-MM-DD' string into a LOCAL midnight Date.
 * Never use `new Date(dateString)` for bare dates — it is UTC-interpreted.
 */
export function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/** Format a Date as 'YYYY-MM-DD' in local time. */
export function formatLocalDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return the LOCAL date string for the next (or today's) occurrence of `dow`
 * (0=Sun … 6=Sat) at or after `fromDate` (a local-midnight Date or 'YYYY-MM-DD').
 * This is the canonical way to compute weekly due_dates — it looks at the
 * actual weekday, so +7-day arithmetic can never shift the day of week.
 */
export function nextOccurrenceOfDow(dow, fromDate) {
  const base = typeof fromDate === 'string' ? parseLocalDate(fromDate) : new Date(fromDate);
  base.setHours(0, 0, 0, 0);
  const diff = (dow - base.getDay() + 7) % 7;
  const result = new Date(base);
  result.setDate(result.getDate() + diff);
  return formatLocalDate(result);
}

/**
 * Return the LOCAL date string for the NEXT (strictly future) occurrence of
 * `dow` after `fromDate`.  Always advances at least one day.
 */
export function nextFutureOccurrenceOfDow(dow, fromDate) {
  const base = typeof fromDate === 'string' ? parseLocalDate(fromDate) : new Date(fromDate);
  base.setHours(0, 0, 0, 0);
  // Advance one day first so we never return fromDate itself.
  base.setDate(base.getDate() + 1);
  return nextOccurrenceOfDow(dow, base);
}

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
 * Advance `fromDate` by exactly one cadence period and return the new LOCAL
 * date string.  For 'weekly' cadences the task MUST have a recurring_dow set;
 * pass it as the third argument and the next occurrence of that weekday is
 * returned — making it impossible for the day-of-week to drift.
 *
 * For all other cadences `dow` is ignored.
 */
export function nextScheduledDate(cadence, fromDate, dow) {
  const d = typeof fromDate === 'string' ? parseLocalDate(fromDate) : new Date(fromDate);
  d.setHours(0, 0, 0, 0);

  if (!cadence || cadence === 'daily') {
    d.setDate(d.getDate() + 1);
    return formatLocalDate(d);
  }

  if (cadence === 'weekday') {
    // Advance to the next Mon–Fri.
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return formatLocalDate(d);
  }

  if (cadence === 'weekly') {
    // Always jump to the next occurrence of the canonical weekday.
    // If dow is somehow undefined, fall back to +7 days.
    if (dow !== undefined && dow !== null) {
      return nextFutureOccurrenceOfDow(dow, d);
    }
    d.setDate(d.getDate() + 7);
    return formatLocalDate(d);
  }

  // custom: 'every_N_days' | 'every_N_weeks' | 'every_N_months'
  const m = cadence.match(/^every_(\d+)_(day|week|month)s?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (m[2] === 'day')   { d.setDate(d.getDate() + n);   return formatLocalDate(d); }
    if (m[2] === 'week') {
      // every_N_weeks also respects dow if provided.
      if (dow !== undefined && dow !== null) {
        d.setDate(d.getDate() + n * 7);
        return nextOccurrenceOfDow(dow, d);
      }
      d.setDate(d.getDate() + n * 7);
      return formatLocalDate(d);
    }
    if (m[2] === 'month') { d.setMonth(d.getMonth() + n); return formatLocalDate(d); }
  }

  // fallback
  d.setDate(d.getDate() + 1);
  return formatLocalDate(d);
}

/**
 * Keep advancing by one cadence period until the result is strictly in the
 * future (> today).  Handles tasks completed very late whose next scheduled
 * date is already in the past.
 */
export function nextFutureScheduledDate(cadence, fromDate, dow) {
  const today = formatLocalDate(new Date());
  let cur = typeof fromDate === 'string' ? fromDate : formatLocalDate(fromDate);
  do {
    cur = nextScheduledDate(cadence, cur, dow);
  } while (cur <= today);
  return cur;
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
    .from('user_preferences').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || {};
}
export async function savePreferences(prefs) {
  const { user_id, ...rest } = prefs;
  const { data, error } = await supabase
    .from('user_preferences').upsert({ user_id, ...rest }).select().single();
  if (error) throw error;
  return data;
}

// ── Categories ────────────────────────────────────────────────────────────────
export async function fetchCategories(userId) {
  const { data, error } = await supabase
    .from('categories').select('*').eq('user_id', userId).order('position');
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
    recurring:               rest.recurring               ?? false,
    recurring_type:          rest.recurring_type          ?? null,
    recurring_cadence:       rest.recurring_cadence       ?? null,
    recurring_dow:           rest.recurring_dow           ?? null,
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

export async function saveTask(task) {
  const {
    substeps, scheduled_days,
    catName, catColor, catId,
    manual_progress, manualProgress,
    dueDate, estimatedHours,
    ...rest
  } = task;

  // For weekly reset tasks: always re-derive due_date from recurring_dow so
  // the stored date is guaranteed to fall on the right day of the week.
  let resolvedDueDate = rest.due_date ?? null;
  if (
    rest.recurring &&
    rest.recurring_type === 'reset' &&
    rest.recurring_cadence === 'weekly' &&
    rest.recurring_dow !== null &&
    rest.recurring_dow !== undefined
  ) {
    const today = formatLocalDate(new Date());
    // If the stored due_date already falls on the right DOW and is in the
    // future (or today), keep it — don't bump it forward unnecessarily.
    const keepExisting =
      resolvedDueDate &&
      parseLocalDate(resolvedDueDate).getDay() === rest.recurring_dow &&
      resolvedDueDate >= today;
    if (!keepExisting) {
      resolvedDueDate = nextOccurrenceOfDow(rest.recurring_dow, today);
    }
  }

  const row = {
    ...rest,
    due_date:  resolvedDueDate,
    status:   toDbStatus(rest.status),
    progress: manual_progress ?? manualProgress ?? rest.progress ?? 0,
    recurring:             rest.recurring             ?? false,
    recurring_type:        rest.recurring_type        ?? null,
    recurring_cadence:     rest.recurring_cadence     ?? null,
    recurring_dow:         rest.recurring_dow         ?? null,
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
 * Called once on app load.  For each reset-mode recurring task:
 *
 *   Case A — status is 'done' AND now >= due_date:
 *     Reset to 'not-started', advance due_date:
 *       - weekly  → next future occurrence of recurring_dow after due_date
 *       - others  → one cadence period after due_date
 *     Always advances from the *scheduled* due_date, not from today.
 *
 *   Case B — status is 'done' AND now < due_date:
 *     Leave as-is (completed early; wait for due_date).
 *
 *   Case C — status is NOT 'done' AND now >= due_date:
 *     Leave as-is (overdue; do not reset until user completes it).
 *
 *   Case D — status is NOT 'done' AND now < due_date:
 *     Nothing to do.
 */
export async function resetStaleRecurringTasks(tasks, userId) {
  const today = formatLocalDate(new Date());

  const toReset = tasks.filter(t => {
    if (!t.recurring || t.recurring_type !== 'reset') return false;
    if (t.status !== 'done') return false;
    if (!t.due_date) return false;
    return t.due_date <= today;  // Case A only
  });

  if (toReset.length === 0) return [];

  const updated = await Promise.all(
    toReset.map(t => {
      const nextDue = nextFutureScheduledDate(
        t.recurring_cadence,
        t.due_date,
        t.recurring_dow ?? undefined,
      );
      return saveTask({
        ...t,
        status:          'not-started',
        manual_progress: 0,
        due_date:        nextDue,
      });
    })
  );

  return updated;
}

// ── Recurring: expand (spawn instances) ──────────────────────────────────────
export async function expandRecurringTemplate(template, userId) {
  const cadence  = template.recurring_cadence || 'daily';
  const dow      = template.recurring_dow ?? undefined;
  const until    = template.recurring_until ? parseLocalDate(template.recurring_until) : null;
  const maxCount = template.recurring_instances ?? 10;

  const dates = [];
  let cursor = formatLocalDate(new Date());

  while (true) {
    const curDate = parseLocalDate(cursor);
    const dayOfWeek = curDate.getDay();
    const eligible =
      cadence === 'weekday' ? (dayOfWeek >= 1 && dayOfWeek <= 5) : true;

    if (eligible) dates.push(cursor);
    if (until && curDate >= until)           break;
    if (!until && dates.length >= maxCount)  break;
    if (dates.length >= 365)                 break;

    cursor = (cadence === 'daily' || cadence === 'weekday')
      ? (() => { const d = parseLocalDate(cursor); d.setDate(d.getDate() + 1); return formatLocalDate(d); })()
      : nextScheduledDate(cadence, cursor, dow);
  }

  if (dates.length === 0) return [];

  const rows = dates.map((due_date, i) => ({
    user_id:               userId,
    category_id:           template.category_id,
    name:                  template.name,
    status:                'not-started',
    priority:              template.priority     || 'med',
    estimated_hours:       template.estimated_hours || 1,
    notes:                 template.notes        || null,
    progress:              0,
    position:              (template.position ?? 0) + i + 1,
    due_date,
    recurring:             false,
    recurring_type:        null,
    recurring_cadence:     null,
    recurring_dow:         null,
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
    .from('substeps').select('*').eq('user_id', userId).order('position');
  if (error) throw error;
  return data || [];
}
export async function saveSubstep(substep) {
  // Pass all fields through — weight is a real column on the substeps table.
  const isNew = !substep.id;
  let data, error;
  if (isNew) {
    ({ data, error } = await supabase.from('substeps').insert(substep).select().single());
  } else {
    const { id, ...fields } = substep;
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
    .from('quick_tasks').select('*').eq('user_id', userId).order('position');
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
    .from('scheduled_days').select('task_id, day_date')
    .eq('user_id', userId).gte('day_date', from).lte('day_date', to);
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
