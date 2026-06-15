import React, { useState } from 'react';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor } from './TaskPanel.jsx';
import QuickTasks from './QuickTasks.jsx';
import '../styles/overview.css';

/* ── Inline capacity editor ─────────────────────────────────────────────────── */
function CapacityEditor({ weeklyHours, onSave, onCancel }) {
  const [val, setVal] = useState(String(weeklyHours));
  const commit = () => {
    const n = parseInt(val, 10);
    if (n > 0 && n <= 168) onSave(n);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number" min={1} max={168} step={1}
        value={val}
        autoFocus
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); commit(); }
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          width: 46, fontSize: 12, padding: '2px 6px',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-sans)',
          background: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>h/wk</span>
      <button className="btn btn-sm btn-primary" onClick={commit} style={{ padding: '2px 8px' }}>Save</button>
      <button className="btn btn-sm" onClick={onCancel} style={{ padding: '2px 8px' }}>Cancel</button>
    </span>
  );
}

/* ── Gear SVG ────────────────────────────────────────────────────────────────────── */
const GearIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true"
    style={{ display: 'inline-block', verticalAlign: '-2px' }}
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06
a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09
A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06
A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09
A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06
A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09
a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06
A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/* ── Helpers ────────────────────────────────────────────────────────────────────── */
function hoursToday(task) {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (!task.scheduled_days?.includes(todayISO)) return 0;
  const dayHrs = task.scheduled_day_hours?.[todayISO];
  if (dayHrs !== undefined) return dayHrs;
  const futureDays = task.scheduled_days.filter(d => d >= todayISO);
  if (!futureDays.length) return 0;
  return remainingHours(task) / futureDays.length;
}

function statusFromProgress(prog, current) {
  if (prog >= 100) return 'done';
  if (prog > 0)    return 'in progress';
  return current === 'done' ? 'not started' : (current || 'not started');
}

function fmtDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function gcalWeeklyHours(gcalFreeBusy) {
  if (!gcalFreeBusy) return null;
  const todayISO = new Date().toISOString().slice(0, 10);
  const weekEndDate = new Date();
  weekEndDate.setDate(weekEndDate.getDate() + (7 - weekEndDate.getDay()) % 7 || 7);
  const weekEndISO = weekEndDate.toISOString().slice(0, 10);
  let total = 0;
  for (const [iso, freeMin] of Object.entries(gcalFreeBusy)) {
    if (iso >= todayISO && iso <= weekEndISO) total += freeMin / 60;
  }
  return {
    hours: Math.round(total * 10) / 10,
    windowStart: todayISO,
    windowEnd: weekEndISO,
  };
}

