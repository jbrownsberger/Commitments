import React, { useState } from 'react';
import TaskPanel, { taskProgress, remainingHours, daysUntil, urgencyScore, urgencyColor } from './TaskPanel.jsx';
import QuickTasks from './QuickTasks.jsx';
import '../styles/overview.css';

export default function Overview({ appData, userId }) {
  const { categories, tasks, preferences, saveTask, removeTask, quickTasks = [], saveQuickTask, removeQuickTask } = appData;
  const [panelTask, setPanelTask] = useState(null);

  const weeklyHours = preferences?.weekly_hours ?? preferences?.weeklyHours ?? 20;

  // All incomplete tasks with catName/catColor injected
  const allInc = (categories || []).flatMap(cat =>
    (tasks || []).filter(t => t.category_id === cat.id && t.status !== 'done').map(t => ({
      ...t,
      catName:  cat.name,
      catColor: cat.color,
      catId:    cat.id,
      due_date: t.due_date ?? t.dueDate ?? null,
      estimated_hours: t.estimated_hours ?? t.estimatedHours ?? 1,
      manual_progress: t.manual_progress ?? t.manualProgress ?? 0,
      substeps: t.substeps ?? [],
    }))
  );

  const overdue  = allInc.filter(t => t.due_date && daysUntil(t.due_date) < 0)
    .sort((a,b) => daysUntil(a.due_date) - daysUntil(b.due_date));
  const upcoming = allInc.filter(t => t.due_date && daysUntil(t.due_date) >= 0)
    .sort((a,b) => urgencyScore(b) - urgencyScore(a));
  const noDue    = allInc.filter(t => !t.due_date);

  const allTasks = (tasks || []);
  const total    = allTasks.filter(t => !(t.recurring)).length;
  const doneCount   = allTasks.filter(t => t.status === 'done').length;
  const dueWeek     = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date ?? t.dueDate) >= 0 && daysUntil(t.due_date ?? t.dueDate) <= 7).length;
  const overdueCount = allTasks.filter(t => t.status !== 'done' && t.due_date && daysUntil(t.due_date ?? t.dueDate) < 0).length;

  // Capacity
  const weekDemanded = allInc.reduce((s, t) => s + parseFloat(remainingHours(t)), 0);
  const capPct  = Math.min(100, Math.round(weekDemanded / Math.max(weeklyHours, 1) * 100));
  const capFill = capPct >= 100 ? 'var(--color-text-danger)' : capPct >= 75 ? '#BA7517' : 'var(--color-text-success)';

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  const openPanel = (t) => setPanelTask(t);

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
            {overdue.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={openPanel} />)}
            <div style={{ marginBottom:16 }} />
          </>
        )}

        {upcoming.length > 0 && (
          <>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-secondary)', marginBottom:8 }}>Upcoming by urgency</div>
            {upcoming.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={openPanel} />)}
          </>
        )}

        {noDue.length > 0 && (
          <>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-secondary)', margin:'16px 0 8px' }}>No due date</div>
            {noDue.map(t => <TaskCard key={t.id} task={t} onCycle={cycleStatus} onOpen={openPanel} />)}
          </>
        )}
      </div>

      {/* ── Sidebar ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <QuickTasks
          quickTasks={quickTasks}
          onSave={saveQuickTask}
          onDelete={removeQuickTask}
        />
      </div>

      {/* ── Task panel ── */}
      {panelTask && (
        <TaskPanel
          task={panelTask}
          cat={{ name: panelTask.catName, color: panelTask.catColor }}
          onClose={() => setPanelTask(null)}
          onSave={async (updated) => { await saveTask(updated); }}
          onDelete={async (id) => { await removeTask(id); setPanelTask(null); }}
          onEdit={() => {}}
        />
      )}
    </div>
  );
}

function Metric({ label, val, danger }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-val" style={danger ? { color:'var(--color-text-danger)' } : {}}>{val}</div>
    </div>
  );
}

function TaskCard({ task, onCycle, onOpen }) {
  const score  = urgencyScore(task);
  const rem    = remainingHours(task);
  const days   = daysUntil(task.due_date);
  const daysStr = days === null ? '' : days < 0 ? 'Overdue' : days === 0 ? 'Due today' : `${days}d left`;
  const isDone  = task.status === 'done';
  const isInProg = task.status === 'in progress';

  return (
    <div style={{
      background:'var(--color-background-primary)',
      border:'0.5px solid var(--color-border-tertiary)',
      borderRadius:'var(--border-radius-md)',
      padding:'10px 14px', marginBottom:4,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom: score > 0 ? 6 : 0 }}>
        <span
          className={`task-check${isDone ? ' done' : isInProg ? ' in-progress' : ''}`}
          style={{ cursor:'pointer', flexShrink:0 }}
          onClick={() => onCycle(task)}
          title="Click to cycle status"
        >{isDone ? '✓' : isInProg ? '…' : ''}</span>
        <span
          style={{ fontSize:13, fontWeight:500, flex:1, cursor:'pointer',
            textDecorationLine:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3 }}
          onClick={() => onOpen(task)}
        >{task.name}</span>
        <span style={{ fontSize:11, color:'var(--color-text-secondary)' }}>{task.catName}</span>
        {score > 0 && <span style={{ fontSize:12, fontWeight:500, color: urgencyColor(score) }}>{score}</span>}
      </div>
      {score > 0 && (
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="urgency-track" style={{ flex:1 }}>
            <div className="urgency-fill" style={{ width:`${score}%`, background: urgencyColor(score) }} />
          </div>
          <span style={{ fontSize:11, color:'var(--color-text-secondary)', whiteSpace:'nowrap' }}>
            {daysStr}{rem > 0 ? ` · ${parseFloat(rem).toFixed(1)}h` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
