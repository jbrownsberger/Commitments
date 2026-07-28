import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchCategories, fetchTasks, fetchSubsteps, fetchPreferences, fetchQuickTasks,
  saveCategory          as dbSaveCategory,
  removeCategory        as dbRemoveCategory,
  saveTask              as dbSaveTask,
  removeTask            as dbRemoveTask,
  saveSubstep           as dbSaveSubstep,
  removeSubstep         as dbRemoveSubstep,
  savePreferences       as dbSavePreferences,
  saveQuickTask         as dbSaveQuickTask,
  removeQuickTask       as dbRemoveQuickTask,
  setScheduledDays,
  catchUpRollingTasks,
  advanceRollingTask,
  materializeSeries,
  extendSeriesIfNeeded,
  isRollingTask,
  isSeriesTemplate,
} from '../lib/db.js';

const UNDO_LIMIT = 30;

function normaliseTaskFields(task) {
  const out = { ...task };
  if (!out.due_date && out.dueDate) { out.due_date = out.dueDate; }
  delete out.dueDate;
  if (!out.estimated_hours && out.estimatedHours) { out.estimated_hours = parseFloat(out.estimatedHours); }
  delete out.estimatedHours;
  if (out.manual_progress === undefined && out.manualProgress !== undefined) { out.manual_progress = out.manualProgress; }
  delete out.manualProgress;
  return out;
}

// Patch only the rows that were touched, by id.
function mergeUpdatedTasks(prev, updated) {
  if (!updated || updated.length === 0) return prev;
  const byId = Object.fromEntries(updated.map(t => [t.id, t]));
  return prev.map(t => byId[t.id] ? { ...t, ...byId[t.id] } : t);
}

