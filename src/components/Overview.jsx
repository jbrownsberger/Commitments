/**
 * Overview — two-column plan layout.
 * Left: date header, metrics, capacity bar, urgency queue.
 * Right: QuickTasks side panel (standing commitments).
 */
import React, { useState } from 'react';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor } from './TaskPanel.jsx';
import QuickTasks from './QuickTasks.jsx';
import '../styles/overview.css';

export default function Overview({ appData, userId, onAddTask }) {
  const {
    categories, tasks, preferences,
    quickTasks = [], saveTask, removeTask,
    saveQuickTask, removeQuickTask,
  } = appData;

  const [panelTask, setPanelTask] = useState(null);

  const weeklyHours = preferences?.weekly_hours ?? preferences?.weeklyHours ?? 20;

  const catMap = Object.fromEntries((categories || []).map(c => [c.id, c]));

  const enrich = (t) => ({
    ...t,
    catName:         catMap[t.category_id]?.name  || '',
    catColor:        catMap[t.category_id]?.color || '#888',
    catId:           t.category_id,
    due_date:        t.due_date        ?? null,
    estimated_hours: t.estimated_hours ?? 1,
    manual_progress: t.manual_progress ?? 0,
    substeps:        t.substeps        ?? [],
  });

  const allTasks  = (tasks || []);
  const recurring = allTasks.filter(t => t.recurring).map(enrich);
  const allInc    = allTasks.filter(t => t.status !== 'done' && !t.recurring).map(enrich);

  const overdue  = allInc.filter(t => t.due_date && daysUntil(t.due_date) < 0)
    .sort((a, b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const upcoming = allInc.filter(t => t.due_date && daysUntil(t.due_date) >= 0)
    .sort((a, b) => urgencyScore(b) - urgencyScore(a));
  const noDue    = allInc.filter(t => !t.due_date);

  const total        = allTasks.filter(t => !t.recurring).length;
  const doneCount    = allTasks.filter(t => t.status === 'done' && !t.recurring).length;
  const dueWeek      = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7).length;
  const overdueCount = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) < 0).length;

  const weekDemanded = allInc.reduce((s, t) => s + parseFloat(remainingHours(t)), 0);
  const capPct  = Math.min(100, Math.round(weekDemanded / Math.max(weeklyHours, 1) * 100));
  const capFill = capPct >= 100 ? 'var(--color-text-danger)' : capPct >= 75 ? '#BA7517' : 'var(--color-text-success)';

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
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>{today}</div>

        {/* Metrics */}
        <div className="overview-grid" style={{ marginBottom: '1.5rem' }}>
          <Metric label="Total tasks"   val={total} />
          <Metric label="Completed"     val={doneCount} />
          <Metric label="Due this week" val={dueWeek} />
          <Metric label="Overdue"       val={overdueCount} danger={overdueCount > 0} />
        </div>

        {/* Capacity bar */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Weekly capacity</div>
            <span style={{ fontSize: 12, color: capFill, fontWeight: 500 }}>
              {weekDemanded.toFixed(1)}h demanded &middot; {weeklyHours}h available
            </span>
          </div>
          <div style={{ background: 'var(--color-background-secondary)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${capPct}%`, background: capFill, borderRadius: 4, transition: 'width 0.4s' }} />
          </div>
          {capPct >= 100 && (
            <div style={{ fontSize: 11, color: 'var(--color-text-danger)', marginTop: 4 }}>
              ⚠ Overcommitted by {(weekDemanded - weeklyHours).toFixed(1)}h
            </div>
          )}
        </div>

        {/* Daily / recurring tasks */}
        {recurring.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Daily &amp; recurring</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recurring.map(t => (
                <RecurringRow key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />
              ))}
            </div>
            <div style={{ marginBottom: 16 }} />
          </div>
        )}

        {/* Urgency queue */}
        {overdue.length === 0 && upcoming.length === 0 && noDue.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', padding: '2rem 0' }}>
            No pending tasks.{' '}
            {onAddTask && (
              <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={onAddTask}>Add one</button>
            )}
          </div>
        )}

        {overdue.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-danger)', marginBottom: 8 }}>⚠ Overdue</div>
            {overdue.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />)}
            <div style={{ marginBottom: 16 }} />
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Upcoming by urgency</div>
            {upcoming.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />)}
          </>
        )}

        {noDue.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', margin: '16px 0 8px' }}>No due date</div>
            {noDue.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />)}
          </>
        )}
      </div>

      {/* ── Right column: Quick tasks side panel ── */}
      <QuickTasks
        quickTasks={quickTasks}
        onSave={saveQuickTask}
        onDelete={removeQuickTask}
      />

      {/* ── Task detail panel ── */}
      {panelTask && (
        <TaskPanel
          task={panelTask}
          cat={{ name: panelTask.catName, color: panelTask.catColor }}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); setPanelTask(null); }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={() => setPanelTask(null)}
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

function RecurringRow({ task, onCycle, onOpen }) {
  const isDone   = task.status === 'done';
  const isInProg = task.status === 'in progress';
  const cadence  = task.recurring_cadence || 'daily';
  return (
    <div className="urgency-item" onClick={() => onOpen(task)} style={{ cursor: 'pointer' }}>
      <div className="urgency-dot" style={{ background: task.catColor || '#888' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
            style={{ flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); onCycle(task); }}
            title="Cycle status"
          >{isDone ? '✓' : isInProg ? '…' : ''}</span>
          <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{task.name}</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', background: 'var(--color-background-secondary)', padding: '1px 6px', borderRadius: 10 }}>{cadence}</span>
          {task.catName && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{task.catName}</span>}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, onCycle, onOpen }) {
  const prog     = taskProgress(task);
  const days     = daysUntil(task.due_date);
  const score    = urgencyScore(task);
  const color    = urgencyColor(score);
  const isDone   = task.status === 'done';
  const isInProg = task.status === 'in progress';
  const isOverdue = !isDone && task.due_date && days < 0;

  const daysStr = !task.due_date ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d`;

  return (
    <div className="urgency-item" onClick={() => onOpen(task)} style={{ cursor: 'pointer' }}>
      <div className="urgency-dot" style={{ background: task.catColor || '#888' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
            style={{ flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); onCycle(task); }}
            title="Cycle status"
          >{isDone ? '✓' : isInProg ? '…' : ''}</span>
          <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{task.name}</span>
          {isOverdue && <span className="badge" style={{ background: 'var(--color-background-danger)', color: 'var(--color-text-danger)', fontSize: 10 }}>Overdue</span>}
          {task.due_date && (
            <span style={{ fontSize: 11, color: isOverdue ? 'var(--color-text-danger)' : days !== null && days <= 3 ? '#BA7517' : 'var(--color-text-secondary)' }}>
              {daysStr}
            </span>
          )}
        </div>
        {prog > 0 && prog < 100 && (
          <div className="progress-track" style={{ height: 3, marginTop: 4, marginLeft: 26 }}>
            <div className="progress-fill" style={{ width: `${prog}%` }} />
          </div>
        )}
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 500, flexShrink: 0 }}>{score > 0 ? score : ''}</span>
    </div>
  );
}
