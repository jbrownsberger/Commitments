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
 *   recurring                     — boolean
 *   recurring_cadence             — 'daily' | 'weekday' | 'weekly' | 'monthly' |
 *                                   'every_N_days' | 'every_N_weeks' | 'every_N_months'
 *   recurring_type                — 'reset' (Rolling) | 'expand' (Series)
 *   recurring_dow                 — 0–6 (Sun=0…Sat=6) for weekly / optional every_N_weeks
 *   recurring_dom                 — 1–31 day-of-month for monthly / every_N_months
 *   recurring_start               — first occurrence / series start date
 *   recurring_until               — series end date (inclusive)
 *   recurring_instances           — series max occurrence count
 *   is_recurring_template         — true on series master row (hidden from work lists)
 *   recurring_template_id         — uuid FK from instance → template
 *   recurring_last_completed_at   — when a rolling task last rolled forward
 *   due_date                      — current occurrence due (rolling) or instance due
 *
 * Schedule math lives in ./recurrence.js.  Rolling advances on complete;
 * series materializes dated instances from a hidden template.
 */
import { supabase } from './supabase.js';
import {
  parseLocalDate,
  formatLocalDate,
  todayStr,
  ruleFromTask,
  nextFutureOccurrence,
  firstOccurrenceOnOrAfter,
  enumerateOccurrences,
  isRollingTask,
  isSeriesTemplate,
} from './recurrence.js';

// Re-export date helpers so existing imports from db.js keep working.
export {
  parseLocalDate,
  formatLocalDate,
  todayStr,
  nextOccurrenceOfDow,
  nextScheduledDate,
  nextFutureScheduledDate,
  isRollingTask,
  isSeriesTemplate,
  isWorkTask,
  isSeriesInstance,
  cadenceLabel,
  ruleFromTask,
} from './recurrence.js';

