/**
 * TaskPanel — full-detail modal for a single task.
 * Status cycle uses UI values (spaces): 'not started' | 'in progress' | 'done'
 * Conversion to DB hyphenated format happens in db.js saveTask.
 */
import React, { useState, useRef } from 'react';
import Modal from './Modal.jsx';

const STATUS_CYCLE = ['not started', 'in progress', 'done'];

export function taskProgress(task) {
  const substeps = task.substeps || [];
  if (substeps.length === 0) return task.manual_progress ?? task.manualProgress ?? 0;
  const doneCount = substeps.filter(s => s.done).length;
  return Math.round((doneCount / substeps.length) * 100);
}

export function remainingHours(task) {
  const est  = parseFloat(task.estimated_hours ?? task.estimatedHours) || 1;
  const prog = taskProgress(task) / 100;
  return Math.max(0, est * (1 - prog));
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round(
    (new Date(dateStr + 'T00:00:00') - new Date().setHours(0,0,0,0)) / 86400000
  );
}

export function urgencyScore(task) {
  if (task.status === 'done') return 0;
  const days = daysUntil(task.due_date ?? task.dueDate);
  if (days === null) return 1;
  if (days < 0)  return 0;
  const rem = remainingHours(task);
  if (days === 0) return 100;
  return Math.min(100, Math.round((rem / Math.max(days, 0.5)) * 20));
}