function rollingWeekEnd() {
  const d = new Date();
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

// Floor urgency score for recurring tasks that have no explicit due date.
// Keeps them reliably present in the queue without crowding out deadline tasks
// (which typically score 50–200+).
const RECURRING_FLOOR_SCORE = { daily: 30, weekday: 25, weekly: 15 };

function recurringUrgency(task) {
  // If a recurring task has a due date, treat it exactly like a normal task.
  if (task.due_date) return urgencyScore(task);
  return RECURRING_FLOOR_SCORE[task.recurring_cadence] ?? 20;
}

const CAP_MODE_KEY = 'capacity_mode';

/* ── Overview ────────────────────────────────────────────────────────────────────── */
export default function Overview({ appData, userId, onAddTask, onEditTask }) {
  const {
    categories, tasks, preferences,
    quickTasks = [], saveTask, removeTask,
    saveQuickTask, removeQuickTask,
    savePreferences,
    gcalFreeBusy,
  } = appData;

  const [panelTask, setPanelTask] = useState(null);
  const [editingCapacity, setEditingCapacity] = useState(false);

  const [capacityMode, setCapacityMode] = useState(
    () => localStorage.getItem(CAP_MODE_KEY) || 'manual'
  );
  const switchCapacityMode = (mode) => {
    localStorage.setItem(CAP_MODE_KEY, mode);
    setCapacityMode(mode);
    setEditingCapacity(false);
  };

  const manualWeeklyHours = preferences?.weekly_hours ?? preferences?.weeklyHours ?? 20;
  const gcalResult        = gcalWeeklyHours(gcalFreeBusy);

  const todayISO = new Date().toISOString().slice(0, 10);
  const weekEnd  = capacityMode === 'gcal'
    ? (gcalResult?.windowEnd ?? (() => { const d = new Date(); d.setDate(d.getDate() + (7 - d.getDay()) % 7 || 7); return d.toISOString().slice(0, 10); })())
    : rollingWeekEnd();

  const weeklyHours = capacityMode === 'gcal' && gcalResult !== null
    ? gcalResult.hours
    : manualWeeklyHours;

  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));

  const enrich = (t) => ({
    ...t,
    catName:         catMap[t.category_id]?.name  || '',
    catColor:        catMap[t.category_id]?.color || '#888',
    due_date:        t.due_date        ?? null,
    estimated_hours: t.estimated_hours ?? 1,
    manual_progress: t.manual_progress ?? 0,
    substeps:        t.substeps        ?? [],
  });

  const allTasks = tasks || [];

  // Recurring tasks are now first-class citizens of the incomplete list.
  // They receive a cadence-based floor score when they have no due date,
  // so they appear in the queue without displacing genuinely urgent work.
  const allInc = allTasks.filter(t => t.status !== 'done').map(enrich);

  // Stats: count all tasks (recurring included in totals).
  const total        = allTasks.length;
  const doneCount    = allTasks.filter(t => t.status === 'done').length;
  const dueWeek      = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7).length;
  const overdueCount = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) < 0).length;

  const plannedThisWeek = allInc.reduce((s, t) => {
    if (!t.scheduled_days?.length) return s;
    const dh         = t.scheduled_day_hours || {};
    const allFuture  = t.scheduled_days.filter(d => d >= todayISO);
    if (!allFuture.length) return s;
    const inWindow   = allFuture.filter(d => d <= weekEnd);
    if (!inWindow.length) return s;
    const explicitTotal = allFuture.reduce((a, d) => a + (dh[d] || 0), 0);
    const allUnweighted = allFuture.filter(d => !dh[d]);
    const perUw = allUnweighted.length > 0
      ? Math.max(remainingHours(t) - explicitTotal, 0) / allUnweighted.length
      : 0;
    const windowSum = inWindow.reduce((a, d) => a + (dh[d] !== undefined ? dh[d] : perUw), 0);
    return s + windowSum;
  }, 0);

  const remainingCapacity = Math.max(weeklyHours - plannedThisWeek, 0);
  const unscheduledTotal  = allInc.reduce((s, t) => {
    const hasAnySchedule = t.scheduled_days?.some(d => d >= todayISO);
    if (hasAnySchedule) return s;
    return s + remainingHours(t);
  }, 0);
  const greedyUnscheduled = Math.min(unscheduledTotal, remainingCapacity);
  const committedLoad     = plannedThisWeek + greedyUnscheduled;
  const capPct  = Math.min(100, Math.round(committedLoad / Math.max(weeklyHours, 1) * 100));
  const capFill = capPct >= 100 ? 'var(--color-text-danger)'
    : capPct >= 75 ? '#BA7517'
    : 'var(--color-text-success)';

  // Sort the focus queue: overdue first, then upcoming deadline tasks by urgency,
  // then no-due tasks — with recurring tasks using their floor score so they
  // slot in naturally among no-deadline work.
  const overdue    = allInc.filter(t => t.due_date && daysUntil(t.due_date) < 0)
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const upcoming   = allInc.filter(t => t.due_date && daysUntil(t.due_date) >= 0)
    .sort((a, b) => urgencyScore(b) - urgencyScore(a));
  const noDue      = allInc
    .filter(t => !t.due_date)
    .sort((a, b) => {
      const sa = t => t.recurring ? recurringUrgency(t) : urgencyScore(t);
      return sa(b) - sa(a);
    });
  const focusQueue = [...overdue, ...upcoming, ...noDue];
  const maxFocusScore = Math.max(
    ...focusQueue.map(t => t.recurring ? recurringUrgency(t) : urgencyScore(t)),
    1
  );

  const todayPlan = allTasks.map(enrich)
    .filter(t => t.status !== 'done' && t.scheduled_days?.includes(todayISO))
    .sort((a, b) => hoursToday(b) - hoursToday(a));
  const todayPlanHours = todayPlan.reduce((s, t) => s + hoursToday(t), 0);

  const today = new Date().toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const cycleStatus = async (task) => {
    const cycle = ['not started', 'in progress', 'done'];
    const next  = cycle[(cycle.indexOf(task.status) + 1) % cycle.length];
    const updated = { ...task, status: next,
      manual_progress: next === 'done' ? 100 : next === 'not started' ? 0 : task.manual_progress };
    await saveTask(updated);
    if (panelTask?.id === task.id) setPanelTask(updated);
  };

  const toggleNextSubstep = async (task) => {
    const idx = (task.substeps || []).findIndex(s => !s.done);
    if (idx === -1) return;
    const substeps = task.substeps.map((s, i) => i === idx ? { ...s, done: true } : s);
    const prog     = taskProgress({ ...task, substeps });
    const status   = statusFromProgress(prog, task.status);
    const updated  = { ...task, substeps, manual_progress: prog, status };
    await saveTask(updated);
    if (panelTask?.id === task.id) setPanelTask(updated);
  };

  const handlePanelSave = async (updated) => {
    await saveTask(updated);
    setPanelTask(updated);
  };

  const handleSaveCapacity = async (hours) => {
    if (savePreferences) {
      await savePreferences({ ...preferences, weekly_hours: hours });
    }
    setEditingCapacity(false);
  };

  const weekISOs = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10);
  });

  const gcalNoData = capacityMode === 'gcal' && gcalResult === null;

  const windowLabel = capacityMode === 'gcal'
    ? `GCal free time ${fmtDate(todayISO)}–${fmtDate(weekEnd)} · tasks ranked by urgency · click to open`
    : `Next 7 days (${fmtDate(todayISO)}–${fmtDate(weekEnd)}) · tasks ranked by urgency · click to open`;

  return (
    <div className="plan-layout">
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 14 }}>{today}</div>

        <div className="overview-grid" style={{ marginBottom: '1.5rem' }}>
          <Metric label="Total tasks"   val={total} />
          <Metric label="Completed"     val={doneCount} />
          <Metric label="Due this week" val={dueWeek} />
          <Metric label="Overdue"       val={overdueCount} danger={overdueCount > 0} />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div className="section-label" style={{ marginBottom: 0 }}>This week's focus</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="capacity-mode-toggle">
                <button
                  className={capacityMode === 'manual' ? 'active' : ''}
                  onClick={() => switchCapacityMode('manual')}
                >Manual</button>
                <button
                  className={capacityMode === 'gcal' ? 'active' : ''}
                  onClick={() => switchCapacityMode('gcal')}
                >GCal</button>
              </div>

              {capacityMode === 'manual' && (
                editingCapacity ? (
                  <CapacityEditor
                    weeklyHours={manualWeeklyHours}
                    onSave={handleSaveCapacity}
                    onCancel={() => setEditingCapacity(false)}
                  />
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={() => setEditingCapacity(true)}
                    title="Change weekly hours"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <GearIcon />
                    <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{manualWeeklyHours}h/wk</span>
                  </button>
                )
              )}

              {capacityMode === 'gcal' && !gcalNoData && (
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {gcalResult.hours}h free
                </span>
              )}
            </div>
          </div>

          {gcalNoData ? (
            <div style={{
              fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span>&#9888;&#65039;</span>
              <span>No GCal data yet — load availability in the <strong>GCal</strong> tab, or switch to Manual.</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
              {weeklyHours}h available · {windowLabel}
            </div>
          )}

          <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Committed load this week</span>
            <span style={{ color: capFill, fontWeight: 500 }}>{committedLoad.toFixed(1)}h / {weeklyHours}h</span>
          </div>
          <div className="progress-track" style={{ height: 8, marginBottom: 6 }}>
            <div className="progress-fill" style={{ width: `${capPct}%`, background: capFill }} />
          </div>
          {capPct >= 100 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-danger)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Overcommitted by {(committedLoad - weeklyHours).toFixed(1)}h — consider deferring or reducing scope
            </div>
          )}
        </div>

        {focusQueue.length > 0 ? (
          <div>
            <div className="section-label">Suggested focus</div>
            {focusQueue.map(t => (
              <FocusCard
                key={t.id}
                task={t}
                maxScore={maxFocusScore}
                weekISOs={weekISOs}
                onCycle={cycleStatus}
                onOpen={() => setPanelTask(t)}
                onToggleNextSubstep={toggleNextSubstep}
              />
            ))}
          </div>
        ) : (
          <div className="focus-empty">
            <div className="focus-empty-icon">✅</div>
            <p className="focus-empty-title">You're all caught up!</p>
            <p className="focus-empty-sub">No pending tasks right now. Add a new one whenever you're ready.</p>
            {onAddTask && (
              <button className="btn btn-sm btn-primary" onClick={onAddTask}>
                + Add task
              </button>
            )}
          </div>
        )}
      </div>

      <div className="right-col">
        <QuickTasks quickTasks={quickTasks} onSave={saveQuickTask} onDelete={removeQuickTask} />
        {todayPlan.length > 0 && (
          <div className="today-plan-panel">
            <div className="today-plan-title">
              <span>Today's plan</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{todayPlanHours.toFixed(1)}h</span>
            </div>
            {todayPlan.map(t => {
              const hrs    = hoursToday(t);
              const isDone = t.status === 'done';
              return (
                <div key={t.id} className="today-plan-item" onClick={() => setPanelTask(t)}>
                  <div className="today-plan-dot" style={{ background: t.catColor || '#888' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={`today-plan-name${isDone ? ' done' : ''}`}>{t.name}</div>
                    <div className="today-plan-meta">{hrs.toFixed(1)}h planned today</div>
                  </div>
                  <span
                    className={`task-check${isDone ? ' done' : ''}`}
                    style={{ flexShrink: 0, width: 18, height: 18 }}
                    onClick={e => { e.stopPropagation(); cycleStatus(t); }}
                  >{isDone ? '✓' : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {panelTask && (
        <TaskPanel
          task={panelTask}
          cat={{ name: panelTask.catName, color: panelTask.catColor }}
          onClose={() => setPanelTask(null)}
          onSave={handlePanelSave}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => { setPanelTask(null); onEditTask(task); }}
        />
      )}
    </div>
  );
}

function Metric({ label, val, danger }) {
  return (
    <div className="overview-metric">
      <div className="metric-val" style={danger ? { color: 'var(--color-text-danger)' } : {}}>{val}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function FocusCard({ task, maxScore, weekISOs, onCycle, onOpen, onToggleNextSubstep }) {
  // Use the floor score for recurring tasks without a due date so the urgency
  // bar renders at a meaningful height rather than zero.
  const score     = task.recurring && !task.due_date
    ? (RECURRING_FLOOR_SCORE[task.recurring_cadence] ?? 20)
    : urgencyScore(task);
  const color     = urgencyColor(score);
  const isDone    = task.status === 'done';
  const isInProg  = task.status === 'in progress';
  const days      = daysUntil(task.due_date);
  const isOverdue = !isDone && task.due_date && days < 0;
  const daysStr   = !task.due_date ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d left`;
  const pct = Math.round((score / Math.max(maxScore, 1)) * 100);

  const hrsWeek = weekISOs.reduce((s, iso) => {
    if (!task.scheduled_days?.includes(iso)) return s;
    const dh = task.scheduled_day_hours?.[iso];
    if (dh !== undefined) return s + dh;
    const futureDays = (task.scheduled_days || []).filter(d => d >= weekISOs[0]);
    return s + (futureDays.length > 0 ? remainingHours(task) / futureDays.length : 0);
  }, 0);

  const nextStep = (task.substeps || []).find(s => !s.done);

  return (
    <div
      className="focus-card"
      style={{ '--focus-card-accent': color }}
      onClick={onOpen}
    >
      <div className="focus-card-header">
        <span
          className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
          style={{ flexShrink: 0, cursor: 'pointer' }}
          onClick={e => { e.stopPropagation(); onCycle(task); }}
        >{isDone ? '✓' : isInProg ? '…' : ''}</span>
        <span className="focus-card-name">{task.name}</span>
        <span className="focus-card-cat">
          {task.catName}
          {task.recurring && (
            <span style={{
              marginLeft: 4,
              fontSize: 10,
              background: 'var(--color-bg-info)',
              color: 'var(--color-text-info)',
              borderRadius: 4,
              padding: '1px 5px',
            }}>
              {task.recurring_cadence || 'recurring'}
            </span>
          )}
        </span>
        <span className="focus-card-score" style={{ color }}>{score > 0 ? score : ''}</span>
      </div>

      {nextStep && (
        <div className="focus-card-substep-row" onClick={e => e.stopPropagation()}>
          <button
            className="substep-pill"
            title={`Mark done: ${nextStep.text}`}
            onClick={e => { e.stopPropagation(); onToggleNextSubstep(task); }}
          >
            <span className="substep-pill-check" aria-hidden="true" />
            Next: {nextStep.text}
          </button>
        </div>
      )}

      <div className="focus-card-bar-row">
        <div className="focus-bar-track">
          <div className="focus-bar-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="focus-card-meta">
          {hrsWeek > 0.05 && (
            <span className="focus-hrs-badge">{hrsWeek.toFixed(1)}h this week</span>
          )}
          {task.due_date && (
            <span style={{ fontSize: 11, color: isOverdue ? 'var(--color-text-danger)' : 'var(--color-text-secondary)' }}>
              {daysStr}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