// ── Status helpers ────────────────────────────────────────────────────────────
export function toDbStatus(s) {
  if (!s) return 'not-started';
  return s.replace(' ', '-');
}
export function toUiStatus(s) {
  if (!s) return 'not started';
  return s.replace('-', ' ');
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
export const resetPasswordForEmail = (email) =>
  supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}?recovery=1`,
  });
export const updatePassword = (newPassword) =>
  supabase.auth.updateUser({ password: newPassword });

// ── Preferences ───────────────────────────────────────────────────────────────
export async function fetchPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || {};
}
export async function savePreferences(prefs) {
  // last_push_digest_on is owned by the cron job — never overwrite it from the client.
  const { user_id, last_push_digest_on: _digestStamp, ...rest } = prefs;
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
    links:               Array.isArray(t.links) ? t.links : [],
    substeps:            (t.substeps || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    recurring:                     rest.recurring                     ?? false,
    recurring_type:                rest.recurring_type                ?? null,
    recurring_cadence:             rest.recurring_cadence             ?? null,
    recurring_dow:                 rest.recurring_dow                 ?? null,
    recurring_dom:                 rest.recurring_dom                 ?? null,
    recurring_start:               rest.recurring_start               ?? null,
    recurring_until:               rest.recurring_until               ?? null,
    recurring_instances:           rest.recurring_instances           ?? null,
    is_recurring_template:         rest.is_recurring_template         ?? false,
    recurring_template_id:         rest.recurring_template_id         ?? null,
    recurring_last_completed_at:   rest.recurring_last_completed_at   ?? null,
    updated_at:                    rest.updated_at                    ?? null,
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

/** App-only keys that must never be sent to Supabase `tasks` rows. */
const TASK_APP_ONLY_KEYS = new Set([
  'substeps', 'scheduled_days', 'catName', 'catColor', 'catId',
  'manual_progress', 'manualProgress', 'dueDate', 'estimatedHours',
  '_cat',   // UI-only category object attached by Shell's openPanel / search flow
]);

export async function saveTask(task) {
  const {
    substeps, scheduled_days,
    catName, catColor, catId,
    manual_progress, manualProgress,
    dueDate, estimatedHours,
    _cat,
    ...rest
  } = task;

  // due_date is taken as given. Callers (TaskModal / advanceRollingTask) are
  // responsible for computing the correct first/next due. We no longer
  // re-derive weekly due_dates from "today" on every edit — that was a major
  // source of due-date jumps.
  let resolvedDueDate = rest.due_date ?? dueDate ?? null;

  // New rolling tasks without a due date: snap to the first valid occurrence.
  if (
    !resolvedDueDate &&
    rest.recurring &&
    rest.recurring_type === 'reset' &&
    !rest.is_recurring_template
  ) {
    const rule = ruleFromTask(rest);
    const start = rest.recurring_start || todayStr();
    resolvedDueDate = firstOccurrenceOnOrAfter(rule, start);
  }

  // Whitelist-ish: start from rest but drop any remaining app-only keys.
  const row = { ...rest };
  for (const k of TASK_APP_ONLY_KEYS) delete row[k];

  row.due_date = resolvedDueDate;
  row.status   = toDbStatus(rest.status);
  row.progress = manual_progress ?? manualProgress ?? rest.progress ?? 0;
  row.recurring                   = rest.recurring                   ?? false;
  row.recurring_type              = rest.recurring_type              ?? null;
  row.recurring_cadence           = rest.recurring_cadence           ?? null;
  row.recurring_dow               = rest.recurring_dow               ?? null;
  row.recurring_dom               = rest.recurring_dom               ?? null;
  row.recurring_start             = rest.recurring_start             ?? null;
  row.recurring_until             = rest.recurring_until             ?? null;
  row.recurring_instances         = rest.recurring_instances         ?? null;
  row.is_recurring_template       = rest.is_recurring_template       ?? false;
  row.recurring_template_id       = rest.recurring_template_id       ?? null;
  row.recurring_last_completed_at = rest.recurring_last_completed_at ?? null;

  // scheduled_day_hours is a real JSON column used by the Planner — keep it.
  if (rest.scheduled_day_hours !== undefined) {
    row.scheduled_day_hours = rest.scheduled_day_hours;
  }

  // Strip undefined so we don't clobber columns on partial updates.
  Object.keys(row).forEach(k => {
    if (row[k] === undefined) delete row[k];
  });

  const isNew = !row.id;
  let data, error;
  if (isNew) {
    ({ data, error } = await supabase.from('tasks').insert(row).select().single());
  } else {
    const { id, ...fields } = row;
    ({ data, error } = await supabase.from('tasks').update(fields).eq('id', id).select().single());
  }
  if (error) throw error;
  return dbTaskToApp({
    ...data,
    scheduled_days: scheduled_days || [],
    scheduled_day_hours: data.scheduled_day_hours || rest.scheduled_day_hours || {},
  });
}

export async function removeTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ── Recurring: rolling advance ────────────────────────────────────────────────

/**
 * Advance a rolling task to its next occurrence after completion.
 * - due_date advances from the previous due (catch-up if late)
 * - status → not-started, progress → 0
 * - substeps unchecked
 * - scheduled_days cleared
 * - recurring_last_completed_at set
 *
 * Returns the updated task with reset substeps embedded.
 */
export async function advanceRollingTask(task, userId) {
  const rule = ruleFromTask(task);
  const anchor = task.due_date || todayStr();
  const nextDue = nextFutureOccurrence(rule, anchor, todayStr());

  const savedTask = await saveTask({
    ...task,
    status: 'not-started',
    manual_progress: 0,
    due_date: nextDue,
    recurring_last_completed_at: new Date().toISOString(),
    scheduled_days: [],
    scheduled_day_hours: {},
  });

  // Clear planner assignments for the new cycle
  if (userId) {
    await setScheduledDays(task.id, userId, []).catch(() => {});
  }

  const originalSubs = task.substeps || [];
  const savedSubs = originalSubs.length > 0
    ? await Promise.all(
        originalSubs.map((s) => {
          const { id, ...fields } = s;
          return supabase
            .from('substeps')
            .update({ ...fields, done: false })
            .eq('id', id)
            .select()
            .single()
            .then(({ data, error }) => {
              if (error) throw error;
              return data;
            });
        })
      )
    : [];

  return {
    ...savedTask,
    scheduled_days: [],
    scheduled_day_hours: {},
    substeps: savedSubs,
  };
}

/**
 * Load-time catch-up for rolling tasks that are already done with due ≤ today
 * (legacy state, or a missed mid-session advance).
 */
export async function catchUpRollingTasks(tasks, userId) {
  const today = todayStr();
  const toAdvance = (tasks || []).filter(t => {
    if (!isRollingTask(t)) return false;
    if (t.status !== 'done') return false;
    if (!t.due_date) return false;
    return t.due_date <= today;
  });

  if (toAdvance.length === 0) return [];

  return Promise.all(toAdvance.map(t => advanceRollingTask(t, userId)));
}

/** @deprecated Use catchUpRollingTasks */
export const resetStaleRecurringTasks = catchUpRollingTasks;

// ── Recurring: series materialize / extend ────────────────────────────────────

function seriesDateList(template) {
  const rule = ruleFromTask(template);
  const start = template.recurring_start
    || template.due_date
    || todayStr();
  return enumerateOccurrences(rule, {
    start,
    until: template.recurring_until || null,
    count: template.recurring_instances || null,
    max: 365,
  });
}

/**
 * Insert series instance rows for a template. Clones substep templates
 * (all unchecked) onto each instance when provided.
 *
 * @param {object} template - saved template task row
 * @param {string} userId
 * @param {{ substeps?: array, existingDueDates?: Set<string> }} options
 * @returns {Promise<object[]>} new instance tasks with substeps embedded
 */
export async function materializeSeries(template, userId, options = {}) {
  const { substeps: templateSubs = [], existingDueDates = null } = options;
  const allDates = seriesDateList(template);
  const dates = existingDueDates
    ? allDates.filter(d => !existingDueDates.has(d))
    : allDates;

  if (dates.length === 0) return [];

  const rows = dates.map((due_date, i) => ({
    user_id:               userId,
    category_id:           template.category_id,
    name:                  template.name,
    status:                'not-started',
    priority:              template.priority || 'med',
    estimated_hours:       template.estimated_hours || 1,
    notes:                 template.notes || null,
    links:                 Array.isArray(template.links) ? template.links : [],
    progress:              0,
    position:              (template.position ?? 0) + i + 1,
    due_date,
    recurring:             false,
    recurring_type:        null,
    recurring_cadence:     null,
    recurring_dow:         null,
    recurring_dom:         null,
    recurring_start:       null,
    recurring_until:       null,
    recurring_instances:   null,
    is_recurring_template: false,
    recurring_template_id: template.id,
  }));

  const { data, error } = await supabase.from('tasks').insert(rows).select();
  if (error) throw error;

  const instances = (data || []).map(t => dbTaskToApp({ ...t, scheduled_days: [] }));

  // Clone substeps onto each instance
  if (templateSubs.length > 0 && instances.length > 0) {
    const subRows = [];
    for (const inst of instances) {
      templateSubs.forEach((s, i) => {
        subRows.push({
          user_id:  userId,
          task_id:  inst.id,
          text:     s.text,
          done:     false,
          weight:   s.weight ?? 1,
          position: s.position ?? i,
        });
      });
    }
    const { data: subData, error: subErr } = await supabase
      .from('substeps').insert(subRows).select();
    if (subErr) throw subErr;

    const byTask = {};
    for (const s of (subData || [])) {
      (byTask[s.task_id] ||= []).push(s);
    }
    return instances.map(inst => ({
      ...inst,
      substeps: (byTask[inst.id] || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    }));
  }

  return instances.map(inst => ({ ...inst, substeps: [] }));
}

/** @deprecated Use materializeSeries */
export const expandRecurringTemplate = (template, userId) =>
  materializeSeries(template, userId, {});

/**
 * After editing a series template, insert any missing future instances
 * implied by the new bounds (never duplicates existing due dates).
 */
export async function extendSeriesIfNeeded(template, existingInstances, userId, options = {}) {
  if (!isSeriesTemplate(template) && !(template.recurring && template.recurring_type === 'expand')) {
    return [];
  }
  const existingDueDates = new Set(
    (existingInstances || [])
      .filter(t => t.recurring_template_id === template.id)
      .map(t => t.due_date)
      .filter(Boolean)
  );
  return materializeSeries(template, userId, {
    substeps: options.substeps || template.substeps || [],
    existingDueDates,
  });
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
    'PRODID:-//TaskTriage//EN', 'CALSCALE:GREGORIAN',
  ];
  for (const task of tasks) {
    if (!task.due_date) continue;
    const cat = catMap[task.category_id];
    const due = task.due_date.replace(/-/g, '');
    const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
    lines.push(
      'BEGIN:VEVENT',
      `UID:due-${task.id}@tasktriage`,
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
        `UID:session-${task.id}-${d}@tasktriage`,
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
  a.download = 'task-triage.ics';
  a.click();
  URL.revokeObjectURL(a.href);
}