export function urgencyColor(score) {
  if (score >= 75) return 'var(--color-text-danger)';
  if (score >= 50) return '#854F0B';
  if (score >= 25) return 'var(--color-text-warning)';
  return 'var(--color-text-success)';
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

export default function TaskPanel({ task, cat, onClose, onSave, onDelete, onEdit }) {
  const [localTask, setLocalTask] = useState({ ...task });
  const dragIdx = useRef(null);

  const prog = taskProgress(localTask);
  const rem  = remainingHours(localTask);
  const days = daysUntil(localTask.due_date ?? localTask.dueDate);
  const isDone    = localTask.status === 'done';
  const isOverdue = !isDone && (localTask.due_date ?? localTask.dueDate) && days < 0;
  const daysStr   = !(localTask.due_date ?? localTask.dueDate) ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'Due today'
    : `${days}d left`;

  const save = (updates) => {
    const next = { ...localTask, ...updates };
    setLocalTask(next);
    onSave(next);
  };

  const cycleStatus = () => {
    const cur  = STATUS_CYCLE.indexOf(localTask.status);
    const next = STATUS_CYCLE[(cur + 1) % STATUS_CYCLE.length];
    save({ status: next, manual_progress: next === 'done' ? 100 : localTask.manual_progress });
  };

  const statusBtn = isDone ? 'Reopen'
    : localTask.status === 'in progress' ? 'Mark done'
    : 'Start';

  const toggleSubstep = (idx) => {
    const substeps = (localTask.substeps || []).map((s, i) =>
      i === idx ? { ...s, done: !s.done } : s
    );
    const allDone = substeps.every(s => s.done);
    const anyDone = substeps.some(s  => s.done);
    const status  = allDone ? 'done' : anyDone ? 'in progress' : 'not started';
    save({ substeps, status });
  };

  const moveSubstep = (from, to) => {
    if (from === to) return;
    const substeps = [...(localTask.substeps || [])];
    const [moved]  = substeps.splice(from, 1);
    substeps.splice(to, 0, moved);
    save({ substeps });
  };

  const setProgress = (val) => {
    const v = parseInt(val);
    save({ manual_progress: v, status: v === 100 ? 'done' : localTask.status });
  };

  const bump10 = () => setProgress(Math.min(100, (localTask.manual_progress || 0) + 10));

  const snooze = (days) => {
    const base = localTask.due_date ?? localTask.dueDate;
    if (!base) return;
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + days);
    save({ due_date: d.toISOString().slice(0, 10) });
  };

  const hasSubsteps = (localTask.substeps || []).length > 0;

  return (
    <Modal title="" onClose={onClose} wide>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:12 }}>
        <div>
          <h2 style={{ fontSize:16, fontWeight:500, marginBottom:4 }}>{localTask.name}</h2>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            {cat && <span style={{ fontSize:12, color:'var(--color-text-secondary)' }}>{cat.name}</span>}
            {(localTask.due_date ?? localTask.dueDate) && (
              <span style={{ fontSize:12, color: isOverdue ? 'var(--color-text-danger)' : days !== null && days <= 3 ? '#BA7517' : 'var(--color-text-secondary)' }}>
                {formatDate(localTask.due_date ?? localTask.dueDate)} &middot; {daysStr}
              </span>
            )}
            {isOverdue && <span className="badge" style={{ background:'var(--color-bg-danger)', color:'var(--color-text-danger)' }}>Overdue</span>}
          </div>
        </div>
        <button className="btn btn-sm" style={{ whiteSpace:'nowrap' }} onClick={cycleStatus}>
          {statusBtn}
        </button>
      </div>

      {/* Meta */}
      <div style={{ display:'flex', gap:16, marginBottom:14, flexWrap:'wrap' }}>
        {(localTask.estimated_hours ?? localTask.estimatedHours) && (
          <div>
            <div style={{ fontSize:11, color:'var(--color-text-secondary)' }}>Estimated</div>
            <div style={{ fontSize:13, fontWeight:500 }}>{localTask.estimated_hours ?? localTask.estimatedHours}h</div>
          </div>
        )}
        <div>
          <div style={{ fontSize:11, color:'var(--color-text-secondary)' }}>Remaining</div>
          <div style={{ fontSize:13, fontWeight:500 }}>{rem.toFixed(1)}h</div>
        </div>
        {localTask.priority && (
          <div>
            <div style={{ fontSize:11, color:'var(--color-text-secondary)' }}>Priority</div>
            <div style={{ fontSize:13, fontWeight:500, textTransform:'capitalize' }}>{localTask.priority}</div>
          </div>
        )}
        <div>
          <div style={{ fontSize:11, color:'var(--color-text-secondary)' }}>Status</div>
          <div style={{ fontSize:13, fontWeight:500, textTransform:'capitalize' }}>{localTask.status || 'not started'}</div>
        </div>
      </div>

      {/* Progress */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--color-text-secondary)', marginBottom:4 }}>
          <span>Progress</span><span>{prog}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width:`${prog}%` }} />
        </div>
        {!hasSubsteps && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:8 }}>
            <input
              type="range" min={0} max={100} step={5}
              value={localTask.manual_progress || 0}
              style={{ flex:1, cursor:'pointer', accentColor:'var(--color-text-info)' }}
              onChange={e => setLocalTask(p => ({ ...p, manual_progress: parseInt(e.target.value) }))}
              onMouseUp={e  => setProgress(e.target.value)}
              onTouchEnd={e => setProgress(e.target.value)}
            />
            <span style={{ fontSize:12, minWidth:34 }}>{localTask.manual_progress || 0}%</span>
            <button className="btn btn-sm" onClick={bump10}>+10%</button>
          </div>
        )}
      </div>

      {/* Substeps */}
      {hasSubsteps && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginBottom:6, fontWeight:500 }}>Substeps</div>
          <div className="substep-list">
            {(localTask.substeps || []).map((s, i) => (
              <div
                key={i} className="substep"
                draggable
                onDragStart={e => { dragIdx.current = i; e.currentTarget.style.opacity = '0.4'; }}
                onDragEnd={e   => { e.currentTarget.style.opacity = '1'; }}
                onDragOver={e  => e.preventDefault()}
                onDrop={e      => { e.preventDefault(); moveSubstep(dragIdx.current, i); }}
              >
                <span
                  className={`substep-check${s.done ? ' done' : ''}`}
                  onClick={() => toggleSubstep(i)}
                >{s.done ? '✓' : ''}</span>
                <span className={`substep-text${s.done ? ' done' : ''}`} style={{ flex:1 }}>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {localTask.notes && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginBottom:4, fontWeight:500 }}>Notes</div>
          <div className="notes-text">{localTask.notes}</div>
        </div>
      )}

      {/* Snooze */}
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
        <span style={{ fontSize:11, color:'var(--color-text-secondary)' }}>Snooze:</span>
        {(localTask.due_date ?? localTask.dueDate) ? (
          <>
            <button className="btn btn-sm" onClick={() => snooze(1)}>1 day</button>
            <button className="btn btn-sm" onClick={() => snooze(7)}>1 week</button>
          </>
        ) : (
          <span style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>No due date set</span>
        )}
      </div>

      {/* Actions */}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => { onClose(); onEdit(localTask); }}>Edit</button>
        <button className="btn btn-danger"
          onClick={() => { if (window.confirm(`Delete “${localTask.name}”?`)) { onDelete(localTask.id); onClose(); } }}
        >Delete</button>
      </div>
    </Modal>
  );
}
