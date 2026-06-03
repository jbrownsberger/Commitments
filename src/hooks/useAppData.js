import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchCategories, fetchTasks, fetchSubsteps, fetchPreferences, fetchQuickTasks,
  saveCategory    as dbSaveCategory,
  removeCategory  as dbRemoveCategory,
  saveTask        as dbSaveTask,
  removeTask      as dbRemoveTask,
  saveSubstep     as dbSaveSubstep,
  removeSubstep   as dbRemoveSubstep,
  savePreferences as dbSavePreferences,
  saveQuickTask   as dbSaveQuickTask,
  removeQuickTask as dbRemoveQuickTask,
  setScheduledDays,
} from '../lib/db.js';

const UNDO_LIMIT = 30;

/**
 * Normalise camelCase / legacy field names to snake_case DB columns
 * before writing.  db.js strips fields it doesn't know, but we must
 * ensure the right keys are present.
 */
function normaliseTaskFields(task) {
  const out = { ...task };
  // due_date — accept dueDate as alias
  if (!out.due_date && out.dueDate) {
    out.due_date = out.dueDate;
  }
  delete out.dueDate;
  // estimated_hours — accept estimatedHours as alias
  if (!out.estimated_hours && out.estimatedHours) {
    out.estimated_hours = parseFloat(out.estimatedHours);
  }
  delete out.estimatedHours;
  // manual_progress — accept manualProgress as alias
  if (out.manual_progress === undefined && out.manualProgress !== undefined) {
    out.manual_progress = out.manualProgress;
  }
  delete out.manualProgress;
  return out;
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

  // ── Initial load ──────────────────────────────────────────────────────────
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
        setCategories(cats || []);
        setTasks(tasksWithSubs || []);
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

  // ── Snapshot for undo ─────────────────────────────────────────────────────
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

  // ── Category CRUD ─────────────────────────────────────────────────────────
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

  // ── Task CRUD ─────────────────────────────────────────────────────────────
  const saveTask = useCallback(async (task) => {
    pushUndo();
    const { substeps: subs, ...taskData } = normaliseTaskFields(task);
    const saved = await dbSaveTask({ ...taskData, user_id: userId });

    // Save substeps if provided alongside a new task
    let savedSubs = (subs && subs.length > 0)
      ? await Promise.all(
          subs.map((s, i) => dbSaveSubstep({ ...s, task_id: saved.id, user_id: userId, position: i }))
        )
      : subs;

    setTasks(prev => {
      const withSubs = { ...saved, substeps: savedSubs || [] };
      return task.id
        ? prev.map(t => t.id === saved.id ? withSubs : t)
        : [...prev, withSubs];
    });
    return saved;
  }, [userId, pushUndo]);

  const removeTask = useCallback(async (id) => {
    pushUndo();
    await dbRemoveTask(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }, [pushUndo]);

  // ── Substep CRUD ──────────────────────────────────────────────────────────
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

  // ── Preferences ───────────────────────────────────────────────────────────
  const savePreferences = useCallback(async (prefs) => {
    const saved = await dbSavePreferences({ ...prefs, user_id: userId });
    setPreferences(saved);
    return saved;
  }, [userId]);

  // ── Quick Tasks ───────────────────────────────────────────────────────────
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

  // ── Scheduled Days ────────────────────────────────────────────────────────
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
