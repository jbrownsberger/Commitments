/**
 * TaskPanel — full-detail modal for a single task.
 * Matches the screenshot: header, meta row, weighted substeps with drag-to-reorder,
 * auto-status logic, snooze, notes, footer actions.
 *
 * Auto-status rules:
 *   progress > 0 and < 100  →  'in progress'
 *   progress === 100         →  'done'
 *   progress === 0           →  'not started'
 *
 * Substep weights are DISPLAY-ONLY here. To change a weight, use Edit mode
 * (TaskModal), which has a proper Save button.
 */
import React, { useState, useRef } from 'react';
import Modal from './Modal.jsx';

const STATUS_CYCLE = ['not started', 'in progress', 'done'];

// ── Helpers exported for use in Overview/Planner ───────────────────────────

export function taskProgress(task) {
  const substeps = task.substeps || [];
  if (substeps.length === 0) return task.manual_progress ?? task.manualProgress ?? 0;
  const totalWeight = substeps.reduce((s, sub) => s + (sub.weight ?? 1), 0);
  if (totalWeight === 0) return 0;
  const doneWeight  = substeps.filter(s => s.done).reduce((s, sub) => s + (sub.weight ?? 1), 0);
  return Math.round((doneWeight / totalWeight) * 100);
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

// Derive status from numeric progress
function statusFromProgress(prog, currentStatus) {
  if (prog >= 100) return 'done';
  if (prog > 0)    return 'in progress';
  return currentStatus === 'done' ? 'not started' : currentStatus;
}

// Priority badge colors
const PRIORITY_STYLES = {
  low:      { bg: 'var(--color-background-success)', color: 'var(--color-text-success)' },
  med:      { bg: 'var(--color-background-warning)', color: 'var(--color-text-warning)' },
  high:     { bg: '#FAEEDA', color: '#854F0B' },
  critical: { bg: 'var(--color-background-danger)',  color: 'var(--color-text-danger)'  },
};
const PRIORITY_LABELS = { low:'Low', med:'Medium', high:'High', critical:'Critical' };

// ── Recurring cadence helper ───────────────────────────────────────────────
const CADENCE_LABELS = { daily: 'daily', weekday: 'weekdays', weekly: 'weekly' };

function RecurringMeta({ task }) {
  if (!task.recurring || !task.recurring_cadence) return null;

  const cadenceLabel = CADENCE_LABELS[task.recurring_cadence] ?? task.recurring_cadence;

  let lastResetStr = null;
  if (task.updated_at) {
    try {
      lastResetStr = new Date(task.updated_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
      });
    } catch (_) {}
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 12,
      color: 'var(--color-text-info, var(--color-text-secondary))',
      marginTop: 8,
      padding: '5px 8px',
      background: 'var(--color-background-info, rgba(59,130,246,0.06))',
      borderRadius: 'var(--radius-sm, 4px)',
      width: 'fit-content',
    }}>
      <span style={{ fontSize: 13 }}>↻</span>
      <span>Repeats {cadenceLabel}</span>
      {lastResetStr && (
        <span style={{ color: 'var(--color-text-tertiary, var(--color-text-secondary))', marginLeft: 2 }}>
          · last reset {lastResetStr}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function TaskPanel({ task, cat, onClose, onSave, onDelete, onEdit }) {
  const [local, setLocal] = useState({
    ...task,
    substeps: (task.substeps || []).map(s => ({ ...s, weight: s.weight ?? 1 })),
  });
  const dragIdx = useRef(null);

  const prog    = taskProgress(local);
  const rem     = remainingHours(local);
  const days    = daysUntil(local.due_date ?? local.dueDate);
  const isDone  = local.status === 'done';
  const isOverdue = !isDone && (local.due_date ?? local.dueDate) && days < 0;

  const daysStr = !(local.due_date ?? local.dueDate) ? ''
    : days < 0  ? `${Math.abs(days)}d overdue`
    : days === 0 ? 'today'
    : `${days}d left`;

  // Persist a partial update
  const save = (updates) => {
    const next = { ...local, ...updates };
    setLocal(next);
    onSave(next);
  };

  // ── Status button
  const cycleStatus = () => {
    const cur  = STATUS_CYCLE.indexOf(local.status);
    const next = STATUS_CYCLE[(cur + 1) % STATUS_CYCLE.length];
    save({
      status: next,
      manual_progress: next === 'done' ? 100 : next === 'not started' ? 0 : local.manual_progress,
    });
  };
  const statusBtnLabel = isDone ? 'Reopen'
    : local.status === 'in progress' ? 'Mark done'
    : '\u25ba Start';

  // ── Substep toggle
  const toggleSubstep = (idx) => {
    const substeps = local.substeps.map((s, i) => i === idx ? { ...s, done: !s.done } : s);
    const newProg  = taskProgress({ ...local, substeps });
    save({ substeps, status: statusFromProgress(newProg, local.status), manual_progress: newProg });
  };

  // ── Substep drag-to-reorder
  const moveSubstep = (from, to) => {
    if (from === to) return;
    const subs = [...local.substeps];
    const [moved] = subs.splice(from, 1);
    subs.splice(to, 0, moved);
    save({ substeps: subs });
  };

  // ── Manual progress slider (no-substep mode)
  const setProgress = (val) => {
    const v      = parseInt(val);
    const status = statusFromProgress(v, local.status);
    save({ manual_progress: v, status });
  };

  // ── Snooze
  const snooze = (numDays) => {
    const base = local.due_date ?? local.dueDate;
    if (!base) return;
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + numDays);
    save({ due_date: d.toISOString().slice(0, 10) });
  };

  const hasSubsteps = local.substeps.length > 0;
  const priorityStyle = PRIORITY_STYLES[local.priority] || {};

  return (
    <Modal title="" onClose={onClose} wide>
      {/* ── Header ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, marginBottom:16 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6, lineHeight:1.2 }}>{local.name}</h2>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            {cat?.name && (
              <span style={{ fontSize:13, color:'var(--color-text-secondary)' }}>{cat.name}</span>
            )}
            {(local.due_date ?? local.dueDate) && (
              <span style={{
                fontSize:13,
                color: isOverdue ? 'var(--color-text-danger)' : days !== null && days <= 3 ? '#BA7517' : 'var(--color-text-secondary)'
              }}>
                {formatDate(local.due_date ?? local.dueDate)}
                {daysStr && <span style={{ marginLeft:4 }}>({daysStr})</span>}
              </span>
            )}
            {local.priority && local.priority !== 'med' && (
              <span className="badge" style={{ background: priorityStyle.bg, color: priorityStyle.color }}>
                {PRIORITY_LABELS[local.priority] || local.priority}
              </span>
            )}
          </div>
          <RecurringMeta task={local} />
        </div>
        <button className="btn" style={{ whiteSpace:'nowrap', flexShrink:0 }} onClick={cycleStatus}>
          {statusBtnLabel}
        </button>
      </div>

      {/* ── Meta row ── */}
      <div style={{ display:'flex', gap:24, marginBottom:20, borderTop:'0.5px solid var(--color-border-tertiary)', borderBottom:'0.5px solid var(--color-border-tertiary)', padding:'12px 0' }}>
        {(local.estimated_hours ?? local.estimatedHours) && (
          <div>
            <div style={{ fontSize:11, color:'var(--color-text-secondary)', marginBottom:2 }}>Estimated</div>
            <div style={{ fontSize:15, fontWeight:600 }}>{local.estimated_hours ?? local.estimatedHours}h</div>
          </div>
        )}
        <div>
          <div style={{ fontSize:11, color:'var(--color-text-secondary)', marginBottom:2 }}>Remaining</div>
          <div style={{ fontSize:15, fontWeight:600 }}>{rem.toFixed(1)}h</div>
        </div>
        <div>
          <div style={{ fontSize:11, color:'var(--color-text-secondary)', marginBottom:2 }}>Status</div>
          <div style={{ fontSize:15, fontWeight:600, textTransform:'capitalize' }}>{local.status || 'not started'}</div>
        </div>
      </div>

      {/* ── Progress ── */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:13, color:'var(--color-text-secondary)', marginBottom:6 }}>
          <span>Progress</span>
          <span>{prog}%</span>
        </div>
        <div className="progress-track" style={{ height:6, borderRadius:3 }}>
          <div className="progress-fill" style={{ width:`${prog}%` }} />
        </div>
        {!hasSubsteps && (
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:10 }}>
            <input
              type="range" min={0} max={100} step={5}
              value={local.manual_progress || 0}
              style={{ flex:1, cursor:'pointer', accentColor:'var(--color-text-info)' }}
              onChange={e => setLocal(p => ({ ...p, manual_progress: parseInt(e.target.value) }))}
              onMouseUp={e  => setProgress(e.target.value)}
              onTouchEnd={e => setProgress(e.currentTarget.value)}
            />
            <span style={{ fontSize:12, minWidth:34 }}>{local.manual_progress || 0}%</span>
            <button className="btn btn-sm" onClick={() => setProgress(Math.min(100, (local.manual_progress || 0) + 10))}>+10%</button>
          </div>
        )}
      </div>

      {/* ── Substeps ── */}
      {hasSubsteps && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
            Substeps
            <span style={{ fontSize:12, fontWeight:400, color:'var(--color-text-tertiary)' }}>— drag to reorder</span>
          </div>
          {local.substeps.map((s, i) => (
            <div
              key={i}
              style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'6px 0',
                borderBottom:'0.5px solid var(--color-border-tertiary)',
                cursor:'default',
              }}
              draggable
              onDragStart={e => {
                dragIdx.current = i;
                e.currentTarget.style.opacity = '0.4';
              }}
              onDragEnd={e => { e.currentTarget.style.opacity = '1'; }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); moveSubstep(dragIdx.current, i); }}
            >
              {/* drag handle */}
              <span style={{ color:'var(--color-text-tertiary)', cursor:'grab', fontSize:14, userSelect:'none' }}>⠇</span>
              {/* checkbox */}
              <input
                type="checkbox"
                checked={!!s.done}
                onChange={() => toggleSubstep(i)}
                style={{ width:16, height:16, cursor:'pointer', flexShrink:0 }}
              />
              {/* text */}
              <span style={{
                flex:1, fontSize:14,
                textDecoration: s.done ? 'line-through' : 'none',
                color: s.done ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
              }}>{s.text}</span>
              {/* weight — read-only display; edit via Edit button → TaskModal */}
              {(s.weight ?? 1) !== 1 && (
                <span
                  style={{ fontSize:11, color:'var(--color-text-tertiary)' }}
                  title="Substep weight (edit in Edit mode to change)"
                >
                  wt:{s.weight}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Notes ── */}
      {local.notes && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:4 }}>Notes</div>
          <div style={{ fontSize:13, color:'var(--color-text-secondary)', fontStyle:'italic' }}>{local.notes}</div>
        </div>
      )}

      {/* ── Snooze ── */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:20 }}>
        <span style={{ fontSize:12, color:'var(--color-text-secondary)' }}>Snooze:</span>
        {(local.due_date ?? local.dueDate) ? (
          <>
            <button className="btn btn-sm" onClick={() => snooze(1)}>+1 day</button>
            <button className="btn btn-sm" onClick={() => snooze(7)}>+1 week</button>
          </>
        ) : (
          <span style={{ fontSize:12, color:'var(--color-text-tertiary)' }}>No due date set</span>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => { onEdit(local); onClose(); }}>Edit</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm(`Delete "${local.name}"?`)) { onDelete(local.id); onClose(); }
          }}
        >Delete</button>
      </div>
    </Modal>
  );
}
