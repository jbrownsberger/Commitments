/**
 * Data access layer — all Supabase queries live here.
 * Components never import supabase directly; they call these functions.
 */
import { supabase } from './supabase.js';

// ── Auth ─────────────────────────────────────────────────────────────────────

export const signInWithMagicLink = (email) =>
  supabase.auth.signInWithOtp({ email });

export const signInWithPassword = (email, password) =>
  supabase.auth.signInWithPassword({ email, password });

export const signUpWithPassword = (email, password) =>
  supabase.auth.signUp({ email, password });

export const signOut = () => supabase.auth.signOut();

export const getSession = () => supabase.auth.getSession();

export const onAuthChange = (cb) =>
  supabase.auth.onAuthStateChange((_event, session) => cb(session));

// ── User Preferences ─────────────────────────────────────────────────────────

export async function getPreferences(userId) {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertPreferences(userId, prefs) {
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function getCategories(userId) {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  return data;
}

export async function upsertCategory(category) {
  const { data, error } = await supabase
    .from('categories')
    .upsert(category)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function getTasks(userId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, substeps(*), scheduled_days(day_date)')
    .eq('user_id', userId)
    .order('position');
  if (error) throw error;
  // Normalize scheduled_days to a plain array of ISO strings
  return data.map(t => ({
    ...t,
    scheduled_days: (t.scheduled_days || []).map(r => r.day_date).sort(),
    substeps: (t.substeps || []).sort((a, b) => a.position - b.position),
  }));
}

export async function upsertTask(task) {
  const { scheduled_days, substeps, ...taskRow } = task;
  const { data, error } = await supabase
    .from('tasks')
    .upsert(taskRow)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ── Substeps ─────────────────────────────────────────────────────────────────

export async function upsertSubstep(substep) {
  const { data, error } = await supabase
    .from('substeps')
    .upsert(substep)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSubstep(id) {
  const { error } = await supabase.from('substeps').delete().eq('id', id);
  if (error) throw error;
}

// ── Scheduled Days ────────────────────────────────────────────────────────────

/**
 * Replace all scheduled days for a task atomically.
 * Deletes existing rows then inserts the new set.
 */
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

// ── ICS Export ───────────────────────────────────────────────────────────────

export function generateICS(tasks, categories) {
  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Commitments//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const task of tasks) {
    if (!task.due_date) continue;
    const cat  = catMap[task.category_id];
    const due  = task.due_date.replace(/-/g, '');
    const now  = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';

    // Due-date event
    lines.push(
      'BEGIN:VEVENT',
      `UID:due-${task.id}@commitments`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${due}`,
      `DTEND;VALUE=DATE:${due}`,
      `SUMMARY:⏰ ${task.name}`,
      `CATEGORIES:${cat ? cat.name : 'Uncategorized'}`,
      `DESCRIPTION:${(task.notes || '').replace(/\n/g, '\\n')}`,
      'END:VEVENT'
    );

    // One work-session event per scheduled day
    for (const day of (task.scheduled_days || [])) {
      const d = day.replace(/-/g, '');
      lines.push(
        'BEGIN:VEVENT',
        `UID:session-${task.id}-${d}@commitments`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${d}`,
        `DTEND;VALUE=DATE:${d}`,
        `SUMMARY:🗂 ${task.name}`,
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
