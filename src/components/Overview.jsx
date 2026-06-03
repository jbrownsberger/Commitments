/**
 * Overview & Queue — two-column layout.
 * Left:  date / metrics / top-urgent bar chart / this-week focus / suggested focus queue.
 * Right: Quick tasks panel + Today’s plan panel.
 */
import React, { useState } from 'react';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor } from './TaskPanel.jsx';
import QuickTasks from './QuickTasks.jsx';
import '../styles/overview.css';

// How many hours planned for a task TODAY (uses Planner scheduled_days)
function hoursToday(task) {
  const todayISO = new Date().toISOString().slice(0, 10);
  if (!task.scheduled_days || !task.scheduled_days.includes(todayISO)) return 0;
  const dayHrs = task.scheduled_day_hours?.[todayISO];
  if (dayHrs !== undefined) return dayHrs;
  // fallback: distribute remaining evenly across future scheduled days
  const futureDays = task.scheduled_days.filter(d => d >= todayISO);
  if (futureDays.length === 0) return 0;
  return remainingHours(task) / futureDays.length;
}

export default function Overview({ appData, userId, onAddTask, onEditTask }) {
  const {
    categories, tasks, preferences,
    quickTasks = [], saveTask, removeTask,
    saveQuickTask, removeQuickTask,
  } = appData;

  const [panelTask,    setPanelTask]    = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const weeklyHours = preferences?.weekly_hours ?? preferences?.weeklyHours ?? 20;

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

  const allTasks  = (tasks || []);
  const recurring = allTasks.filter(t => t.recurring).map(enrich);
  const allInc    = allTasks.filter(t => t.status !== 'done' && !t.recurring).map(enrich);

  // ── Metrics
  const total        = allTasks.filter(t => !t.recurring).length;
  const doneCount    = allTasks.filter(t => t.status === 'done' && !t.recurring).length;
  const dueWeek      = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7).length;
  const overdueCount = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) < 0).length;

  // ── Top urgent (for the bar chart, max 5)
  const topUrgent = [...allInc]
    .filter(t => t.due_date)
    .sort((a, b) => urgencyScore(b) - urgencyScore(a))
    .slice(0, 5);
  const maxScore = topUrgent.length > 0 ? Math.max(...topUrgent.map(t => urgencyScore(t)), 1) : 1;

  // ── This week's focus
  const weekDemanded = allInc.reduce((s, t) => s + parseFloat(remainingHours(t)), 0);
  // Planner-scheduled hours this week
  const todayISO = new Date().toISOString().slice(0, 10);
  const weekEnd  = (() => { const d = new Date(); d.setDate(d.getDate() + (6 - d.getDay())); return d.toISOString().slice(0,10); })();
  const plannedThisWeek = allInc.reduce((s, t) => {
    if (!t.scheduled_days) return s;
    const days = t.scheduled_days.filter(d => d >= todayISO && d <= weekEnd);
    if (days.length === 0) return s;
    const dayHrs = t.scheduled_day_hours || {};
    const explicit = days.reduce((a, d) => a + (dayHrs[d] || 0), 0);
    const unweighted = days.filter(d => !dayHrs[d]);
    const perUw = unweighted.length > 0
      ? Math.max(remainingHours(t) - explicit, 0) / unweighted.length : 0;
    return s + explicit + perUw * unweighted.length;
  }, 0);

  const committedLoad = plannedThisWeek;
  const capPct  = Math.min(100, Math.round(committedLoad / Math.max(weeklyHours, 1) * 100));
  const capFill = capPct >= 100 ? 'var(--color-text-danger)' : capPct >= 75 ? '#BA7517' : 'var(--color-text-success)';

  // ── Suggested focus queue (urgency-ranked, include overdue + upcoming)
  const overdue  = allInc.filter(t => t.due_date && daysUntil(t.due_date) < 0)
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const upcoming = allInc.filter(t => t.due_date && daysUntil(t.due_date) >= 0)
    .sort((a, b) => urgencyScore(b) - urgencyScore(a));
  const noDue    = allInc.filter(t => !t.due_date);
  const focusQueue = [...overdue, ...upcoming, ...noDue];
  const maxFocusScore = focusQueue.length > 0 ? Math.max(...focusQueue.map(urgencyScore), 1) : 1;

  // ── Today's plan
  const todayPlan = allTasks
    .map(enrich)
    .filter(t => t.status !== 'done' && t.scheduled_days?.includes(todayISO))
    .sort((a, b) => hoursToday(b) - hoursToday(a));
  const todayPlanHours = todayPlan.reduce((s, t) => s + hoursToday(t), 0);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const cycleStatus = async (task) => {
    const cycle = ['not started', 'in progress', 'done'];
    const cur   = cycle.indexOf(task.status);
    const next  = cycle[(cur + 1) % cycle.length];
    await saveTask({ ...task, status: next, manual_progress: next === 'done' ? 100 : task.manual_progress });
  };

  return (
    <div className="plan-layout">
      {/* ── Main column ── */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 14 }}>{today}</div>

        {/* Metrics row */}
        <div className="overview-grid" style={{ marginBottom: '1.5rem' }}>
          <Metric label="Total tasks"   val={total} />
          <Metric label="Completed"     val={doneCount} />
          <Metric label="Due this week" val={dueWeek} />
          <Metric label="Overdue"       val={overdueCount} danger={overdueCount > 0} />
        </div>

        {/* Top urgent bar chart */}
        {topUrgent.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="section-label">Top urgent tasks</div>
            {topUrgent.map(t => {
              const score = urgencyScore(t);
              const color = urgencyColor(score);
              const days  = daysUntil(t.due_date);
              const daysStr = days === null ? '' : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `${days}d left`;
              const pct = Math.round((score / maxScore) * 100);
              // next substep
              const nextStep = t.substeps?.find(s => !s.done);
              return (
                <div
                  key={t.id}
                  className="urgent-bar-row"
                  onClick={() => setPanelTask(t)}
                >
                  <span
                    className={`task-check${t.status === 'done' ? ' done' : t.status === 'in progress' ? ' in-progress' : ''}`}
                    style={{ flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); cycleStatus(t); }}
                  >{t.status === 'done' ? '✓' : t.status === 'in progress' ? '…' : ''}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="urgent-bar-name">{t.name}</div>
                    {nextStep && <div className="urgent-bar-sub">Next: <em>{nextStep.text}</em></div>}
                    <div className="urgent-bar-track">
                      <div className="urgent-bar-fill" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                  <span className="urgent-bar-days" style={{ color }}>{daysStr}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* This week's focus */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <div className="section-label" style={{ marginBottom: 0 }}>This week’s focus</div>
            <button
              className="btn btn-sm"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setShowSettings(s => !s)}
              title="Weekly hours"
            >&#9881; {weeklyHours}h/week</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
            {weeklyHours}h available &middot; tasks ranked by urgency &middot; click to open
          </div>

          {/* Capacity bar */}
          <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Committed load this week <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>(planner + forecast)</span></span>
            <span style={{ color: capFill, fontWeight: 500 }}>{committedLoad.toFixed(1)}h / {weeklyHours}h</span>
          </div>
          <div className="progress-track" style={{ height: 8, marginBottom: 6 }}>
            <div className="progress-fill" style={{ width: `${capPct}%`, background: capFill }} />
          </div>
          {capPct >= 100 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-danger)', marginBottom: 8 }}>
              ⚠ Overcommitted by {(committedLoad - weeklyHours).toFixed(1)}h — consider deferring or reducing scope
            </div>
          )}
        </div>

        {/* Suggested focus queue */}
        {focusQueue.length > 0 && (
          <div>
            <div className="section-label">Suggested focus</div>
            {focusQueue.map(t => (
              <FocusCard
                key={t.id}
                task={t}
                maxScore={maxFocusScore}
                weekISOs={Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0,10);
                })}
                onCycle={cycleStatus}
                onOpen={() => setPanelTask(t)}
              />
            ))}
          </div>
        )}

        {focusQueue.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', padding: '2rem 0' }}>
            No pending tasks.
            {onAddTask && <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={onAddTask}>Add one</button>}
          </div>
        )}
      </div>

      {/* ── Right column ── */}
      <div className="right-col">
        {/* Quick tasks */}
        <QuickTasks
          quickTasks={quickTasks}
          onSave={saveQuickTask}
          onDelete={removeQuickTask}
        />

        {/* Today's plan */}
        {todayPlan.length > 0 && (
          <div className="today-plan-panel">
            <div className="today-plan-title">
              <span>📅 Today’s plan</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{todayPlanHours.toFixed(1)}h</span>
            </div>
            {todayPlan.map(t => {
              const hrs = hoursToday(t);
              const isDone = t.status === 'done';
              return (
                <div key={t.id} className="today-plan-item" onClick={() => setPanelTask(t)}>
                  <div
                    className="today-plan-dot"
                    style={{ background: t.catColor || '#888' }}
                  />
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

      {/* ── Task detail panel ── */}
      {panelTask && (
        <TaskPanel
          task={panelTask}
          cat={{ name: panelTask.catName, color: panelTask.catColor }}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); setPanelTask(null); }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={(task) => { setPanelTask(null); onEditTask(task); }}
        />
      )}
    </div>
  );
}

// ── Metric tile
function Metric({ label, val, danger }) {
  return (
    <div className="overview-metric">
      <div className="metric-val" style={danger ? { color: 'var(--color-text-danger)' } : {}}>{val}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

// ── Suggested focus card
function FocusCard({ task, maxScore, weekISOs, onCycle, onOpen }) {
  const score    = urgencyScore(task);
  const color    = urgencyColor(score);
  const isDone   = task.status === 'done';
  const isInProg = task.status === 'in progress';
  const days     = daysUntil(task.due_date);
  const isOverdue = !isDone && task.due_date && days < 0;
  const daysStr  = !task.due_date ? '' : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `${days}d left`;
  const pct      = Math.round((score / Math.max(maxScore, 1)) * 100);

  // Hours planned this week
  const hrsWeek = weekISOs.reduce((s, iso) => {
    if (!task.scheduled_days?.includes(iso)) return s;
    const dh = task.scheduled_day_hours?.[iso];
    if (dh !== undefined) return s + dh;
    const futureDays = (task.scheduled_days || []).filter(d => d >= weekISOs[0]);
    return s + (futureDays.length > 0 ? remainingHours(task) / futureDays.length : 0);
  }, 0);

  // Next substep
  const nextStep = task.substeps?.find(s => !s.done);

  return (
    <div className="focus-card" onClick={onOpen}>
      <div className="focus-card-header">
        <span
          className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
          style={{ flexShrink: 0 }}
          onClick={e => { e.stopPropagation(); onCycle(task); }}
        >{isDone ? '✓' : isInProg ? '…' : ''}</span>
        {nextStep && (
          <input
            type="checkbox" style={{ marginRight: 2, flexShrink: 0, cursor: 'pointer' }}
            checked={false}
            onChange={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
            title={`Next: ${nextStep.text}`}
          />
        )}
        <span className="focus-card-name">{task.name}</span>
        <span className="focus-card-cat">{task.catName}</span>
        <span className="focus-card-score" style={{ color }}>{score > 0 ? score : ''}</span>
      </div>
      {nextStep && (
        <div className="focus-card-substep">Next: <em>{nextStep.text}</em></div>
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
