/**
 * Central data hook — owns loading, optimistic updates, and undo stack.
 * Mirrors the shape of the old `state` object so UI logic ports cleanly.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import * as db from '../lib/db.js';

export function useAppData(userId) {
  const [categories,   setCategories]   = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [preferences,  setPreferences]  = useState({ weekly_hours: 20, session_hours: 1 });
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  // Undo stack: each entry is a snapshot of { categories, tasks }
  const undoStack = useRef([]);
  const redoStack = useRef([]);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [cats, ts, prefs] = await Promise.all([
        db.getCategories(userId),
        db.getTasks(userId),
        db.getPreferences(userId),
      ]);
      setCategories(cats);
      setTasks(ts);
      setPreferences(prefs);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  // ── Undo / Redo ────────────────────────────────────────────────────────────
  const pushUndo = useCallback(() => {
    undoStack.current.push({ categories, tasks });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [categories, tasks]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ categories, tasks });
    setCategories(prev.categories);
    setTasks(prev.tasks);
  }, [categories, tasks]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ categories, tasks });
    setCategories(next.categories);
    setTasks(next.tasks);
  }, [categories, tasks]);

  // ── Category mutations ─────────────────────────────────────────────────────
  const saveCategory = useCallback(async (cat) => {
    pushUndo();
    const saved = await db.upsertCategory({ ...cat, user_id: userId });
    setCategories(prev => {
      const idx = prev.findIndex(c => c.id === saved.id);
      return idx >= 0
        ? prev.map(c => c.id === saved.id ? saved : c)
        : [...prev, saved];
    });
    return saved;
  }, [userId, pushUndo]);

  const removeCategory = useCallback(async (id) => {
    pushUndo();
    await db.deleteCategory(id);
    setCategories(prev => prev.filter(c => c.id !== id));
    setTasks(prev => prev.filter(t => t.category_id !== id));
  }, [pushUndo]);

  // ── Task mutations ─────────────────────────────────────────────────────────
  const saveTask = useCallback(async (task) => {
    pushUndo();
    const saved = await db.upsertTask({ ...task, user_id: userId });
    // Persist scheduled days separately
    if (task.scheduled_days !== undefined) {
      await db.setScheduledDays(saved.id, userId, task.scheduled_days);
      saved.scheduled_days = task.scheduled_days;
    }
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === saved.id);
      return idx >= 0
        ? prev.map(t => t.id === saved.id ? { ...prev[idx], ...saved } : t)
        : [...prev, { ...saved, substeps: [], scheduled_days: [] }];
    });
    return saved;
  }, [userId, pushUndo]);

  const removeTask = useCallback(async (id) => {
    pushUndo();
    await db.deleteTask(id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }, [pushUndo]);

  // ── Substep mutations ──────────────────────────────────────────────────────
  const saveSubstep = useCallback(async (substep) => {
    const saved = await db.upsertSubstep({ ...substep, user_id: userId });
    setTasks(prev => prev.map(t => {
      if (t.id !== substep.task_id) return t;
      const idx = t.substeps.findIndex(s => s.id === saved.id);
      const substeps = idx >= 0
        ? t.substeps.map(s => s.id === saved.id ? saved : s)
        : [...t.substeps, saved];
      return { ...t, substeps };
    }));
    return saved;
  }, [userId]);

  const removeSubstep = useCallback(async (taskId, substepId) => {
    await db.deleteSubstep(substepId);
    setTasks(prev => prev.map(t =>
      t.id !== taskId ? t : { ...t, substeps: t.substeps.filter(s => s.id !== substepId) }
    ));
  }, []);

  // ── Scheduled days ─────────────────────────────────────────────────────────
  const setTaskSchedule = useCallback(async (taskId, dates) => {
    await db.setScheduledDays(taskId, userId, dates);
    setTasks(prev => prev.map(t =>
      t.id !== taskId ? t : { ...t, scheduled_days: dates }
    ));
  }, [userId]);

  // ── Preferences ────────────────────────────────────────────────────────────
  const savePreferences = useCallback(async (prefs) => {
    const saved = await db.upsertPreferences(userId, prefs);
    setPreferences(saved);
  }, [userId]);

  return {
    categories, tasks, preferences, loading, error,
    reload: load,
    undo, redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    saveCategory, removeCategory,
    saveTask, removeTask,
    saveSubstep, removeSubstep,
    setTaskSchedule,
    savePreferences,
  };
}
