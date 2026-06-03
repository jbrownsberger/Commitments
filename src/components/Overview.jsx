import React, { useState } from 'react';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor } from './TaskPanel.jsx';
import '../styles/overview.css';

export default function Overview({ appData, userId }) {
  const { categories, tasks, preferences, saveTask, removeTask } = appData;
  const [panelTask, setPanelTask] = useState(null);

  const weeklyHours = preferences?.weekly_hours ?? preferences?.weeklyHours ?? 20;

  // All incomplete tasks with catName/catColor injected
  const allInc = (categories || []).flatMap(cat =>
    (tasks || []).filter(t => t.category_id === cat.id && t.status !== 'done').map(t => ({
      ...t,
      catName:  cat.name,
      catColor: cat.color,
      catId:    cat.id,
      due_date:        t.due_date        ?? t.dueDate        ?? null,
      estimated_hours: t.estimated_hours ?? t.estimatedHours ?? 1,
      manual_progress: t.manual_progress ?? t.manualProgress ?? 0,
      substeps:        t.substeps        ?? [],
    }))
  );

  const overdue  = allInc.filter(t => t.due_date && daysUntil(t.due_date) < 0)
    .sort((a,b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const upcoming = allInc.filter(t => t.due_date && daysUntil(t.due_date) >= 0)
    .sort((a,b) => urgencyScore(b) - urgencyScore(a));
  const noDue    = allInc.filter(t => !t.due_date);

  const allTasks    = (tasks || []);
  const total       = allTasks.filter(t => !t.recurring).length;
  const doneCount   = allTasks.filter(t => t.status === 'done').length;
  const dueWeek     = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) >= 0 && daysUntil(t.due_date) <= 7).length;
  const overdueCount = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date) < 0).length;

  // Capacity
  const weekDemanded = allInc.reduce((s, t) => s + parseFloat(remainingHours(t)), 0);
  const capPct  = Math.min(100, Math.round(weekDemanded / Math.max(weeklyHours, 1) * 100));
  const capFill = capPct >= 100 ? 'var(--color-text-danger)' : capPct >= 75 ? '#BA7517' : 'var(--color-text-success)';

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  const cycleStatus = async (task) => {
    const cycle = ['not started', 'in progress', 'done'];
    const cur   = cycle.indexOf(task.status);
    const next  = cycle[(cur + 1) % cycle.length];
    await saveTask({ ...task, status: next, manual_progress: next === 'done' ? 100 : task.manual_progress });
  };

  return (
    <div>
      <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginBottom:10 }}>{today}</div>

      {/* Metrics */}
      <div className="overview-grid" style={{ marginBottom:'1.5rem' }}>
        <Metric label="Total tasks"   val={total} />
        <Metric label="Completed"     val={doneCount} />
        <Metric label="Due this week" val={dueWeek} />
        <Metric label="Overdue"       val={overdueCount} danger={overdueCount > 0} />
      </div>

      {/* Capacity bar */}
      <div className="urgency-bar-wrap" style={{ marginBottom:'1.5rem' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)' }}>Weekly capacity</div>
          <span style={{ fontSize:12, color:capFill, fontWeight:500 }}>
            {weekDemanded.toFixed(1)}h demanded · {weeklyHours}h available
          </span>
        </div>
        <div style={{ background:'var(--color-background-secondary)', borderRadius:4, height:10, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${capPct}%`, background:capFill, borderRadius:4, transition:'width 0.4s' }} />
        </div>
        {capPct >= 100 && (
          <div style={{ fontSize:11, color:'var(--color-text-danger)', marginTop:4 }}>
            ⚠ Overcommitted by {(weekDemanded - weeklyHours).toFixed(1)}h this week
          </div>
        )}
      </div>

      {/* Urgency queue */}
      {overdue.length === 0 && upcoming.length === 0 && noDue.length === 0 && (
        <div style={{ fontSize:13, color:'var(--color-text-secondary)', textAlign:'center', padding:'2rem 0' }}>
          No pending tasks. ✓
        </div>
      )}

      {overdue.length > 0 && (
        <>
          <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-danger)', marginBottom:8 }}>⚠ Overdue</div>
          {overdue.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />)}
          <div style={{ marginBottom:16 }} />
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-secondary)', marginBottom:8 }}>Upcoming by urgency</div>
          {upcoming.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />)}
        </>
      )}

      {noDue.length > 0 && (
        <>
          <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-secondary)', margin:'16px 0 8px' }}>No due date</div>
          {noDue.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={t2 => setPanelTask(t2)} />)}
        </>
      )}

      {/* Task detail panel */}
      {panelTask && (
        <TaskPanel
          task={panelTask}
          cat={{ name: panelTask.catName, color: panelTask.catColor }}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); setPanelTask(null); }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={() => { setPanelTask(null); }}
        />
      )}
    </div>
  );
}

function Metric({ label, val, danger }) {
  return (
    <div className="overview-metric">
      <div className="metric-val" style={danger ? { color:'var(--color-text-danger)' } : {}}>{val}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function TaskCard({ task, onCycle, onOpen }) {
  const prog  = taskProgress(task);
  const days  = daysUntil(task.due_date);
  const score = urgencyScore(task);
  const color = urgencyColor(score);
  const isDone = task.status === 'done';
  const isInProg = task.status === 'in progress';
  const isOverdue = !isDone && task.due_date && days < 0;

  const daysStr = !task.due_date ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d`;

  return (
    <div className="urgency-item" onClick={() => onOpen(task)} style={{ cursor:'pointer' }}>
      <div className="urgency-dot" style={{ background: task.catColor || '#888' }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <span
            className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
            style={{ flexShrink:0 }}
            onClick={e => { e.stopPropagation(); onCycle(task); }}
            title="Cycle status"
          >{isDone ? '✓' : isInProg ? '…' : ''}</span>
          <span style={{ fontSize:13, fontWeight:500, flex:1 }}>{task.name}</span>
          {isOverdue && <span className="badge" style={{ background:'var(--color-bg-danger)', color:'var(--color-text-danger)', fontSize:10 }}>Overdue</span>}
          {task.due_date && <span style={{ fontSize:11, color: isOverdue ? 'var(--color-text-danger)' : days !== null && days <= 3 ? '#BA7517' : 'var(--color-text-secondary)' }}>{daysStr}</span>}
        </div>
        {prog > 0 && prog < 100 && (
          <div className="progress-track" style={{ height:3, marginTop:4, marginLeft:26 }}>
            <div className="progress-fill" style={{ width:`${prog}%` }} />
          </div>
        )}
      </div>
      <span style={{ fontSize:11, color, fontWeight:500, flexShrink:0 }}>{score > 0 ? score : ''}</span>
    </div>
  );
}