export function useAppData(userId) {
  const [categories,  setCategories]  = useState([]);
  const [tasks,       setTasks]       = useState([]);
  const [substeps,    setSubsteps]    = useState([]);
  const [preferences, setPreferences] = useState(null);
  const [quickTasks,  setQuickTasks]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [cats, tsks, subs, prefs, qts] = await Promise.all([
          fetchCategories(userId),
          fetchTasks(userId),
          fetchSubsteps(userId),
          fetchPreferences(userId),
          fetchQuickTasks(userId),
        ]);

        const tasksWithSubs = tsks.map(t => ({
          ...t,
          substeps: subs.filter(s => s.task_id === t.id),
        }));

        // ── Catch-up: rolling tasks left done under the old system ────────────
        // Primary advance happens on complete; this is a safety net only.
        const resetTasks = await catchUpRollingTasks(tasksWithSubs, userId)
          .catch(e => { console.warn('recurring catch-up skipped:', e.message); return []; });

        const finalTasks = mergeUpdatedTasks(tasksWithSubs, resetTasks);

        setCategories(cats || []);
        setTasks(finalTasks || []);
        setSubsteps(subs || []);
        setPreferences(prefs || {});
        setQuickTasks(qts || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  // ── Undo / redo ─────────────────────────────────────────────────────────────
  const snapshot = useCallback(() => ({
    categories:  JSON.parse(JSON.stringify(categories)),
    tasks:       JSON.parse(JSON.stringify(tasks)),
    quickTasks:  JSON.parse(JSON.stringify(quickTasks)),
    preferences: JSON.parse(JSON.stringify(preferences)),
  }), [categories, tasks, quickTasks, preferences]);

  const pushUndo = useCallback(() => {
    undoStack.current = [...undoStack.current.slice(-UNDO_LIMIT), snapshot()];
    redoStack.current = [];
  }, [snapshot]);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current = [...redoStack.current, snapshot()];
    const prev = undoStack.current.pop();
    setCategories(prev.categories);
    setTasks(prev.tasks);
    setQuickTasks(prev.quickTasks);
    if (prev.preferences !== undefined) setPreferences(prev.preferences);
  }, [snapshot]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current = [...undoStack.current, snapshot()];
    const next = redoStack.current.pop();
    setCategories(next.categories);
    setTasks(next.tasks);
    setQuickTasks(next.quickTasks);
    if (next.preferences !== undefined) setPreferences(next.preferences);
  }, [snapshot]);

  // ── Categories ──────────────────────────────────────────────────────────────
  const saveCategory = useCallback(async (cat) => {
    pushUndo();
    const saved = await dbSaveCategory({ ...cat, user_id: userId });
    setCategories(prev =>
      cat.id
        ? prev.map(c => c.id === saved.id ? saved : c)
        : [...prev, saved]
    );
    return saved;
  }, [userId, pushUndo]);

  const removeCategory = useCallback(async (id) => {
    pushUndo();
    await dbRemoveCategory(id);
    setCategories(prev => prev.filter(c => c.id !== id));
    setTasks(prev => prev.filter(t => t.category_id !== id));
  }, [pushUndo]);

  // ── Tasks ───────────────────────────────────────────────────────────────────
  const saveTask = useCallback(async (task) => {
    pushUndo();

    // Snapshot pre-save state for rolling "transitioned to done" detection.
    const prevTask = task.id
      ? tasks.find(t => t.id === task.id)
      : null;
    const wasDone = prevTask?.status === 'done';

    const { substeps: subs, ...taskData } = normaliseTaskFields(task);
    let saved = await dbSaveTask({ ...taskData, user_id: userId });

    // Persist substeps
    let savedSubs = (subs && subs.length > 0)
      ? await Promise.all(
          subs.map((s, i) => dbSaveSubstep({ ...s, task_id: saved.id, user_id: userId, position: i }))
        )
      : (subs ?? []);

    saved = { ...saved, substeps: savedSubs };

    // ── Rolling: advance immediately when the task becomes done ──────────────
    const nowDone = saved.status === 'done';
    const becameDone = nowDone && !wasDone;
    // Also treat progress hitting 100 / explicit done on a rolling task as complete
    // even if prev was already done (no double-advance).
    if (isRollingTask(saved) && becameDone) {
      try {
        const advanced = await advanceRollingTask(
          { ...saved, substeps: savedSubs },
          userId,
        );
        saved = advanced;
        savedSubs = advanced.substeps || [];
      } catch (e) {
        console.warn('rolling advance skipped:', e.message);
      }
    }

    // ── Series: materialize instances for new templates ──────────────────────
    let newInstances = [];
    const isNewSeries = !task.id && isSeriesTemplate(saved);
    if (isNewSeries) {
      newInstances = await materializeSeries(saved, userId, { substeps: savedSubs })
        .catch(e => { console.warn('series materialize skipped:', e.message); return []; });
    }

    // ── Series: extend on edit when bounds grow ──────────────────────────────
    if (task.id && isSeriesTemplate(saved)) {
      const existing = tasks.filter(t => t.recurring_template_id === saved.id);
      newInstances = await extendSeriesIfNeeded(saved, existing, userId, {
        substeps: savedSubs,
      }).catch(e => { console.warn('series extend skipped:', e.message); return []; });
    }

    setTasks(prev => {
      const existing = prev.find(t => t.id === saved.id);
      const withSubs = {
        ...saved,
        scheduled_days:      saved.scheduled_days      ?? existing?.scheduled_days      ?? task.scheduled_days      ?? [],
        scheduled_day_hours: saved.scheduled_day_hours ?? existing?.scheduled_day_hours ?? task.scheduled_day_hours ?? {},
        substeps:            savedSubs ?? existing?.substeps ?? [],
      };

      // When rolling advanced, also clear scheduled days in local state.
      if (isRollingTask(withSubs) && becameDone) {
        withSubs.scheduled_days = [];
        withSubs.scheduled_day_hours = {};
      }

      let base = task.id
        ? prev.map(t => t.id === saved.id ? withSubs : t)
        : [...prev, withSubs];

      if (newInstances.length > 0) {
        // Avoid duplicates if extend re-ran
        const existingIds = new Set(base.map(t => t.id));
        const fresh = newInstances.filter(t => !existingIds.has(t.id));
        base = [...base, ...fresh];
      }
      return base;
    });

    // Keep flat substeps list roughly in sync for any consumers
    if (savedSubs && savedSubs.length > 0) {
      setSubsteps(prev => {
        const byId = Object.fromEntries(prev.map(s => [s.id, s]));
        for (const s of savedSubs) byId[s.id] = s;
        // Also merge instance substeps
        for (const inst of newInstances) {
          for (const s of (inst.substeps || [])) byId[s.id] = s;
        }
        return Object.values(byId);
      });
    }

    return saved;
  }, [userId, pushUndo, tasks]);

  const removeTask = useCallback(async (id) => {
    pushUndo();
    await dbRemoveTask(id);
    // Also sweep any expand instances that belong to this template
    setTasks(prev => prev.filter(t => t.id !== id && t.recurring_template_id !== id));
  }, [pushUndo]);

  // ── Substeps ────────────────────────────────────────────────────────────────
  const saveSubstep = useCallback(async (substep) => {
    const saved = await dbSaveSubstep({ ...substep, user_id: userId });
    setTasks(prev => prev.map(t =>
      t.id === saved.task_id
        ? { ...t, substeps: t.substeps
            ? t.substeps.map(s => s.id === saved.id ? saved : s)
            : [saved] }
        : t
    ));
    return saved;
  }, [userId]);

  const removeSubstep = useCallback(async (taskId, substepId) => {
    await dbRemoveSubstep(substepId);
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, substeps: (t.substeps || []).filter(s => s.id !== substepId) }
        : t
    ));
  }, []);

  // ── Preferences ─────────────────────────────────────────────────────────────
  const savePreferences = useCallback(async (prefs) => {
    const saved = await dbSavePreferences({ ...prefs, user_id: userId });
    setPreferences(saved);
    return saved;
  }, [userId]);

  // ── Quick Tasks ─────────────────────────────────────────────────────────────
  const saveQuickTask = useCallback(async (qt) => {
    pushUndo();
    const saved = await dbSaveQuickTask({ ...qt, user_id: userId });
    setQuickTasks(prev =>
      qt.id && prev.find(q => q.id === qt.id)
        ? prev.map(q => q.id === saved.id ? saved : q)
        : [...prev, saved]
    );
    return saved;
  }, [userId, pushUndo]);

  const removeQuickTask = useCallback(async (id) => {
    pushUndo();
    await dbRemoveQuickTask(id);
    setQuickTasks(prev => prev.filter(q => q.id !== id));
  }, [pushUndo]);

  // ── Scheduled Days ──────────────────────────────────────────────────────────
  const setTaskSchedule = useCallback(async (taskId, dates) => {
    await setScheduledDays(taskId, userId, dates);
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, scheduled_days: [...dates].sort() }
        : t
    ));
  }, [userId]);

  return {
    categories, tasks, substeps, preferences, quickTasks,
    loading, error,
    saveCategory, removeCategory,
    saveTask, removeTask,
    saveSubstep, removeSubstep,
    savePreferences,
    saveQuickTask, removeQuickTask,
    setTaskSchedule,
    undo, redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
